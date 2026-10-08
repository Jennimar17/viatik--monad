// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LedgerFixture} from "./utils/LedgerFixture.sol";
import {ViatikLedger} from "../src/ViatikLedger.sol";

/// v3 of the ledger: an Agency Admin pays outside Viatik (a tool, a subscription) by sending
/// TestUSD to an address, anchors the invoice once, and returns capital to the Investor's
/// Portfolio Vault. Every money test ends by checking that the tokens the ledger holds equal
/// the balances it has booked.
contract ViatikLedgerV3Test is LedgerFixture {
    bytes32 internal constant NONE = bytes32(0);
    bytes32 internal constant OPEN = keccak256("qa:bud_open");
    bytes32 internal constant SPARE = keccak256("qa:acct_spare");
    bytes32 internal constant INVOICE = keccak256("qa:invoice_claude_teams");

    address internal tool = makeAddr("tool");

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// The tokens in the ledger equal every balance it has booked (both agencies, if built).
    function _backed() internal view {
        bytes32[11] memory places = [PF_VAULT, FUND_VAULT, OPS, BUD, OPEN, SPARE, PF2_VAULT, FUND_VAULT2, OPS2, BUD2, NONE];
        uint256 booked;
        for (uint256 i; i < places.length; ++i) {
            booked += ledger.balanceOf(places[i]);
        }
        booked += ledger.memberBalance(AG, member) + ledger.memberBalance(AG, admin);
        booked += ledger.memberBalance(AG2, member2) + ledger.memberBalance(AG2, admin2);
        assertEq(token.balanceOf(address(ledger)), booked, "tokens back every booked balance");
    }

    function _addr(address who) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(who)));
    }

    /// A budget that accepts any destination: 2,000 allocated from Operations, 1,000 per operation.
    function _openBudget() internal {
        vm.prank(admin);
        ledger.createBudget(OPEN, OPS, 1_000 * USD, 200 * USD, new bytes32[](0), 2_000 * USD);
    }

    function _payOutside(bytes32 opId, bytes32 source, uint256 amount, bytes32 evidence) internal {
        vm.prank(admin);
        ledger.payOutside(opId, source, tool, amount, evidence);
    }

    // ─── payOutside ─────────────────────────────────────────────────────────

    function test_AdminPaysOutsideFromAnAccount() public {
        bytes32 opId = _id("out_1");
        uint256 amount = 300 * USD;
        uint256 ops = ledger.balanceOf(OPS);
        bytes32 hash = ledger.receiptHash(opId, ViatikLedger.ReceiptKind.OutsidePayment, amount, OPS, _addr(tool), INVOICE);

        vm.expectEmit(true, true, true, true);
        emit ViatikLedger.PaidOutside(opId, AG, tool, OPS, amount, INVOICE);
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.Recorded(opId, admin, hash);
        _payOutside(opId, OPS, amount, INVOICE);

        assertEq(ledger.balanceOf(OPS), ops - amount, "Operations pays it");
        assertEq(token.balanceOf(tool), amount, "the tokens reach the address");
        (bool paid, bytes32 proof) = ledger.outsidePayment(AG, opId);
        assertTrue(paid);
        assertEq(proof, INVOICE);
        _backed();
    }

    function test_PayOutsideFromAnOpenBudgetFollowsPauseAndPerOperation() public {
        _openBudget();
        _payOutside(_id("out_b1"), OPEN, 400 * USD, NONE);
        assertEq(ledger.balanceOf(OPEN), 1_600 * USD);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.PerOperation, 1_000 * USD, 1_001 * USD)
        );
        ledger.payOutside(_id("out_b2"), OPEN, tool, 1_001 * USD, NONE);

        vm.prank(admin);
        ledger.setBudgetPaused(OPEN, true);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.BudgetPaused.selector, OPEN));
        ledger.payOutside(_id("out_b3"), OPEN, tool, 10 * USD, NONE);
        _backed();
    }

    /// A budget limited to approved vendors never pays an address: its list names vendors.
    function test_PayOutsideFromARestrictedBudgetIsRefused() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.DestinationNotAllowed.selector, BUD, NONE));
        ledger.payOutside(_id("out_r"), BUD, tool, 10 * USD, NONE);
    }

    function test_PayOutsideAboveTheExceptionThresholdReverts() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, EXCEPTION, EXCEPTION + 1)
        );
        ledger.payOutside(_id("out_x"), OPS, tool, EXCEPTION + 1, NONE);
        // Right at the threshold is fine.
        _payOutside(_id("out_x2"), OPS, EXCEPTION, NONE);
        _backed();
    }

    function test_PayOutsideCannotOverdraw() public {
        vm.startPrank(admin);
        ledger.createAccount(SPARE, AG, false);
        ledger.transfer(_id("drain"), OPS, SPARE, ledger.balanceOf(OPS));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, OPS, 0, 1));
        ledger.payOutside(_id("out_o"), OPS, tool, 1, NONE);
        vm.stopPrank();
        _backed();
    }

    function test_OnlyAnAdminOfTheAgencyPaysOutside() public {
        _buildSecondAgency();
        address[4] memory others = [investor, member, stranger, admin2];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.payOutside(_id("out_who"), OPS, tool, 1 * USD, NONE);
        }
    }

    function test_PayOutsideRejectsBadInputs() public {
        bytes32 opId = _id("out_bad");
        address[3] memory bad = [address(0), address(ledger), address(token)];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(admin);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
            ledger.payOutside(opId, OPS, bad[i], 1 * USD, NONE);
        }
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.payOutside(opId, OPS, tool, 0, NONE);
        // Only an account or a budget pays: never a vault.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, FUND_VAULT));
        ledger.payOutside(opId, FUND_VAULT, tool, 1 * USD, NONE);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, PF_VAULT));
        ledger.payOutside(opId, PF_VAULT, tool, 1 * USD, NONE);
    }

    function test_PayOutsideOpIdRunsOncePerActor() public {
        bytes32 opId = _id("out_once");
        _payOutside(opId, OPS, 1 * USD, NONE);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.payOutside(opId, OPS, tool, 1 * USD, NONE);
    }

    // ─── recordEvidence ─────────────────────────────────────────────────────

    function test_AnAdminAnchorsTheInvoiceOnce() public {
        bytes32 opId = _id("out_ev");
        _payOutside(opId, OPS, 30 * USD, NONE);
        (, bytes32 before) = ledger.outsidePayment(AG, opId);
        assertEq(before, NONE, "no proof yet");

        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.EvidenceRecorded(opId, AG, admin, INVOICE);
        vm.prank(admin);
        ledger.recordEvidence(AG, opId, INVOICE);
        (, bytes32 proof) = ledger.outsidePayment(AG, opId);
        assertEq(proof, INVOICE);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.recordEvidence(AG, opId, keccak256("another"));
    }

    function test_EvidenceGivenWithThePaymentCannotBeReplaced() public {
        bytes32 opId = _id("out_ev2");
        _payOutside(opId, OPS, 30 * USD, INVOICE);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.recordEvidence(AG, opId, keccak256("another"));
    }

    function test_EvidenceNeedsAnOutsidePaymentOfThatAgency() public {
        bytes32 opId = _id("out_ev3");
        // Nothing was paid under that id.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, opId));
        ledger.recordEvidence(AG, opId, INVOICE);

        _payOutside(opId, OPS, 30 * USD, NONE);
        // A zero fingerprint is no proof.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.recordEvidence(AG, opId, NONE);

        // Another agency's Admin cannot anchor it, under either agency.
        _buildSecondAgency();
        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin2));
        ledger.recordEvidence(AG, opId, INVOICE);
        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, opId));
        ledger.recordEvidence(AG2, opId, INVOICE);
    }

    function test_OnlyAnAdminAnchorsEvidence() public {
        bytes32 opId = _id("out_ev4");
        _payOutside(opId, OPS, 30 * USD, NONE);
        address[3] memory others = [investor, member, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.recordEvidence(AG, opId, INVOICE);
        }
    }

    // ─── returnCapital ──────────────────────────────────────────────────────

    function test_AdminReturnsCapitalToThePortfolioVault() public {
        bytes32 opId = _id("ret_1");
        uint256 amount = 5_000 * USD;
        uint256 vault = ledger.balanceOf(PF_VAULT);
        uint256 ops = ledger.balanceOf(OPS);
        ViatikLedger.Agreement memory before = ledger.getAgreement(FA);
        bytes32 hash = ledger.receiptHash(opId, ViatikLedger.ReceiptKind.CapitalReturn, amount, OPS, PF_VAULT, NONE);

        vm.expectEmit(true, true, true, true);
        emit ViatikLedger.CapitalReturned(opId, AG, FA, OPS, PF_VAULT, amount);
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.Recorded(opId, admin, hash);
        vm.prank(admin);
        ledger.returnCapital(opId, OPS, PF_VAULT, FA, amount, NONE);

        assertEq(ledger.balanceOf(PF_VAULT), vault + amount, "the Portfolio Vault gets it back");
        assertEq(ledger.balanceOf(OPS), ops - amount);
        ViatikLedger.Agreement memory afterwards = ledger.getAgreement(FA);
        assertEq(afterwards.funded, before.funded, "funded is history");
        assertEq(afterwards.released, before.released, "released is history");

        // The Investor can now take it out like any capital in the Portfolio Vault.
        vm.prank(investor);
        ledger.withdraw(_id("ret_wd"), PF, PF_VAULT, vault + amount, investor);
        assertEq(ledger.balanceOf(PF_VAULT), 0);
        _backed();
    }

    function test_ReturnCapitalWithoutAnAgreement() public {
        vm.prank(admin);
        ledger.returnCapital(_id("ret_none"), OPS, PF_VAULT, NONE, 1 * USD, NONE);
        _backed();
    }

    function test_ReturnCapitalOnlyFromAnAccountOfTheAgency() public {
        // A budget or a funding vault is not an account.
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, BUD));
        ledger.returnCapital(_id("ret_b"), BUD, PF_VAULT, FA, 1 * USD, NONE);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, FUND_VAULT));
        ledger.returnCapital(_id("ret_f"), FUND_VAULT, PF_VAULT, FA, 1 * USD, NONE);
        vm.stopPrank();
        // Another agency's account: this Admin has no role there.
        _buildSecondAgency();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.returnCapital(_id("ret_o"), OPS2, PF_VAULT, NONE, 1 * USD, NONE);
    }

    function test_ReturnCapitalOnlyToTheAgencysPortfolioVault() public {
        _buildSecondAgency();
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF2_VAULT));
        ledger.returnCapital(_id("ret_v"), OPS, PF2_VAULT, NONE, 1 * USD, NONE);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, FUND_VAULT));
        ledger.returnCapital(_id("ret_v2"), OPS, FUND_VAULT, NONE, 1 * USD, NONE);
        vm.stopPrank();
    }

    function test_ReturnCapitalAgreementMustBelongToTheAgency() public {
        _buildSecondAgency();
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FA2));
        ledger.returnCapital(_id("ret_a"), OPS, PF_VAULT, FA2, 1 * USD, NONE);
        bytes32 unknown = _id("fa_unknown");
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, unknown));
        ledger.returnCapital(_id("ret_a2"), OPS, PF_VAULT, unknown, 1 * USD, NONE);
        vm.stopPrank();
    }

    function test_OnlyAnAdminReturnsCapital() public {
        address[3] memory others = [investor, member, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.returnCapital(_id("ret_who"), OPS, PF_VAULT, FA, 1 * USD, NONE);
        }
    }

    function test_ReturnCapitalWhileTheAgreementIsPaused() public {
        vm.prank(investor);
        ledger.setAgreementPaused(FA, true);
        vm.prank(admin);
        ledger.returnCapital(_id("ret_p"), OPS, PF_VAULT, FA, 1_000 * USD, NONE);
        _backed();
    }

    function test_ReturnCapitalRejectsZeroOverdrawAndReplays() public {
        bytes32 opId = _id("ret_z");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.returnCapital(opId, OPS, PF_VAULT, FA, 0, NONE);

        uint256 ops = ledger.balanceOf(OPS);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, OPS, ops, ops + 1));
        ledger.returnCapital(opId, OPS, PF_VAULT, FA, ops + 1, NONE);

        vm.prank(admin);
        ledger.returnCapital(opId, OPS, PF_VAULT, FA, 1 * USD, NONE);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.returnCapital(opId, OPS, PF_VAULT, FA, 1 * USD, NONE);
        _backed();
    }

    // ─── Genesis ────────────────────────────────────────────────────────────

    function test_ImportOutsidePaymentOnlyOwnerOnceAndMovesNothing() public {
        bytes32 opId = _id("out_seeded");
        uint256 held = token.balanceOf(address(ledger));

        vm.prank(admin);
        vm.expectRevert();
        ledger.importOutsidePayment(AG, opId, NONE);

        ledger.importOutsidePayment(AG, opId, NONE);
        (bool paid, bytes32 proof) = ledger.outsidePayment(AG, opId);
        assertTrue(paid);
        assertEq(proof, NONE);
        assertEq(token.balanceOf(address(ledger)), held, "nothing moves");

        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.importOutsidePayment(AG, opId, NONE);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF));
        ledger.importOutsidePayment(PF, _id("out_seeded2"), NONE);

        // An imported payment without proof can still get its invoice anchored.
        vm.prank(admin);
        ledger.recordEvidence(AG, opId, INVOICE);
        (, bytes32 anchored) = ledger.outsidePayment(AG, opId);
        assertEq(anchored, INVOICE);
    }

    // ─── Receipt kinds ──────────────────────────────────────────────────────

    /// The new kinds are appended: every existing number stays where it was.
    function test_NewReceiptKindsAreAppended() public pure {
        assertEq(uint8(ViatikLedger.ReceiptKind.Withdrawal), 9);
        assertEq(uint8(ViatikLedger.ReceiptKind.OutsidePayment), 10);
        assertEq(uint8(ViatikLedger.ReceiptKind.CapitalReturn), 11);
    }

    /// The receipt hash is keccak256(abi.encode(opId, kind, amount, from, to, evidenceHash)),
    /// the same formula the app recomputes when it confirms a transaction.
    function test_ReceiptHashForTheNewKinds() public view {
        bytes32 opId = keccak256("vector:op");
        bytes32 from = keccak256("vector:from");
        bytes32 to = bytes32(uint256(uint160(address(0xBEEF))));
        assertEq(
            ledger.receiptHash(opId, ViatikLedger.ReceiptKind.OutsidePayment, 1_234_560_000, from, to, INVOICE),
            keccak256(abi.encode(opId, uint8(10), uint256(1_234_560_000), from, to, INVOICE))
        );
        assertEq(
            ledger.receiptHash(opId, ViatikLedger.ReceiptKind.CapitalReturn, 5, from, to, NONE),
            keccak256(abi.encode(opId, uint8(11), uint256(5), from, to, NONE))
        );
    }

    // ─── The whole thing ────────────────────────────────────────────────────

    /// Fund, release, pay a tool outside Viatik with its invoice, return what is left.
    function test_TheAgencyPaysAToolAndReturnsTheRest() public {
        _payOutside(_id("claude_teams"), OPS, 150 * USD, NONE);
        vm.prank(admin);
        ledger.recordEvidence(AG, _id("claude_teams"), INVOICE);
        uint256 left = ledger.balanceOf(OPS);
        vm.prank(admin);
        ledger.returnCapital(_id("give_back"), OPS, PF_VAULT, FA, left, NONE);
        assertEq(ledger.balanceOf(OPS), 0);
        assertEq(token.balanceOf(tool), 150 * USD);
        _backed();
    }
}

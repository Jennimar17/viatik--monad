// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ITestUSD, ViatikLedger} from "../src/ViatikLedger.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Who can touch what: two unrelated agencies and a stranger, self-approval through
/// two roles, multicall's sender and atomicity, role permits (EIP-712), revocations
/// and the owner-only configuration.
contract ViatikLedgerAccessTest is LedgerFixture {
    address internal bob = makeAddr("bob");
    address internal coInvestor = makeAddr("co-investor");

    bytes32 internal constant BUD_BIG = keccak256("qa:bud_big");
    bytes32 internal constant FA_M = keccak256("qa:fa_m");
    bytes32 internal constant VAULT_M = keccak256("qa:vault_m");
    bytes32 internal constant TM = keccak256("qa:tr_m");
    bytes32 internal constant FA_PENDING = keccak256("qa:fa_pending");
    bytes32 internal constant VAULT_PENDING = keccak256("qa:vault_pending");
    bytes32 internal constant TP = keccak256("qa:tr_pending");
    bytes32 internal constant REQ_PENDING = keccak256("qa:req_450");
    bytes32 internal constant REQ_EXCEPTION = keccak256("qa:req_3000");
    bytes32 internal constant REQ_SELF = keccak256("qa:req_self");
    bytes32 internal constant NOWHERE = keccak256("qa:nowhere");

    uint256 internal constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function setUp() public override {
        super.setUp();
        _buildSecondAgency();
    }

    // ─── 1. Cross-agency isolation ─────────────────────────────────────────

    /// admin2, member2, investor2 and a stranger try every AG resource: each call is
    /// refused with NotAuthorized(caller), and nothing in either agency moves.
    function test_OtherAgencyAndStrangersAreRefusedOnEveryAgencyResource() public {
        _openAgencyBusiness();
        bytes32 before = _agencyState();

        address[4] memory attackers = [admin2, member2, investor2, stranger];
        for (uint256 a; a < attackers.length; ++a) {
            address attacker = attackers[a];
            bytes[] memory calls = _callsIntoTheAgency(attacker);
            bytes memory refused = abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, attacker);
            for (uint256 i; i < calls.length; ++i) {
                _assertRefused(attacker, calls[i], refused, i);
            }
            assertEq(uint8(ledger.roleOf(AG, attacker)), uint8(ViatikLedger.Role.None));
            assertFalse(ledger.getAllowance(BUD, attacker).active);
            assertFalse(ledger.processed(attacker, _id("x_pay")));
        }

        assertEq(_agencyState(), before, "nothing in either agency changed");
        assertEq(uint8(ledger.getRequest(REQ_PENDING).status), uint8(ViatikLedger.RequestStatus.Pending));
        assertEq(uint8(ledger.getRequest(REQ_EXCEPTION).status), uint8(ViatikLedger.RequestStatus.Pending));
        assertEq(uint8(ledger.getTranche(TM).status), uint8(ViatikLedger.TrancheStatus.Requested));
        assertEq(uint8(ledger.getAgreement(FA_PENDING).status), uint8(ViatikLedger.AgreementStatus.Pending));
        assertEq(ledger.memberBalance(AG2, member2), 100 * USD);
    }

    /// The second agency's own roles do not stretch to the first agency's ids either.
    function test_SecondAgencyRolesCannotReachIntoTheFirst() public {
        // An unbound funding vault of a third agency, under PF.
        bytes32 ag3 = _id("ag_three");
        bytes32 vault3 = _id("vault_three");
        vm.prank(investor);
        ledger.registerAgency(ag3, PF, vault3);
        bytes32 before = _agencyState();
        bytes32[] memory any = new bytes32[](0);

        // investor2 cannot fund its own agreement, or deposit, through PF's vault.
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF_VAULT));
        ledger.fundAgreement(_id("x_fund"), FA2, PF_VAULT, 1 * USD);

        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF_VAULT));
        ledger.deposit(_id("x_dep"), PF2, PF_VAULT, 1 * USD);

        // ...nor bind another agency's funding vault, bound or free, to an AG2 agreement.
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FUND_VAULT));
        ledger.createAgreement(
            _id("x_fa"), AG2, FUND_VAULT, 1 * USD, 0, _ids(_id("x_tr")), _amounts(1 * USD), _flags(false)
        );

        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, vault3));
        ledger.createAgreement(
            _id("x_fa"), AG2, vault3, 1 * USD, 0, _ids(_id("x_tr")), _amounts(1 * USD), _flags(false)
        );

        // ...nor register AG again under PF2, or reuse AG's ids for AG2.
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, AG));
        ledger.registerAgency(AG, PF2, _id("x_vault"));

        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, OPS));
        ledger.createAccount(OPS, AG2, false);

        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, BUD));
        ledger.createBudget(BUD, OPS2, PER_OP, 0, any, 0);

        // admin2 cannot pay, or give spending access to, a person outside AG2.
        bytes32 memberId = bytes32(uint256(uint160(member)));
        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, memberId));
        ledger.pay(_id("x_pay"), OPS2, bytes32(0), member, 1 * USD, bytes32(0));

        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, memberId));
        ledger.setAllowance(BUD2, member, true, 0);

        assertEq(_agencyState(), before);
        assertEq(ledger.vaultAgreement(vault3), bytes32(0));
    }

    /// And the other way around: AG's people cannot move money into or out of AG2.
    function test_FirstAgencyRolesCannotReachIntoTheSecond() public {
        bytes32 before = _agencyState();

        // Money never leaves an agency through a transfer, even by its own Admin.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.transfer(_id("x_xfer"), OPS, OPS2, 1 * USD);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.pay(_id("x_pay"), OPS2, VERCEL, address(0), 1 * USD, bytes32(0));

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.requestPayment(_id("x_req"), _id("x_pay"), BUD2, VERCEL, address(0), 1 * USD, bytes32(0));

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.returnToAgency(_id("x_ret"), AG2, 1 * USD);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.setBudgetPaused(BUD2, true);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.revokeRole(AG2, admin2);

        assertEq(_agencyState(), before);
    }

    // ─── 2. No self-approval through two roles ─────────────────────────────

    /// The Investor joins her own agency as a Member, asks for an exception and cannot
    /// approve it; the Admin cannot either, so it waits until she cancels it.
    function test_InvestorAsMemberCannotApproveHerOwnException() public {
        _openBigBudget();
        _join(investor, AG, ViatikLedger.Role.Member, 0);
        _allow(BUD_BIG, investor);

        vm.prank(investor);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(REQ_SELF, _id("pay_self_a"), BUD_BIG, VERCEL, address(0), 3_000 * USD, bytes32(0));
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Pending));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.approvePayment(REQ_SELF, _id("pay_self"));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.approvePayment(REQ_SELF, _id("pay_self"));

        // Another Member cannot close someone else's request.
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.closeRequest(REQ_SELF);

        // Closing it herself is a cancel, not a decline.
        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(REQ_SELF, investor, false);
        vm.prank(investor);
        ledger.closeRequest(REQ_SELF);

        assertEq(uint8(ledger.getRequest(REQ_SELF).status), uint8(ViatikLedger.RequestStatus.Closed));
        assertEq(ledger.balanceOf(BUD_BIG), 6_000 * USD);
        assertEq(token.balanceOf(sink), 0);
    }

    /// Batching the request and the approval in one multicall does not help: the
    /// approval sees the same wallet and the whole batch is undone.
    function test_SelfApprovalFailsInsideOneMulticall() public {
        _openBigBudget();
        _join(investor, AG, ViatikLedger.Role.Member, 0);
        _join(coInvestor, PF, ViatikLedger.Role.Investor, 0);
        _allow(BUD_BIG, investor);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(
            ViatikLedger.requestPayment,
            (REQ_SELF, _id("pay_self_a"), BUD_BIG, VERCEL, address(0), 3_000 * USD, bytes32(0))
        );
        calls[1] = abi.encodeCall(ViatikLedger.approvePayment, (REQ_SELF, _id("pay_self")));
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.multicall(calls);

        assertEq(uint8(ledger.getRequest(REQ_SELF).status), uint8(ViatikLedger.RequestStatus.None));
        assertFalse(ledger.processed(investor, REQ_SELF));
        assertEq(ledger.balanceOf(BUD_BIG), 6_000 * USD);

        // Asked on its own, another Investor of the portfolio decides it.
        vm.prank(investor);
        ledger.requestPayment(REQ_SELF, _id("pay_self_a"), BUD_BIG, VERCEL, address(0), 3_000 * USD, bytes32(0));
        vm.expectEmit(address(ledger));
        emit ViatikLedger.PaymentApproved(REQ_SELF, _id("pay_self"), coInvestor);
        vm.prank(coInvestor);
        ledger.approvePayment(REQ_SELF, _id("pay_self"));
        assertEq(uint8(ledger.getRequest(REQ_SELF).status), uint8(ViatikLedger.RequestStatus.Executed));
        assertEq(token.balanceOf(sink), 3_000 * USD);
    }

    /// Same with the Admin hat: the Investor who is also an Agency Admin cannot approve
    /// her own (non-exception) request; the other Admin can.
    function test_InvestorAsAdminCannotApproveHerOwnRequest() public {
        _join(investor, AG, ViatikLedger.Role.Admin, 0);
        _allow(BUD, investor);

        vm.prank(investor);
        ledger.requestPayment(REQ_SELF, _id("pay_self_a"), BUD, VERCEL, address(0), 450 * USD, bytes32(0));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.approvePayment(REQ_SELF, _id("pay_self"));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.PaymentApproved(REQ_SELF, _id("pay_self"), admin);
        vm.prank(admin);
        ledger.approvePayment(REQ_SELF, _id("pay_self"));
        assertEq(token.balanceOf(sink), 450 * USD);
        assertEq(ledger.balanceOf(BUD), 4_550 * USD);
    }

    /// An Investor who sent milestone evidence as Admin can neither send it back nor
    /// release it; a second Investor of the portfolio can.
    function test_InvestorWhoRequestedAMilestoneCannotJudgeIt() public {
        _join(investor, AG, ViatikLedger.Role.Admin, 0);
        _join(coInvestor, PF, ViatikLedger.Role.Investor, 0);
        _activeMilestoneAgreement();

        vm.prank(investor);
        ledger.requestTranche(TM, OPS, EVIDENCE);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.requestChanges(TM, false);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.releaseTranche(TM, bytes32(0));

        vm.prank(coInvestor);
        ledger.releaseTranche(TM, keccak256("qa:decision_m"));
        assertEq(uint8(ledger.getTranche(TM).status), uint8(ViatikLedger.TrancheStatus.Released));
        assertEq(ledger.balanceOf(OPS), 30_000 * USD);
    }

    // ─── 3. Multicall: sender and atomicity ────────────────────────────────

    /// forge-config: default.fuzz.runs = 256
    function testFuzz_MulticallRecordsTheCallerForEveryPay(uint8 rawCount) public {
        uint256 count = bound(rawCount, 1, 8);
        bytes[] memory calls = new bytes[](count);
        uint256 total;
        for (uint256 i; i < count; ++i) {
            calls[i] =
                abi.encodeCall(ViatikLedger.pay, (_batchId(i), OPS, VERCEL, address(0), (i + 1) * USD, bytes32(0)));
            total += (i + 1) * USD;
        }

        vm.recordLogs();
        vm.prank(admin);
        ledger.multicall(calls);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 seen;
        for (uint256 j; j < logs.length; ++j) {
            if (logs[j].emitter != address(ledger) || logs[j].topics[0] != ViatikLedger.Recorded.selector) continue;
            bytes32 opId = _batchId(seen);
            bytes32 expected =
                ledger.receiptHash(opId, ViatikLedger.ReceiptKind.Payment, (seen + 1) * USD, OPS, VERCEL, bytes32(0));
            assertEq(logs[j].topics[1], opId);
            assertEq(logs[j].topics[2], bytes32(uint256(uint160(admin))), "the actor is the caller");
            assertEq(abi.decode(logs[j].data, (bytes32)), expected);
            assertTrue(ledger.processed(admin, opId));
            assertFalse(ledger.processed(address(ledger), opId));
            ++seen;
        }
        assertEq(seen, count, "one Recorded per pay");
        assertEq(token.balanceOf(sink), total);
        assertEq(ledger.balanceOf(OPS), 20_000 * USD - total);
    }

    function test_AStrangersMulticallRunsAsTheStranger() public {
        bytes32 ownPortfolio = _id("pf_stranger");
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ViatikLedger.createPortfolio, (ownPortfolio, _id("vault_stranger")));
        calls[1] = abi.encodeCall(ViatikLedger.pay, (_id("pay_s"), OPS, VERCEL, address(0), 1 * USD, bytes32(0)));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.multicall(calls);
        assertEq(uint8(ledger.scopeKind(ownPortfolio)), uint8(ViatikLedger.ScopeKind.None), "its own step is undone");

        // An owner-only step is refused for the stranger, not run as the ledger itself.
        bytes[] memory genesis = new bytes[](1);
        genesis[0] = abi.encodeCall(ViatikLedger.importScope, (_id("pf_seed"), _id("ag_seed")));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        ledger.multicall(genesis);
        assertEq(uint8(ledger.scopeKind(_id("pf_seed"))), uint8(ViatikLedger.ScopeKind.None));
    }

    /// createAccount + transfer + acceptAgreement where the accept fails: nothing stays.
    function test_OneFailingCallRollsBackTheWholeMulticall() public {
        bytes32 account = _id("acct_batch");
        bytes32 xfer = _id("xfer_batch");
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(ViatikLedger.createAccount, (account, AG, false));
        calls[1] = abi.encodeCall(ViatikLedger.transfer, (xfer, OPS, account, 500 * USD));
        calls[2] = abi.encodeCall(ViatikLedger.acceptAgreement, (FA)); // already Active

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FA));
        ledger.multicall(calls);

        assertEq(uint8(ledger.getLocation(account).kind), uint8(ViatikLedger.LocationKind.None));
        assertEq(ledger.balanceOf(OPS), 20_000 * USD);
        assertFalse(ledger.processed(admin, xfer));

        // Without the failing step the same command goes through as one unit.
        bytes[] memory fixedCalls = new bytes[](2);
        fixedCalls[0] = calls[0];
        fixedCalls[1] = calls[1];
        vm.prank(admin);
        ledger.multicall(fixedCalls);
        assertEq(ledger.balanceOf(account), 500 * USD);
        assertEq(ledger.balanceOf(OPS), 19_500 * USD);
        assertTrue(ledger.processed(admin, xfer));
    }

    /// A team payout where one payment breaks the exception threshold pays nobody.
    function test_PaymentOverTheExceptionUndoesTheWholeBatch() public {
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(ViatikLedger.pay, (_batchId(0), OPS, VERCEL, address(0), 100 * USD, bytes32(0)));
        calls[1] = abi.encodeCall(ViatikLedger.pay, (_batchId(1), OPS, bytes32(0), member, 50 * USD, bytes32(0)));
        calls[2] = abi.encodeCall(ViatikLedger.pay, (_batchId(2), OPS, VERCEL, address(0), 2_500 * USD, bytes32(0)));

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, EXCEPTION, 2_500 * USD
            )
        );
        ledger.multicall(calls);

        assertEq(ledger.balanceOf(OPS), 20_000 * USD);
        assertEq(ledger.memberBalance(AG, member), 0);
        assertEq(token.balanceOf(sink), 0);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens);
        assertFalse(ledger.processed(admin, _batchId(0)));
        assertFalse(ledger.processed(admin, _batchId(1)));
    }

    // ─── 4. Role permits (EIP-712) ─────────────────────────────────────────

    /// A second ledger with the same registrar: each permit only works where it was signed.
    function test_PermitForAnotherLedgerIsRejected() public {
        ViatikLedger other = new ViatikLedger(ITestUSD(address(token)), registrar, sink);
        vm.startPrank(investor);
        other.createPortfolio(PF, PF_VAULT);
        other.registerAgency(AG, PF, FUND_VAULT);
        vm.stopPrank();

        uint256 deadline = block.timestamp + 1 days;
        bytes memory forOther =
            _permitFor(address(other), registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);
        bytes memory forThis = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, forOther);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        other.join(AG, ViatikLedger.Role.Member, 0, deadline, forThis);

        vm.prank(stranger);
        other.join(AG, ViatikLedger.Role.Member, 0, deadline, forOther);
        assertEq(uint8(other.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.None));
        assertEq(ledger.nonces(stranger), 0);
    }

    function test_PermitOnlyWorksForItsAccount() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory signature = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, bob));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, signature);
        assertEq(uint8(ledger.roleOf(AG, bob)), uint8(ViatikLedger.Role.None));

        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, signature);
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));
    }

    /// The role, scope and deadline are signed: none can be swapped. A permit cannot
    /// upgrade a role someone already has either.
    function test_PermitOnlyGrantsItsRoleInItsScope() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory memberPermit = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);
        bytes memory refused = abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger);

        vm.prank(stranger);
        vm.expectRevert(refused);
        ledger.join(AG, ViatikLedger.Role.Admin, 0, deadline, memberPermit);

        vm.prank(stranger);
        vm.expectRevert(refused);
        ledger.join(AG2, ViatikLedger.Role.Member, 0, deadline, memberPermit);

        vm.prank(stranger);
        vm.expectRevert(refused);
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline + 1, memberPermit);

        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, memberPermit);
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));
        assertEq(uint8(ledger.roleOf(AG2, stranger)), uint8(ViatikLedger.Role.None));

        // Leo (Member of AG, next nonce 1) cannot become Admin with a fresh permit.
        bytes memory upgrade = _permit(registrarKey, member, AG, ViatikLedger.Role.Admin, 1, deadline);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, AG));
        ledger.join(AG, ViatikLedger.Role.Admin, 1, deadline, upgrade);
        assertEq(uint8(ledger.roleOf(AG, member)), uint8(ViatikLedger.Role.Member));
        assertEq(ledger.nonces(member), 1);
    }

    /// Validly signed permits whose role does not fit the scope are NotRegistered, and a
    /// refused permit does not burn the nonce.
    function test_PermitRoleMustFitTheScope() public {
        _expectJoinReverts(AG, ViatikLedger.Role.Investor, AG);
        _expectJoinReverts(PF, ViatikLedger.Role.Admin, PF);
        _expectJoinReverts(PF, ViatikLedger.Role.Member, PF);
        _expectJoinReverts(AG, ViatikLedger.Role.None, AG);
        _expectJoinReverts(PF, ViatikLedger.Role.None, PF);
        _expectJoinReverts(NOWHERE, ViatikLedger.Role.Member, NOWHERE);
        _expectJoinReverts(OPS, ViatikLedger.Role.Member, OPS); // an account is not a scope
        assertEq(ledger.nonces(stranger), 0);

        // An Investor permit on a portfolio works.
        _join(coInvestor, PF, ViatikLedger.Role.Investor, 0);
        assertEq(uint8(ledger.roleOf(PF, coInvestor)), uint8(ViatikLedger.Role.Investor));
    }

    /// The deadline's own second still counts; the next one does not.
    function test_PermitDeadlineIncludesItsLastSecond() public {
        vm.warp(1_000_000);
        bytes memory onTime = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, 1_000_000);
        bytes memory late = _permit(registrarKey, bob, AG, ViatikLedger.Role.Member, 0, 1_000_000);

        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 0, 1_000_000, onTime);
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));

        vm.warp(1_000_001);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, bob));
        ledger.join(AG, ViatikLedger.Role.Member, 0, 1_000_000, late);
        assertEq(ledger.nonces(bob), 0);
    }

    function test_MalformedSignaturesAreNotAuthorized() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory valid = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);
        (bytes32 r, bytes32 s, uint8 v) = _split(valid);

        bytes[] memory malformed = new bytes[](8);
        malformed[0] = "";
        malformed[1] = abi.encodePacked(r, s); // 64 bytes, v missing
        // The registrar's own signature in EIP-2098 compact form: only 65 bytes are accepted.
        malformed[2] = abi.encodePacked(r, bytes32(uint256(s) | (uint256(v - 27) << 255)));
        malformed[3] = abi.encodePacked(valid, uint8(0)); // 66 bytes
        malformed[4] = new bytes(65); // all zeros
        malformed[5] = abi.encodePacked(keccak256("qa:garbage_r"), keccak256("qa:garbage_s"), uint8(28));
        // Its malleable twin (high s, flipped v).
        malformed[6] = abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        malformed[7] = abi.encodePacked(r, s, uint8(v + 2)); // v out of range

        for (uint256 i; i < malformed.length; ++i) {
            vm.prank(stranger);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
            ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, malformed[i]);
        }
        assertEq(ledger.nonces(stranger), 0);

        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, valid);
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));
    }

    /// Only the account's next nonce works, and each nonce works once.
    function test_PermitNonceMustBeTheNextOne() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory refused = abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger);
        bytes memory ahead = _permit(registrarKey, stranger, AG2, ViatikLedger.Role.Member, 1, deadline);

        vm.prank(stranger);
        vm.expectRevert(refused);
        ledger.join(AG2, ViatikLedger.Role.Member, 1, deadline, ahead);

        // The nonce is signed: the nonce-1 permit does not pass as nonce 0.
        vm.prank(stranger);
        vm.expectRevert(refused);
        ledger.join(AG2, ViatikLedger.Role.Member, 0, deadline, ahead);

        _join(stranger, AG, ViatikLedger.Role.Member, 0);

        // A second permit with the used nonce is dead.
        bytes memory sameNonce = _permit(registrarKey, stranger, AG2, ViatikLedger.Role.Member, 0, deadline);
        vm.prank(stranger);
        vm.expectRevert(refused);
        ledger.join(AG2, ViatikLedger.Role.Member, 0, deadline, sameNonce);

        vm.prank(stranger);
        ledger.join(AG2, ViatikLedger.Role.Member, 1, deadline, ahead);
        assertEq(uint8(ledger.roleOf(AG2, stranger)), uint8(ViatikLedger.Role.Member));
        assertEq(ledger.nonces(stranger), 2);
    }

    function test_OnlyRegistrarOrOwnerInvalidatesPermits() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory first = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);
        bytes memory second = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 1, deadline);
        bytes memory third = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 2, deadline);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.invalidatePermit(stranger);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.invalidatePermit(stranger);
        assertEq(ledger.nonces(stranger), 0);

        // The owner (this test contract) burns nonce 0...
        assertEq(ledger.owner(), address(this));
        ledger.invalidatePermit(stranger);
        assertEq(ledger.nonces(stranger), 1);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, first);

        // ...the registrar burns nonce 1...
        vm.prank(registrar);
        ledger.invalidatePermit(stranger);
        assertEq(ledger.nonces(stranger), 2);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 1, deadline, second);

        // ...and a permit for the next nonce still works.
        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 2, deadline, third);
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));
    }

    function test_RotatingTheRegistrarKillsOldPermits() public {
        (address newRegistrar, uint256 newKey) = makeAddrAndKey("registrar-2");
        uint256 deadline = block.timestamp + 1 days;
        bytes memory oldPermit = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);
        bytes memory newPermit = _permit(newKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);

        vm.expectEmit(address(ledger));
        emit ViatikLedger.RegistrarSet(newRegistrar);
        ledger.setRegistrar(newRegistrar);
        assertEq(ledger.registrar(), newRegistrar);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, oldPermit);

        // The old key has lost its other power too.
        vm.prank(registrar);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, registrar));
        ledger.invalidatePermit(stranger);

        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, newPermit);
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.Member));
    }

    // ─── 5. revokeRole ─────────────────────────────────────────────────────

    function test_NobodyRevokesThemselves() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.revokeRole(AG, admin);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.revokeRole(PF, investor);

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.revokeRole(AG, member);

        assertEq(uint8(ledger.roleOf(AG, admin)), uint8(ViatikLedger.Role.Admin));
        assertEq(uint8(ledger.roleOf(PF, investor)), uint8(ViatikLedger.Role.Investor));
        assertEq(uint8(ledger.roleOf(AG, member)), uint8(ViatikLedger.Role.Member));
    }

    function test_InvestorRevokesAnAgencyAdmin() public {
        vm.expectEmit(address(ledger));
        emit ViatikLedger.RoleSet(AG, admin, ViatikLedger.Role.None);
        vm.prank(investor);
        ledger.revokeRole(AG, admin);

        assertEq(uint8(ledger.roleOf(AG, admin)), uint8(ViatikLedger.Role.None));
        assertEq(ledger.membershipEpoch(AG, admin), 1);

        // The former Admin cannot act on the agency anymore.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.createAccount(_id("acct_after"), AG, false);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.revokeRole(AG, member);
    }

    function test_OnlyAnInvestorRevokesAtPortfolioScope() public {
        _join(coInvestor, PF, ViatikLedger.Role.Investor, 0);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.revokeRole(PF, coInvestor);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.revokeRole(PF, investor);

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.revokeRole(PF, coInvestor);

        vm.expectEmit(address(ledger));
        emit ViatikLedger.RoleSet(PF, coInvestor, ViatikLedger.Role.None);
        vm.prank(investor);
        ledger.revokeRole(PF, coInvestor);
        assertEq(uint8(ledger.roleOf(PF, coInvestor)), uint8(ViatikLedger.Role.None));
        assertEq(ledger.membershipEpoch(PF, coInvestor), 0, "only agency roles carry an epoch");

        vm.prank(coInvestor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, coInvestor));
        ledger.releaseTranche(T2, bytes32(0));
    }

    function test_RevokingSomeoneWithoutARoleIsInvalidState() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, AG));
        ledger.revokeRole(AG, stranger);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF));
        ledger.revokeRole(PF, stranger);

        // A second revocation of the same person too, and the epoch moves only once.
        vm.prank(admin);
        ledger.revokeRole(AG, member);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, AG));
        ledger.revokeRole(AG, member);
        assertEq(ledger.membershipEpoch(AG, member), 1);
        assertEq(ledger.membershipEpoch(AG, stranger), 0);
    }

    function test_RevokingInAnUnknownScopeIsNotRegistered() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, NOWHERE));
        ledger.revokeRole(NOWHERE, member);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(0)));
        ledger.revokeRole(bytes32(0), member);

        // A location id is not a scope.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, OPS));
        ledger.revokeRole(OPS, member);

        assertEq(uint8(ledger.roleOf(AG, member)), uint8(ViatikLedger.Role.Member));
    }

    // ─── 6. Owner-only configuration and genesis ───────────────────────────

    function test_OwnerOnlyFunctionsRejectEveryoneElse() public {
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        bytes[] memory calls = _ownerOnlyCalls();
        address[6] memory others = [investor, admin, member, registrar, stranger, investor2];
        for (uint256 a; a < others.length; ++a) {
            bytes memory refused = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, others[a]);
            for (uint256 i; i < calls.length; ++i) {
                _assertRefused(others[a], calls[i], refused, i);
            }
        }

        assertEq(ledger.owner(), address(this));
        assertEq(ledger.registrar(), registrar);
        assertEq(ledger.payoutSink(), sink);
        assertEq(ledger.namespace(), bytes32(0));
        assertEq(uint8(ledger.scopeKind(_id("x_pf"))), uint8(ViatikLedger.ScopeKind.None));
        assertEq(uint8(ledger.roleOf(AG, stranger)), uint8(ViatikLedger.Role.None));
        assertEq(uint8(ledger.roleOf(AG, admin)), uint8(ViatikLedger.Role.Admin));
        assertEq(ledger.memberBalance(AG, stranger), 0);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens, "nothing was minted");
    }

    function test_PayoutSinkCannotBeTheLedgerOrZero() public {
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(0)));
        ledger.setPayoutSink(address(ledger));

        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(0)));
        ledger.setPayoutSink(address(0));
        assertEq(ledger.payoutSink(), sink);

        // A valid rotation sends the next vendor payment to the new sink.
        address newSink = makeAddr("sink-2");
        vm.expectEmit(address(ledger));
        emit ViatikLedger.PayoutSinkSet(newSink);
        ledger.setPayoutSink(newSink);

        vm.prank(admin);
        ledger.pay(_id("pay_new_sink"), OPS, VERCEL, address(0), 10 * USD, bytes32(0));
        assertEq(token.balanceOf(newSink), 10 * USD);
        assertEq(token.balanceOf(sink), 0);
    }

    function test_RegistrarCannotBeZero() public {
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(0)));
        ledger.setRegistrar(address(0));
        assertEq(ledger.registrar(), registrar);
    }

    function test_ConstructorRejectsMissingOrSelfAddresses() public {
        ITestUSD usd = ITestUSD(address(token));
        bytes memory refused = abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(0));

        vm.expectRevert(refused);
        new ViatikLedger(usd, address(0), sink);

        vm.expectRevert(refused);
        new ViatikLedger(usd, registrar, address(0));

        address next = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        vm.expectRevert(refused);
        new ViatikLedger(usd, registrar, next);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// A budget from OPS that can hold an exception: per operation 5,000, no automatic
    /// approval, any destination, 6,000 allocated.
    function _openBigBudget() internal {
        bytes32[] memory any = new bytes32[](0);
        vm.prank(admin);
        ledger.createBudget(BUD_BIG, OPS, 5_000 * USD, 0, any, 6_000 * USD);
    }

    /// FA_M: an accepted, funded agreement of 10,000 with one milestone tranche TM.
    function _activeMilestoneAgreement() internal {
        vm.prank(investor);
        ledger.createAgreement(
            FA_M, AG, VAULT_M, 10_000 * USD, EXCEPTION, _ids(TM), _amounts(10_000 * USD), _flags(true)
        );
        vm.prank(admin);
        ledger.acceptAgreement(FA_M);
        vm.prank(investor);
        ledger.fundAgreement(_id("fund_m"), FA_M, PF_VAULT, 10_000 * USD);
    }

    /// Open business in AG for the attackers to aim at: Leo's pending request of 450
    /// (an Admin decides) and exception of 3,000 (the Investor decides), a requested
    /// milestone tranche TM, a pending agreement, and a balance for member2 in AG2.
    function _openAgencyBusiness() internal {
        _openBigBudget();
        _allow(BUD_BIG, member);
        vm.startPrank(member);
        ledger.requestPayment(REQ_PENDING, _id("pay_450"), BUD, VERCEL, address(0), 450 * USD, bytes32(0));
        ledger.requestPayment(REQ_EXCEPTION, _id("pay_3000"), BUD_BIG, VERCEL, address(0), 3_000 * USD, bytes32(0));
        vm.stopPrank();

        _activeMilestoneAgreement();
        vm.prank(admin);
        ledger.requestTranche(TM, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.createAgreement(
            FA_PENDING, AG, VAULT_PENDING, 5_000 * USD, EXCEPTION, _ids(TP), _amounts(5_000 * USD), _flags(false)
        );

        vm.prank(admin2);
        ledger.pay(_id("pay_member2"), OPS2, bytes32(0), member2, 100 * USD, bytes32(0));
    }

    /// Every AG resource as a call from `attacker`. The ids are fresh and the targets
    /// exist, so the only thing that can refuse each call is the access check.
    function _callsIntoTheAgency(address attacker) internal view returns (bytes[] memory calls) {
        bytes32[] memory any = new bytes32[](0);
        bytes32 pay = _id("x_pay");
        calls = new bytes[](34);
        calls[0] = abi.encodeCall(ViatikLedger.transfer, (_id("x_xfer"), OPS, OPS2, 1 * USD));
        calls[1] = abi.encodeCall(ViatikLedger.transfer, (_id("x_xfer"), OPS2, OPS, 1 * USD));
        calls[2] = abi.encodeCall(ViatikLedger.pay, (pay, OPS, VERCEL, address(0), 1 * USD, bytes32(0)));
        calls[3] = abi.encodeCall(ViatikLedger.pay, (pay, BUD, VERCEL, address(0), 1 * USD, bytes32(0)));
        calls[4] = abi.encodeCall(ViatikLedger.pay, (pay, OPS, bytes32(0), attacker, 1 * USD, bytes32(0)));
        calls[5] = abi.encodeCall(ViatikLedger.createBudget, (_id("x_bud"), OPS, PER_OP, 0, any, 1 * USD));
        calls[6] = abi.encodeCall(ViatikLedger.allocate, (_id("x_alloc"), BUD, -int256(BUDGET)));
        calls[7] = abi.encodeCall(ViatikLedger.updateRules, (BUD, type(uint256).max, type(uint256).max, any));
        calls[8] = abi.encodeCall(ViatikLedger.setBudgetPaused, (BUD, true));
        calls[9] = abi.encodeCall(ViatikLedger.setAllowance, (BUD, attacker, true, 0));
        calls[10] = abi.encodeCall(ViatikLedger.setAllowance, (BUD, member, false, 0));
        calls[11] = abi.encodeCall(
            ViatikLedger.requestPayment, (_id("x_req"), pay, BUD, VERCEL, address(0), 1 * USD, bytes32(0))
        );
        calls[12] = abi.encodeCall(
            ViatikLedger.requestPayment, (_id("x_req"), pay, BUD, bytes32(0), attacker, 1 * USD, bytes32(0))
        );
        calls[13] = abi.encodeCall(ViatikLedger.approvePayment, (REQ_PENDING, pay));
        calls[14] = abi.encodeCall(ViatikLedger.approvePayment, (REQ_EXCEPTION, pay));
        calls[15] = abi.encodeCall(ViatikLedger.closeRequest, (REQ_PENDING));
        calls[16] = abi.encodeCall(ViatikLedger.closeRequest, (REQ_EXCEPTION));
        calls[17] = abi.encodeCall(ViatikLedger.requestTranche, (T2, OPS2, bytes32(0)));
        calls[18] = abi.encodeCall(ViatikLedger.requestTranche, (T2, OPS, bytes32(0)));
        calls[19] = abi.encodeCall(ViatikLedger.releaseTranche, (T2, bytes32(0)));
        calls[20] = abi.encodeCall(ViatikLedger.releaseTranche, (TM, bytes32(0)));
        calls[21] = abi.encodeCall(ViatikLedger.requestChanges, (TM, false));
        calls[22] = abi.encodeCall(ViatikLedger.requestChanges, (TM, true));
        calls[23] = abi.encodeCall(ViatikLedger.fundAgreement, (_id("x_fund"), FA_PENDING, PF_VAULT, 1 * USD));
        calls[24] = abi.encodeCall(ViatikLedger.fundAgreement, (_id("x_fund"), FA_PENDING, PF2_VAULT, 1 * USD));
        calls[25] = abi.encodeCall(ViatikLedger.setAgreementPaused, (FA, true));
        calls[26] = abi.encodeCall(ViatikLedger.acceptAgreement, (FA_PENDING));
        calls[27] = abi.encodeCall(ViatikLedger.createAccount, (_id("x_acct"), AG, true));
        calls[28] = abi.encodeCall(ViatikLedger.returnToAgency, (_id("x_ret"), AG, 1 * USD));
        calls[29] = abi.encodeCall(ViatikLedger.revokeRole, (AG, admin));
        calls[30] = abi.encodeCall(ViatikLedger.revokeRole, (AG, member));
        calls[31] = abi.encodeCall(ViatikLedger.revokeRole, (PF, investor));
        calls[32] = abi.encodeCall(ViatikLedger.registerAgency, (_id("x_ag"), PF, _id("x_vault")));
        calls[33] = abi.encodeCall(
            ViatikLedger.createAgreement,
            (_id("x_fa"), AG, _id("x_vault"), 1 * USD, 0, _ids(_id("x_tr")), _amounts(1 * USD), _flags(false))
        );
    }

    /// Every owner-only entry point, with arguments that would otherwise be accepted.
    function _ownerOnlyCalls() internal view returns (bytes[] memory calls) {
        bytes32[] memory any = new bytes32[](0);
        ViatikLedger.Agreement memory agreement = ViatikLedger.Agreement({
            agency: AG,
            vault: _id("x_vault"),
            committed: 1 * USD,
            funded: 0,
            released: 0,
            exceptionThreshold: 0,
            status: ViatikLedger.AgreementStatus.Active
        });
        ViatikLedger.Tranche[] memory tranches = new ViatikLedger.Tranche[](1);
        tranches[0] = ViatikLedger.Tranche({
            agreement: bytes32(0),
            amount: 1 * USD,
            index: 0,
            milestone: false,
            status: ViatikLedger.TrancheStatus.Available,
            requestedBy: address(0),
            destination: bytes32(0),
            evidenceHash: bytes32(0)
        });
        ViatikLedger.Budget memory budget = ViatikLedger.Budget({
            sourceAccount: OPS,
            perOperationLimit: PER_OP,
            approvalThreshold: 0,
            paused: false,
            anyDestination: true,
            destinationEpoch: 0
        });
        ViatikLedger.ImportedRequest memory request = ViatikLedger.ImportedRequest({
            requestId: _id("x_req"),
            budget: BUD,
            requester: member,
            destination: VERCEL,
            member: address(0),
            amount: 1 * USD,
            evidenceHash: bytes32(0)
        });

        calls = new bytes[](14);
        calls[0] = abi.encodeCall(ViatikLedger.importScope, (_id("x_pf"), _id("x_ag")));
        calls[1] = abi.encodeCall(ViatikLedger.importRole, (AG, stranger, ViatikLedger.Role.Admin));
        calls[2] = abi.encodeCall(ViatikLedger.importRole, (AG, admin, ViatikLedger.Role.None));
        calls[3] = abi.encodeCall(
            ViatikLedger.importLocation, (_id("x_acct"), ViatikLedger.LocationKind.Account, AG, 1 * USD, false)
        );
        calls[4] = abi.encodeCall(ViatikLedger.importAgreement, (_id("x_fa"), agreement, _ids(_id("x_tr")), tranches));
        calls[5] = abi.encodeCall(ViatikLedger.importBudget, (_id("x_bud"), budget, any));
        calls[6] = abi.encodeCall(ViatikLedger.importAllowance, (BUD, stranger, 0));
        calls[7] = abi.encodeCall(ViatikLedger.importMemberBalance, (AG, stranger, 1 * USD));
        calls[8] = abi.encodeCall(ViatikLedger.importPendingRequest, (request));
        calls[9] = abi.encodeCall(ViatikLedger.setNamespace, (keccak256("qa:namespace_x")));
        calls[10] = abi.encodeCall(ViatikLedger.setRegistrar, (stranger));
        calls[11] = abi.encodeCall(ViatikLedger.setPayoutSink, (stranger));
        calls[12] = abi.encodeCall(Ownable.transferOwnership, (stranger));
        calls[13] = abi.encodeCall(Ownable.renounceOwnership, ());
    }

    /// Sends `data` from `caller` and checks the exact revert data.
    function _assertRefused(address caller, bytes memory data, bytes memory reason, uint256 index) internal {
        string memory label = string.concat(vm.getLabel(caller), " call #", vm.toString(index));
        vm.prank(caller);
        (bool ok, bytes memory returned) = address(ledger).call(data);
        assertFalse(ok, label);
        assertEq(returned, reason, label);
    }

    /// The stranger, with a valid registrar signature for `role` in `scope`, is refused
    /// with NotRegistered(`expected`).
    function _expectJoinReverts(bytes32 scope, ViatikLedger.Role role, bytes32 expected) internal {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory signature = _permit(registrarKey, stranger, scope, role, 0, deadline);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, expected));
        ledger.join(scope, role, 0, deadline, signature);
    }

    /// A fingerprint of both agencies: balances, tokens, and the state of every object
    /// the attackers aim at.
    function _agencyState() internal view returns (bytes32) {
        bytes32 balances = keccak256(
            abi.encode(
                [
                    ledger.balanceOf(PF_VAULT),
                    ledger.balanceOf(FUND_VAULT),
                    ledger.balanceOf(OPS),
                    ledger.balanceOf(BUD),
                    ledger.balanceOf(BUD_BIG),
                    ledger.balanceOf(VAULT_M),
                    ledger.balanceOf(PF2_VAULT),
                    ledger.balanceOf(OPS2),
                    ledger.balanceOf(BUD2),
                    ledger.memberBalance(AG, member),
                    ledger.memberBalance(AG2, member2),
                    token.balanceOf(sink),
                    token.balanceOf(address(ledger))
                ]
            )
        );
        bytes32 objects = keccak256(
            abi.encode(
                ledger.getBudget(BUD),
                ledger.getAllowance(BUD, member),
                ledger.getAgreement(FA),
                ledger.getAgreement(FA_M),
                ledger.getAgreement(FA_PENDING),
                ledger.getTranche(T2),
                ledger.getTranche(TM),
                ledger.getRequest(REQ_PENDING),
                ledger.getRequest(REQ_EXCEPTION)
            )
        );
        bytes32 people = keccak256(
            abi.encode(
                [ledger.roleOf(AG, admin), ledger.roleOf(AG, member), ledger.roleOf(PF, investor)],
                [ledger.roleOf(AG2, admin2), ledger.roleOf(AG2, member2), ledger.roleOf(PF2, investor2)],
                ledger.operationsAccount(AG),
                ledger.operationsAccount(AG2)
            )
        );
        return keccak256(abi.encode(balances, objects, people));
    }

    function _batchId(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encode("qa:pay_batch", i));
    }

    function _split(bytes memory signature) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
    }
}

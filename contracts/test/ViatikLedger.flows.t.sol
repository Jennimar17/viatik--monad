// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LedgerFixture} from "./utils/LedgerFixture.sol";
import {ViatikLedger} from "../src/ViatikLedger.sol";

/// Engine parity for the flows the QA story does not walk: the tranche machine,
/// agreement gates, exception routing and closing requests, the governing agreement,
/// the rule order of `pay` and `requestPayment`, and transfers, returns and allocations.
contract ViatikLedgerFlowsTest is LedgerFixture {
    address internal admin3 = makeAddr("admin3");
    address internal admin4 = makeAddr("admin4");
    address internal colleague = makeAddr("colleague");

    // Extra agreement and account on the story agency AG.
    bytes32 internal constant FB = keccak256("qa:fl_fa_b");
    bytes32 internal constant VAULT_B = keccak256("qa:fl_vault_b");
    bytes32 internal constant B1 = keccak256("qa:fl_tr_b1");
    bytes32 internal constant B2 = keccak256("qa:fl_tr_b2");
    bytes32 internal constant B3 = keccak256("qa:fl_tr_b3");
    bytes32 internal constant ACC2 = keccak256("qa:fl_acct_project");

    // Budgets built by single tests.
    bytes32 internal constant EX_BUD = keccak256("qa:fl_bud_exceptions");
    bytes32 internal constant CASE_BUD = keccak256("qa:fl_bud_case");

    // A third agency in PF that starts without an Operations account.
    bytes32 internal constant AG3 = keccak256("qa3:ag");
    bytes32 internal constant FUND_VAULT3 = keccak256("qa3:vault_funding");
    bytes32 internal constant FA3 = keccak256("qa3:fa");
    bytes32 internal constant C1 = keccak256("qa3:tr_1");
    bytes32 internal constant ACC3 = keccak256("qa3:acct_project");
    bytes32 internal constant OPS3 = keccak256("qa3:acct_operations");

    // A fourth agency in PF for the governing agreement.
    bytes32 internal constant AG4 = keccak256("qa4:ag");
    bytes32 internal constant FUND_VAULT4 = keccak256("qa4:vault_funding");
    bytes32 internal constant GA = keccak256("qa4:fa_a");
    bytes32 internal constant GB = keccak256("qa4:fa_b");
    bytes32 internal constant GC = keccak256("qa4:fa_c");
    bytes32 internal constant VAULT_GB = keccak256("qa4:vault_b");
    bytes32 internal constant VAULT_GC = keccak256("qa4:vault_c");
    bytes32 internal constant GA1 = keccak256("qa4:tr_a1");
    bytes32 internal constant GB1 = keccak256("qa4:tr_b1");
    bytes32 internal constant GC1 = keccak256("qa4:tr_c1");
    bytes32 internal constant OPS4 = keccak256("qa4:acct_operations");
    bytes32 internal constant BUD4 = keccak256("qa4:bud");

    uint256 private _opCount;

    function setUp() public override {
        super.setUp();
        _buildSecondAgency();
    }

    // ─── Tranche machine ────────────────────────────────────────────────────

    function test_FirstTrancheWithoutMilestoneStartsAvailableAndReleasesToOperations() public {
        _createAgreement(
            FB, AG, VAULT_B, EXCEPTION, _ids(B1, B2), _amounts(10_000 * USD, 5_000 * USD), _flags(false, false)
        );
        _assertTranche(B1, ViatikLedger.TrancheStatus.Available);
        _assertTranche(B2, ViatikLedger.TrancheStatus.Planned);
        _accept(FB, admin);
        _fund(FB, 15_000 * USD);

        bytes32 decision = keccak256("qa:fl_decision");
        bytes32 receipt =
            ledger.receiptHash(B1, ViatikLedger.ReceiptKind.TrancheRelease, 10_000 * USD, VAULT_B, OPS, decision);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.TrancheReleased(B1, FB, OPS, 10_000 * USD, decision);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Recorded(B1, investor, receipt);
        vm.prank(investor);
        ledger.releaseTranche(B1, decision);

        ViatikLedger.Tranche memory released = ledger.getTranche(B1);
        assertEq(uint8(released.status), uint8(ViatikLedger.TrancheStatus.Released));
        assertEq(released.destination, OPS);
        assertEq(released.requestedBy, address(0));
        assertEq(ledger.balanceOf(OPS), 30_000 * USD);
        assertEq(ledger.balanceOf(VAULT_B), 5_000 * USD);
        assertEq(ledger.getAgreement(FB).released, 10_000 * USD);
        // The next tranche has no milestone: the release makes it available.
        _assertTranche(B2, ViatikLedger.TrancheStatus.Available);
    }

    function test_PlannedTrancheWithoutMilestoneIsRequestedBeforeItIsReleased() public {
        _createAgreement(
            FB, AG, VAULT_B, EXCEPTION, _ids(B1, B2), _amounts(10_000 * USD, 5_000 * USD), _flags(false, false)
        );
        _accept(FB, admin);
        _fund(FB, 15_000 * USD);
        vm.prank(admin);
        ledger.createAccount(ACC2, AG, false);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, B2));
        ledger.releaseTranche(B2, bytes32(0));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.TrancheRequested(B2, admin, ACC2, bytes32(0));
        vm.prank(admin);
        ledger.requestTranche(B2, ACC2, bytes32(0));
        ViatikLedger.Tranche memory requested = ledger.getTranche(B2);
        assertEq(uint8(requested.status), uint8(ViatikLedger.TrancheStatus.Requested));
        assertEq(requested.requestedBy, admin);
        assertEq(requested.destination, ACC2);

        vm.prank(investor);
        ledger.releaseTranche(B2, bytes32(0));
        assertEq(ledger.balanceOf(ACC2), 5_000 * USD, "the requested account gets it");
        assertEq(ledger.balanceOf(OPS), 20_000 * USD, "not Operations");
        // The earlier tranche is untouched and still goes to Operations.
        _assertTranche(B1, ViatikLedger.TrancheStatus.Available);
        vm.prank(investor);
        ledger.releaseTranche(B1, bytes32(0));
        assertEq(ledger.balanceOf(OPS), 30_000 * USD);
        _assertTranche(B2, ViatikLedger.TrancheStatus.Released);
    }

    function test_MilestoneTrancheTakesEvidenceWhilePlanned() public {
        // [no milestone, milestone]: the milestone waits behind an unreleased tranche.
        _createAgreement(
            FB, AG, VAULT_B, EXCEPTION, _ids(B1, B2), _amounts(10_000 * USD, 5_000 * USD), _flags(false, true)
        );
        _accept(FB, admin);
        _fund(FB, 15_000 * USD);
        _assertTranche(B2, ViatikLedger.TrancheStatus.Planned);

        vm.expectEmit(address(ledger));
        emit ViatikLedger.TrancheRequested(B2, admin, OPS, EVIDENCE);
        vm.prank(admin);
        ledger.requestTranche(B2, OPS, EVIDENCE);
        ViatikLedger.Tranche memory requested = ledger.getTranche(B2);
        assertEq(uint8(requested.status), uint8(ViatikLedger.TrancheStatus.Requested));
        assertEq(requested.evidenceHash, EVIDENCE);

        // A requested tranche cannot be requested again before a decision.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, B2));
        ledger.requestTranche(B2, OPS, keccak256("qa:fl_evidence_v2"));

        vm.prank(investor);
        ledger.releaseTranche(B2, keccak256("qa:fl_decision"));
        assertEq(ledger.balanceOf(OPS), 25_000 * USD);
        assertEq(ledger.getAgreement(FB).released, 5_000 * USD);
    }

    function test_EvidenceIsRequiredExactlyForMilestones() public {
        _createAgreement(FB, AG, VAULT_B, EXCEPTION, _ids(B1), _amounts(10_000 * USD), _flags(true));
        _accept(FB, admin);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, B1));
        ledger.requestTranche(B1, OPS, bytes32(0));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, T2));
        ledger.requestTranche(T2, OPS, EVIDENCE);

        _assertTranche(B1, ViatikLedger.TrancheStatus.Planned);
        _assertTranche(T2, ViatikLedger.TrancheStatus.Available);
    }

    function test_MilestoneSentBackIsRequestedAgainToAnotherAccount() public {
        _createAgreement(FB, AG, VAULT_B, EXCEPTION, _ids(B1), _amounts(10_000 * USD), _flags(true));
        _accept(FB, admin);
        _fund(FB, 10_000 * USD);
        vm.prank(admin);
        ledger.createAccount(ACC2, AG, false);

        vm.prank(admin);
        ledger.requestTranche(B1, OPS, EVIDENCE);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.TrancheChangesRequested(B1, false);
        vm.prank(investor);
        ledger.requestChanges(B1, false);
        _assertTranche(B1, ViatikLedger.TrancheStatus.Available);

        bytes32 evidence2 = keccak256("qa:fl_evidence_v2");
        vm.prank(admin);
        ledger.requestTranche(B1, ACC2, evidence2);
        ViatikLedger.Tranche memory again = ledger.getTranche(B1);
        assertEq(again.destination, ACC2);
        assertEq(again.evidenceHash, evidence2);

        vm.prank(investor);
        ledger.releaseTranche(B1, bytes32(0));
        assertEq(ledger.balanceOf(ACC2), 10_000 * USD, "the new destination gets it");
        assertEq(ledger.balanceOf(OPS), 20_000 * USD);
    }

    function test_RejectedMilestoneIsTerminalAndOnlyMilestonesGoBack() public {
        _createAgreement(FB, AG, VAULT_B, EXCEPTION, _ids(B1), _amounts(10_000 * USD), _flags(true));
        _accept(FB, admin);
        vm.prank(admin);
        ledger.requestTranche(B1, OPS, EVIDENCE);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.TrancheChangesRequested(B1, true);
        vm.prank(investor);
        ledger.requestChanges(B1, true);
        _assertTranche(B1, ViatikLedger.TrancheStatus.Rejected);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, B1));
        ledger.requestTranche(B1, OPS, EVIDENCE);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, B1));
        ledger.requestChanges(B1, false);

        // A requested tranche without a milestone cannot be sent back.
        vm.prank(admin);
        ledger.requestTranche(T2, OPS, bytes32(0));
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, T2));
        ledger.requestChanges(T2, false);
        _assertTranche(T2, ViatikLedger.TrancheStatus.Requested);
    }

    function test_ReleasePromotesOnlyTheNextTrancheWithoutMilestone() public {
        // [no milestone, milestone, no milestone]
        _createAgreement(
            FB,
            AG,
            VAULT_B,
            EXCEPTION,
            _ids(B1, B2, B3),
            _amounts(10_000 * USD, 5_000 * USD, 3_000 * USD),
            _flags(false, true, false)
        );
        _accept(FB, admin);
        _fund(FB, 18_000 * USD);

        vm.prank(investor);
        ledger.releaseTranche(B1, bytes32(0));
        _assertTranche(B2, ViatikLedger.TrancheStatus.Planned); // a milestone is never promoted
        _assertTranche(B3, ViatikLedger.TrancheStatus.Planned); // and only the next one is looked at

        vm.prank(admin);
        ledger.requestTranche(B2, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.releaseTranche(B2, bytes32(0));
        _assertTranche(B3, ViatikLedger.TrancheStatus.Available);

        vm.prank(investor);
        ledger.releaseTranche(B3, bytes32(0));
        assertEq(ledger.balanceOf(OPS), 38_000 * USD);
        assertEq(ledger.balanceOf(VAULT_B), 0);
        assertEq(ledger.getAgreement(FB).released, 18_000 * USD);
    }

    function test_DirectReleaseNeedsAnOperationsAccount() public {
        _buildAgencyWithoutOperations();
        assertEq(ledger.operationsAccount(AG3), bytes32(0));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, AG3));
        ledger.releaseTranche(C1, bytes32(0));

        // Requested to a named account, it releases without one.
        vm.prank(admin3);
        ledger.requestTranche(C1, ACC3, bytes32(0));
        vm.prank(investor);
        ledger.releaseTranche(C1, bytes32(0));
        assertEq(ledger.balanceOf(ACC3), 10_000 * USD);
        assertEq(ledger.balanceOf(FUND_VAULT3), 0);
    }

    function test_TrancheDestinationMustBeAnAccountOfTheAgency() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.requestTranche(T2, OPS2, bytes32(0));

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, BUD));
        ledger.requestTranche(T2, BUD, bytes32(0));

        _assertTranche(T2, ViatikLedger.TrancheStatus.Available);
        assertEq(ledger.balanceOf(OPS2), 47_000 * USD);
    }

    function test_ReleaseCannotExceedWhatWasFunded() public {
        _createAgreement(
            FB, AG, VAULT_B, EXCEPTION, _ids(B1, B2), _amounts(10_000 * USD, 5_000 * USD), _flags(false, false)
        );
        _accept(FB, admin);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, VAULT_B, 0, 10_000 * USD));
        ledger.releaseTranche(B1, bytes32(0));

        _fund(FB, 12_000 * USD);
        vm.prank(investor);
        ledger.releaseTranche(B1, bytes32(0));
        _assertTranche(B2, ViatikLedger.TrancheStatus.Available);

        // released + amount > funded: 10,000 + 5,000 > 12,000.
        vm.prank(investor);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, VAULT_B, 2_000 * USD, 5_000 * USD)
        );
        ledger.releaseTranche(B2, bytes32(0));

        _fund(FB, 3_000 * USD);
        vm.prank(investor);
        ledger.releaseTranche(B2, bytes32(0));
        ViatikLedger.Agreement memory agreement = ledger.getAgreement(FB);
        assertEq(agreement.funded, 15_000 * USD);
        assertEq(agreement.released, 15_000 * USD);
        assertEq(ledger.balanceOf(VAULT_B), 0);
        assertEq(ledger.balanceOf(OPS), 35_000 * USD);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, B2));
        ledger.releaseTranche(B2, bytes32(0));
    }

    // ─── Agreement gates ────────────────────────────────────────────────────

    function test_TranchesMoveOnlyWhileTheAgreementIsActive() public {
        _createAgreement(
            FB, AG, VAULT_B, EXCEPTION, _ids(B1, B2), _amounts(10_000 * USD, 5_000 * USD), _flags(false, true)
        );

        // Pending: funding works, tranches do not move.
        _fund(FB, 5_000 * USD);
        assertEq(ledger.getAgreement(FB).funded, 5_000 * USD);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FB));
        ledger.requestTranche(B2, OPS, EVIDENCE);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FB));
        ledger.releaseTranche(B1, bytes32(0));

        // Active: funding works.
        _accept(FB, admin);
        _fund(FB, 5_000 * USD);
        assertEq(ledger.getAgreement(FB).funded, 10_000 * USD);

        // Paused: funding works, tranches do not move.
        vm.prank(investor);
        ledger.setAgreementPaused(FB, true);
        _fund(FB, 5_000 * USD);
        assertEq(ledger.getAgreement(FB).funded, 15_000 * USD);
        assertEq(ledger.balanceOf(VAULT_B), 15_000 * USD);
        assertEq(ledger.balanceOf(PF_VAULT), 85_000 * USD);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AgreementPaused.selector, FB));
        ledger.requestTranche(B2, OPS, EVIDENCE);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AgreementPaused.selector, FB));
        ledger.releaseTranche(B1, bytes32(0));

        // Resumed: the release goes through.
        vm.prank(investor);
        ledger.setAgreementPaused(FB, false);
        vm.prank(investor);
        ledger.releaseTranche(B1, bytes32(0));
        assertEq(ledger.balanceOf(OPS), 30_000 * USD);
    }

    /// Engine parity: sending milestone evidence back does not need an active agreement.
    function test_MilestoneChangesCanBeRequestedWhilePaused() public {
        _createAgreement(FB, AG, VAULT_B, EXCEPTION, _ids(B1), _amounts(10_000 * USD), _flags(true));
        _accept(FB, admin);
        vm.prank(admin);
        ledger.requestTranche(B1, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.setAgreementPaused(FB, true);

        vm.prank(investor);
        ledger.requestChanges(B1, false);
        _assertTranche(B1, ViatikLedger.TrancheStatus.Available);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AgreementPaused.selector, FB));
        ledger.requestTranche(B1, OPS, keccak256("qa:fl_evidence_v2"));
    }

    function test_AgreementAcceptanceAndPauseAreStrict() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FA));
        ledger.acceptAgreement(FA);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FA));
        ledger.setAgreementPaused(FA, false);

        vm.expectEmit(address(ledger));
        emit ViatikLedger.AgreementPausedSet(FA, true);
        vm.prank(investor);
        ledger.setAgreementPaused(FA, true);
        assertEq(uint8(ledger.getAgreement(FA).status), uint8(ViatikLedger.AgreementStatus.Paused));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FA));
        ledger.setAgreementPaused(FA, true);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FA));
        ledger.acceptAgreement(FA);

        // A pending agreement cannot be paused, only accepted.
        _createAgreement(FB, AG, VAULT_B, EXCEPTION, _ids(B1), _amounts(1_000 * USD), _flags(false));
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, FB));
        ledger.setAgreementPaused(FB, true);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.acceptAgreement(FB);
    }

    function test_BudgetPauseIsStrictAndRevokingAnAllowanceIsIdempotent() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, BUD));
        ledger.setBudgetPaused(BUD, false);

        vm.prank(investor);
        ledger.setBudgetPaused(BUD, true);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, BUD));
        ledger.setBudgetPaused(BUD, true);
        assertTrue(ledger.getBudget(BUD).paused);

        // Revoking twice mirrors the engine's revokeAllowance no-op.
        vm.startPrank(admin);
        ledger.setAllowance(BUD, member, false, 0);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.AllowanceSet(BUD, member, false, 0);
        ledger.setAllowance(BUD, member, false, 0);
        vm.stopPrank();
        assertFalse(ledger.getAllowance(BUD, member).active);
    }

    // ─── Exception routing and closing requests ────────────────────────────

    function test_ApprovalRoutingIsExclusiveBothWays() public {
        _exceptionBudget();
        _request(EX_BUD, _id("fl_req_ex"), 3_000 * USD, ViatikLedger.RequestStatus.Pending);
        // Exactly at the threshold is not an exception.
        _request(EX_BUD, _id("fl_req_edge"), EXCEPTION, ViatikLedger.RequestStatus.Pending);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.approvePayment(_id("fl_req_ex"), _id("fl_pay_ex"));
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.approvePayment(_id("fl_req_edge"), _id("fl_pay_edge"));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.PaymentApproved(_id("fl_req_ex"), _id("fl_pay_ex"), investor);
        vm.prank(investor);
        ledger.approvePayment(_id("fl_req_ex"), _id("fl_pay_ex"));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.PaymentApproved(_id("fl_req_edge"), _id("fl_pay_edge"), admin);
        vm.prank(admin);
        ledger.approvePayment(_id("fl_req_edge"), _id("fl_pay_edge"));

        _assertRequest(_id("fl_req_ex"), ViatikLedger.RequestStatus.Executed);
        _assertRequest(_id("fl_req_edge"), ViatikLedger.RequestStatus.Executed);
        assertEq(token.balanceOf(sink), 5_000 * USD);
        assertEq(ledger.balanceOf(EX_BUD), 1_000 * USD);
    }

    function test_AdminDeclinesAnyPendingRequestIncludingExceptions() public {
        _exceptionBudget();
        _request(EX_BUD, _id("fl_req_ex"), 3_000 * USD, ViatikLedger.RequestStatus.Pending);
        _request(EX_BUD, _id("fl_req_small"), 500 * USD, ViatikLedger.RequestStatus.Pending);

        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(_id("fl_req_ex"), admin, true);
        vm.prank(admin);
        ledger.closeRequest(_id("fl_req_ex"));
        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(_id("fl_req_small"), admin, true);
        vm.prank(admin);
        ledger.closeRequest(_id("fl_req_small"));

        _assertRequest(_id("fl_req_ex"), ViatikLedger.RequestStatus.Closed);
        _assertRequest(_id("fl_req_small"), ViatikLedger.RequestStatus.Closed);
        assertEq(ledger.balanceOf(EX_BUD), 6_000 * USD, "a pending request never held funds");

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, _id("fl_req_ex")));
        ledger.approvePayment(_id("fl_req_ex"), _id("fl_pay_ex"));
    }

    function test_InvestorDeclinesOnlyExceptionsOrStaleRequests() public {
        _exceptionBudget();
        _request(EX_BUD, _id("fl_req_ex"), 3_000 * USD, ViatikLedger.RequestStatus.Pending);
        _request(EX_BUD, _id("fl_req_small"), 500 * USD, ViatikLedger.RequestStatus.Pending);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.closeRequest(_id("fl_req_small"));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(_id("fl_req_ex"), investor, true);
        vm.prank(investor);
        ledger.closeRequest(_id("fl_req_ex"));

        // Once the requester loses their role the request is stale: the Investor may close it.
        vm.prank(admin);
        ledger.revokeRole(AG, member);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(_id("fl_req_small"), investor, true);
        vm.prank(investor);
        ledger.closeRequest(_id("fl_req_small"));
        _assertRequest(_id("fl_req_small"), ViatikLedger.RequestStatus.Closed);
    }

    function test_RequesterCancelsAndNobodyElseCloses() public {
        _exceptionBudget();
        _join(colleague, AG, ViatikLedger.Role.Member, 0);
        _request(EX_BUD, _id("fl_req_small"), 500 * USD, ViatikLedger.RequestStatus.Pending);
        _request(EX_BUD, _id("fl_req_ex"), 3_000 * USD, ViatikLedger.RequestStatus.Pending);

        vm.prank(colleague);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, colleague));
        ledger.closeRequest(_id("fl_req_small"));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.closeRequest(_id("fl_req_ex"));
        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin2));
        ledger.closeRequest(_id("fl_req_small"));
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor2));
        ledger.closeRequest(_id("fl_req_ex"));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(_id("fl_req_small"), member, false);
        vm.prank(member);
        ledger.closeRequest(_id("fl_req_small"));
        vm.expectEmit(address(ledger));
        emit ViatikLedger.RequestClosed(_id("fl_req_ex"), member, false);
        vm.prank(member);
        ledger.closeRequest(_id("fl_req_ex"));
    }

    function test_OnlyPendingRequestsCanBeClosed() public {
        _exceptionBudget();
        _request(EX_BUD, _id("fl_req_paid"), 100 * USD, ViatikLedger.RequestStatus.Executed);
        _request(EX_BUD, _id("fl_req_over"), 5_500 * USD, ViatikLedger.RequestStatus.Rejected);
        _request(EX_BUD, _id("fl_req_small"), 500 * USD, ViatikLedger.RequestStatus.Pending);
        vm.prank(member);
        ledger.closeRequest(_id("fl_req_small"));

        bytes32[4] memory notPending =
            [_id("fl_req_paid"), _id("fl_req_over"), _id("fl_req_small"), _id("fl_req_unknown")];
        for (uint256 i; i < notPending.length; ++i) {
            vm.prank(admin);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, notPending[i]));
            ledger.closeRequest(notPending[i]);
        }
        _assertRequest(_id("fl_req_paid"), ViatikLedger.RequestStatus.Executed);
        _assertRequest(_id("fl_req_over"), ViatikLedger.RequestStatus.Rejected);
    }

    // ─── Governing agreement ───────────────────────────────────────────────

    function test_GoverningAgreementIsTheFirstActiveOrPausedInCreationOrder() public {
        _registerAgency(AG4, FUND_VAULT4, admin4);
        assertEq(ledger.exceptionThresholdOf(AG4), type(uint256).max);

        _createAgreement(GA, AG4, FUND_VAULT4, 1_000 * USD, _ids(GA1), _amounts(1_000 * USD), _flags(false));
        _createAgreement(GB, AG4, VAULT_GB, 2_500 * USD, _ids(GB1), _amounts(1_000 * USD), _flags(false));
        _createAgreement(GC, AG4, VAULT_GC, 4_000 * USD, _ids(GC1), _amounts(1_000 * USD), _flags(false));
        assertEq(ledger.exceptionThresholdOf(AG4), type(uint256).max, "pending agreements do not govern");

        _accept(GC, admin4);
        assertEq(ledger.exceptionThresholdOf(AG4), 4_000 * USD);
        // [Pending A, Active B, Active C]: B was created first, so B governs.
        _accept(GB, admin4);
        assertEq(ledger.exceptionThresholdOf(AG4), 2_500 * USD);
        vm.prank(investor);
        ledger.setAgreementPaused(GB, true);
        assertEq(ledger.exceptionThresholdOf(AG4), 2_500 * USD, "a paused agreement still governs");
        _accept(GA, admin4);
        assertEq(ledger.exceptionThresholdOf(AG4), 1_000 * USD);
    }

    function test_WithoutAGoverningAgreementNothingIsAnException() public {
        _registerAgency(AG4, FUND_VAULT4, admin4);
        // Genesis money: no agreement of AG4 is active yet.
        ledger.importLocation(OPS4, ViatikLedger.LocationKind.Account, AG4, 20_000 * USD, true);
        vm.startPrank(admin4);
        ledger.createBudget(BUD4, OPS4, 10_000 * USD, 10_000 * USD, new bytes32[](0), 10_000 * USD);
        ledger.setAllowance(BUD4, admin4, true, 0);
        vm.stopPrank();

        vm.prank(admin4);
        ViatikLedger.RequestStatus outcome = ledger.requestPayment(
            _id("fl_req_4a"), _id("fl_pay_4a"), BUD4, VERCEL, address(0), 3_000 * USD, bytes32(0)
        );
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Executed));
        vm.prank(admin4);
        ledger.pay(_id("fl_pay_4b"), OPS4, VERCEL, address(0), 3_000 * USD, bytes32(0));
        assertEq(token.balanceOf(sink), 6_000 * USD);

        // Once an agreement is accepted it governs: the same amount is now an exception.
        _createAgreement(GB, AG4, FUND_VAULT4, 2_500 * USD, _ids(GB1), _amounts(1_000 * USD), _flags(false));
        _accept(GB, admin4);
        vm.prank(admin4);
        outcome = ledger.requestPayment(
            _id("fl_req_4c"), _id("fl_pay_4c"), BUD4, VERCEL, address(0), 3_000 * USD, bytes32(0)
        );
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Pending));
        vm.prank(admin4);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, 2_500 * USD, 3_000 * USD
            )
        );
        ledger.pay(_id("fl_pay_4d"), OPS4, VERCEL, address(0), 3_000 * USD, bytes32(0));

        vm.prank(investor);
        ledger.approvePayment(_id("fl_req_4c"), _id("fl_pay_4c2"));
        assertEq(token.balanceOf(sink), 9_000 * USD);
        assertEq(ledger.balanceOf(BUD4), 4_000 * USD);
    }

    function test_LaterAgreementsDoNotReplaceTheGoverningOne() public {
        _createAgreement(FB, AG, VAULT_B, 100 * USD, _ids(B1), _amounts(1_000 * USD), _flags(false));
        _accept(FB, admin);
        assertEq(ledger.exceptionThresholdOf(AG), EXCEPTION);
        vm.prank(investor);
        ledger.setAgreementPaused(FA, true);
        assertEq(ledger.exceptionThresholdOf(AG), EXCEPTION);

        // 1,000 is above FB's threshold but FA still governs.
        vm.prank(admin);
        ledger.pay(_id("fl_pay_gov"), OPS, VERCEL, address(0), 1_000 * USD, bytes32(0));
        assertEq(token.balanceOf(sink), 1_000 * USD);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, EXCEPTION, EXCEPTION + 1
            )
        );
        ledger.pay(_id("fl_pay_gov2"), OPS, VERCEL, address(0), EXCEPTION + 1, bytes32(0));
    }

    // ─── pay: rule order and payees ────────────────────────────────────────

    /// Every combination of failing rules on a budget source: the error is the first one in
    /// the order paused > per-operation > destination (skipped for a Member) > exception > funds.
    function test_PayFromABudgetChecksItsRulesInOrder() public {
        for (uint256 mask; mask < 64; ++mask) {
            uint256 snapshot = vm.snapshotState();
            _payCase(mask);
            vm.revertToStateAndDelete(snapshot);
        }
    }

    function test_PayFromAnAccountChecksOnlyTheExceptionAndFunds() public {
        vm.startPrank(admin);
        ledger.createAccount(ACC2, AG, false);
        ledger.transfer(_id("fl_xfer"), OPS, ACC2, 1_900 * USD);
        ledger.setBudgetPaused(BUD, true);
        vm.stopPrank();

        // The exception comes before funds.
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, EXCEPTION, 2_500 * USD
            )
        );
        ledger.pay(_id("fl_pay_acct"), ACC2, OTHER_VENDOR, address(0), 2_500 * USD, bytes32(0));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, ACC2, 1_900 * USD, 2_000 * USD));
        ledger.pay(_id("fl_pay_acct"), ACC2, OTHER_VENDOR, address(0), 2_000 * USD, bytes32(0));

        // Any destination, above every budget's per-operation limit, with a budget paused.
        vm.expectEmit(address(ledger));
        emit ViatikLedger.PaymentExecuted(
            _id("fl_pay_acct"), bytes32(0), ACC2, OTHER_VENDOR, address(0), 1_900 * USD, EVIDENCE
        );
        vm.prank(admin);
        ledger.pay(_id("fl_pay_acct"), ACC2, OTHER_VENDOR, address(0), 1_900 * USD, EVIDENCE);
        assertEq(ledger.balanceOf(ACC2), 0);
        assertEq(token.balanceOf(sink), 1_900 * USD);
    }

    function test_PayToAMemberNeedsARoleAndNoDestination() public {
        bytes32 payId = _id("fl_pay_member");
        bytes32 strangerLocation = ledger.memberLocation(stranger);
        bytes32 investorLocation = ledger.memberLocation(investor);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, strangerLocation));
        ledger.pay(payId, OPS, bytes32(0), stranger, 100 * USD, bytes32(0));
        // The Investor has no role in the agency.
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, investorLocation));
        ledger.pay(payId, OPS, bytes32(0), investor, 100 * USD, bytes32(0));
        // The payee's role is checked before the shape of the call.
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, strangerLocation));
        ledger.pay(payId, OPS, VERCEL, stranger, 100 * USD, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, payId));
        ledger.pay(payId, OPS, VERCEL, member, 100 * USD, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, payId));
        ledger.pay(payId, OPS, bytes32(0), member, 0, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, FUND_VAULT));
        ledger.pay(payId, FUND_VAULT, VERCEL, address(0), 100 * USD, bytes32(0));
        vm.stopPrank();

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.pay(payId, OPS, bytes32(0), member, 100 * USD, bytes32(0));

        assertEq(ledger.balanceOf(OPS), 20_000 * USD);
        assertFalse(ledger.processed(admin, payId));
    }

    /// Engine parity (documented): an Admin can pay himself as a Member and return it.
    function test_AdminCanPayHimselfAsAMemberAndReturnIt() public {
        bytes32 payId = _id("fl_pay_self");
        bytes32 retId = _id("fl_ret_self");
        bytes32 adminLocation = ledger.memberLocation(admin);
        bytes32 payReceipt =
            ledger.receiptHash(payId, ViatikLedger.ReceiptKind.Payment, 300 * USD, OPS, adminLocation, bytes32(0));
        bytes32 retReceipt =
            ledger.receiptHash(retId, ViatikLedger.ReceiptKind.Return, 120 * USD, adminLocation, OPS, bytes32(0));
        uint256 held = token.balanceOf(address(ledger));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.PaymentExecuted(payId, bytes32(0), OPS, bytes32(0), admin, 300 * USD, bytes32(0));
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Recorded(payId, admin, payReceipt);
        vm.prank(admin);
        ledger.pay(payId, OPS, bytes32(0), admin, 300 * USD, bytes32(0));
        assertEq(ledger.memberBalance(AG, admin), 300 * USD);
        assertEq(ledger.balanceOf(OPS), 19_700 * USD);
        assertEq(token.balanceOf(sink), 0);
        assertEq(token.balanceOf(address(ledger)), held, "a Member payout stays in the ledger");

        vm.expectEmit(address(ledger));
        emit ViatikLedger.FundsReturned(retId, AG, admin, OPS, 120 * USD);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Recorded(retId, admin, retReceipt);
        vm.prank(admin);
        ledger.returnToAgency(retId, AG, 120 * USD);
        assertEq(ledger.memberBalance(AG, admin), 180 * USD);
        assertEq(ledger.balanceOf(OPS), 19_820 * USD);
    }

    // ─── requestPayment: reason order and allowance limits ─────────────────

    /// Every combination of {paused, destination, per-operation (budget or allowance), funds},
    /// to a vendor and to the Member: checkPayment and requestPayment agree on the first
    /// failing rule in the engine's order, and a rejection never reverts nor moves money.
    function test_RequestPaymentReasonsFollowTheEngineOrder() public {
        for (uint256 mask; mask < 64; ++mask) {
            uint256 snapshot = vm.snapshotState();
            _requestCase(mask);
            vm.revertToStateAndDelete(snapshot);
        }
    }

    function test_AllowanceLimitZeroMeansTheBudgetLimitAndOtherwiseTheSmaller() public {
        _assertCheck(BUD, PER_OP, ViatikLedger.Reason.None, 0);
        _assertCheck(BUD, PER_OP + 1, ViatikLedger.Reason.LimitExceeded, PER_OP);

        vm.prank(admin);
        ledger.setAllowance(BUD, member, true, 300 * USD);
        _assertCheck(BUD, 300 * USD, ViatikLedger.Reason.None, 0);
        _assertCheck(BUD, 300 * USD + 1, ViatikLedger.Reason.LimitExceeded, 300 * USD);

        // A larger allowance never lifts the budget's limit.
        vm.prank(admin);
        ledger.setAllowance(BUD, member, true, 5_000 * USD);
        _assertCheck(BUD, PER_OP + 1, ViatikLedger.Reason.LimitExceeded, PER_OP);
        vm.prank(member);
        ViatikLedger.RequestStatus outcome = ledger.requestPayment(
            _id("fl_req_lim"), _id("fl_pay_lim"), BUD, VERCEL, address(0), PER_OP + 1, bytes32(0)
        );
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Rejected));
    }

    function test_ApprovalRechecksTheAllowanceLimit() public {
        _request(BUD, _id("fl_req_450"), 450 * USD, ViatikLedger.RequestStatus.Pending);

        vm.prank(admin);
        ledger.setAllowance(BUD, member, true, 400 * USD);
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.PerOperation, 400 * USD, 450 * USD
            )
        );
        ledger.approvePayment(_id("fl_req_450"), _id("fl_pay_450"));

        // Back to 0: only the budget's 1,000 applies again.
        vm.prank(admin);
        ledger.setAllowance(BUD, member, true, 0);
        vm.prank(admin);
        ledger.approvePayment(_id("fl_req_450"), _id("fl_pay_450"));
        _assertRequest(_id("fl_req_450"), ViatikLedger.RequestStatus.Executed);
        assertEq(token.balanceOf(sink), 450 * USD);
    }

    /// From a valid holder, requestPayment never reverts for any budget state or amount: the
    /// outcome is checkPayment's reason, then the approval and exception routing.
    function testFuzz_RequestPaymentNeverRevertsForAHolder(
        bool paused,
        uint8 destinationMode,
        bool toMember,
        bool nearTheStory,
        uint256 budgetPerOp,
        uint256 allowancePerOp,
        uint256 approvalThreshold,
        uint256 allocation,
        uint256 amount
    ) public {
        // 0: listed destination, 1: unlisted destination, 2: empty allowlist (any destination).
        destinationMode = uint8(bound(destinationMode, 0, 2));
        if (nearTheStory) {
            // Around the 2,000 exception, with every limit near the amount so each rule
            // passes or fails about as often and every outcome shows up.
            amount = bound(amount, 1, 3_000 * USD);
            budgetPerOp = bound(budgetPerOp, amount / 2, amount * 2);
            allowancePerOp = bound(allowancePerOp, 0, amount * 2);
            approvalThreshold = bound(approvalThreshold, amount / 2, amount * 2);
            allocation = bound(allocation, amount / 2, amount * 2);
        } else {
            allocation = bound(allocation, 0, TRANCHE_1 - BUDGET);
            amount = bound(amount, 1, type(uint256).max);
        }

        vm.startPrank(admin);
        ledger.createBudget(
            CASE_BUD,
            OPS,
            budgetPerOp,
            approvalThreshold,
            destinationMode == 2 ? new bytes32[](0) : _ids(VERCEL),
            allocation
        );
        ledger.setAllowance(CASE_BUD, member, true, allowancePerOp);
        if (paused) ledger.setBudgetPaused(CASE_BUD, true);
        vm.stopPrank();

        bytes32 destination = toMember ? bytes32(0) : (destinationMode == 0 ? VERCEL : OTHER_VENDOR);
        address payee = toMember ? member : address(0);

        // The engine's order, written out apart from the contract.
        (ViatikLedger.Reason reason, uint256 limit) =
            _engineReason(paused, toMember || destinationMode != 1, budgetPerOp, allowancePerOp, allocation, amount);
        (ViatikLedger.Reason checked, uint256 checkedLimit) =
            ledger.checkPayment(CASE_BUD, member, destination, payee, amount);
        assertEq(uint8(checked), uint8(reason), "checkPayment reason");
        assertEq(checkedLimit, limit, "checkPayment limit");

        ViatikLedger.RequestStatus expected = reason != ViatikLedger.Reason.None
            ? ViatikLedger.RequestStatus.Rejected
            : (amount > approvalThreshold || amount > EXCEPTION
                    ? ViatikLedger.RequestStatus.Pending
                    : ViatikLedger.RequestStatus.Executed);

        bytes32 requestId = _id("fl_req_fuzz");
        bytes32 paymentId = _id("fl_pay_fuzz");
        vm.expectEmit(address(ledger));
        if (expected == ViatikLedger.RequestStatus.Rejected) {
            emit ViatikLedger.PaymentRejected(requestId, CASE_BUD, member, amount, reason, limit);
        } else if (expected == ViatikLedger.RequestStatus.Pending) {
            emit ViatikLedger.PaymentPending(requestId, CASE_BUD, member, amount);
        } else {
            emit ViatikLedger.PaymentExecuted(paymentId, requestId, CASE_BUD, destination, payee, amount, EVIDENCE);
        }
        vm.prank(member);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(requestId, paymentId, CASE_BUD, destination, payee, amount, EVIDENCE);
        assertEq(uint8(outcome), uint8(expected), "outcome");
        _assertRequest(requestId, expected);

        if (expected == ViatikLedger.RequestStatus.Pending) {
            assertEq(ledger.balanceOf(CASE_BUD), allocation, "pending holds nothing");
            // Exceptions go only to the Investor; the rest only to the Admin.
            (address approver, address other) = amount > EXCEPTION ? (investor, admin) : (admin, investor);
            vm.prank(other);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, other));
            ledger.approvePayment(requestId, paymentId);
            vm.prank(approver);
            ledger.approvePayment(requestId, paymentId);
            _assertRequest(requestId, ViatikLedger.RequestStatus.Executed);
        }

        bool paid = expected != ViatikLedger.RequestStatus.Rejected;
        assertEq(ledger.balanceOf(CASE_BUD), paid ? allocation - amount : allocation, "budget");
        assertEq(token.balanceOf(sink), paid && !toMember ? amount : 0, "vendor");
        assertEq(ledger.memberBalance(AG, member), paid && toMember ? amount : 0, "member");
    }

    // ─── Transfers, returns and allocations ────────────────────────────────

    function test_TransferStaysInsideOneAgency() public {
        bytes32 opId = _id("fl_xfer");
        vm.prank(admin);
        ledger.createAccount(ACC2, AG, false);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.transfer(opId, OPS, OPS2, 100 * USD);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, OPS));
        ledger.transfer(opId, OPS, OPS, 100 * USD);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, ACC2));
        ledger.transfer(opId, OPS, ACC2, 0);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, BUD));
        ledger.transfer(opId, OPS, BUD, 100 * USD);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, OPS, 20_000 * USD, 20_000 * USD + 1)
        );
        ledger.transfer(opId, OPS, ACC2, 20_000 * USD + 1);
        vm.stopPrank();

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.transfer(opId, OPS, ACC2, 100 * USD);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.transfer(opId, OPS, ACC2, 100 * USD);

        bytes32 receipt = ledger.receiptHash(opId, ViatikLedger.ReceiptKind.Transfer, 700 * USD, OPS, ACC2, bytes32(0));
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Transferred(opId, OPS, ACC2, 700 * USD);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Recorded(opId, admin, receipt);
        vm.prank(admin);
        ledger.transfer(opId, OPS, ACC2, 700 * USD);
        assertEq(ledger.balanceOf(OPS), 19_300 * USD);
        assertEq(ledger.balanceOf(ACC2), 700 * USD);
        assertEq(ledger.balanceOf(OPS2), 47_000 * USD);
    }

    function test_ReturnToAgencyNeedsAnOperationsAccount() public {
        _buildAgencyWithoutOperations();
        vm.prank(admin3);
        ledger.requestTranche(C1, ACC3, bytes32(0));
        vm.prank(investor);
        ledger.releaseTranche(C1, bytes32(0));
        vm.prank(admin3);
        ledger.pay(_id("fl_pay_3"), ACC3, bytes32(0), admin3, 400 * USD, bytes32(0));

        vm.prank(admin3);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, AG3));
        ledger.returnToAgency(_id("fl_ret_3"), AG3, 100 * USD);

        vm.prank(admin3);
        ledger.createAccount(OPS3, AG3, true);
        vm.prank(admin3);
        ledger.returnToAgency(_id("fl_ret_3"), AG3, 100 * USD);
        assertEq(ledger.balanceOf(OPS3), 100 * USD);
        assertEq(ledger.balanceOf(ACC3), 9_600 * USD, "returns land on Operations, not the paying account");
        assertEq(ledger.memberBalance(AG3, admin3), 300 * USD);
    }

    function test_ReturnToAgencyChecksRoleAndBalance() public {
        vm.prank(admin);
        ledger.pay(_id("fl_pay_team"), OPS, bytes32(0), member, 100 * USD, bytes32(0));
        bytes32 memberLocation = ledger.memberLocation(member);
        bytes32 retId = _id("fl_ret");

        vm.startPrank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, memberLocation, 100 * USD, 0));
        ledger.returnToAgency(retId, AG, 0);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, memberLocation, 100 * USD, 100 * USD + 1)
        );
        ledger.returnToAgency(retId, AG, 100 * USD + 1);
        // A balance in AG cannot be returned to another agency.
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.returnToAgency(retId, AG2, 50 * USD);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.returnToAgency(retId, AG, 1);

        // Revoked: the balance stays booked but cannot be returned until the person rejoins.
        vm.prank(admin);
        ledger.revokeRole(AG, member);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.returnToAgency(retId, AG, 50 * USD);
        assertEq(ledger.memberBalance(AG, member), 100 * USD);

        _join(member, AG, ViatikLedger.Role.Member, 1);
        vm.prank(member);
        ledger.returnToAgency(retId, AG, 100 * USD);
        assertEq(ledger.memberBalance(AG, member), 0);
        assertEq(ledger.balanceOf(OPS), 20_000 * USD);
    }

    function test_AllocateMovesBothWaysAndRejectsEdgeDeltas() public {
        bytes32 up = _id("fl_alloc_up");
        bytes32 down = _id("fl_alloc_down");
        bytes32 bad = _id("fl_alloc_bad");
        bytes32 upReceipt =
            ledger.receiptHash(up, ViatikLedger.ReceiptKind.Allocation, 1_000 * USD, OPS, BUD, bytes32(0));
        bytes32 downReceipt =
            ledger.receiptHash(down, ViatikLedger.ReceiptKind.Allocation, 2_500 * USD, BUD, OPS, bytes32(0));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.BudgetAllocated(BUD, int256(1_000 * USD), 6_000 * USD);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Recorded(up, admin, upReceipt);
        vm.prank(admin);
        ledger.allocate(up, BUD, int256(1_000 * USD));

        vm.expectEmit(address(ledger));
        emit ViatikLedger.BudgetAllocated(BUD, -int256(2_500 * USD), 3_500 * USD);
        vm.expectEmit(address(ledger));
        emit ViatikLedger.Recorded(down, admin, downReceipt);
        vm.prank(admin);
        ledger.allocate(down, BUD, -int256(2_500 * USD));
        assertEq(ledger.balanceOf(BUD), 3_500 * USD);
        assertEq(ledger.balanceOf(OPS), 21_500 * USD);

        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, bad));
        ledger.allocate(bad, BUD, 0);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, bad));
        ledger.allocate(bad, BUD, type(int256).min);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, BUD, 3_500 * USD, 3_500 * USD + 1)
        );
        ledger.allocate(bad, BUD, -int256(3_500 * USD + 1));
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, OPS, 21_500 * USD, 21_500 * USD + 1)
        );
        ledger.allocate(bad, BUD, int256(21_500 * USD + 1));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, OPS));
        ledger.allocate(bad, OPS, 1);
        vm.stopPrank();
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.allocate(bad, BUD, 1);

        assertFalse(ledger.processed(admin, bad), "a failed allocation does not claim its id");
        assertEq(ledger.balanceOf(BUD), 3_500 * USD);
    }

    /// Any delta either moves exactly that much between the budget and its source, or
    /// reverts with a ledger error (never a panic).
    function testFuzz_AllocateMovesOrRevertsWithALedgerError(int256 delta, bool nearTheStory) public {
        if (nearTheStory) delta = bound(delta, -6_000 * int256(USD), 21_000 * int256(USD));
        bytes32 opId = _id("fl_alloc_fuzz");
        uint256 source = ledger.balanceOf(OPS);
        uint256 budget = ledger.balanceOf(BUD);

        bool fails = true;
        if (delta == 0 || delta == type(int256).min) {
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        } else if (delta > 0 && uint256(delta) > source) {
            vm.expectRevert(
                abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, OPS, source, uint256(delta))
            );
        } else if (delta < 0 && uint256(-delta) > budget) {
            vm.expectRevert(
                abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, BUD, budget, uint256(-delta))
            );
        } else {
            fails = false;
        }
        vm.prank(admin);
        ledger.allocate(opId, BUD, delta);

        if (fails) {
            assertEq(ledger.balanceOf(BUD), budget);
            assertEq(ledger.balanceOf(OPS), source);
        } else if (delta > 0) {
            assertEq(ledger.balanceOf(BUD), budget + uint256(delta));
            assertEq(ledger.balanceOf(OPS), source - uint256(delta));
        } else {
            assertEq(ledger.balanceOf(BUD), budget - uint256(-delta));
            assertEq(ledger.balanceOf(OPS), source + uint256(-delta));
        }
    }

    // ─── Case runners ───────────────────────────────────────────────────────

    function _payCase(uint256 mask) internal {
        bool paused = mask & 1 != 0;
        bool overPerOp = mask & 2 != 0;
        bool badDestination = mask & 4 != 0;
        bool exception = mask & 8 != 0;
        bool short = mask & 16 != 0;
        bool toMember = mask & 32 != 0;

        uint256 amount = exception ? EXCEPTION + 500 * USD : EXCEPTION - 500 * USD;
        uint256 perOp = overPerOp ? amount - 1 : amount;
        uint256 allocation = short ? amount - 1 : amount;
        vm.startPrank(admin);
        ledger.createBudget(CASE_BUD, OPS, perOp, 0, _ids(VERCEL), allocation);
        if (paused) ledger.setBudgetPaused(CASE_BUD, true);
        vm.stopPrank();

        // A Member payout has no destination, which the allowlist would refuse for a vendor.
        bytes32 destination = toMember ? bytes32(0) : (badDestination ? OTHER_VENDOR : VERCEL);
        address payee = toMember ? member : address(0);
        string memory label = string.concat("pay case ", vm.toString(mask));

        bytes memory expected;
        if (paused) {
            expected = abi.encodeWithSelector(ViatikLedger.BudgetPaused.selector, CASE_BUD);
        } else if (overPerOp) {
            expected = abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.PerOperation, perOp, amount
            );
        } else if (badDestination && !toMember) {
            expected = abi.encodeWithSelector(ViatikLedger.DestinationNotAllowed.selector, CASE_BUD, OTHER_VENDOR);
        } else if (exception) {
            expected = abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, EXCEPTION, amount
            );
        } else if (short) {
            expected = abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, CASE_BUD, allocation, amount);
        }

        if (expected.length > 0) vm.expectRevert(expected);
        vm.prank(admin);
        ledger.pay(_id("fl_pay_case"), CASE_BUD, destination, payee, amount, bytes32(0));

        bool paid = expected.length == 0;
        assertEq(ledger.balanceOf(CASE_BUD), paid ? 0 : allocation, label);
        assertEq(token.balanceOf(sink), paid && !toMember ? amount : 0, label);
        assertEq(ledger.memberBalance(AG, member), paid && toMember ? amount : 0, label);
    }

    function _requestCase(uint256 mask) internal {
        bool paused = mask & 1 != 0;
        bool badDestination = mask & 2 != 0;
        bool overPerOp = mask & 4 != 0;
        bool short = mask & 8 != 0;
        bool viaAllowance = mask & 16 != 0;
        bool toMember = mask & 32 != 0;

        uint256 amount = 500 * USD;
        uint256 limit = overPerOp ? amount - 1 : amount;
        // The per-operation limit comes from the budget, or from a smaller allowance.
        uint256 budgetPerOp = viaAllowance ? 10 * amount : limit;
        uint256 allowancePerOp = viaAllowance ? limit : 0;
        uint256 allocation = short ? amount - 1 : amount;

        vm.startPrank(admin);
        ledger.createBudget(CASE_BUD, OPS, budgetPerOp, amount, _ids(VERCEL), allocation);
        ledger.setAllowance(CASE_BUD, member, true, allowancePerOp);
        if (paused) ledger.setBudgetPaused(CASE_BUD, true);
        vm.stopPrank();

        bytes32 destination = toMember ? bytes32(0) : (badDestination ? OTHER_VENDOR : VERCEL);
        address payee = toMember ? member : address(0);
        string memory label = string.concat("request case ", vm.toString(mask));

        ViatikLedger.Reason reason = ViatikLedger.Reason.None;
        uint256 reasonLimit;
        if (paused) {
            reason = ViatikLedger.Reason.BudgetPaused;
        } else if (badDestination && !toMember) {
            reason = ViatikLedger.Reason.DestinationNotAllowed;
        } else if (overPerOp) {
            (reason, reasonLimit) = (ViatikLedger.Reason.LimitExceeded, limit);
        } else if (short) {
            (reason, reasonLimit) = (ViatikLedger.Reason.InsufficientFunds, allocation);
        }

        (ViatikLedger.Reason checked, uint256 checkedLimit) =
            ledger.checkPayment(CASE_BUD, member, destination, payee, amount);
        assertEq(uint8(checked), uint8(reason), label);
        assertEq(checkedLimit, reasonLimit, label);

        bytes32 requestId = _id("fl_req_case");
        if (reason != ViatikLedger.Reason.None) {
            vm.expectEmit(address(ledger));
            emit ViatikLedger.PaymentRejected(requestId, CASE_BUD, member, amount, reason, reasonLimit);
        }
        vm.prank(member);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(requestId, _id("fl_pay_case"), CASE_BUD, destination, payee, amount, bytes32(0));

        bool paid = reason == ViatikLedger.Reason.None;
        assertEq(
            uint8(outcome),
            uint8(paid ? ViatikLedger.RequestStatus.Executed : ViatikLedger.RequestStatus.Rejected),
            label
        );
        assertTrue(ledger.processed(member, requestId), label);
        assertEq(ledger.balanceOf(CASE_BUD), paid ? 0 : allocation, label);
        assertEq(token.balanceOf(sink), paid && !toMember ? amount : 0, label);
        assertEq(ledger.memberBalance(AG, member), paid && toMember ? amount : 0, label);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// The Investor of PF creates an agreement whose commitment is the sum of its tranches.
    function _createAgreement(
        bytes32 agreementId,
        bytes32 agencyId,
        bytes32 vaultId,
        uint256 exceptionThreshold,
        bytes32[] memory trancheIds,
        uint256[] memory amounts,
        bool[] memory milestones
    ) internal {
        uint256 committed;
        for (uint256 i; i < amounts.length; ++i) {
            committed += amounts[i];
        }
        vm.prank(investor);
        ledger.createAgreement(
            agreementId, agencyId, vaultId, committed, exceptionThreshold, trancheIds, amounts, milestones
        );
    }

    function _accept(bytes32 agreementId, address agencyAdmin) internal {
        vm.prank(agencyAdmin);
        ledger.acceptAgreement(agreementId);
    }

    function _fund(bytes32 agreementId, uint256 amount) internal {
        bytes32 opId = keccak256(abi.encode("qa:fl_fund", ++_opCount));
        vm.prank(investor);
        ledger.fundAgreement(opId, agreementId, PF_VAULT, amount);
    }

    /// A new agency of PF with its Admin.
    function _registerAgency(bytes32 agencyId, bytes32 fundingVault, address agencyAdmin) internal {
        vm.prank(investor);
        ledger.registerAgency(agencyId, PF, fundingVault);
        _join(agencyAdmin, agencyId, ViatikLedger.Role.Admin, 0);
    }

    /// AG3: an accepted, fully funded agreement of 10,000 (one tranche without a milestone,
    /// exception threshold 5,000) and a project account, but no Operations account.
    function _buildAgencyWithoutOperations() internal {
        _registerAgency(AG3, FUND_VAULT3, admin3);
        vm.prank(admin3);
        ledger.createAccount(ACC3, AG3, false);
        _createAgreement(FA3, AG3, FUND_VAULT3, 5_000 * USD, _ids(C1), _amounts(10_000 * USD), _flags(false));
        _accept(FA3, admin3);
        _fund(FA3, 10_000 * USD);
    }

    /// EX_BUD: per-operation 5,000 (above the 2,000 exception), auto-approval up to 200,
    /// any destination, 6,000 allocated, with Leo's allowance.
    function _exceptionBudget() internal {
        vm.startPrank(admin);
        ledger.createBudget(EX_BUD, OPS, 5_000 * USD, AUTO_APPROVE, new bytes32[](0), 6_000 * USD);
        ledger.setAllowance(EX_BUD, member, true, 0);
        vm.stopPrank();
    }

    /// Leo asks to pay VERCEL from `budgetId` and gets `expected`.
    function _request(bytes32 budgetId, bytes32 requestId, uint256 amount, ViatikLedger.RequestStatus expected)
        internal
    {
        bytes32 paymentId = keccak256(abi.encode(requestId, "pay"));
        vm.prank(member);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(requestId, paymentId, budgetId, VERCEL, address(0), amount, bytes32(0));
        assertEq(uint8(outcome), uint8(expected));
    }

    function _assertCheck(bytes32 budgetId, uint256 amount, ViatikLedger.Reason reason, uint256 limit) internal view {
        (ViatikLedger.Reason checked, uint256 checkedLimit) =
            ledger.checkPayment(budgetId, member, VERCEL, address(0), amount);
        assertEq(uint8(checked), uint8(reason));
        assertEq(checkedLimit, limit);
    }

    function _engineReason(
        bool paused,
        bool destinationOk,
        uint256 budgetPerOp,
        uint256 allowancePerOp,
        uint256 available,
        uint256 amount
    ) internal pure returns (ViatikLedger.Reason, uint256) {
        if (paused) return (ViatikLedger.Reason.BudgetPaused, 0);
        if (!destinationOk) return (ViatikLedger.Reason.DestinationNotAllowed, 0);
        uint256 perOp = allowancePerOp != 0 && allowancePerOp < budgetPerOp ? allowancePerOp : budgetPerOp;
        if (amount > perOp) return (ViatikLedger.Reason.LimitExceeded, perOp);
        if (amount > available) return (ViatikLedger.Reason.InsufficientFunds, available);
        return (ViatikLedger.Reason.None, 0);
    }

    function _assertTranche(bytes32 trancheId, ViatikLedger.TrancheStatus expected) internal view {
        assertEq(uint8(ledger.getTranche(trancheId).status), uint8(expected));
    }

    function _assertRequest(bytes32 requestId, ViatikLedger.RequestStatus expected) internal view {
        assertEq(uint8(ledger.getRequest(requestId).status), uint8(expected));
    }
}

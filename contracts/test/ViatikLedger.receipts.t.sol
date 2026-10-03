// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";

import {ViatikLedger} from "../src/ViatikLedger.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// One test per kind of money operation: each emits exactly one
/// `Recorded(opId, actor, receiptHash)`. The hash is recomputed here from section 2.8,
/// never with `ledger.receiptHash`: keccak256(abi.encode(opId, kind, amount, from, to,
/// evidenceHash)), where a Member is their address as bytes32, a vendor is its
/// destination id, a deposit comes from 0 and a tranche release carries the decision hash.
/// Each opId runs once per actor: the same id from someone else is another operation.
contract ViatikLedgerReceiptsTest is LedgerFixture {
    bytes32 internal constant NONE = bytes32(0);
    bytes32 internal constant PROJECT = keccak256("qa:acct_project");
    bytes32 internal constant PROJECT2 = keccak256("qa2:acct_project");
    bytes32 internal constant DECISION = keccak256("qa:decision_hash");

    struct RecordedLog {
        bytes32 opId;
        address actor;
        bytes32 receiptHash;
    }

    function setUp() public override {
        super.setUp();
        _buildSecondAgency();
        vm.prank(admin);
        ledger.createAccount(PROJECT, AG, false);
        vm.prank(admin2);
        ledger.createAccount(PROJECT2, AG2, false);
    }

    // ─── The receipt format ────────────────────────────────────────────────

    /// The offchain recomputation hashes the kind as a number: the numbers are part of the format.
    function test_ReceiptKindNumbersArePinned() public pure {
        assertEq(uint8(ViatikLedger.ReceiptKind.Deposit), 0);
        assertEq(uint8(ViatikLedger.ReceiptKind.Funding), 1);
        assertEq(uint8(ViatikLedger.ReceiptKind.TrancheRelease), 2);
        assertEq(uint8(ViatikLedger.ReceiptKind.Transfer), 3);
        assertEq(uint8(ViatikLedger.ReceiptKind.Payment), 4);
        assertEq(uint8(ViatikLedger.ReceiptKind.PaymentPending), 5);
        assertEq(uint8(ViatikLedger.ReceiptKind.PaymentRejected), 6);
        assertEq(uint8(ViatikLedger.ReceiptKind.Return), 7);
        assertEq(uint8(ViatikLedger.ReceiptKind.Allocation), 8);
    }

    function testFuzz_PublicHelpersMatchTheSpecEncoding(
        bytes32 opId,
        uint8 rawKind,
        uint256 amount,
        bytes32 from,
        bytes32 to,
        bytes32 evidence,
        address who
    ) public view {
        ViatikLedger.ReceiptKind kind = ViatikLedger.ReceiptKind(uint8(bound(rawKind, 0, 8)));
        assertEq(
            ledger.receiptHash(opId, kind, amount, from, to, evidence), _hash(opId, kind, amount, from, to, evidence)
        );
        assertEq(ledger.memberLocation(who), _loc(who));
    }

    // ─── One Recorded per operation ────────────────────────────────────────

    function test_DepositRecordsFromZeroIntoThePortfolioVault() public {
        bytes32 opId = _id("dep_r");
        uint256 amount = 1_234 * USD;
        uint256 tokens = token.balanceOf(address(ledger));

        vm.recordLogs();
        vm.prank(investor);
        ledger.deposit(opId, PF, PF_VAULT, amount);

        _expectOnlyReceipt(opId, investor, _hash(opId, ViatikLedger.ReceiptKind.Deposit, amount, NONE, PF_VAULT, NONE));
        assertEq(token.balanceOf(address(ledger)), tokens + amount, "the deposit mints into the ledger");
        assertEq(ledger.balanceOf(PF_VAULT), DEPOSIT - COMMITTED + amount);
    }

    function test_FundAgreementRecordsPortfolioVaultToFundingVault() public {
        (bytes32 agreementId, bytes32 vault) = _pendingAgreement("r", 10_000 * USD);
        bytes32 opId = _id("fund_r");
        uint256 amount = 4_000 * USD;
        uint256 tokens = token.balanceOf(address(ledger));

        vm.recordLogs();
        vm.prank(investor);
        ledger.fundAgreement(opId, agreementId, PF_VAULT, amount);

        _expectOnlyReceipt(opId, investor, _hash(opId, ViatikLedger.ReceiptKind.Funding, amount, PF_VAULT, vault, NONE));
        assertEq(ledger.balanceOf(vault), amount);
        assertEq(ledger.balanceOf(PF_VAULT), DEPOSIT - COMMITTED - amount);
        assertEq(token.balanceOf(address(ledger)), tokens);
    }

    function test_ReleaseToOperationsRecordsTheDecisionHash() public {
        vm.recordLogs();
        vm.prank(investor);
        ledger.releaseTranche(T2, DECISION);

        // The receipt id is the tranche id, and its evidence field is the decision hash.
        _expectOnlyReceipt(
            T2, investor, _hash(T2, ViatikLedger.ReceiptKind.TrancheRelease, TRANCHE_2, FUND_VAULT, OPS, DECISION)
        );
        assertEq(ledger.balanceOf(OPS), TRANCHE_1 - BUDGET + TRANCHE_2);
    }

    function test_ReleaseOfARequestedMilestoneRecordsTheDecisionNotTheEvidence() public {
        bytes32 tranche = _id("tr_m");
        bytes32 vault = _id("vault_m");
        uint256 amount = 8_000 * USD;
        vm.prank(investor);
        ledger.createAgreement(_id("fa_m"), AG, vault, amount, EXCEPTION, _ids(tranche), _amounts(amount), _flags(true));
        vm.prank(admin);
        ledger.acceptAgreement(_id("fa_m"));
        vm.prank(investor);
        ledger.fundAgreement(_id("fund_m"), _id("fa_m"), PF_VAULT, amount);
        vm.prank(admin);
        ledger.requestTranche(tranche, PROJECT, EVIDENCE);

        vm.recordLogs();
        vm.prank(investor);
        ledger.releaseTranche(tranche, DECISION);

        _expectOnlyReceipt(
            tranche, investor, _hash(tranche, ViatikLedger.ReceiptKind.TrancheRelease, amount, vault, PROJECT, DECISION)
        );
        assertEq(ledger.balanceOf(PROJECT), amount, "the money lands in the requested account");
    }

    function test_TransferRecordsBothAccounts() public {
        bytes32 opId = _id("xfer_r");
        uint256 amount = 500 * USD;
        uint256 tokens = token.balanceOf(address(ledger));

        vm.recordLogs();
        vm.prank(admin);
        ledger.transfer(opId, OPS, PROJECT, amount);

        _expectOnlyReceipt(opId, admin, _hash(opId, ViatikLedger.ReceiptKind.Transfer, amount, OPS, PROJECT, NONE));
        assertEq(ledger.balanceOf(OPS), TRANCHE_1 - BUDGET - amount);
        assertEq(ledger.balanceOf(PROJECT), amount);
        assertEq(token.balanceOf(address(ledger)), tokens);
    }

    function test_CreateBudgetRecordsTheInitialAllocationUnderTheBudgetId() public {
        bytes32 budgetId = _id("bud_r");
        uint256 allocation = 1_500 * USD;
        bytes32[] memory any = new bytes32[](0);

        vm.recordLogs();
        vm.prank(admin);
        ledger.createBudget(budgetId, OPS, PER_OP, AUTO_APPROVE, any, allocation);

        _expectOnlyReceipt(
            budgetId, admin, _hash(budgetId, ViatikLedger.ReceiptKind.Allocation, allocation, OPS, budgetId, NONE)
        );
        assertEq(ledger.balanceOf(budgetId), allocation);
        assertEq(ledger.balanceOf(OPS), TRANCHE_1 - BUDGET - allocation);
    }

    function test_CreateBudgetWithoutAllocationRecordsNothing() public {
        bytes32[] memory any = new bytes32[](0);
        vm.recordLogs();
        vm.prank(admin);
        ledger.createBudget(_id("bud_empty"), OPS, PER_OP, AUTO_APPROVE, any, 0);
        assertEq(_receipts().length, 0);
    }

    function test_AllocateUpRecordsSourceToBudget() public {
        bytes32 opId = _id("alloc_up");
        uint256 amount = 700 * USD;

        vm.recordLogs();
        vm.prank(admin);
        ledger.allocate(opId, BUD, int256(amount));

        _expectOnlyReceipt(opId, admin, _hash(opId, ViatikLedger.ReceiptKind.Allocation, amount, OPS, BUD, NONE));
        assertEq(ledger.balanceOf(BUD), BUDGET + amount);
    }

    function test_AllocateDownRecordsBudgetToSource() public {
        bytes32 opId = _id("alloc_down");
        uint256 amount = 300 * USD;

        vm.recordLogs();
        vm.prank(admin);
        ledger.allocate(opId, BUD, -int256(amount));

        // The receipt carries the absolute amount; the direction is in from/to.
        _expectOnlyReceipt(opId, admin, _hash(opId, ViatikLedger.ReceiptKind.Allocation, amount, BUD, OPS, NONE));
        assertEq(ledger.balanceOf(BUD), BUDGET - amount);
    }

    function test_VendorPayRecordsTheDestinationAndSendsTokensToTheSink() public {
        bytes32 opId = _id("pay_vendor");
        uint256 amount = 300 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        uint256 sinkTokens = token.balanceOf(sink);

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentExecuted(opId, NONE, OPS, VERCEL, address(0), amount, EVIDENCE);
        vm.prank(admin);
        ledger.pay(opId, OPS, VERCEL, address(0), amount, EVIDENCE);

        _expectOnlyReceipt(opId, admin, _hash(opId, ViatikLedger.ReceiptKind.Payment, amount, OPS, VERCEL, EVIDENCE));
        assertEq(token.balanceOf(address(ledger)), ledgerTokens - amount, "the ledger pays out");
        assertEq(token.balanceOf(sink), sinkTokens + amount, "the sink receives");
        assertEq(ledger.balanceOf(OPS), TRANCHE_1 - BUDGET - amount);
    }

    function test_MemberPayRecordsTheMemberLocationAndKeepsTheTokens() public {
        bytes32 opId = _id("pay_member");
        uint256 amount = 150 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        uint256 sinkTokens = token.balanceOf(sink);

        vm.recordLogs();
        vm.prank(admin);
        ledger.pay(opId, BUD, NONE, member, amount, NONE);

        _expectOnlyReceipt(opId, admin, _hash(opId, ViatikLedger.ReceiptKind.Payment, amount, BUD, _loc(member), NONE));
        assertEq(token.balanceOf(address(ledger)), ledgerTokens, "a Member's balance stays in the ledger");
        assertEq(token.balanceOf(sink), sinkTokens);
        assertEq(ledger.memberBalance(AG, member), amount);
        assertEq(ledger.balanceOf(BUD), BUDGET - amount);
    }

    function test_ExecutedRequestRecordsUnderThePaymentId() public {
        bytes32 requestId = _id("req_exec");
        bytes32 paymentId = _id("pay_exec");
        uint256 amount = 120 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        uint256 sinkTokens = token.balanceOf(sink);

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentExecuted(paymentId, requestId, BUD, VERCEL, address(0), amount, EVIDENCE);
        vm.prank(member);
        ledger.requestPayment(requestId, paymentId, BUD, VERCEL, address(0), amount, EVIDENCE);

        // No receipt under the request id: the payment is the operation.
        _expectOnlyReceipt(
            paymentId, member, _hash(paymentId, ViatikLedger.ReceiptKind.Payment, amount, BUD, VERCEL, EVIDENCE)
        );
        assertTrue(ledger.processed(member, requestId));
        assertTrue(ledger.processed(member, paymentId));
        assertEq(token.balanceOf(address(ledger)), ledgerTokens - amount);
        assertEq(token.balanceOf(sink), sinkTokens + amount);
    }

    function test_ExecutedReimbursementRecordsTheMemberLocation() public {
        bytes32 requestId = _id("req_uber");
        bytes32 paymentId = _id("pay_uber");
        uint256 amount = 35 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentExecuted(paymentId, requestId, BUD, NONE, member, amount, EVIDENCE);
        vm.prank(member);
        ledger.requestPayment(requestId, paymentId, BUD, NONE, member, amount, EVIDENCE);

        _expectOnlyReceipt(
            paymentId, member, _hash(paymentId, ViatikLedger.ReceiptKind.Payment, amount, BUD, _loc(member), EVIDENCE)
        );
        assertEq(token.balanceOf(address(ledger)), ledgerTokens);
        assertEq(ledger.memberBalance(AG, member), amount);
    }

    function test_RejectedRequestRecordsUnderTheRequestIdAndMovesNothing() public {
        bytes32 requestId = _id("req_1100");
        bytes32 paymentId = _id("pay_1100");
        uint256 amount = 1_100 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));

        vm.recordLogs();
        vm.prank(member);
        ledger.requestPayment(requestId, paymentId, BUD, VERCEL, address(0), amount, EVIDENCE);

        _expectOnlyReceipt(
            requestId, member, _hash(requestId, ViatikLedger.ReceiptKind.PaymentRejected, amount, BUD, VERCEL, EVIDENCE)
        );
        assertEq(ledger.balanceOf(BUD), BUDGET);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens);
        assertTrue(ledger.processed(member, requestId));
        assertFalse(ledger.processed(member, paymentId), "nothing was paid, so the payment id stays free");
    }

    function test_RejectedReimbursementRecordsTheMemberLocation() public {
        bytes32 requestId = _id("req_uber_big");
        uint256 amount = 1_100 * USD;

        vm.recordLogs();
        vm.prank(member);
        ledger.requestPayment(requestId, _id("pay_uber_big"), BUD, NONE, member, amount, NONE);

        _expectOnlyReceipt(
            requestId,
            member,
            _hash(requestId, ViatikLedger.ReceiptKind.PaymentRejected, amount, BUD, _loc(member), NONE)
        );
        assertEq(ledger.memberBalance(AG, member), 0);
    }

    function test_PendingRequestRecordsUnderTheRequestIdAndHoldsNothing() public {
        bytes32 requestId = _id("req_450");
        bytes32 paymentId = _id("pay_450a");
        uint256 amount = 450 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));

        vm.recordLogs();
        vm.prank(member);
        ledger.requestPayment(requestId, paymentId, BUD, VERCEL, address(0), amount, EVIDENCE);

        _expectOnlyReceipt(
            requestId, member, _hash(requestId, ViatikLedger.ReceiptKind.PaymentPending, amount, BUD, VERCEL, EVIDENCE)
        );
        assertEq(ledger.balanceOf(BUD), BUDGET);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens);
        assertFalse(ledger.processed(member, paymentId));
    }

    function test_ApprovalRecordsUnderTheNewPaymentIdWithTheApproverAsActor() public {
        bytes32 requestId = _id("req_450");
        bytes32 paymentId = _id("pay_450");
        uint256 amount = 450 * USD;
        vm.prank(member);
        ledger.requestPayment(requestId, _id("pay_450a"), BUD, VERCEL, address(0), amount, EVIDENCE);
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        uint256 sinkTokens = token.balanceOf(sink);

        vm.recordLogs();
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentApproved(requestId, paymentId, admin);
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentExecuted(paymentId, requestId, BUD, VERCEL, address(0), amount, EVIDENCE);
        vm.prank(admin);
        ledger.approvePayment(requestId, paymentId);

        _expectOnlyReceipt(
            paymentId, admin, _hash(paymentId, ViatikLedger.ReceiptKind.Payment, amount, BUD, VERCEL, EVIDENCE)
        );
        assertTrue(ledger.processed(admin, paymentId));
        assertFalse(ledger.processed(member, paymentId), "the approver ran the payment, not the requester");
        assertEq(token.balanceOf(address(ledger)), ledgerTokens - amount);
        assertEq(token.balanceOf(sink), sinkTokens + amount);
        assertEq(ledger.balanceOf(BUD), BUDGET - amount);
    }

    function test_ExceptionApprovalRecordsTheInvestorAsActor() public {
        bytes32 budgetId = _id("bud_big");
        bytes32 requestId = _id("req_ex");
        bytes32 paymentId = _id("pay_ex");
        uint256 amount = 3_000 * USD;
        bytes32[] memory any = new bytes32[](0);
        vm.startPrank(admin);
        ledger.createBudget(budgetId, OPS, 5_000 * USD, 0, any, 6_000 * USD);
        ledger.setAllowance(budgetId, member, true, 0);
        vm.stopPrank();
        vm.prank(member);
        ledger.requestPayment(requestId, _id("pay_exa"), budgetId, VERCEL, address(0), amount, NONE);

        vm.recordLogs();
        vm.prank(investor);
        ledger.approvePayment(requestId, paymentId);

        _expectOnlyReceipt(
            paymentId, investor, _hash(paymentId, ViatikLedger.ReceiptKind.Payment, amount, budgetId, VERCEL, NONE)
        );
    }

    function test_ReturnRecordsFromTheMemberLocationToOperations() public {
        vm.prank(admin);
        ledger.pay(_id("pay_team"), OPS, NONE, member, 100 * USD, NONE);
        bytes32 opId = _id("ret_r");
        uint256 amount = 40 * USD;
        uint256 ledgerTokens = token.balanceOf(address(ledger));
        uint256 opsBefore = ledger.balanceOf(OPS);

        vm.recordLogs();
        vm.prank(member);
        ledger.returnToAgency(opId, AG, amount);

        _expectOnlyReceipt(opId, member, _hash(opId, ViatikLedger.ReceiptKind.Return, amount, _loc(member), OPS, NONE));
        assertEq(ledger.memberBalance(AG, member), 60 * USD);
        assertEq(ledger.balanceOf(OPS), opsBefore + amount);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens, "a return moves no tokens");
    }

    function test_MulticallRecordsEachOperationWithTheCallerAsActor() public {
        bytes32 vendorPay = _id("pay_mc_vendor");
        bytes32 teamPay = _id("pay_mc_team");
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ViatikLedger.pay, (vendorPay, OPS, VERCEL, address(0), 10 * USD, NONE));
        calls[1] = abi.encodeCall(ViatikLedger.pay, (teamPay, OPS, NONE, member, 20 * USD, NONE));

        vm.recordLogs();
        vm.prank(admin);
        ledger.multicall(calls);

        RecordedLog[] memory receipts = _receipts();
        assertEq(receipts.length, 2);
        assertEq(receipts[0].opId, vendorPay);
        assertEq(receipts[0].actor, admin);
        assertEq(
            receipts[0].receiptHash, _hash(vendorPay, ViatikLedger.ReceiptKind.Payment, 10 * USD, OPS, VERCEL, NONE)
        );
        assertEq(receipts[1].opId, teamPay);
        assertEq(receipts[1].actor, admin);
        assertEq(
            receipts[1].receiptHash, _hash(teamPay, ViatikLedger.ReceiptKind.Payment, 20 * USD, OPS, _loc(member), NONE)
        );
    }

    // ─── Each opId runs once per actor ─────────────────────────────────────

    function test_DepositIdRunsOncePerActor() public {
        bytes32 opId = _id("dep_shared");
        vm.prank(investor);
        ledger.deposit(opId, PF, PF_VAULT, 1 * USD);
        _assertClaimedOnlyBy(opId, investor, investor2);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.deposit(opId, PF, PF_VAULT, 1 * USD);

        vm.recordLogs();
        vm.prank(investor2);
        ledger.deposit(opId, PF2, PF2_VAULT, 2 * USD);
        _expectOnlyReceipt(
            opId, investor2, _hash(opId, ViatikLedger.ReceiptKind.Deposit, 2 * USD, NONE, PF2_VAULT, NONE)
        );
        assertTrue(ledger.processed(investor2, opId));
        assertEq(ledger.balanceOf(PF_VAULT), DEPOSIT - COMMITTED + 1 * USD, "the rejected retry added nothing");
    }

    function test_FundingIdRunsOncePerActor() public {
        bytes32 opId = _id("fund_shared");
        (bytes32 agreementId,) = _pendingAgreement("shared", 5_000 * USD);
        vm.prank(investor);
        ledger.fundAgreement(opId, agreementId, PF_VAULT, 1_000 * USD);
        _assertClaimedOnlyBy(opId, investor, investor2);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.fundAgreement(opId, agreementId, PF_VAULT, 1_000 * USD);
        assertEq(ledger.getAgreement(agreementId).funded, 1_000 * USD);

        bytes32 agreement2 = keccak256("qa2:fa_shared");
        bytes32 vault2 = keccak256("qa2:vault_shared");
        vm.startPrank(investor2);
        ledger.createAgreement(
            agreement2,
            AG2,
            vault2,
            5_000 * USD,
            0,
            _ids(keccak256("qa2:tr_shared")),
            _amounts(5_000 * USD),
            _flags(false)
        );
        vm.recordLogs();
        ledger.fundAgreement(opId, agreement2, PF2_VAULT, 2_000 * USD);
        vm.stopPrank();
        _expectOnlyReceipt(
            opId, investor2, _hash(opId, ViatikLedger.ReceiptKind.Funding, 2_000 * USD, PF2_VAULT, vault2, NONE)
        );
    }

    function test_TransferIdRunsOncePerActor() public {
        bytes32 opId = _id("xfer_shared");
        vm.prank(admin);
        ledger.transfer(opId, OPS, PROJECT, 10 * USD);
        _assertClaimedOnlyBy(opId, admin, admin2);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.transfer(opId, OPS, PROJECT, 10 * USD);

        vm.recordLogs();
        vm.prank(admin2);
        ledger.transfer(opId, OPS2, PROJECT2, 20 * USD);
        _expectOnlyReceipt(opId, admin2, _hash(opId, ViatikLedger.ReceiptKind.Transfer, 20 * USD, OPS2, PROJECT2, NONE));
        assertEq(ledger.balanceOf(PROJECT), 10 * USD);
        assertEq(ledger.balanceOf(PROJECT2), 20 * USD);
    }

    function test_AllocationIdRunsOncePerActor() public {
        bytes32 opId = _id("alloc_shared");
        vm.prank(admin);
        ledger.allocate(opId, BUD, int256(100 * USD));
        _assertClaimedOnlyBy(opId, admin, admin2);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.allocate(opId, BUD, -int256(100 * USD));

        vm.recordLogs();
        vm.prank(admin2);
        ledger.allocate(opId, BUD2, -int256(500 * USD));
        _expectOnlyReceipt(opId, admin2, _hash(opId, ViatikLedger.ReceiptKind.Allocation, 500 * USD, BUD2, OPS2, NONE));
        assertEq(ledger.balanceOf(BUD), BUDGET + 100 * USD);
        assertEq(ledger.balanceOf(BUD2), 2_500 * USD);
    }

    function test_PayIdRunsOncePerActor() public {
        bytes32 opId = _id("pay_shared");
        vm.prank(admin);
        ledger.pay(opId, OPS, VERCEL, address(0), 10 * USD, NONE);
        _assertClaimedOnlyBy(opId, admin, admin2);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.pay(opId, OPS, VERCEL, address(0), 10 * USD, NONE);

        vm.recordLogs();
        vm.prank(admin2);
        ledger.pay(opId, OPS2, VERCEL, address(0), 30 * USD, NONE);
        _expectOnlyReceipt(opId, admin2, _hash(opId, ViatikLedger.ReceiptKind.Payment, 30 * USD, OPS2, VERCEL, NONE));
        assertEq(token.balanceOf(sink), 40 * USD, "one payout each, no double pay");
    }

    function test_RequestPaymentIdRunsOncePerActor() public {
        bytes32 paymentId = _id("pay_req_shared");
        vm.prank(member);
        ledger.requestPayment(_id("req_a"), paymentId, BUD, VERCEL, address(0), 10 * USD, NONE);
        _assertClaimedOnlyBy(paymentId, member, member2);

        // A second executed request with the same payment id reverts as a whole.
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, paymentId));
        ledger.requestPayment(_id("req_b"), paymentId, BUD, VERCEL, address(0), 10 * USD, NONE);
        assertEq(uint8(ledger.getRequest(_id("req_b")).status), uint8(ViatikLedger.RequestStatus.None));
        assertFalse(ledger.processed(member, _id("req_b")));

        vm.recordLogs();
        vm.prank(member2);
        ledger.requestPayment(keccak256("qa2:req_a"), paymentId, BUD2, VERCEL, address(0), 50 * USD, NONE);
        _expectOnlyReceipt(
            paymentId, member2, _hash(paymentId, ViatikLedger.ReceiptKind.Payment, 50 * USD, BUD2, VERCEL, NONE)
        );
    }

    function test_ApprovalPaymentIdRunsOncePerActor() public {
        bytes32 paymentId = _id("pay_appr_shared");
        vm.startPrank(member);
        ledger.requestPayment(_id("req_p1"), _id("pay_p1"), BUD, VERCEL, address(0), 300 * USD, NONE);
        ledger.requestPayment(_id("req_p2"), _id("pay_p2"), BUD, VERCEL, address(0), 400 * USD, NONE);
        vm.stopPrank();

        vm.prank(admin);
        ledger.approvePayment(_id("req_p1"), paymentId);
        _assertClaimedOnlyBy(paymentId, admin, admin2);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, paymentId));
        ledger.approvePayment(_id("req_p2"), paymentId);
        assertEq(uint8(ledger.getRequest(_id("req_p2")).status), uint8(ViatikLedger.RequestStatus.Pending));

        bytes32 request2 = keccak256("qa2:req_p");
        vm.prank(member2);
        ledger.requestPayment(request2, keccak256("qa2:pay_pa"), BUD2, VERCEL, address(0), 500 * USD, NONE);
        vm.recordLogs();
        vm.prank(admin2);
        ledger.approvePayment(request2, paymentId);
        _expectOnlyReceipt(
            paymentId, admin2, _hash(paymentId, ViatikLedger.ReceiptKind.Payment, 500 * USD, BUD2, VERCEL, NONE)
        );
    }

    function test_ReturnIdRunsOncePerActor() public {
        bytes32 opId = _id("ret_shared");
        vm.prank(admin);
        ledger.pay(_id("pay_team"), OPS, NONE, member, 100 * USD, NONE);
        vm.prank(admin2);
        ledger.pay(keccak256("qa2:pay_team"), OPS2, NONE, member2, 100 * USD, NONE);

        vm.prank(member);
        ledger.returnToAgency(opId, AG, 10 * USD);
        _assertClaimedOnlyBy(opId, member, member2);

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.returnToAgency(opId, AG, 10 * USD);
        assertEq(ledger.memberBalance(AG, member), 90 * USD);

        vm.recordLogs();
        vm.prank(member2);
        ledger.returnToAgency(opId, AG2, 25 * USD);
        _expectOnlyReceipt(
            opId, member2, _hash(opId, ViatikLedger.ReceiptKind.Return, 25 * USD, _loc(member2), OPS2, NONE)
        );
    }

    /// Request ids are creation ids (a known limit in 2.8): unique across actors. Still, a
    /// stranger who claims one as the opId of their own operation does not block it.
    function test_RequestIdsAreGlobalButAForeignClaimDoesNotBlockThem() public {
        bytes32 requestId = _id("req_shared");
        vm.startPrank(stranger);
        ledger.createPortfolio(_id("pf_stranger"), _id("vault_stranger"));
        ledger.deposit(requestId, _id("pf_stranger"), _id("vault_stranger"), 1 * USD);
        vm.stopPrank();

        vm.prank(member);
        ledger.requestPayment(requestId, _id("pay_a"), BUD, VERCEL, address(0), 10 * USD, NONE);
        assertTrue(ledger.processed(member, requestId));

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, requestId));
        ledger.requestPayment(requestId, _id("pay_b"), BUD, VERCEL, address(0), 10 * USD, NONE);

        vm.prank(member2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, requestId));
        ledger.requestPayment(requestId, _id("pay_c"), BUD2, VERCEL, address(0), 10 * USD, NONE);
    }

    function test_ReleasedTrancheCannotBeRecordedAgain() public {
        vm.prank(investor);
        ledger.releaseTranche(T2, DECISION);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, T2));
        ledger.releaseTranche(T2, DECISION);
        assertEq(ledger.getAgreement(FA).released, COMMITTED);
    }

    /// Budget ids are creation ids: unique across actors.
    function test_BudgetIdsAreGlobalCreationIds() public {
        bytes32 budgetId = _id("bud_shared");
        bytes32[] memory any = new bytes32[](0);
        vm.prank(admin);
        ledger.createBudget(budgetId, OPS, PER_OP, AUTO_APPROVE, any, 100 * USD);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, budgetId));
        ledger.createBudget(budgetId, OPS, PER_OP, AUTO_APPROVE, any, 100 * USD);

        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, budgetId));
        ledger.createBudget(budgetId, OPS2, PER_OP, AUTO_APPROVE, any, 100 * USD);
        assertEq(ledger.balanceOf(budgetId), 100 * USD);
    }

    /// Regression (found in 6.4): the initial allocation is recorded under the budget id, and
    /// the id used to stay unclaimed, so `processed(admin, budgetId)` read false and the same
    /// Admin could record it again through `allocate`. Now it is claimed.
    function test_BudgetIdIsClaimedWhenRecorded() public {
        bytes32 budgetId = _id("bud_twice");
        bytes32[] memory any = new bytes32[](0);
        vm.prank(admin);
        ledger.createBudget(budgetId, OPS, PER_OP, AUTO_APPROVE, any, 1_000 * USD);

        assertTrue(ledger.processed(admin, budgetId), "Recorded(budgetId, admin) but processed() is false");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, budgetId));
        ledger.allocate(budgetId, budgetId, int256(1 * USD));
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// Section 2.8, computed here on purpose (not with `ledger.receiptHash`).
    function _hash(
        bytes32 opId,
        ViatikLedger.ReceiptKind kind,
        uint256 amount,
        bytes32 from,
        bytes32 to,
        bytes32 evidenceHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(opId, kind, amount, from, to, evidenceHash));
    }

    /// A Member's location in receipts: their address as bytes32.
    function _loc(address who) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(who)));
    }

    /// The ledger's `Recorded` events since `vm.recordLogs()` (consumes the recorded logs).
    function _receipts() internal view returns (RecordedLog[] memory receipts) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (_isRecorded(logs[i])) ++count;
        }
        receipts = new RecordedLog[](count);
        uint256 next;
        for (uint256 i; i < logs.length; ++i) {
            if (!_isRecorded(logs[i])) continue;
            receipts[next++] = RecordedLog({
                opId: logs[i].topics[1],
                actor: address(uint160(uint256(logs[i].topics[2]))),
                receiptHash: abi.decode(logs[i].data, (bytes32))
            });
        }
    }

    function _isRecorded(Vm.Log memory log) internal view returns (bool) {
        return
            log.emitter == address(ledger) && log.topics.length == 3 && log.topics[0] == ViatikLedger.Recorded.selector;
    }

    function _expectOnlyReceipt(bytes32 opId, address actor, bytes32 expectedHash) internal view {
        RecordedLog[] memory receipts = _receipts();
        assertEq(receipts.length, 1, "exactly one Recorded");
        assertEq(receipts[0].opId, opId, "opId");
        assertEq(receipts[0].actor, actor, "actor");
        assertEq(receipts[0].receiptHash, expectedHash, "receiptHash");
    }

    function _assertClaimedOnlyBy(bytes32 opId, address actor, address other) internal view {
        assertTrue(ledger.processed(actor, opId), "claimed by its actor");
        assertFalse(ledger.processed(other, opId), "not claimed for anyone else");
    }

    /// A pending agreement for AG (funding is allowed while pending), with one tranche.
    function _pendingAgreement(string memory name, uint256 committed)
        internal
        returns (bytes32 agreementId, bytes32 vault)
    {
        agreementId = _id(string.concat("fa_", name));
        vault = _id(string.concat("vault_", name));
        vm.prank(investor);
        ledger.createAgreement(
            agreementId,
            AG,
            vault,
            committed,
            EXCEPTION,
            _ids(_id(string.concat("tr_", name))),
            _amounts(committed),
            _flags(false)
        );
    }
}

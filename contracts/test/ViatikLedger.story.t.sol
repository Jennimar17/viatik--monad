// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {TestUSD} from "../src/TestUSD.sol";
import {ITestUSD, ViatikLedger} from "../src/ViatikLedger.sol";

/// The QA story from the live test of 02/10, end to end on the ledger: portfolio,
/// agency, agreement, funding, a milestone tranche, a budget with an allowance,
/// requests (paid, rejected, pending), approvals, payouts and a return.
contract ViatikLedgerStoryTest is Test {
    TestUSD internal token;
    ViatikLedger internal ledger;

    address internal registrar;
    uint256 internal registrarKey;
    address internal sink = makeAddr("sink");
    address internal investor = makeAddr("jenni");
    address internal admin = makeAddr("ana");
    address internal member = makeAddr("leo");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant PF = keccak256("qa:pf_ventures");
    bytes32 internal constant PF_VAULT = keccak256("qa:vault_portfolio");
    bytes32 internal constant AG = keccak256("qa:ag_studio");
    bytes32 internal constant FUND_VAULT = keccak256("qa:vault_funding");
    bytes32 internal constant FA = keccak256("qa:fa_milestone");
    bytes32 internal constant T1 = keccak256("qa:tr_1");
    bytes32 internal constant T2 = keccak256("qa:tr_2");
    bytes32 internal constant OPS = keccak256("qa:acct_operations");
    bytes32 internal constant BUD = keccak256("qa:bud_team");
    bytes32 internal constant VERCEL = keccak256("qa:dest_vercel");
    bytes32 internal constant OTHER_VENDOR = keccak256("qa:dest_other");
    bytes32 internal constant EVIDENCE = keccak256("qa:evidence_set");

    uint256 internal constant USD = 1e6;

    function setUp() public {
        (registrar, registrarKey) = makeAddrAndKey("registrar");
        token = new TestUSD();
        ledger = new ViatikLedger(ITestUSD(address(token)), registrar, sink);

        // Deposits move real tokens now: the Investor holds TestUSD and lets the ledger pull it.
        token.mint(investor, token.MAX_MINT());
        vm.prank(investor);
        token.approve(address(ledger), type(uint256).max);
        token.mint(stranger, token.MAX_MINT());
        vm.prank(stranger);
        token.approve(address(ledger), type(uint256).max);

        vm.startPrank(investor);
        ledger.createPortfolio(PF, PF_VAULT);
        ledger.registerAgency(AG, PF, FUND_VAULT);
        vm.stopPrank();

        _join(admin, AG, ViatikLedger.Role.Admin, 0);
        _join(member, AG, ViatikLedger.Role.Member, 0);

        vm.prank(investor);
        ledger.deposit(_id("dep_1"), PF, PF_VAULT, 200_000 * USD);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = T1;
        ids[1] = T2;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 25_000 * USD;
        amounts[1] = 75_000 * USD;
        bool[] memory milestones = new bool[](2);
        milestones[0] = true;
        vm.prank(investor);
        ledger.createAgreement(FA, AG, FUND_VAULT, 100_000 * USD, 2_000 * USD, ids, amounts, milestones);

        vm.startPrank(admin);
        ledger.createAccount(OPS, AG, true);
        ledger.acceptAgreement(FA);
        vm.stopPrank();

        vm.prank(investor);
        ledger.fundAgreement(_id("fund_1"), FA, PF_VAULT, 100_000 * USD);

        vm.prank(admin);
        ledger.requestTranche(T1, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.releaseTranche(T1, keccak256("decision"));

        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = VERCEL;
        vm.startPrank(admin);
        ledger.createBudget(BUD, OPS, 1_000 * USD, 200 * USD, allowed, 5_000 * USD);
        ledger.setAllowance(BUD, member, true, 0);
        vm.stopPrank();
    }

    // ─── The story ──────────────────────────────────────────────────────────

    function test_StoryBalancesAfterSetup() public view {
        assertEq(ledger.balanceOf(PF_VAULT), 100_000 * USD);
        assertEq(ledger.balanceOf(FUND_VAULT), 75_000 * USD);
        assertEq(ledger.balanceOf(OPS), 20_000 * USD);
        assertEq(ledger.balanceOf(BUD), 5_000 * USD);
        assertEq(token.balanceOf(address(ledger)), 200_000 * USD);
        ViatikLedger.Agreement memory agreement = ledger.getAgreement(FA);
        assertEq(agreement.funded, 100_000 * USD);
        assertEq(agreement.released, 25_000 * USD);
        assertEq(uint8(ledger.getTranche(T1).status), uint8(ViatikLedger.TrancheStatus.Released));
        // The next tranche has no milestone, so it becomes available after the release.
        assertEq(uint8(ledger.getTranche(T2).status), uint8(ViatikLedger.TrancheStatus.Available));
    }

    function test_RequestWithinTheThresholdPaysTheVendorAtOnce() public {
        vm.prank(member);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(_id("req_120"), _id("pay_120"), BUD, VERCEL, address(0), 120 * USD, bytes32(0));
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Executed));
        assertEq(token.balanceOf(sink), 120 * USD);
        assertEq(ledger.balanceOf(BUD), 4_880 * USD);
    }

    function test_RequestOverTheLimitIsRecordedNotReverted() public {
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentRejected(
            _id("req_1100"), BUD, member, 1_100 * USD, ViatikLedger.Reason.LimitExceeded, 1_000 * USD
        );
        vm.prank(member);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(_id("req_1100"), _id("pay_1100"), BUD, VERCEL, address(0), 1_100 * USD, bytes32(0));
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Rejected));
        assertEq(ledger.balanceOf(BUD), 5_000 * USD);
        assertTrue(ledger.processed(member, _id("req_1100")));
    }

    function test_RequestToAnUnapprovedDestinationIsRecordedAsRejected() public {
        vm.prank(member);
        ViatikLedger.RequestStatus outcome =
            ledger.requestPayment(_id("req_x"), _id("pay_x"), BUD, OTHER_VENDOR, address(0), 50 * USD, bytes32(0));
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Rejected));
    }

    function test_PendingRequestIsApprovedByTheAdminAndNeverByTheRequester() public {
        vm.prank(member);
        ledger.requestPayment(_id("req_450"), _id("pay_450a"), BUD, VERCEL, address(0), 450 * USD, bytes32(0));
        assertEq(ledger.balanceOf(BUD), 5_000 * USD, "a pending request holds nothing");

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.approvePayment(_id("req_450"), _id("pay_450"));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.approvePayment(_id("req_450"), _id("pay_450"));

        vm.prank(admin);
        ledger.approvePayment(_id("req_450"), _id("pay_450"));
        assertEq(ledger.balanceOf(BUD), 4_550 * USD);
        assertEq(uint8(ledger.getRequest(_id("req_450")).status), uint8(ViatikLedger.RequestStatus.Executed));
    }

    /// A-13: the rules are checked again when approving; if the request no longer
    /// fits, the approval reverts and the request stays pending (and can be declined).
    function test_ApprovalChecksTheRulesAgain() public {
        vm.prank(member);
        ledger.requestPayment(_id("req_900"), _id("pay_900a"), BUD, VERCEL, address(0), 900 * USD, bytes32(0));

        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = VERCEL;
        vm.prank(admin);
        ledger.updateRules(BUD, 500 * USD, 200 * USD, allowed);

        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.PerOperation, 500 * USD, 900 * USD
            )
        );
        ledger.approvePayment(_id("req_900"), _id("pay_900"));
        assertEq(uint8(ledger.getRequest(_id("req_900")).status), uint8(ViatikLedger.RequestStatus.Pending));

        vm.prank(admin);
        ledger.closeRequest(_id("req_900"));
        assertEq(uint8(ledger.getRequest(_id("req_900")).status), uint8(ViatikLedger.RequestStatus.Closed));
    }

    function test_RevokedAllowanceCannotBeApproved() public {
        vm.prank(member);
        ledger.requestPayment(_id("req_r"), _id("pay_ra"), BUD, VERCEL, address(0), 300 * USD, bytes32(0));
        vm.prank(admin);
        ledger.setAllowance(BUD, member, false, 0);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.approvePayment(_id("req_r"), _id("pay_r"));
    }

    function test_AdminCannotPayAboveTheExceptionThreshold() public {
        vm.prank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, 2_000 * USD, 2_500 * USD
            )
        );
        ledger.pay(_id("pay_big"), OPS, VERCEL, address(0), 2_500 * USD, bytes32(0));
    }

    function test_ExceptionRequestsAreDecidedOnlyByTheInvestor() public {
        bytes32[] memory any = new bytes32[](0);
        vm.startPrank(admin);
        ledger.createBudget(_id("bud_big"), OPS, 5_000 * USD, 0, any, 6_000 * USD);
        ledger.setAllowance(_id("bud_big"), member, true, 0);
        vm.stopPrank();
        vm.prank(member);
        ledger.requestPayment(
            _id("req_ex"), _id("pay_exa"), _id("bud_big"), VERCEL, address(0), 3_000 * USD, bytes32(0)
        );

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.approvePayment(_id("req_ex"), _id("pay_ex"));

        vm.prank(investor);
        ledger.approvePayment(_id("req_ex"), _id("pay_ex"));
        assertEq(token.balanceOf(sink), 3_000 * USD);
    }

    function test_TeamPayoutAndReturnOfUnusedFunds() public {
        vm.prank(admin);
        ledger.pay(_id("pay_team"), OPS, bytes32(0), member, 100 * USD, bytes32(0));
        assertEq(ledger.memberBalance(AG, member), 100 * USD);

        vm.prank(member);
        ledger.returnToAgency(_id("ret_1"), AG, 40 * USD);
        assertEq(ledger.memberBalance(AG, member), 60 * USD);
        assertEq(ledger.balanceOf(OPS), 19_940 * USD);

        // Read the location first: a prank applies to the very next call, view calls included.
        bytes32 memberLocation = ledger.memberLocation(member);
        vm.prank(member);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, memberLocation, 60 * USD, 150 * USD)
        );
        ledger.returnToAgency(_id("ret_2"), AG, 150 * USD);
    }

    function test_ReimbursementPaysTheMemberInsteadOfAVendor() public {
        vm.prank(member);
        ledger.requestPayment(_id("req_uber"), _id("pay_uber"), BUD, bytes32(0), member, 35 * USD, bytes32(0));
        assertEq(ledger.memberBalance(AG, member), 35 * USD);
        assertEq(token.balanceOf(sink), 0);
    }

    // ─── Tranches ───────────────────────────────────────────────────────────

    function test_MilestoneSentBackCanBeRequestedAgainThenReleased() public {
        bytes32 fa2 = _id("fa_two");
        bytes32 m1 = _id("tr_m1");
        _agreementWithOneMilestone(fa2, _id("vault_two"), m1, 10_000 * USD);

        vm.prank(admin);
        ledger.requestTranche(m1, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.requestChanges(m1, false);
        assertEq(uint8(ledger.getTranche(m1).status), uint8(ViatikLedger.TrancheStatus.Available));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, m1));
        ledger.releaseTranche(m1, bytes32(0));

        vm.prank(admin);
        ledger.requestTranche(m1, OPS, keccak256("qa:evidence_v2"));
        vm.prank(investor);
        ledger.releaseTranche(m1, bytes32(0));
        assertEq(ledger.balanceOf(OPS), 30_000 * USD);
    }

    function test_RejectedTrancheCanNeverBeReleased() public {
        bytes32 m1 = _id("tr_m1");
        _agreementWithOneMilestone(_id("fa_two"), _id("vault_two"), m1, 10_000 * USD);
        vm.prank(admin);
        ledger.requestTranche(m1, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.requestChanges(m1, true);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, m1));
        ledger.releaseTranche(m1, bytes32(0));
    }

    function test_AvailableTrancheWithoutMilestoneGoesToOperations() public {
        vm.prank(investor);
        ledger.releaseTranche(T2, bytes32(0));
        assertEq(ledger.balanceOf(OPS), 95_000 * USD);
        assertEq(ledger.getAgreement(FA).released, 100_000 * USD);
    }

    function test_PausedAgreementBlocksRelease() public {
        vm.prank(investor);
        ledger.setAgreementPaused(FA, true);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AgreementPaused.selector, FA));
        ledger.releaseTranche(T2, bytes32(0));
    }

    function test_NobodyReleasesWhatTheyRequested() public {
        // The Investor also joins as Admin of the agency, requests, and then cannot release.
        _join(investor, AG, ViatikLedger.Role.Admin, 0);
        vm.prank(investor);
        ledger.requestTranche(T2, OPS, bytes32(0));
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.releaseTranche(T2, bytes32(0));
    }

    function test_CannotFundBeyondTheCommitment() public {
        vm.prank(investor);
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Commitment, 0, 1 * USD)
        );
        ledger.fundAgreement(_id("fund_2"), FA, PF_VAULT, 1 * USD);
    }

    // ─── Roles, ids and money conservation ─────────────────────────────────

    function test_JoinNeedsTheRegistrarsPermit() public {
        (, uint256 wrongKey) = makeAddrAndKey("not-registrar");
        bytes memory signature = _permit(wrongKey, stranger, AG, ViatikLedger.Role.Member, 0, block.timestamp + 1 days);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, block.timestamp + 1 days, signature);
    }

    function test_JoinPermitsExpireAndCannotBeReused() public {
        // Fixed timestamps: with via-IR, a local computed from block.timestamp can be
        // re-evaluated after vm.warp.
        vm.warp(1_000_000);
        uint256 deadline = 1_003_600;
        bytes memory signature = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);

        vm.warp(1_003_601);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, signature);

        vm.warp(1_003_000);
        vm.prank(stranger);
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, signature);
        vm.prank(admin);
        ledger.revokeRole(AG, stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, signature);
    }

    function test_EachOperationIdRunsOnce() public {
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, _id("dep_1")));
        ledger.deposit(_id("dep_1"), PF, PF_VAULT, 1 * USD);
    }

    function test_DepositsAreCappedLikeTestUSDMints() public {
        vm.prank(investor);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Deposit, 1_000_000 * USD, 1_000_001 * USD
            )
        );
        ledger.deposit(_id("dep_big"), PF, PF_VAULT, 1_000_001 * USD);
    }

    function test_StrangersCannotMoveMoney() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.pay(_id("pay_s"), OPS, VERCEL, address(0), 1 * USD, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.requestPayment(_id("req_s"), _id("pay_s2"), BUD, VERCEL, address(0), 1 * USD, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.releaseTranche(T2, bytes32(0));
        vm.stopPrank();
    }

    /// The ledger never counts TestUSD it did not book: a donation leaves a surplus.
    function test_BalancesNeverExceedTheTokensHeld() public {
        vm.prank(member);
        ledger.requestPayment(_id("req_120"), _id("pay_120"), BUD, VERCEL, address(0), 120 * USD, bytes32(0));
        vm.prank(admin);
        ledger.pay(_id("pay_team"), OPS, bytes32(0), member, 100 * USD, bytes32(0));
        vm.prank(stranger);
        token.mint(address(ledger), 7 * USD);

        uint256 booked = ledger.balanceOf(PF_VAULT) + ledger.balanceOf(FUND_VAULT) + ledger.balanceOf(OPS)
            + ledger.balanceOf(BUD) + ledger.memberBalance(AG, member);
        assertEq(booked, 200_000 * USD - 120 * USD);
        assertEq(token.balanceOf(address(ledger)), booked + 7 * USD);
    }

    // ─── Fixes from the 6.3 review ─────────────────────────────────────────

    /// Blocker 1: a stranger used to lock a tranche by claiming its id as an opId.
    function test_StrangerCannotBlockATrancheByClaimingItsId() public {
        vm.startPrank(stranger);
        ledger.createPortfolio(_id("pf_stranger"), _id("vault_stranger"));
        ledger.deposit(T2, _id("pf_stranger"), _id("vault_stranger"), 1 * USD);
        vm.stopPrank();
        vm.prank(investor);
        ledger.releaseTranche(T2, bytes32(0));
        assertEq(uint8(ledger.getTranche(T2).status), uint8(ViatikLedger.TrancheStatus.Released));
    }

    /// Blocker 2: an agency id could be reopened as a portfolio to take over its roles.
    function test_AgencyIdsCannotBecomePortfolios() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, AG));
        ledger.createPortfolio(AG, _id("vault_squat"));

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, PF));
        ledger.registerAgency(PF, PF, _id("vault_squat2"));
    }

    function test_ReimbursementOnlyPaysTheRequester() public {
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.requestPayment(_id("req_m"), _id("pay_m"), BUD, bytes32(0), admin, 35 * USD, bytes32(0));
    }

    /// M-1: above the exception threshold nothing approves itself, even within the budget's
    /// automatic limit: it waits for the Investor.
    function test_AutoApprovalNeverSkipsTheExceptionThreshold() public {
        bytes32[] memory any = new bytes32[](0);
        vm.startPrank(admin);
        ledger.createBudget(_id("bud_auto"), OPS, 5_000 * USD, 5_000 * USD, any, 6_000 * USD);
        ledger.setAllowance(_id("bud_auto"), member, true, 0);
        vm.stopPrank();
        vm.prank(member);
        ViatikLedger.RequestStatus outcome = ledger.requestPayment(
            _id("req_auto"), _id("pay_auto"), _id("bud_auto"), VERCEL, address(0), 3_000 * USD, bytes32(0)
        );
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Pending));
        vm.prank(investor);
        ledger.approvePayment(_id("req_auto"), _id("pay_auto2"));
        assertEq(token.balanceOf(sink), 3_000 * USD);
    }

    /// A revocation invalidates the person's allowances and pending requests, and they do
    /// not come back when the person rejoins.
    function test_RevocationInvalidatesAllowancesAndRequestsForGood() public {
        vm.prank(member);
        ledger.requestPayment(_id("req_old"), _id("pay_old"), BUD, VERCEL, address(0), 300 * USD, bytes32(0));

        // The Investor of the portfolio revokes: no Admin-only cascade is needed onchain.
        vm.prank(investor);
        ledger.revokeRole(AG, member);
        _join(member, AG, ViatikLedger.Role.Member, 1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.approvePayment(_id("req_old"), _id("pay_old2"));

        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, member));
        ledger.requestPayment(_id("req_new"), _id("pay_new"), BUD, VERCEL, address(0), 50 * USD, bytes32(0));

        // The Investor can close the stale request; a fresh allowance works again.
        vm.prank(investor);
        ledger.closeRequest(_id("req_old"));
        vm.prank(admin);
        ledger.setAllowance(BUD, member, true, 0);
        vm.prank(member);
        ledger.requestPayment(_id("req_new"), _id("pay_new"), BUD, VERCEL, address(0), 50 * USD, bytes32(0));
    }

    function test_AllocationsAreRecordedOnce() public {
        vm.recordLogs();
        vm.startPrank(admin);
        ledger.allocate(_id("alloc_1"), BUD, int256(1_000 * USD));
        ledger.allocate(_id("alloc_2"), BUD, -int256(500 * USD));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, _id("alloc_1")));
        ledger.allocate(_id("alloc_1"), BUD, int256(1 * USD));
        vm.stopPrank();
        assertEq(ledger.balanceOf(BUD), 5_500 * USD);
        assertEq(ledger.balanceOf(OPS), 19_500 * USD);
        assertTrue(ledger.processed(admin, _id("alloc_2")));
    }

    function test_AnUnusedPermitCanBeCancelled() public {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory signature = _permit(registrarKey, stranger, AG, ViatikLedger.Role.Member, 0, deadline);
        vm.prank(registrar);
        ledger.invalidatePermit(stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.join(AG, ViatikLedger.Role.Member, 0, deadline, signature);
    }

    function test_GenesisImportsRunOnce() public {
        bytes32 account = _id("acct_seed");
        ledger.importLocation(account, ViatikLedger.LocationKind.Account, AG, 1_000 * USD, false);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, account));
        ledger.importLocation(account, ViatikLedger.LocationKind.Account, AG, 1_000 * USD, false);

        ledger.importMemberBalance(AG, member, 10 * USD);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, AG));
        ledger.importMemberBalance(AG, member, 10 * USD);

        vm.prank(stranger);
        vm.expectRevert();
        ledger.importLocation(_id("acct_x"), ViatikLedger.LocationKind.Account, AG, 1 * USD, false);
        assertEq(token.balanceOf(address(ledger)), 201_010 * USD);
    }

    function test_FirstOperationsAccountWins() public {
        vm.prank(admin);
        ledger.createAccount(_id("acct_ops2"), AG, true);
        assertEq(ledger.operationsAccount(AG), OPS);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _id(string memory name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("qa:", name));
    }

    function _agreementWithOneMilestone(bytes32 agreementId, bytes32 vaultId, bytes32 trancheId, uint256 amount)
        internal
    {
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = trancheId;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        bool[] memory milestones = new bool[](1);
        milestones[0] = true;
        vm.prank(investor);
        ledger.createAgreement(agreementId, AG, vaultId, amount, 2_000 * USD, ids, amounts, milestones);
        vm.prank(admin);
        ledger.acceptAgreement(agreementId);
        vm.prank(investor);
        ledger.fundAgreement(keccak256(abi.encode(agreementId, "fund")), agreementId, PF_VAULT, amount);
    }

    function _join(address account, bytes32 scope, ViatikLedger.Role role, uint256 nonce) internal {
        uint256 deadline = block.timestamp + 1 days;
        bytes memory signature = _permit(registrarKey, account, scope, role, nonce, deadline);
        vm.prank(account);
        ledger.join(scope, role, nonce, deadline, signature);
    }

    function _permit(
        uint256 key,
        address account,
        bytes32 scope,
        ViatikLedger.Role role,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ViatikLedger"),
                keccak256("1"),
                block.chainid,
                address(ledger)
            )
        );
        bytes32 structHash = keccak256(abi.encode(ledger.JOIN_TYPEHASH(), account, scope, role, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }
}

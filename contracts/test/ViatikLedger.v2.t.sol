// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LedgerFixture} from "./utils/LedgerFixture.sol";
import {ViatikLedger} from "../src/ViatikLedger.sol";

/// v2 of the ledger: deposits that pull real tokens from the Investor, withdrawals (Portfolio
/// Vault and a Member's balance) and scheduled payments that a keeper runs when they are due.
/// Every test ends by checking the rule that protects everything: the tokens held by the ledger
/// equal the balances it has booked.
contract ViatikLedgerV2Test is LedgerFixture {
    uint64 internal constant T0 = 1_800_000_000;
    uint32 internal constant WEEK = 7 days;
    bytes32 internal constant NONE = bytes32(0);

    address internal keeper = makeAddr("keeper");
    address internal outside = makeAddr("outside");

    bytes32 internal constant S1 = keccak256("qa:sched_1");

    function setUp() public override {
        super.setUp();
        vm.warp(T0);
        ledger.setKeeper(keeper);
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// The tokens in the ledger equal the sum of every balance it has booked in the story.
    function _backed() internal view {
        uint256 booked = ledger.balanceOf(PF_VAULT) + ledger.balanceOf(FUND_VAULT) + ledger.balanceOf(OPS)
            + ledger.balanceOf(BUD) + ledger.memberBalance(AG, member) + ledger.memberBalance(AG, admin);
        assertEq(token.balanceOf(address(ledger)), booked, "tokens back every booked balance");
    }

    function _addr(address who) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(who)));
    }

    function _payMember(uint256 amount) internal {
        vm.prank(admin);
        ledger.pay(_id("v2_pay"), OPS, NONE, member, amount, NONE);
    }

    function _input(
        bytes32 id,
        bytes32 source,
        bytes32 destination,
        address payee,
        uint256 amount,
        uint64 firstRunAt,
        uint32 interval,
        uint32 runs
    ) internal pure returns (ViatikLedger.ScheduleInput memory) {
        return ViatikLedger.ScheduleInput({
            id: id,
            source: source,
            destination: destination,
            member: payee,
            amount: amount,
            firstRunAt: firstRunAt,
            interval: interval,
            runs: runs
        });
    }

    /// 500 to the Member from Operations, first run one day from T0, weekly, three times.
    function _createWeekly() internal {
        vm.prank(admin);
        ledger.createSchedule(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 3));
    }

    function _run(bytes32 scheduleId, bytes32 paymentId) internal {
        vm.prank(keeper);
        ledger.runSchedule(scheduleId, paymentId);
    }

    function _status(bytes32 scheduleId) internal view returns (ViatikLedger.ScheduleStatus) {
        return ledger.getSchedule(scheduleId).status;
    }

    // ─── Deposit pulls real tokens ──────────────────────────────────────────

    function test_DepositPullsTokensFromTheInvestor() public {
        uint256 wallet = token.balanceOf(investor);
        uint256 held = token.balanceOf(address(ledger));
        vm.prank(investor);
        ledger.deposit(_id("v2_dep"), PF, PF_VAULT, 1_000 * USD);
        assertEq(token.balanceOf(investor), wallet - 1_000 * USD, "the wallet pays");
        assertEq(token.balanceOf(address(ledger)), held + 1_000 * USD, "the ledger receives");
        assertEq(ledger.balanceOf(PF_VAULT), 101_000 * USD);
        _backed();
    }

    function test_DepositWithoutApprovalBooksNothing() public {
        address fresh = makeAddr("fresh");
        bytes32 pf = _id("pf_fresh");
        bytes32 vault = _id("vault_fresh");
        vm.prank(fresh);
        ledger.createPortfolio(pf, vault);
        token.mint(fresh, 10 * USD);

        vm.prank(fresh);
        vm.expectPartialRevert(bytes4(keccak256("ERC20InsufficientAllowance(address,uint256,uint256)")));
        ledger.deposit(_id("v2_noapproval"), pf, vault, 10 * USD);
        assertEq(ledger.balanceOf(vault), 0, "nothing is booked");
        assertEq(token.balanceOf(fresh), 10 * USD, "nothing moved");
    }

    function test_DepositWithoutTokensBooksNothing() public {
        address fresh = makeAddr("fresh");
        bytes32 pf = _id("pf_fresh");
        bytes32 vault = _id("vault_fresh");
        vm.startPrank(fresh);
        ledger.createPortfolio(pf, vault);
        token.approve(address(ledger), type(uint256).max);
        vm.expectPartialRevert(bytes4(keccak256("ERC20InsufficientBalance(address,uint256,uint256)")));
        ledger.deposit(_id("v2_nobalance"), pf, vault, 10 * USD);
        vm.stopPrank();
        assertEq(ledger.balanceOf(vault), 0);
    }

    function test_OnlyTheInvestorDepositsAndOnlyToAPortfolioVault() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.deposit(_id("v2_x1"), PF, PF_VAULT, 1 * USD);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, FUND_VAULT));
        ledger.deposit(_id("v2_x2"), PF, FUND_VAULT, 1 * USD);
    }

    // ─── Withdrawing from a Portfolio Vault ─────────────────────────────────

    function test_InvestorWithdrawsFromThePortfolioVault() public {
        bytes32 opId = _id("v2_wd");
        uint256 amount = 10_000 * USD;
        uint256 wallet = token.balanceOf(investor);
        bytes32 hash =
            ledger.receiptHash(opId, ViatikLedger.ReceiptKind.Withdrawal, amount, PF_VAULT, _addr(investor), NONE);

        vm.expectEmit(true, true, true, true);
        emit ViatikLedger.Withdrawn(opId, PF, PF_VAULT, investor, amount);
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.Recorded(opId, investor, hash);
        vm.prank(investor);
        ledger.withdraw(opId, PF, PF_VAULT, amount, investor);

        assertEq(ledger.balanceOf(PF_VAULT), 90_000 * USD, "the vault goes from 100,000 to 90,000");
        assertEq(token.balanceOf(investor), wallet + amount, "the tokens reach the wallet");
        assertEq(ledger.balanceOf(FUND_VAULT), 75_000 * USD, "the funding vault is untouched");
        _backed();
    }

    function test_InvestorCanWithdrawToAnotherAddress() public {
        vm.prank(investor);
        ledger.withdraw(_id("v2_wd2"), PF, PF_VAULT, 4_000 * USD, outside);
        assertEq(token.balanceOf(outside), 4_000 * USD);
        assertEq(ledger.balanceOf(PF_VAULT), 96_000 * USD);
        _backed();
    }

    function test_TheWholePortfolioVaultCanLeaveButNothingMore() public {
        uint256 all = ledger.balanceOf(PF_VAULT);
        vm.prank(investor);
        ledger.withdraw(_id("v2_all"), PF, PF_VAULT, all, investor);
        assertEq(ledger.balanceOf(PF_VAULT), 0);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, PF_VAULT, 0, 1));
        ledger.withdraw(_id("v2_more"), PF, PF_VAULT, 1, investor);
        _backed();
    }

    /// The point of the design: capital committed to an agency cannot leave through `withdraw`.
    function test_AFundingVaultCannotBeWithdrawn() public {
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, FUND_VAULT));
        ledger.withdraw(_id("v2_fv"), PF, FUND_VAULT, 1 * USD, investor);

        // Not even by naming the funding vault as if it were the portfolio.
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor));
        ledger.withdraw(_id("v2_fv2"), FUND_VAULT, FUND_VAULT, 1 * USD, investor);

        // Operations accounts and budgets are not Portfolio Vaults either.
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, OPS));
        ledger.withdraw(_id("v2_ops"), PF, OPS, 1 * USD, investor);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, BUD));
        ledger.withdraw(_id("v2_bud"), PF, BUD, 1 * USD, investor);
        _backed();
    }

    function test_OnlyTheInvestorOfThePortfolioWithdraws() public {
        address[3] memory others = [admin, member, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.withdraw(_id("v2_o"), PF, PF_VAULT, 1 * USD, others[i]);
        }

        _buildSecondAgency();
        // Another portfolio's Investor cannot take from this one, naming either id.
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor2));
        ledger.withdraw(_id("v2_p1"), PF, PF_VAULT, 1 * USD, investor2);
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF_VAULT));
        ledger.withdraw(_id("v2_p2"), PF2, PF_VAULT, 1 * USD, investor2);
        // And this Investor cannot take from the other portfolio's vault.
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, PF2_VAULT));
        ledger.withdraw(_id("v2_p3"), PF, PF2_VAULT, 1 * USD, investor);
    }

    function test_WithdrawRejectsBadInputsAndReplays() public {
        bytes32 opId = _id("v2_bad");
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.withdraw(opId, PF, PF_VAULT, 0, investor);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.withdraw(opId, PF, PF_VAULT, 1 * USD, address(0));
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.withdraw(opId, PF, PF_VAULT, 1 * USD, address(ledger));

        vm.prank(investor);
        ledger.withdraw(opId, PF, PF_VAULT, 1 * USD, investor);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.withdraw(opId, PF, PF_VAULT, 1 * USD, investor);
        _backed();
    }

    /// Deposit, commit, withdraw what is left: the flow of the product, token by token.
    function test_FundFromWalletCommitAndWithdrawWhatIsLeft() public {
        uint256 start = token.balanceOf(investor);
        vm.prank(investor);
        ledger.deposit(_id("v2_flow"), PF, PF_VAULT, 60_250 * USD);
        assertEq(ledger.balanceOf(PF_VAULT), 160_250 * USD);

        vm.prank(investor);
        ledger.withdraw(_id("v2_flow_out"), PF, PF_VAULT, 160_250 * USD, investor);
        assertEq(ledger.balanceOf(PF_VAULT), 0);
        assertEq(token.balanceOf(investor), start + 100_000 * USD, "the story's 100,000 came back");
        assertEq(ledger.balanceOf(FUND_VAULT), 75_000 * USD, "committed capital stayed in the agency");
        _backed();
    }

    // ─── Withdrawing a Member's Viatik balance ──────────────────────────────

    function test_MemberWithdrawsTheirOwnBalance() public {
        _payMember(1_500 * USD);
        bytes32 opId = _id("v2_mw");
        bytes32 hash = ledger.receiptHash(
            opId, ViatikLedger.ReceiptKind.Withdrawal, 600 * USD, ledger.memberLocation(member), _addr(outside), NONE
        );

        vm.expectEmit(true, true, true, true);
        emit ViatikLedger.Withdrawn(opId, AG, ledger.memberLocation(member), outside, 600 * USD);
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.Recorded(opId, member, hash);
        vm.prank(member);
        ledger.withdrawMemberBalance(opId, AG, 600 * USD, outside);

        assertEq(ledger.memberBalance(AG, member), 900 * USD);
        assertEq(token.balanceOf(outside), 600 * USD);
        _backed();
    }

    function test_MemberCannotWithdrawMoreThanTheyHold() public {
        _payMember(1_500 * USD);
        bytes32 location = ledger.memberLocation(member);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, location, 1_500 * USD, 2_000 * USD));
        ledger.withdrawMemberBalance(_id("v2_mw2"), AG, 2_000 * USD, outside);
    }

    function test_NobodyWithdrawsAnotherPersonsBalance() public {
        _payMember(1_500 * USD);
        bytes32 location = ledger.memberLocation(stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, location, 0, 1));
        ledger.withdrawMemberBalance(_id("v2_mw3"), AG, 1, stranger);
        assertEq(ledger.memberBalance(AG, member), 1_500 * USD);
    }

    function test_AMemberWhoLeftTheAgencyKeepsWhatWasPaid() public {
        _payMember(1_500 * USD);
        vm.prank(admin);
        ledger.revokeRole(AG, member);

        vm.prank(member);
        ledger.withdrawMemberBalance(_id("v2_mw4"), AG, 1_500 * USD, member);
        assertEq(token.balanceOf(member), 1_500 * USD);
        assertEq(ledger.memberBalance(AG, member), 0);
        _backed();
    }

    function test_MemberWithdrawRejectsBadInputsAndReplays() public {
        _payMember(1_500 * USD);
        bytes32 opId = _id("v2_mw5");
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.withdrawMemberBalance(opId, AG, 1 * USD, address(0));
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, opId));
        ledger.withdrawMemberBalance(opId, AG, 1 * USD, address(ledger));

        bytes32 location = ledger.memberLocation(member);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, location, 1_500 * USD, 0));
        ledger.withdrawMemberBalance(opId, AG, 0, member);

        vm.prank(member);
        ledger.withdrawMemberBalance(opId, AG, 1 * USD, member);
        vm.prank(member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, opId));
        ledger.withdrawMemberBalance(opId, AG, 1 * USD, member);
        _backed();
    }

    // ─── Creating a schedule ────────────────────────────────────────────────

    function test_AdminCreatesAScheduleForAMember() public {
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.ScheduleCreated(S1, AG, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 3);
        _createWeekly();

        ViatikLedger.Schedule memory s = ledger.getSchedule(S1);
        assertEq(s.agency, AG);
        assertEq(s.source, OPS);
        assertEq(s.member, member);
        assertEq(s.creator, admin);
        assertEq(s.amount, 500 * USD);
        assertEq(s.nextRunAt, T0 + 1 days);
        assertEq(s.interval, WEEK);
        assertEq(s.runsLeft, 3);
        assertTrue(s.status == ViatikLedger.ScheduleStatus.Active);
        // Creating moves nothing: money moves only when it runs.
        _backed();
    }

    function test_AdminCreatesAScheduleForAVendorFromABudget() public {
        vm.prank(admin);
        ledger.createSchedule(_input(S1, BUD, VERCEL, address(0), 100 * USD, T0 + 1 hours, 30 days, 12));
        assertEq(ledger.getSchedule(S1).destination, VERCEL);
        assertEq(ledger.getSchedule(S1).runsLeft, 12);
    }

    function test_OnlyAnAdminOfTheAgencyCreatesSchedules() public {
        ViatikLedger.ScheduleInput memory input = _input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 3);
        address[3] memory others = [investor, member, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.createSchedule(input);
        }
    }

    function test_ASchedulePaysOneKindOfPayeeOnly() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.createSchedule(_input(S1, OPS, VERCEL, member, 500 * USD, T0 + 1 days, WEEK, 3));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.createSchedule(_input(S1, OPS, NONE, address(0), 500 * USD, T0 + 1 days, WEEK, 3));
        // The Member has to belong to the agency.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, _addr(stranger)));
        ledger.createSchedule(_input(S1, OPS, NONE, stranger, 500 * USD, T0 + 1 days, WEEK, 3));
    }

    function test_ScheduleInputsAreValidated() public {
        // Nothing to pay, nothing to run, too many runs, a date in the past.
        _expectInvalid(_input(S1, OPS, NONE, member, 0, T0 + 1 days, WEEK, 3));
        _expectInvalid(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 0));
        _expectInvalid(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 53));
        _expectInvalid(_input(S1, OPS, NONE, member, 500 * USD, T0 - 1, WEEK, 3));
        // A single run has no interval; a repeating one is not faster than a minute.
        _expectInvalid(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, 0, 2));
        _expectInvalid(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, 59, 2));
        // The zero id.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, NONE));
        ledger.createSchedule(_input(NONE, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 3));

        // The edges are fine: a single run, a one-minute cadence, fifty-two runs, right now.
        vm.startPrank(admin);
        ledger.createSchedule(_input(_id("e1"), OPS, NONE, member, 1, T0 + 1, 0, 1));
        ledger.createSchedule(_input(_id("e2"), OPS, NONE, member, 1, T0, 60, 52));
        vm.stopPrank();
    }

    function _expectInvalid(ViatikLedger.ScheduleInput memory input) internal {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, input.id));
        ledger.createSchedule(input);
    }

    /// A schedule can never authorize what the Admin could not pay by hand.
    function test_ASchedulePlayedByTheSameRulesAsPay() public {
        // From the budget: above its per-operation limit, to a vendor it does not allow.
        vm.startPrank(admin);
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.PerOperation, PER_OP, PER_OP + 1
            )
        );
        ledger.createSchedule(_input(S1, BUD, VERCEL, address(0), PER_OP + 1, T0 + 1 days, WEEK, 3));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.DestinationNotAllowed.selector, BUD, OTHER_VENDOR));
        ledger.createSchedule(_input(S1, BUD, OTHER_VENDOR, address(0), 100 * USD, T0 + 1 days, WEEK, 3));
        // Above the Investor's exception threshold from any source.
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Exception, EXCEPTION, EXCEPTION + 1
            )
        );
        ledger.createSchedule(_input(S1, OPS, NONE, member, EXCEPTION + 1, T0 + 1 days, WEEK, 3));
        vm.stopPrank();
        // A paused budget.
        vm.prank(admin);
        ledger.setBudgetPaused(BUD, true);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.BudgetPaused.selector, BUD));
        ledger.createSchedule(_input(S1, BUD, VERCEL, address(0), 100 * USD, T0 + 1 days, WEEK, 3));
    }

    function test_AScheduleIdIsSingleUse() public {
        _createWeekly();
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, S1));
        ledger.createSchedule(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 3));
    }

    // ─── Running a schedule ─────────────────────────────────────────────────

    function test_KeeperRunsADueScheduleAndThePaymentIsRecorded() public {
        _createWeekly();
        bytes32 paymentId = _id("v2_run1");
        uint256 ops = ledger.balanceOf(OPS);
        bytes32 hash = ledger.receiptHash(
            paymentId, ViatikLedger.ReceiptKind.Payment, 500 * USD, OPS, ledger.memberLocation(member), NONE
        );

        vm.warp(T0 + 1 days);
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.ScheduleRan(S1, paymentId, T0 + 1 days + WEEK, 2);
        vm.expectEmit(true, true, false, true);
        emit ViatikLedger.Recorded(paymentId, keeper, hash);
        _run(S1, paymentId);

        assertEq(ledger.balanceOf(OPS), ops - 500 * USD);
        assertEq(ledger.memberBalance(AG, member), 500 * USD);
        assertEq(ledger.getSchedule(S1).runsLeft, 2);
        assertEq(ledger.getSchedule(S1).nextRunAt, T0 + 1 days + WEEK);
        assertTrue(ledger.processed(keeper, paymentId));
        _backed();
    }

    function test_AVendorScheduleLeavesTheLedgerLikeAnyVendorPayment() public {
        vm.prank(admin);
        ledger.createSchedule(_input(S1, BUD, VERCEL, address(0), 100 * USD, T0 + 1 hours, 0, 1));
        uint256 sinkBefore = token.balanceOf(sink);
        vm.warp(T0 + 1 hours);
        _run(S1, _id("v2_vendor"));
        assertEq(token.balanceOf(sink), sinkBefore + 100 * USD, "the vendor payment goes to the payout sink");
        assertEq(ledger.balanceOf(BUD), BUDGET - 100 * USD);
        _backed();
    }

    function test_OnlyTheKeeperRuns() public {
        _createWeekly();
        vm.warp(T0 + 1 days);
        address[4] memory others = [admin, investor, member, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.runSchedule(S1, _id("v2_nope"));
        }
    }

    function test_NobodyRunsWhileNoKeeperIsSet() public {
        ViatikLedger fresh = new ViatikLedger(ledger.TOKEN(), registrar, sink);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, keeper));
        fresh.runSchedule(S1, _id("v2_nokeeper"));
    }

    function test_OnlyTheOwnerSetsTheKeeper() public {
        vm.prank(admin);
        vm.expectRevert();
        ledger.setKeeper(admin);

        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, NONE));
        ledger.setKeeper(address(0));

        vm.expectEmit(false, false, false, true);
        emit ViatikLedger.KeeperSet(outside);
        ledger.setKeeper(outside);
        assertEq(ledger.keeper(), outside);
    }

    function test_ARunBeforeItIsDueReverts() public {
        _createWeekly();
        vm.warp(T0 + 1 days - 1);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotDue.selector, S1, T0 + 1 days));
        ledger.runSchedule(S1, _id("v2_early"));
        assertEq(ledger.getSchedule(S1).runsLeft, 3, "nothing ran");
    }

    function test_ARecurringScheduleRunsOnItsCadenceAndCompletes() public {
        _createWeekly();
        for (uint256 i; i < 3; ++i) {
            vm.warp(T0 + 1 days + i * WEEK);
            _run(S1, keccak256(abi.encode("run", i)));
        }
        assertEq(ledger.memberBalance(AG, member), 1_500 * USD);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Completed);
        assertEq(ledger.getSchedule(S1).runsLeft, 0);

        vm.warp(T0 + 1 days + 3 * WEEK);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.runSchedule(S1, _id("v2_after_end"));
        _backed();
    }

    function test_AKeeperThatWasDownCatchesUpWhatWasOwed() public {
        _createWeekly();
        vm.warp(T0 + 1 days + 2 * WEEK + 1 hours);
        _run(S1, _id("v2_late_1"));
        _run(S1, _id("v2_late_2"));
        _run(S1, _id("v2_late_3"));
        assertEq(ledger.memberBalance(AG, member), 1_500 * USD, "three payments were due, three were paid");
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Completed);
    }

    function test_APaymentIdRunsOnce() public {
        _createWeekly();
        vm.warp(T0 + 1 days);
        _run(S1, _id("v2_dup"));
        vm.warp(T0 + 1 days + WEEK);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, _id("v2_dup")));
        ledger.runSchedule(S1, _id("v2_dup"));
    }

    function test_ARunChecksTheBudgetRulesAgain() public {
        vm.prank(admin);
        ledger.createSchedule(_input(S1, BUD, VERCEL, address(0), 100 * USD, T0 + 1 hours, WEEK, 3));
        vm.warp(T0 + 1 hours);

        vm.prank(admin);
        ledger.setBudgetPaused(BUD, true);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.BudgetPaused.selector, BUD));
        ledger.runSchedule(S1, _id("v2_budget"));

        vm.prank(admin);
        ledger.setBudgetPaused(BUD, false);
        _run(S1, _id("v2_budget_ok"));
        _backed();
    }

    function test_ARunNeedsTheMoneyToBeThere() public {
        // Take everything out of Operations, then let the schedule come due.
        _createWeekly();
        bytes32 other = keccak256("qa:acct_other");
        vm.startPrank(admin);
        ledger.createAccount(other, AG, false);
        ledger.transfer(_id("v2_drain"), OPS, other, ledger.balanceOf(OPS));
        vm.stopPrank();

        vm.warp(T0 + 1 days);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, OPS, 0, 500 * USD));
        ledger.runSchedule(S1, _id("v2_empty"));
        assertEq(ledger.getSchedule(S1).runsLeft, 3, "a failed run costs nothing and can be retried");
    }

    function test_AScheduleStopsWhenItsAdminLosesTheRole() public {
        _createWeekly();
        vm.prank(investor);
        ledger.revokeRole(AG, admin);

        vm.warp(T0 + 1 days);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.runSchedule(S1, _id("v2_gone"));
    }

    function test_AScheduleStopsWhenThePayeeLosesTheRole() public {
        _createWeekly();
        vm.prank(admin);
        ledger.revokeRole(AG, member);

        vm.warp(T0 + 1 days);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, _addr(member)));
        ledger.runSchedule(S1, _id("v2_gone2"));
    }

    function test_AnUnknownScheduleCannotRun() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, S1));
        ledger.runSchedule(S1, _id("v2_unknown"));
    }

    // ─── Pausing, resuming and cancelling ───────────────────────────────────

    function test_APausedScheduleDoesNotRun() public {
        _createWeekly();
        vm.prank(admin);
        ledger.pauseSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Paused);

        vm.warp(T0 + 1 days);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.SchedulePaused.selector, S1));
        ledger.runSchedule(S1, _id("v2_paused"));
    }

    function test_TheInvestorPausesAndOnlyTheInvestorResumes() public {
        _createWeekly();
        vm.expectEmit(true, false, false, true);
        emit ViatikLedger.ScheduleStatusChanged(S1, ViatikLedger.ScheduleStatus.Paused, investor);
        vm.prank(investor);
        ledger.pauseSchedule(S1);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin));
        ledger.resumeSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Paused, "the Admin cannot undo it");

        vm.prank(investor);
        ledger.resumeSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Active);
    }

    function test_WhenTheAdminPausesEitherCanResume() public {
        _createWeekly();
        vm.prank(admin);
        ledger.pauseSchedule(S1);
        vm.prank(investor);
        ledger.resumeSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Active);

        vm.prank(admin);
        ledger.pauseSchedule(S1);
        vm.prank(admin);
        ledger.resumeSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Active);
    }

    function test_OnlyAdminsAndTheInvestorManageASchedule() public {
        _createWeekly();
        address[2] memory others = [member, stranger];
        for (uint256 i; i < others.length; ++i) {
            vm.startPrank(others[i]);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.pauseSchedule(S1);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, others[i]));
            ledger.cancelSchedule(S1);
            vm.stopPrank();
        }
        // Another portfolio's Investor has no say either.
        _buildSecondAgency();
        vm.prank(investor2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, investor2));
        ledger.pauseSchedule(S1);
        vm.prank(admin2);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, admin2));
        ledger.pauseSchedule(S1);
    }

    function test_ResumeSkipsTheDatesThatPassedWhilePaused() public {
        vm.prank(admin);
        ledger.createSchedule(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, WEEK, 4));
        vm.prank(admin);
        ledger.pauseSchedule(S1);

        // Three and a bit weeks later: the dates at +1d, +8d, +15d and +22d have passed.
        vm.warp(T0 + 1 days + 3 * WEEK + 1 hours);
        vm.prank(admin);
        ledger.resumeSchedule(S1);

        assertEq(ledger.getSchedule(S1).runsLeft, 4, "skipped dates do not use up runs");
        assertEq(ledger.getSchedule(S1).nextRunAt, T0 + 1 days + 4 * WEEK, "it goes on from the next date");
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotDue.selector, S1, T0 + 1 days + 4 * WEEK));
        ledger.runSchedule(S1, _id("v2_skip"));
        assertEq(ledger.memberBalance(AG, member), 0, "nothing was paid for the skipped dates");

        vm.warp(T0 + 1 days + 4 * WEEK);
        _run(S1, _id("v2_skip_ok"));
        assertEq(ledger.memberBalance(AG, member), 500 * USD);
    }

    function test_ResumeBeforeTheNextDateChangesNothing() public {
        _createWeekly();
        vm.prank(admin);
        ledger.pauseSchedule(S1);
        vm.warp(T0 + 12 hours);
        vm.prank(admin);
        ledger.resumeSchedule(S1);
        assertEq(ledger.getSchedule(S1).nextRunAt, T0 + 1 days);
    }

    function test_ASingleRunThatWasDueRunsAsSoonAsItIsResumed() public {
        vm.prank(admin);
        ledger.createSchedule(_input(S1, OPS, NONE, member, 500 * USD, T0 + 1 days, 0, 1));
        vm.prank(admin);
        ledger.pauseSchedule(S1);
        vm.warp(T0 + 5 days);
        vm.prank(admin);
        ledger.resumeSchedule(S1);
        assertEq(ledger.getSchedule(S1).nextRunAt, T0 + 5 days);
        _run(S1, _id("v2_once"));
        assertEq(ledger.memberBalance(AG, member), 500 * USD);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Completed);
    }

    function test_CancellingIsForGood() public {
        _createWeekly();
        vm.prank(admin);
        ledger.cancelSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Cancelled);

        vm.warp(T0 + 1 days);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.runSchedule(S1, _id("v2_cancelled"));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.resumeSchedule(S1);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.cancelSchedule(S1);
    }

    function test_TheInvestorCancelsAPausedSchedule() public {
        _createWeekly();
        vm.prank(investor);
        ledger.pauseSchedule(S1);
        vm.prank(admin);
        ledger.cancelSchedule(S1);
        assertTrue(_status(S1) == ViatikLedger.ScheduleStatus.Cancelled, "the Admin can cancel what the Investor paused");
    }

    function test_AnUnknownScheduleCannotBeManaged() public {
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, S1));
        ledger.pauseSchedule(S1);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, S1));
        ledger.resumeSchedule(S1);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, S1));
        ledger.cancelSchedule(S1);
        vm.stopPrank();
    }

    function test_PausingAnAlreadyPausedScheduleReverts() public {
        _createWeekly();
        vm.prank(admin);
        ledger.pauseSchedule(S1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.pauseSchedule(S1);
        vm.prank(admin);
        ledger.resumeSchedule(S1);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, S1));
        ledger.resumeSchedule(S1);
    }

    // ─── The whole thing ────────────────────────────────────────────────────

    /// A schedule pays a Member, who takes the money to their own wallet.
    function test_ScheduledPayThenMemberWithdraws() public {
        _createWeekly();
        vm.warp(T0 + 1 days);
        _run(S1, _id("v2_e2e"));
        vm.prank(member);
        ledger.withdrawMemberBalance(_id("v2_e2e_out"), AG, 500 * USD, member);
        assertEq(token.balanceOf(member), 500 * USD);
        assertEq(ledger.memberBalance(AG, member), 0);
        _backed();
    }
}

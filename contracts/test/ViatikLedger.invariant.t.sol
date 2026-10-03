// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ViatikLedger} from "../src/ViatikLedger.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";
import {LedgerHandler} from "./utils/LedgerHandler.sol";

/// Stateful invariants for ViatikLedger. Starting from the QA story plus a second,
/// unrelated agency, LedgerHandler runs random sequences over every money path (both
/// agencies), owner imports, a donor and outsiders replaying ids from the shared pool.
/// The handler keeps a reference model of every balance; the invariants compare the
/// ledger with it after every call.
/// forge-config: default.invariant.runs = 128
/// forge-config: default.invariant.depth = 50
/// forge-config: default.invariant.fail-on-revert = false
contract ViatikLedgerInvariantTest is LedgerFixture {
    LedgerHandler internal handler;

    // Open work added on top of the fixture (see `_addOpenWork`).
    bytes32 internal constant FA3 = keccak256("inv:fa_three");
    bytes32 internal constant VAULT3 = keccak256("inv:vault_three");
    bytes32 internal constant M1 = keccak256("inv:tr_m1");
    bytes32 internal constant M2 = keccak256("inv:tr_m2");
    bytes32 internal constant N3 = keccak256("inv:tr_n3");
    bytes32 internal constant BUD_BIG = keccak256("inv:bud_big");
    bytes32 internal constant FUND_3 = keccak256("inv:fund_3");
    bytes32 internal constant REQ_450 = keccak256("inv:req_450");
    bytes32 internal constant REQ_EXCEPTION = keccak256("inv:req_exception");
    bytes32 internal constant REQ_B = keccak256("inv:req_b");
    bytes32 internal constant PAY_LEO = keccak256("inv:pay_leo");
    bytes32 internal constant PAY_MEMBER2 = keccak256("inv:pay_member2");

    function setUp() public override {
        super.setUp();
        _buildSecondAgency();
        _addOpenWork();

        LedgerHandler.Seed[2] memory seeds;
        LedgerHandler.ClaimedOp[] memory usedA = new LedgerHandler.ClaimedOp[](6);
        usedA[0] = LedgerHandler.ClaimedOp(investor, _id("dep_1"));
        usedA[1] = LedgerHandler.ClaimedOp(investor, _id("fund_1"));
        usedA[2] = LedgerHandler.ClaimedOp(investor, FUND_3);
        usedA[3] = LedgerHandler.ClaimedOp(member, REQ_450);
        usedA[4] = LedgerHandler.ClaimedOp(member, REQ_EXCEPTION);
        usedA[5] = LedgerHandler.ClaimedOp(admin, PAY_LEO);
        seeds[0] = LedgerHandler.Seed({
            side: LedgerHandler.Side({
                portfolio: PF,
                pfVault: PF_VAULT,
                investor: investor,
                agency: AG,
                admin: admin,
                member: member,
                operations: OPS
            }),
            agreements: _ids(FA, FA3),
            budgets: _ids(BUD, BUD_BIG),
            requests: _ids(REQ_450, REQ_EXCEPTION),
            usedOps: usedA
        });
        LedgerHandler.ClaimedOp[] memory usedB = new LedgerHandler.ClaimedOp[](4);
        usedB[0] = LedgerHandler.ClaimedOp(investor2, keccak256("qa2:dep"));
        usedB[1] = LedgerHandler.ClaimedOp(investor2, keccak256("qa2:fund"));
        usedB[2] = LedgerHandler.ClaimedOp(member2, REQ_B);
        usedB[3] = LedgerHandler.ClaimedOp(admin2, PAY_MEMBER2);
        seeds[1] = LedgerHandler.Seed({
            side: LedgerHandler.Side({
                portfolio: PF2,
                pfVault: PF2_VAULT,
                investor: investor2,
                agency: AG2,
                admin: admin2,
                member: member2,
                operations: OPS2
            }),
            agreements: _ids(FA2),
            budgets: _ids(BUD2),
            requests: _ids(REQ_B),
            usedOps: usedB
        });
        handler = new LedgerHandler(ledger, token, sink, registrarKey, seeds);

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: handler.actions()}));
    }

    /// Open work at the start of every run, so a short sequence still reaches the deeper
    /// paths: a partly funded milestone agreement whose first tranche is requested, pending
    /// requests in both agencies (one above the exception threshold) and Members who hold
    /// something to return.
    function _addOpenWork() internal {
        vm.prank(investor);
        ledger.createAgreement(
            FA3,
            AG,
            VAULT3,
            20_000 * USD,
            0,
            _ids(M1, M2, N3),
            _amounts(8_000 * USD, 6_000 * USD, 6_000 * USD),
            _flags(true, true, false)
        );
        vm.prank(admin);
        ledger.acceptAgreement(FA3);
        vm.prank(investor);
        ledger.fundAgreement(FUND_3, FA3, PF_VAULT, 14_000 * USD);
        vm.prank(admin);
        ledger.requestTranche(M1, OPS, EVIDENCE);

        bytes32[] memory any = new bytes32[](0);
        vm.startPrank(admin);
        ledger.createBudget(BUD_BIG, OPS, 5_000 * USD, 0, any, 6_000 * USD);
        ledger.setAllowance(BUD_BIG, member, true, 0);
        vm.stopPrank();

        vm.startPrank(member);
        ledger.requestPayment(REQ_450, keccak256("inv:pay_450"), BUD, VERCEL, address(0), 450 * USD, bytes32(0));
        ledger.requestPayment(
            REQ_EXCEPTION, keccak256("inv:pay_ex"), BUD_BIG, VERCEL, address(0), 3_000 * USD, bytes32(0)
        );
        vm.stopPrank();
        vm.prank(member2);
        ledger.requestPayment(REQ_B, keccak256("inv:pay_b"), BUD2, OTHER_VENDOR, address(0), 500 * USD, bytes32(0));

        // People who hold something they can return.
        vm.prank(admin);
        ledger.pay(PAY_LEO, OPS, bytes32(0), member, 300 * USD, bytes32(0));
        vm.prank(admin2);
        ledger.pay(PAY_MEMBER2, OPS2, bytes32(0), member2, 200 * USD, bytes32(0));
    }

    /// The starting point every run shares.
    function test_OpenWorkStartsWhereTheRunsExpect() public view {
        assertEq(ledger.balanceOf(PF_VAULT), DEPOSIT - COMMITTED - 14_000 * USD);
        assertEq(ledger.balanceOf(VAULT3), 14_000 * USD);
        assertEq(ledger.balanceOf(OPS), TRANCHE_1 - BUDGET - 6_000 * USD - 300 * USD);
        assertEq(ledger.memberBalance(AG, member), 300 * USD);
        assertEq(ledger.memberBalance(AG2, member2), 200 * USD);
        assertEq(uint8(ledger.getTranche(M1).status), uint8(ViatikLedger.TrancheStatus.Requested));
        assertEq(uint8(ledger.getRequest(REQ_450).status), uint8(ViatikLedger.RequestStatus.Pending));
        assertEq(uint8(ledger.getRequest(REQ_EXCEPTION).status), uint8(ViatikLedger.RequestStatus.Pending));
        assertEq(uint8(ledger.getRequest(REQ_B).status), uint8(ViatikLedger.RequestStatus.Pending));
        assertEq(handler.ghostBooked(), token.balanceOf(address(ledger)));
        assertEq(handler.violations(), 0);
    }

    // ─── Money ──────────────────────────────────────────────────────────────

    /// The ledger holds exactly what it booked plus what was donated, and the payout
    /// sink holds exactly the vendor payouts.
    function invariant_TokensBackEveryBookedBalance() public view {
        assertEq(
            token.balanceOf(address(ledger)),
            handler.ghostBooked() + handler.ghostDonations(),
            "ledger TestUSD != booked + donations"
        );
        assertEq(token.balanceOf(sink), handler.ghostVendorPaid(), "sink != vendor payouts");
    }

    /// Booked (deposits + imports - vendor payouts) is the sum of every location and every
    /// person's balance: nothing is booked twice or lost.
    function invariant_BookedIsTheSumOfEveryBalance() public view {
        bytes32[] memory locations = handler.locations();
        uint256 sum;
        for (uint256 i; i < locations.length; ++i) {
            sum += ledger.balanceOf(locations[i]);
        }
        LedgerHandler.MemberSlot[] memory slots = handler.memberSlots();
        for (uint256 i; i < slots.length; ++i) {
            sum += ledger.memberBalance(slots[i].agency, slots[i].person);
        }
        assertEq(sum, handler.ghostBooked(), "sum of balances != deposits + imports - vendor payouts");
        assertEq(ledger.balanceOf(bytes32(0)), 0, "id 0 holds money");
    }

    /// Each balance is what the reference model computed from the calls that succeeded.
    function invariant_EveryBalanceMatchesTheModel() public view {
        bytes32[] memory locations = handler.locations();
        for (uint256 i; i < locations.length; ++i) {
            assertEq(ledger.balanceOf(locations[i]), handler.ghostBalance(locations[i]), "location balance");
        }
        LedgerHandler.MemberSlot[] memory slots = handler.memberSlots();
        for (uint256 i; i < slots.length; ++i) {
            assertEq(
                ledger.memberBalance(slots[i].agency, slots[i].person),
                handler.ghostMemberBalance(slots[i].agency, slots[i].person),
                "member balance"
            );
        }
    }

    /// For every agreement: released <= funded <= committed, its vault holds funded -
    /// released, its tranches add up to committed and the released ones to released.
    function invariant_CapitalStaysOrdered() public view {
        bytes32[] memory agreements = handler.allAgreements();
        for (uint256 i; i < agreements.length; ++i) {
            ViatikLedger.Agreement memory agreement = ledger.getAgreement(agreements[i]);
            LedgerHandler.AgreementGhost memory ghost = handler.agreementGhost(agreements[i]);
            assertLe(agreement.released, agreement.funded, "released > funded");
            assertLe(agreement.funded, agreement.committed, "funded > committed");
            assertEq(
                ledger.balanceOf(agreement.vault), agreement.funded - agreement.released, "vault != funded - released"
            );
            assertEq(ledger.vaultAgreement(agreement.vault), agreements[i], "vault bound to another agreement");
            assertEq(agreement.vault, ghost.vault);
            assertEq(agreement.committed, ghost.committed);
            assertEq(agreement.funded, ghost.funded, "funded != modeled");
            assertEq(agreement.released, ghost.released, "released != modeled");

            bytes32[] memory tranches = ledger.tranchesOf(agreements[i]);
            uint256 total;
            uint256 released;
            for (uint256 j; j < tranches.length; ++j) {
                ViatikLedger.Tranche memory tranche = ledger.getTranche(tranches[j]);
                assertEq(tranche.agreement, agreements[i]);
                assertEq(tranche.index, j);
                total += tranche.amount;
                if (tranche.status == ViatikLedger.TrancheStatus.Released) released += tranche.amount;
            }
            assertEq(total, agreement.committed, "tranches != committed");
            assertEq(released, agreement.released, "released tranches != released");
        }
    }

    /// No path moves money across agencies: what each agency holds (accounts, budgets,
    /// its people) is what entered it minus its vendor payouts, and each portfolio vault
    /// is its deposits minus what it funded.
    function invariant_AgenciesAndPortfoliosStayIsolated() public view {
        for (uint256 s; s < 2; ++s) {
            LedgerHandler.Side memory side = handler.sideOf(s);
            uint256 held = _sum(handler.accountsOf(s)) + _sum(handler.budgetsOf(s))
                + ledger.memberBalance(side.agency, side.admin) + ledger.memberBalance(side.agency, side.member);
            assertEq(held, handler.agencyIn(s) - handler.agencyOut(s), "agency holds money from elsewhere");

            bytes32[] memory agreements = handler.agreementsOf(s);
            uint256 funded;
            for (uint256 i; i < agreements.length; ++i) {
                funded += ledger.getAgreement(agreements[i]).funded;
            }
            assertEq(ledger.balanceOf(side.pfVault), handler.portfolioDeposits(s) - funded, "portfolio vault");
        }
    }

    // ─── States ─────────────────────────────────────────────────────────────

    /// Released and Rejected tranches, and Executed, Rejected and Closed requests, never change.
    function invariant_TerminalStatesNeverChange() public view {
        bytes32[] memory tranches = handler.allTranches();
        for (uint256 i; i < tranches.length; ++i) {
            ViatikLedger.TrancheStatus seen = handler.finalTranche(tranches[i]);
            if (seen != ViatikLedger.TrancheStatus.None) {
                assertEq(uint8(ledger.getTranche(tranches[i]).status), uint8(seen), "terminal tranche changed");
            }
        }
        bytes32[] memory requests = handler.allRequests();
        for (uint256 i; i < requests.length; ++i) {
            ViatikLedger.RequestStatus seen = handler.finalRequest(requests[i]);
            if (seen != ViatikLedger.RequestStatus.None) {
                assertEq(uint8(ledger.getRequest(requests[i]).status), uint8(seen), "terminal request changed");
            }
        }
    }

    /// No PaymentExecuted ever comes from a budget that was paused.
    function invariant_PausedBudgetsNeverPay() public view {
        assertEq(handler.pausedPayouts(), 0, "a paused budget paid");
    }

    /// Each (actor, opId) has at most one Recorded event.
    function invariant_EachOperationIsRecordedOncePerActor() public view {
        assertEq(handler.duplicateRecords(), 0, "an opId was recorded twice by the same actor");
    }

    function invariant_NobodyApprovesTheirOwnRequest() public view {
        assertEq(handler.selfApprovals(), 0, "a requester approved their own request");
    }

    /// Every call succeeded or reverted exactly as the rules predict (request outcomes
    /// equal checkPayment, valid holders never revert, errors carry the right arguments).
    function invariant_EveryCallFollowsTheRules() public view {
        assertEq(handler.violations(), 0, handler.firstViolation());
    }

    // ─── Outsiders ──────────────────────────────────────────────────────────

    /// No outsider call ever succeeded, and the roles, scopes and configuration they
    /// aimed at are intact: each agency keeps its Admin and each portfolio its Investor.
    function invariant_OutsidersChangeNothing() public view {
        assertEq(handler.attackerWins(), 0, handler.firstAttackerWin());
        for (uint256 s; s < 2; ++s) {
            LedgerHandler.Side memory side = handler.sideOf(s);
            assertEq(uint8(ledger.roleOf(side.agency, side.admin)), uint8(ViatikLedger.Role.Admin), "Admin lost");
            assertEq(
                uint8(ledger.roleOf(side.portfolio, side.investor)), uint8(ViatikLedger.Role.Investor), "Investor lost"
            );
            assertEq(uint8(ledger.roleOf(side.agency, side.member)), uint8(handler.memberRole(s)), "Member role");
            assertEq(uint8(ledger.scopeKind(side.agency)), uint8(ViatikLedger.ScopeKind.Agency));
            assertEq(uint8(ledger.scopeKind(side.portfolio)), uint8(ViatikLedger.ScopeKind.Portfolio));
            assertEq(ledger.agencyPortfolio(side.agency), side.portfolio);
            assertEq(ledger.operationsAccount(side.agency), side.operations);
        }
        assertEq(ledger.exceptionThresholdOf(AG), EXCEPTION);
        assertEq(ledger.exceptionThresholdOf(AG2), 4_000 * USD);
        assertEq(ledger.owner(), address(this));
        assertEq(ledger.registrar(), registrar);
        assertEq(ledger.payoutSink(), sink);
    }

    /// Nobody can lock a tranche: every requested tranche, and every available one without
    /// a milestone, of an active agreement with the capital for it, releases when its
    /// Investor calls (tried inside a snapshot, then undone).
    function invariant_ReleasableTranchesStayReleasable() public {
        bytes32[] memory tranches = handler.allTranches();
        for (uint256 i; i < tranches.length; ++i) {
            ViatikLedger.Tranche memory tranche = ledger.getTranche(tranches[i]);
            ViatikLedger.Agreement memory agreement = ledger.getAgreement(tranche.agreement);
            bool releasable = tranche.status == ViatikLedger.TrancheStatus.Requested
                || (tranche.status == ViatikLedger.TrancheStatus.Available && !tranche.milestone);
            if (
                !releasable || agreement.status != ViatikLedger.AgreementStatus.Active
                    || tranche.amount > agreement.funded - agreement.released
            ) continue;
            address releaser = handler.sideOf(handler.agreementGhost(tranche.agreement).side).investor;
            uint256 snapshot = vm.snapshotState();
            vm.prank(releaser);
            ledger.releaseTranche(tranches[i], keccak256("invariant:release"));
            assertEq(uint8(ledger.getTranche(tranches[i]).status), uint8(ViatikLedger.TrancheStatus.Released));
            vm.revertToStateAndDelete(snapshot);
        }
    }

    // ─── The handler itself ─────────────────────────────────────────────────

    /// The handler is not vacuous: short scripted runs from the setup state (like the
    /// campaign's) never revert inside the handler, every invariant holds after each run,
    /// and every action reaches its success path at least once.
    function test_ScriptedRunsReachEveryMoneyPath() public {
        bytes4[] memory actions = handler.actions();
        uint256[] memory successes = new uint256[](actions.length);
        for (uint256 run; run < 16; ++run) {
            uint256 snapshot = vm.snapshotState();
            for (uint256 i; i < 40; ++i) {
                bytes32 r = keccak256(abi.encode("script", run, i));
                bytes memory call = abi.encodeWithSelector(
                    actions[uint256(r) % actions.length],
                    uint256(keccak256(abi.encode(r, 1))),
                    uint256(keccak256(abi.encode(r, 2))),
                    uint256(keccak256(abi.encode(r, 3))),
                    uint256(keccak256(abi.encode(r, 4))),
                    uint256(keccak256(abi.encode(r, 5))),
                    uint256(keccak256(abi.encode(r, 6)))
                );
                (bool ok, bytes memory reason) = address(handler).call(call);
                assertTrue(ok, string.concat("handler reverted: ", vm.toString(reason)));
            }
            _assertEveryInvariant();
            for (uint256 k; k < actions.length; ++k) {
                successes[k] += handler.successes(actions[k]);
            }
            vm.revertToStateAndDelete(snapshot);
        }
        for (uint256 k; k < actions.length; ++k) {
            assertGt(successes[k], 0, string.concat("never succeeded: action #", vm.toString(k)));
        }
    }

    // ─── Regressions for the contract bugs this suite found ─────────────────

    /// processed(actor, opId) is "whether actor already recorded opId". A release used to
    /// emit Recorded(trancheId, investor) without marking it, so the same Investor could
    /// record that id again under another receipt (a deposit): two Recorded for one opId.
    function test_ReleaseMarksTheTrancheIdProcessed() public {
        vm.prank(investor);
        ledger.releaseTranche(T2, bytes32(0));
        assertTrue(ledger.processed(investor, T2), "a recorded release counts as processed");

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, T2));
        ledger.deposit(T2, PF, PF_VAULT, 1 * USD);
    }

    /// Same gap for createBudget: its initial allocation used to be recorded under the
    /// budget id without marking it, so allocate(opId = budgetId) could record it again.
    function test_InitialAllocationMarksTheBudgetIdProcessed() public {
        bytes32 budgetId = _id("bud_new");
        bytes32[] memory any = new bytes32[](0);
        vm.prank(admin);
        ledger.createBudget(budgetId, OPS, PER_OP, AUTO_APPROVE, any, 100 * USD);
        assertTrue(ledger.processed(admin, budgetId), "the recorded initial allocation counts as processed");

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, budgetId));
        ledger.allocate(budgetId, budgetId, int256(50 * USD));
    }

    /// Every creator rejects id 0. An agreement with id 0 used to leave vaultAgreement[vault]
    /// at 0, which reads as "unbound", so a second agreement could bind the same vault and
    /// "vault balance == funded - released" stopped holding for both.
    function test_AgreementIdZeroIsRefused() public {
        bytes32 vault = _id("vault_zero");
        vm.prank(investor);
        try ledger.createAgreement(
            bytes32(0), AG, vault, 1_000 * USD, EXCEPTION, _ids(_id("tr_z1")), _amounts(1_000 * USD), _flags(false)
        ) {
            // If id 0 is accepted at all, its vault must still count as bound.
            vm.prank(investor);
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, vault));
            ledger.createAgreement(
                _id("fa_second"),
                AG,
                vault,
                500 * USD,
                EXCEPTION,
                _ids(_id("tr_z2")),
                _amounts(500 * USD),
                _flags(false)
            );
        } catch (bytes memory reason) {
            assertEq(reason, abi.encodeWithSelector(ViatikLedger.InvalidState.selector, bytes32(0)));
        }
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _assertEveryInvariant() internal {
        invariant_TokensBackEveryBookedBalance();
        invariant_BookedIsTheSumOfEveryBalance();
        invariant_EveryBalanceMatchesTheModel();
        invariant_CapitalStaysOrdered();
        invariant_AgenciesAndPortfoliosStayIsolated();
        invariant_TerminalStatesNeverChange();
        invariant_PausedBudgetsNeverPay();
        invariant_EachOperationIsRecordedOncePerActor();
        invariant_NobodyApprovesTheirOwnRequest();
        invariant_EveryCallFollowsTheRules();
        invariant_OutsidersChangeNothing();
        invariant_ReleasableTranchesStayReleasable();
    }

    function _sum(bytes32[] memory ids) internal view returns (uint256 total) {
        for (uint256 i; i < ids.length; ++i) {
            total += ledger.balanceOf(ids[i]);
        }
    }
}

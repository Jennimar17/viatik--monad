// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Vm} from "forge-std/Vm.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";

import {TestUSD} from "../../src/TestUSD.sol";
import {ViatikLedger} from "../../src/ViatikLedger.sol";

/// Drives ViatikLedger for the invariant suite. Two sides (a portfolio, its agency and
/// their people) go through every money path with bounded inputs, the owner imports
/// genesis balances, a donor sends TestUSD nobody booked, and outsiders replay ids
/// from the shared pool.
///
/// Every call runs in try/catch and is compared with what the rules say should happen
/// (success, or the exact revert data). fail-on-revert is off, so the handler never
/// reverts on a surprise: it counts it, and an invariant fails on the count. It also
/// keeps a reference model of every balance (ghost accounting) and watches the logs of
/// each action: Recorded per (actor, opId), PaymentExecuted from a paused budget and
/// self-approvals.
contract LedgerHandler is CommonBase, StdCheats, StdUtils {
    /// One portfolio with its agency and its people.
    struct Side {
        bytes32 portfolio;
        bytes32 pfVault;
        address investor;
        bytes32 agency;
        address admin;
        address member;
        bytes32 operations;
    }

    /// What the setup built for a side: its agreements, budgets, requests and the opIds used.
    struct Seed {
        Side side;
        bytes32[] agreements;
        bytes32[] budgets;
        bytes32[] requests;
        ClaimedOp[] usedOps;
    }

    struct AgreementGhost {
        uint256 side;
        bytes32 vault;
        uint256 committed;
        uint256 funded;
        uint256 released;
    }

    struct MemberSlot {
        uint256 side;
        bytes32 agency;
        address person;
    }

    struct ClaimedOp {
        address actor;
        bytes32 opId;
    }

    struct PaymentPlan {
        uint256 side;
        bytes32 budget;
        address holder;
        bytes32 destination;
        address payee;
        uint256 amount;
        bool holderValid;
        ViatikLedger.Reason reason;
        uint256 limit;
        ViatikLedger.RequestStatus expected;
    }

    uint256 internal constant USD = 1e6;
    bytes32 internal constant VERCEL = keccak256("qa:dest_vercel");
    bytes32 internal constant OTHER_VENDOR = keccak256("qa:dest_other");
    bytes32 internal constant UNLISTED_VENDOR = keccak256("inv:dest_unlisted");
    /// Signs fake role permits for outsiders.
    uint256 internal constant FORGER_KEY = 0xBAD;

    ViatikLedger public immutable ledger;
    TestUSD public immutable token;
    address public immutable sink;
    address public immutable owner;
    address public immutable stranger;
    address public immutable donor;
    uint256 internal immutable registrarKey;

    Side[2] internal sides;
    mapping(uint256 side => bytes32[]) internal _accounts;
    mapping(uint256 side => bytes32[]) internal _budgets;
    mapping(uint256 side => bytes32[]) internal _agreements;
    mapping(uint256 side => bytes32[]) internal _tranches;
    mapping(uint256 side => bytes32[]) internal _requests;
    /// Ids that belong to a side, for outsiders to try against it.
    mapping(uint256 side => bytes32[]) internal _pool;

    bytes32[] internal _locations;
    bytes32[] internal _allBudgets;
    bytes32[] internal _allAgreements;
    bytes32[] internal _allTranches;
    bytes32[] internal _allRequests;
    MemberSlot[] internal _memberSlots;
    ClaimedOp[] internal _claimedOps;
    bytes32[] internal _strangerPortfolios;
    bytes32[] internal _strangerVaults;
    uint256 internal idNonce;

    // ─── Ghost accounting ────────────────────────────────────────────────────

    uint256 public ghostDeposits;
    uint256 public ghostImports;
    uint256 public ghostVendorPaid;
    uint256 public ghostDonations;
    mapping(bytes32 location => uint256) public ghostBalance;
    mapping(bytes32 agency => mapping(address person => uint256)) public ghostMemberBalance;
    mapping(bytes32 agreement => AgreementGhost) internal _agreementGhost;
    mapping(bytes32 request => uint256) public requestSide;
    /// Money that entered an agency (tranche releases, imports) and left it (vendor payouts).
    mapping(uint256 side => uint256) public agencyIn;
    mapping(uint256 side => uint256) public agencyOut;
    /// Everything deposited into a side's portfolio vault.
    mapping(uint256 side => uint256) public portfolioDeposits;
    mapping(uint256 side => ViatikLedger.Role) public memberRole;
    /// The first terminal status seen for each tranche and request.
    mapping(bytes32 tranche => ViatikLedger.TrancheStatus) public finalTranche;
    mapping(bytes32 request => ViatikLedger.RequestStatus) public finalRequest;

    // ─── Surprises (each one fails an invariant) ─────────────────────────────

    uint256 public violations;
    string public firstViolation;
    uint256 public attackerWins;
    string public firstAttackerWin;
    uint256 public pausedPayouts;
    uint256 public duplicateRecords;
    uint256 public selfApprovals;

    mapping(bytes4 action => uint256) public calls;
    mapping(bytes4 action => uint256) public successes;
    mapping(bytes32 actorOp => uint256) internal recordedCount;
    mapping(bytes32 budget => bool) internal pausedAtStart;

    constructor(ViatikLedger ledger_, TestUSD token_, address sink_, uint256 registrarKey_, Seed[2] memory seeds) {
        ledger = ledger_;
        token = token_;
        sink = sink_;
        owner = ledger_.owner();
        registrarKey = registrarKey_;
        stranger = makeAddr("stranger");
        donor = makeAddr("donor");
        // The setup only deposited (no imports or donations); vendor payouts sit in the sink.
        ghostVendorPaid = token_.balanceOf(sink_);
        ghostDeposits = token_.balanceOf(address(ledger_)) + ghostVendorPaid;

        for (uint256 s; s < 2; ++s) {
            Seed memory seed = seeds[s];
            Side memory side = seed.side;
            sides[s] = side;
            memberRole[s] = ledger_.roleOf(side.agency, side.member);
            _pool[s].push(side.portfolio);
            _pool[s].push(side.agency);
            _trackLocation(s, side.pfVault);
            _trackLocation(s, side.operations);
            _accounts[s].push(side.operations);
            uint256 held = ledger_.balanceOf(side.operations) + ledger_.memberBalance(side.agency, side.admin)
                + ledger_.memberBalance(side.agency, side.member);
            for (uint256 i; i < seed.budgets.length; ++i) {
                _trackBudget(s, seed.budgets[i]);
                held += ledger_.balanceOf(seed.budgets[i]);
            }
            uint256 funded;
            for (uint256 i; i < seed.agreements.length; ++i) {
                bytes32 id = seed.agreements[i];
                ViatikLedger.Agreement memory agreement = ledger_.getAgreement(id);
                _trackAgreement(s, id, agreement.vault, agreement.committed, ledger_.tranchesOf(id));
                _agreementGhost[id].funded = agreement.funded;
                _agreementGhost[id].released = agreement.released;
                funded += agreement.funded;
            }
            for (uint256 i; i < seed.requests.length; ++i) {
                _allRequests.push(seed.requests[i]);
                _requests[s].push(seed.requests[i]);
                requestSide[seed.requests[i]] = s;
            }
            for (uint256 i; i < seed.usedOps.length; ++i) {
                _claimedOps.push(seed.usedOps[i]);
                _pool[s].push(seed.usedOps[i].opId);
            }
            portfolioDeposits[s] = ledger_.balanceOf(side.pfVault) + funded;
            agencyIn[s] = held;
            ghostMemberBalance[side.agency][side.admin] = ledger_.memberBalance(side.agency, side.admin);
            ghostMemberBalance[side.agency][side.member] = ledger_.memberBalance(side.agency, side.member);
            _memberSlots.push(MemberSlot(s, side.agency, side.admin));
            _memberSlots.push(MemberSlot(s, side.agency, side.member));
        }
        for (uint256 i; i < _locations.length; ++i) {
            ghostBalance[_locations[i]] = ledger_.balanceOf(_locations[i]);
        }
        _syncFinalStates();
    }

    /// The actions the invariant campaign calls. Every one takes only uint256 seeds.
    function actions() external pure returns (bytes4[] memory list) {
        list = new bytes4[](31);
        list[0] = LedgerHandler.deposit.selector;
        list[1] = LedgerHandler.createAgreement.selector;
        list[2] = LedgerHandler.acceptAgreement.selector;
        list[3] = LedgerHandler.fundAgreement.selector;
        list[4] = LedgerHandler.setAgreementPaused.selector;
        list[5] = LedgerHandler.requestTranche.selector;
        list[6] = LedgerHandler.requestChanges.selector;
        list[7] = LedgerHandler.releaseTranche.selector;
        list[8] = LedgerHandler.createAccount.selector;
        list[9] = LedgerHandler.transfer.selector;
        list[10] = LedgerHandler.createBudget.selector;
        list[11] = LedgerHandler.allocate.selector;
        list[12] = LedgerHandler.updateRules.selector;
        list[13] = LedgerHandler.setBudgetPaused.selector;
        list[14] = LedgerHandler.setAllowance.selector;
        list[15] = LedgerHandler.requestPayment.selector;
        list[16] = LedgerHandler.approvePayment.selector;
        list[17] = LedgerHandler.closeRequest.selector;
        list[18] = LedgerHandler.pay.selector;
        list[19] = LedgerHandler.returnToAgency.selector;
        list[20] = LedgerHandler.revokeMember.selector;
        list[21] = LedgerHandler.rejoinMember.selector;
        list[22] = LedgerHandler.donate.selector;
        list[23] = LedgerHandler.importAccount.selector;
        list[24] = LedgerHandler.importMemberBalance.selector;
        list[25] = LedgerHandler.reuseOpId.selector;
        list[26] = LedgerHandler.attackerCreatePortfolio.selector;
        list[27] = LedgerHandler.attackerDeposit.selector;
        list[28] = LedgerHandler.attackFunding.selector;
        list[29] = LedgerHandler.attackMoney.selector;
        list[30] = LedgerHandler.attackRoles.selector;
    }

    // ─── Funding ────────────────────────────────────────────────────────────

    function deposit(uint256 sideSeed, uint256 amount) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        uint256 max = token.MAX_MINT();
        amount = _bound(amount, 1, max + max / 16);
        bytes memory want = amount > max ? _limit(ViatikLedger.LimitRule.Deposit, max, amount) : bytes("");
        bytes32 opId = _fresh("dep");
        vm.prank(side.investor);
        try ledger.deposit(opId, side.portfolio, side.pfVault, amount) {
            _succeeded(want, "deposit");
            ghostDeposits += amount;
            portfolioDeposits[s] += amount;
            _add(side.pfVault, amount);
            _claimed(side.investor, opId, s);
        } catch (bytes memory got) {
            _reverted(want, got, "deposit");
        }
        _end();
    }

    /// 1 to 4 tranches with random amounts and milestones; now and then the committed
    /// amount does not match their total.
    function createAgreement(uint256 sideSeed, uint256 count, uint256 amountSeed, uint256 shape, uint256 threshold)
        external
    {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        count = _bound(count, 1, 4);
        bytes32[] memory ids = new bytes32[](count);
        uint256[] memory amounts = new uint256[](count);
        bool[] memory milestones = new bool[](count);
        uint256 total;
        for (uint256 i; i < count; ++i) {
            ids[i] = _fresh("tr");
            amounts[i] = _bound(uint256(keccak256(abi.encode(amountSeed, i))), 1, 20_000 * USD);
            milestones[i] = (shape >> i) & 1 == 1;
            total += amounts[i];
        }
        uint256 committed = (shape >> 8) % 8 == 0 ? total + 1 : total;
        threshold = _bound(threshold, 0, 10_000 * USD);
        bytes memory want = committed != total ? _limit(ViatikLedger.LimitRule.Tranches, committed, total) : bytes("");
        bytes32 agreementId = _fresh("fa");
        bytes32 vault = _fresh("vault");
        vm.prank(side.investor);
        try ledger.createAgreement(agreementId, side.agency, vault, committed, threshold, ids, amounts, milestones) {
            _succeeded(want, "createAgreement");
            _trackAgreement(s, agreementId, vault, committed, ids);
            for (uint256 i; i < count; ++i) {
                ViatikLedger.TrancheStatus expected = i == 0 && !milestones[0]
                    ? ViatikLedger.TrancheStatus.Available
                    : ViatikLedger.TrancheStatus.Planned;
                if (ledger.getTranche(ids[i]).status != expected) _violation("createAgreement: wrong first status");
            }
        } catch (bytes memory got) {
            _reverted(want, got, "createAgreement");
        }
        _end();
    }

    function acceptAgreement(uint256 agreementSeed) external {
        _begin();
        bytes32 agreementId = _pickAgreement(agreementSeed, ViatikLedger.AgreementStatus.Pending);
        Side memory side = sides[_agreementGhost[agreementId].side];
        bytes memory want = ledger.getAgreement(agreementId).status != ViatikLedger.AgreementStatus.Pending
            ? _invalidState(agreementId)
            : bytes("");
        vm.prank(side.admin);
        try ledger.acceptAgreement(agreementId) {
            _succeeded(want, "acceptAgreement");
            if (ledger.getAgreement(agreementId).status != ViatikLedger.AgreementStatus.Active) {
                _violation("acceptAgreement: not active");
            }
        } catch (bytes memory got) {
            _reverted(want, got, "acceptAgreement");
        }
        _end();
    }

    function fundAgreement(uint256 agreementSeed, uint256 amount) external {
        _begin();
        bytes32 agreementId = _allAgreements[agreementSeed % _allAgreements.length];
        AgreementGhost memory ghost = _agreementGhost[agreementId];
        Side memory side = sides[ghost.side];
        ViatikLedger.Agreement memory agreement = ledger.getAgreement(agreementId);
        uint256 left = agreement.committed - agreement.funded;
        uint256 available = ledger.balanceOf(side.pfVault);
        amount = _bound(amount, 1, left + left / 8 + 1);
        bytes memory want = amount > left
            ? _limit(ViatikLedger.LimitRule.Commitment, left, amount)
            : amount > available ? _insufficient(side.pfVault, available, amount) : bytes("");
        bytes32 opId = _fresh("fund");
        vm.prank(side.investor);
        try ledger.fundAgreement(opId, agreementId, side.pfVault, amount) {
            _succeeded(want, "fundAgreement");
            _move(side.pfVault, ghost.vault, amount);
            _agreementGhost[agreementId].funded += amount;
            _claimed(side.investor, opId, ghost.side);
        } catch (bytes memory got) {
            _reverted(want, got, "fundAgreement");
        }
        _end();
    }

    function setAgreementPaused(uint256 agreementSeed, uint256 pausedSeed) external {
        _begin();
        bytes32 agreementId = _allAgreements[agreementSeed % _allAgreements.length];
        Side memory side = sides[_agreementGhost[agreementId].side];
        bool paused = pausedSeed % 2 == 0;
        ViatikLedger.AgreementStatus from =
            paused ? ViatikLedger.AgreementStatus.Active : ViatikLedger.AgreementStatus.Paused;
        bytes memory want = ledger.getAgreement(agreementId).status != from ? _invalidState(agreementId) : bytes("");
        vm.prank(side.investor);
        try ledger.setAgreementPaused(agreementId, paused) {
            _succeeded(want, "setAgreementPaused");
        } catch (bytes memory got) {
            _reverted(want, got, "setAgreementPaused");
        }
        _end();
    }

    // ─── Tranches ───────────────────────────────────────────────────────────

    /// The agency's Admin asks for a tranche; now and then with the wrong kind of evidence.
    function requestTranche(uint256 trancheSeed, uint256 accountSeed, uint256 evidenceSeed) external {
        _begin();
        bytes32 trancheId = _pickTranche(trancheSeed, 0);
        ViatikLedger.Tranche memory tranche = ledger.getTranche(trancheId);
        ViatikLedger.Agreement memory agreement = ledger.getAgreement(tranche.agreement);
        uint256 s = _agreementGhost[tranche.agreement].side;
        bytes32 destination = _pick(_accounts[s], accountSeed);
        bool rightEvidence = evidenceSeed % 4 != 0;
        bytes32 evidence =
            tranche.milestone == rightEvidence ? keccak256(abi.encode("inv:evidence", evidenceSeed)) : bytes32(0);
        bytes memory want;
        if (agreement.status == ViatikLedger.AgreementStatus.Paused) {
            want = abi.encodeWithSelector(ViatikLedger.AgreementPaused.selector, tranche.agreement);
        } else if (agreement.status != ViatikLedger.AgreementStatus.Active) {
            want = _invalidState(tranche.agreement);
        } else if (
            tranche.status != ViatikLedger.TrancheStatus.Planned
                && tranche.status != ViatikLedger.TrancheStatus.Available
        ) {
            want = _invalidState(trancheId);
        } else if (!rightEvidence) {
            want = _invalidState(trancheId);
        }
        address admin = sides[s].admin;
        vm.prank(admin);
        try ledger.requestTranche(trancheId, destination, evidence) {
            _succeeded(want, "requestTranche");
            ViatikLedger.Tranche memory requested = ledger.getTranche(trancheId);
            if (
                requested.status != ViatikLedger.TrancheStatus.Requested || requested.destination != destination
                    || requested.requestedBy != admin || requested.evidenceHash != evidence
            ) _violation("requestTranche: tranche not requested as asked");
        } catch (bytes memory got) {
            _reverted(want, got, "requestTranche");
        }
        _end();
    }

    /// The Investor sends milestone evidence back, or rejects the tranche for good.
    function requestChanges(uint256 trancheSeed, uint256 rejectSeed) external {
        _begin();
        bytes32 trancheId = _pickTranche(trancheSeed, 1);
        ViatikLedger.Tranche memory tranche = ledger.getTranche(trancheId);
        Side memory side = sides[_agreementGhost[tranche.agreement].side];
        bool reject = rejectSeed % 3 == 0;
        bytes memory want = !tranche.milestone || tranche.status != ViatikLedger.TrancheStatus.Requested
            ? _invalidState(trancheId)
            : bytes("");
        vm.prank(side.investor);
        try ledger.requestChanges(trancheId, reject) {
            _succeeded(want, "requestChanges");
            ViatikLedger.TrancheStatus expected =
                reject ? ViatikLedger.TrancheStatus.Rejected : ViatikLedger.TrancheStatus.Available;
            if (ledger.getTranche(trancheId).status != expected) _violation("requestChanges: wrong status");
        } catch (bytes memory got) {
            _reverted(want, got, "requestChanges");
        }
        _end();
    }

    function releaseTranche(uint256 trancheSeed) external {
        _begin();
        bytes32 trancheId = _pickTranche(trancheSeed, 2);
        ViatikLedger.Tranche memory tranche = ledger.getTranche(trancheId);
        ViatikLedger.Agreement memory agreement = ledger.getAgreement(tranche.agreement);
        uint256 s = _agreementGhost[tranche.agreement].side;
        Side memory side = sides[s];
        (bytes memory want, bytes32 destination) = _releaseOutcome(trancheId, tranche, agreement, side);
        // A release opens the next tranche only when it has no milestone and is still planned.
        bytes32[] memory siblings = ledger.tranchesOf(tranche.agreement);
        bytes32 nextId;
        bool opensNext;
        if (uint256(tranche.index) + 1 < siblings.length) {
            nextId = siblings[uint256(tranche.index) + 1];
            ViatikLedger.Tranche memory next = ledger.getTranche(nextId);
            opensNext = !next.milestone && next.status == ViatikLedger.TrancheStatus.Planned;
        }
        vm.prank(side.investor);
        try ledger.releaseTranche(trancheId, keccak256("inv:decision")) {
            _succeeded(want, "releaseTranche");
            _move(agreement.vault, destination, tranche.amount);
            _agreementGhost[tranche.agreement].released += tranche.amount;
            agencyIn[s] += tranche.amount;
            ViatikLedger.Tranche memory released = ledger.getTranche(trancheId);
            if (released.status != ViatikLedger.TrancheStatus.Released || released.destination != destination) {
                _violation("releaseTranche: not released to the expected account");
            }
            if (opensNext && ledger.getTranche(nextId).status != ViatikLedger.TrancheStatus.Available) {
                _violation("releaseTranche: the next tranche did not open");
            }
        } catch (bytes memory got) {
            _reverted(want, got, "releaseTranche");
        }
        _end();
    }

    // ─── Accounts and budgets ───────────────────────────────────────────────

    function createAccount(uint256 sideSeed, uint256 operationsSeed) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        bytes32 accountId = _fresh("acct");
        vm.prank(side.admin);
        try ledger.createAccount(accountId, side.agency, operationsSeed % 2 == 0) {
            _succeeded("", "createAccount");
            _accounts[s].push(accountId);
            _trackLocation(s, accountId);
            if (ledger.operationsAccount(side.agency) != side.operations) {
                _violation("createAccount: a second Operations account replaced the first");
            }
        } catch (bytes memory got) {
            _reverted("", got, "createAccount");
        }
        _end();
    }

    function transfer(uint256 sideSeed, uint256 fromSeed, uint256 toSeed, uint256 amount) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        uint256 n = _accounts[s].length;
        uint256 fromIndex = fromSeed % n;
        // Mostly two different accounts; sometimes the same one (InvalidState).
        uint256 toIndex = toSeed % 4 == 0 || n == 1 ? fromIndex : (fromIndex + 1 + (toSeed >> 2) % (n - 1)) % n;
        bytes32 from = _accounts[s][fromIndex];
        bytes32 to = _accounts[s][toIndex];
        uint256 balance = ledger.balanceOf(from);
        amount = _bound(amount, 0, balance + balance / 8 + 1);
        bytes memory want = from == to || amount == 0
            ? _invalidState(to)
            : amount > balance ? _insufficient(from, balance, amount) : bytes("");
        bytes32 opId = _fresh("xfer");
        vm.prank(side.admin);
        try ledger.transfer(opId, from, to, amount) {
            _succeeded(want, "transfer");
            _move(from, to, amount);
            _claimed(side.admin, opId, s);
        } catch (bytes memory got) {
            _reverted(want, got, "transfer");
        }
        _end();
    }

    function createBudget(
        uint256 sideSeed,
        uint256 sourceSeed,
        uint256 perOperation,
        uint256 threshold,
        uint256 allowBits,
        uint256 allocation
    ) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        bytes32 source = _pick(_accounts[s], sourceSeed);
        uint256 balance = ledger.balanceOf(source);
        perOperation = _bound(perOperation, 0, 5_000 * USD);
        threshold = _bound(threshold, 0, 5_000 * USD);
        allocation = _bound(allocation, 0, balance + balance / 8);
        bytes32[] memory allowed = _allowlist(allowBits);
        bytes memory want = allocation > balance ? _insufficient(source, balance, allocation) : bytes("");
        bytes32 budgetId = _fresh("bud");
        vm.prank(side.admin);
        try ledger.createBudget(budgetId, source, perOperation, threshold, allowed, allocation) {
            _succeeded(want, "createBudget");
            _trackBudget(s, budgetId);
            _move(source, budgetId, allocation);
        } catch (bytes memory got) {
            _reverted(want, got, "createBudget");
        }
        _end();
    }

    /// Both signs; now and then a zero or type(int256).min delta.
    function allocate(uint256 budgetSeed, uint256 mode, uint256 amount) external {
        _begin();
        uint256 s = budgetSeed % 2;
        Side memory side = sides[s];
        bytes32 budgetId = _pick(_budgets[s], budgetSeed >> 1);
        bytes32 source = ledger.getBudget(budgetId).sourceAccount;
        bytes32 opId = _fresh("alloc");
        int256 delta;
        bytes memory want;
        bytes32 from;
        bytes32 to;
        mode = mode % 8;
        if (mode < 2) {
            delta = mode == 0 ? type(int256).min : int256(0);
            want = _invalidState(opId);
        } else {
            (from, to) = mode < 5 ? (source, budgetId) : (budgetId, source);
            uint256 balance = ledger.balanceOf(from);
            amount = _bound(amount, 1, balance + balance / 8 + 1);
            delta = mode < 5 ? int256(amount) : -int256(amount);
            if (amount > balance) want = _insufficient(from, balance, amount);
        }
        vm.prank(side.admin);
        try ledger.allocate(opId, budgetId, delta) {
            _succeeded(want, "allocate");
            _move(from, to, amount);
            _claimed(side.admin, opId, s);
        } catch (bytes memory got) {
            _reverted(want, got, "allocate");
        }
        _end();
    }

    function updateRules(uint256 budgetSeed, uint256 perOperation, uint256 threshold, uint256 allowBits) external {
        _begin();
        uint256 s = budgetSeed % 2;
        Side memory side = sides[s];
        bytes32 budgetId = _pick(_budgets[s], budgetSeed >> 1);
        perOperation = _bound(perOperation, 0, 5_000 * USD);
        threshold = _bound(threshold, 0, 5_000 * USD);
        bytes32[] memory allowed = _allowlist(allowBits);
        vm.prank(side.admin);
        try ledger.updateRules(budgetId, perOperation, threshold, allowed) {
            _succeeded("", "updateRules");
            ViatikLedger.Budget memory budget = ledger.getBudget(budgetId);
            if (
                budget.perOperationLimit != perOperation || budget.approvalThreshold != threshold
                    || budget.anyDestination != (allowed.length == 0)
                    || (allowed.length > 0 && !ledger.isDestinationAllowed(budgetId, allowed[0]))
            ) _violation("updateRules: rules not stored");
        } catch (bytes memory got) {
            _reverted("", got, "updateRules");
        }
        _end();
    }

    /// The agency's Admin or the portfolio's Investor; now and then a no-op toggle.
    function setBudgetPaused(uint256 budgetSeed, uint256 pausedSeed, uint256 callerSeed) external {
        _begin();
        uint256 s = budgetSeed % 2;
        Side memory side = sides[s];
        bytes32 budgetId = _pick(_budgets[s], budgetSeed >> 1);
        bool paused = pausedSeed % 2 == 0;
        bytes memory want = ledger.getBudget(budgetId).paused == paused ? _invalidState(budgetId) : bytes("");
        vm.prank(callerSeed % 2 == 0 ? side.admin : side.investor);
        try ledger.setBudgetPaused(budgetId, paused) {
            _succeeded(want, "setBudgetPaused");
        } catch (bytes memory got) {
            _reverted(want, got, "setBudgetPaused");
        }
        _end();
    }

    function setAllowance(uint256 budgetSeed, uint256 holderSeed, uint256 activeSeed, uint256 perOperation) external {
        _begin();
        uint256 s = budgetSeed % 2;
        Side memory side = sides[s];
        bytes32 budgetId = _pick(_budgets[s], budgetSeed >> 1);
        address holder = holderSeed % 2 == 0 ? side.member : side.admin;
        bool active = activeSeed % 4 != 0;
        perOperation = _bound(perOperation, 0, 3_000 * USD);
        bytes memory want = active && ledger.roleOf(side.agency, holder) == ViatikLedger.Role.None
            ? abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(uint256(uint160(holder))))
            : bytes("");
        uint64 epoch = ledger.membershipEpoch(side.agency, holder);
        vm.prank(side.admin);
        try ledger.setAllowance(budgetId, holder, active, perOperation) {
            _succeeded(want, "setAllowance");
            ViatikLedger.Allowance memory allowance = ledger.getAllowance(budgetId, holder);
            if (
                allowance.active != active || allowance.perOperationLimit != (active ? perOperation : 0)
                    || allowance.epoch != epoch
            ) _violation("setAllowance: allowance not stored");
        } catch (bytes memory got) {
            _reverted(want, got, "setAllowance");
        }
        _end();
    }

    // ─── Payments ───────────────────────────────────────────────────────────

    /// A holder (the Member or the Admin) asks to pay a vendor or to be reimbursed. A valid
    /// holder never sees a revert, and the outcome is what checkPayment and the thresholds say.
    function requestPayment(uint256 sideSeed, uint256 budgetSeed, uint256 holderSeed, uint256 destSeed, uint256 amount)
        external
    {
        _begin();
        PaymentPlan memory plan = _planPayment(sideSeed, budgetSeed, holderSeed, destSeed, amount);
        bytes memory want = plan.holderValid ? bytes("") : _notAuthorized(plan.holder);
        bytes32 requestId = _fresh("req");
        bytes32 paymentId = _fresh("pay");
        ViatikLedger.RequestStatus outcome;
        vm.prank(plan.holder);
        try ledger.requestPayment(
            requestId, paymentId, plan.budget, plan.destination, plan.payee, plan.amount, bytes32(0)
        ) returns (
            ViatikLedger.RequestStatus result
        ) {
            _succeeded(want, "requestPayment");
            outcome = result;
            if (outcome != plan.expected) _violation("requestPayment: outcome differs from checkPayment");
            if (ledger.getRequest(requestId).status != outcome) _violation("requestPayment: stored status differs");
            _allRequests.push(requestId);
            _requests[plan.side].push(requestId);
            requestSide[requestId] = plan.side;
            _claimed(plan.holder, requestId, plan.side);
            if (outcome == ViatikLedger.RequestStatus.Executed) {
                _payout(plan.side, plan.budget, plan.payee, plan.amount);
                _claimed(plan.holder, paymentId, plan.side);
            }
        } catch (bytes memory got) {
            _reverted(want, got, "requestPayment");
        }
        Vm.Log[] memory logs = _end();
        if (outcome == ViatikLedger.RequestStatus.Rejected && !_rejectionLogged(logs, requestId, plan)) {
            _violation("requestPayment: rejection not logged with checkPayment's reason");
        }
    }

    /// The right approver most of the time; otherwise the wrong one, which must be refused.
    function approvePayment(uint256 requestSeed, uint256 approverSeed) external {
        _begin();
        if (_allRequests.length == 0) {
            _end();
            return;
        }
        bytes32 requestId = _pickRequest(requestSeed);
        ViatikLedger.PaymentRequest memory request = ledger.getRequest(requestId);
        uint256 s = requestSide[requestId];
        Side memory side = sides[s];
        uint256 exception = ledger.exceptionThresholdOf(side.agency);
        uint256 pick = approverSeed % 4;
        address approver = pick == 0
            ? side.investor
            : pick == 1 ? side.admin : request.amount > exception ? side.investor : side.admin;
        bytes memory want = _approvalError(requestId, request, approver, side, exception);
        bytes32 paymentId = _fresh("pay");
        vm.prank(approver);
        try ledger.approvePayment(requestId, paymentId) {
            _succeeded(want, "approvePayment");
            if (ledger.getRequest(requestId).status != ViatikLedger.RequestStatus.Executed) {
                _violation("approvePayment: request not executed");
            }
            _payout(s, request.budget, request.member, request.amount);
            _claimed(approver, paymentId, s);
        } catch (bytes memory got) {
            _reverted(want, got, "approvePayment");
        }
        _end();
    }

    /// The requester cancels, or the Admin, the Investor or an outsider tries to decline.
    function closeRequest(uint256 requestSeed, uint256 closerSeed) external {
        _begin();
        if (_allRequests.length == 0) {
            _end();
            return;
        }
        bytes32 requestId = _pickRequest(requestSeed);
        ViatikLedger.PaymentRequest memory request = ledger.getRequest(requestId);
        uint256 s = requestSide[requestId];
        Side memory side = sides[s];
        uint256 pick = closerSeed % 4;
        address closer =
            pick == 0 ? request.requester : pick == 1 ? side.admin : pick == 2 ? side.investor : sides[1 - s].admin;
        bytes memory want = _closeError(requestId, request, closer, side);
        vm.prank(closer);
        try ledger.closeRequest(requestId) {
            _succeeded(want, "closeRequest");
            if (ledger.getRequest(requestId).status != ViatikLedger.RequestStatus.Closed) {
                _violation("closeRequest: request not closed");
            }
        } catch (bytes memory got) {
            _reverted(want, got, "closeRequest");
        }
        _end();
    }

    /// The Admin pays a vendor or a person of the agency, from an account or a budget.
    function pay(uint256 sideSeed, uint256 sourceSeed, uint256 payeeSeed, uint256 amount) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        bool fromBudget = sourceSeed % 2 == 0;
        bytes32 source = fromBudget ? _pick(_budgets[s], sourceSeed >> 1) : _pick(_accounts[s], sourceSeed >> 1);
        uint256 pick = payeeSeed % 4;
        address payee = pick == 0 ? side.member : pick == 1 ? side.admin : address(0);
        bytes32 destination = payee == address(0) ? _vendor(payeeSeed >> 2) : bytes32(0);
        amount = _amount(amount);
        bytes memory want = _payError(side, source, fromBudget, destination, payee, amount);
        bytes32 paymentId = _fresh("pay");
        vm.prank(side.admin);
        try ledger.pay(paymentId, source, destination, payee, amount, bytes32(0)) {
            _succeeded(want, "pay");
            _payout(s, source, payee, amount);
            _claimed(side.admin, paymentId, s);
        } catch (bytes memory got) {
            _reverted(want, got, "pay");
        }
        _end();
    }

    function returnToAgency(uint256 sideSeed, uint256 personSeed, uint256 amount) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        // Mostly whoever holds more; sometimes either one.
        address person = ledger.memberBalance(side.agency, side.admin) > ledger.memberBalance(side.agency, side.member)
            ? side.admin
            : side.member;
        if (personSeed % 4 == 0) person = personSeed % 8 == 0 ? side.member : side.admin;
        uint256 balance = ledger.memberBalance(side.agency, person);
        amount = _bound(amount, 0, balance + balance / 8 + 1);
        ViatikLedger.Role role = ledger.roleOf(side.agency, person);
        bytes32 personLocation = ledger.memberLocation(person);
        bytes memory want = role != ViatikLedger.Role.Member && role != ViatikLedger.Role.Admin
            ? _notAuthorized(person)
            : amount == 0 || amount > balance ? _insufficient(personLocation, balance, amount) : bytes("");
        bytes32 opId = _fresh("ret");
        vm.prank(person);
        try ledger.returnToAgency(opId, side.agency, amount) {
            _succeeded(want, "returnToAgency");
            _subMember(side.agency, person, amount);
            _add(side.operations, amount);
            _claimed(person, opId, s);
        } catch (bytes memory got) {
            _reverted(want, got, "returnToAgency");
        }
        _end();
    }

    // ─── Roles ──────────────────────────────────────────────────────────────

    /// The Admin or the Investor revokes the side's Member (Admins stay put).
    function revokeMember(uint256 sideSeed, uint256 callerSeed) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        bytes memory want =
            ledger.roleOf(side.agency, side.member) == ViatikLedger.Role.None ? _invalidState(side.agency) : bytes("");
        uint64 epoch = ledger.membershipEpoch(side.agency, side.member);
        vm.prank(callerSeed % 2 == 0 ? side.admin : side.investor);
        try ledger.revokeRole(side.agency, side.member) {
            _succeeded(want, "revokeMember");
            memberRole[s] = ViatikLedger.Role.None;
            if (ledger.membershipEpoch(side.agency, side.member) != epoch + 1) {
                _violation("revokeRole: membership epoch not bumped");
            }
        } catch (bytes memory got) {
            _reverted(want, got, "revokeMember");
        }
        _end();
    }

    /// The Member joins again with a fresh registrar permit.
    function rejoinMember(uint256 sideSeed) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        uint256 nonce = ledger.nonces(side.member);
        uint256 deadline = block.timestamp + 1 days;
        bytes memory signature =
            _permit(side.member, side.agency, ViatikLedger.Role.Member, nonce, deadline, registrarKey);
        bytes memory want =
            ledger.roleOf(side.agency, side.member) != ViatikLedger.Role.None ? _invalidState(side.agency) : bytes("");
        vm.prank(side.member);
        try ledger.join(side.agency, ViatikLedger.Role.Member, nonce, deadline, signature) {
            _succeeded(want, "rejoinMember");
            memberRole[s] = ViatikLedger.Role.Member;
        } catch (bytes memory got) {
            _reverted(want, got, "rejoinMember");
        }
        _end();
    }

    // ─── Donor and owner ────────────────────────────────────────────────────

    /// TestUSD that reaches the ledger without being booked: a mint or a plain transfer.
    function donate(uint256 amount, uint256 viaSeed) external {
        _begin();
        uint256 max = token.MAX_MINT();
        amount = _bound(amount, 1, max);
        if (viaSeed % 2 == 0) {
            vm.prank(donor);
            token.mint(address(ledger), amount);
        } else {
            token.mint(donor, amount);
            vm.prank(donor);
            if (!token.transfer(address(ledger), amount)) _violation("donate: transfer returned false");
        }
        ghostDonations += amount;
        successes[msg.sig] += 1;
        _end();
    }

    /// Genesis: an account with a balance, minted in MAX_MINT chunks when needed.
    function importAccount(uint256 sideSeed, uint256 balance) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        balance = _bound(balance, 0, 2_500_000 * USD);
        bytes32 accountId = _fresh("acct_seed");
        vm.prank(owner);
        try ledger.importLocation(accountId, ViatikLedger.LocationKind.Account, side.agency, balance, false) {
            _succeeded("", "importAccount");
            _accounts[s].push(accountId);
            _trackLocation(s, accountId);
            _add(accountId, balance);
            ghostImports += balance;
            agencyIn[s] += balance;
        } catch (bytes memory got) {
            _reverted("", got, "importAccount");
        }
        _end();
    }

    /// Genesis: what a person of the agency holds. Set once per person.
    function importMemberBalance(uint256 sideSeed, uint256 personSeed, uint256 amount) external {
        _begin();
        uint256 s = sideSeed % 2;
        Side memory side = sides[s];
        address person = personSeed % 2 == 0 ? side.member : side.admin;
        amount = _bound(amount, 1, 10_000 * USD);
        bytes memory want = ledger.memberBalance(side.agency, person) != 0 ? _invalidState(side.agency) : bytes("");
        vm.prank(owner);
        try ledger.importMemberBalance(side.agency, person, amount) {
            _succeeded(want, "importMemberBalance");
            ghostMemberBalance[side.agency][person] += amount;
            ghostImports += amount;
            agencyIn[s] += amount;
        } catch (bytes memory got) {
            _reverted(want, got, "importMemberBalance");
        }
        _end();
    }

    /// Someone repeats one of their own opIds: it must revert AlreadyProcessed before anything else.
    function reuseOpId(uint256 seed) external {
        _begin();
        ClaimedOp memory op = _claimedOps[seed % _claimedOps.length];
        bytes32 budgetId = _allBudgets[(seed >> 8) % _allBudgets.length];
        bytes memory want = abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, op.opId);
        vm.prank(op.actor);
        try ledger.allocate(op.opId, budgetId, 1) {
            _violation("reuseOpId: a used opId ran again");
        } catch (bytes memory got) {
            if (keccak256(got) == keccak256(want)) successes[msg.sig] += 1;
            else _violation(string.concat("reuseOpId: unexpected error ", vm.toString(got)));
        }
        _end();
    }

    // ─── Outsiders ──────────────────────────────────────────────────────────

    /// A stranger opens a portfolio, often over an id that already exists.
    function attackerCreatePortfolio(uint256 idSeed, uint256 vaultSeed) external {
        _begin();
        bytes32 portfolioId = idSeed % 4 == 0 ? _fresh("pf_x") : _poolAny(idSeed >> 2);
        bytes32 vaultId = vaultSeed % 4 == 0 ? _poolAny(vaultSeed >> 2) : _fresh("vault_x");
        bytes memory want;
        if (ledger.scopeKind(portfolioId) != ViatikLedger.ScopeKind.None) want = _already(portfolioId);
        else if (ledger.getLocation(vaultId).kind != ViatikLedger.LocationKind.None) want = _already(vaultId);
        vm.prank(stranger);
        try ledger.createPortfolio(portfolioId, vaultId) {
            if (want.length != 0) _attackerWon("createPortfolio over an existing id");
            successes[msg.sig] += 1;
            _strangerPortfolios.push(portfolioId);
            _strangerVaults.push(vaultId);
            _locations.push(vaultId);
        } catch (bytes memory got) {
            _reverted(want, got, "stranger createPortfolio");
        }
        _end();
    }

    /// Someone who is not the side's Investor deposits into their own portfolio under one
    /// of the side's ids (tranche, request, budget, used opId...): the "processed" squat.
    function attackerDeposit(uint256 targetSeed, uint256 opSeed, uint256 amount, uint256 viaSeed) external {
        _begin();
        uint256 t = targetSeed % 2;
        bytes32 opId = _pick(_pool[t], opSeed);
        amount = _bound(amount, 1, 1_000 * USD);
        bool viaStranger = viaSeed % 2 == 0 && _strangerPortfolios.length > 0;
        address actor = sides[1 - t].investor;
        bytes32 portfolio = sides[1 - t].portfolio;
        bytes32 vault = sides[1 - t].pfVault;
        if (viaStranger) {
            uint256 i = (viaSeed >> 1) % _strangerPortfolios.length;
            (actor, portfolio, vault) = (stranger, _strangerPortfolios[i], _strangerVaults[i]);
        }
        bytes memory want = ledger.processed(actor, opId) ? _already(opId) : bytes("");
        vm.prank(actor);
        try ledger.deposit(opId, portfolio, vault, amount) {
            _succeeded(want, "squatting deposit");
            ghostDeposits += amount;
            _add(vault, amount);
            if (!viaStranger) portfolioDeposits[1 - t] += amount;
            if (!ledger.processed(actor, opId)) _violation("squatting deposit: opId not marked processed");
            _claimedOps.push(ClaimedOp(actor, opId));
        } catch (bytes memory got) {
            _reverted(want, got, "squatting deposit");
        }
        _end();
    }

    /// Outsiders against portfolios, agreements and tranches.
    function attackFunding(uint256 targetSeed, uint256 actorSeed, uint256 which, uint256 idSeed, uint256 amount)
        external
    {
        uint256[9] memory cases = [uint256(0), 1, 2, 3, 4, 18, 19, 20, 25];
        _attack(targetSeed, actorSeed, cases[which % 9], idSeed, amount);
    }

    /// Outsiders against accounts, budgets, payments and requests.
    function attackMoney(uint256 targetSeed, uint256 actorSeed, uint256 which, uint256 idSeed, uint256 amount)
        external
    {
        uint256[10] memory cases = [uint256(5), 6, 7, 8, 9, 10, 11, 12, 13, 26];
        _attack(targetSeed, actorSeed, cases[which % 10], idSeed, amount);
    }

    /// Outsiders against roles, permits, accounts and genesis.
    function attackRoles(uint256 targetSeed, uint256 actorSeed, uint256 which, uint256 idSeed, uint256 amount)
        external
    {
        uint256[8] memory cases = [uint256(14), 15, 16, 17, 21, 22, 23, 24];
        _attack(targetSeed, actorSeed, cases[which % 8], idSeed, amount);
    }

    // ─── Views for the invariants ───────────────────────────────────────────

    function ghostBooked() public view returns (uint256) {
        return ghostDeposits + ghostImports - ghostVendorPaid;
    }

    function sideOf(uint256 s) external view returns (Side memory) {
        return sides[s];
    }

    function agreementGhost(bytes32 agreementId) external view returns (AgreementGhost memory) {
        return _agreementGhost[agreementId];
    }

    function locations() external view returns (bytes32[] memory) {
        return _locations;
    }

    function memberSlots() external view returns (MemberSlot[] memory) {
        return _memberSlots;
    }

    function allAgreements() external view returns (bytes32[] memory) {
        return _allAgreements;
    }

    function allTranches() external view returns (bytes32[] memory) {
        return _allTranches;
    }

    function allRequests() external view returns (bytes32[] memory) {
        return _allRequests;
    }

    function accountsOf(uint256 s) external view returns (bytes32[] memory) {
        return _accounts[s];
    }

    function budgetsOf(uint256 s) external view returns (bytes32[] memory) {
        return _budgets[s];
    }

    function agreementsOf(uint256 s) external view returns (bytes32[] memory) {
        return _agreements[s];
    }

    // ─── Outcomes the rules predict ─────────────────────────────────────────

    function _releaseOutcome(
        bytes32 trancheId,
        ViatikLedger.Tranche memory tranche,
        ViatikLedger.Agreement memory agreement,
        Side memory side
    ) internal view returns (bytes memory want, bytes32 destination) {
        if (agreement.status == ViatikLedger.AgreementStatus.Paused) {
            return (abi.encodeWithSelector(ViatikLedger.AgreementPaused.selector, tranche.agreement), 0);
        }
        if (agreement.status != ViatikLedger.AgreementStatus.Active) return (_invalidState(tranche.agreement), 0);
        if (tranche.status == ViatikLedger.TrancheStatus.Released) return (_already(trancheId), 0);
        if (tranche.status == ViatikLedger.TrancheStatus.Requested) {
            destination = tranche.destination;
        } else if (tranche.status == ViatikLedger.TrancheStatus.Available && !tranche.milestone) {
            destination = ledger.operationsAccount(side.agency);
        } else {
            return (_invalidState(trancheId), 0);
        }
        uint256 available = agreement.funded - agreement.released;
        if (tranche.amount > available) want = _insufficient(agreement.vault, available, tranche.amount);
    }

    function _planPayment(uint256 sideSeed, uint256 budgetSeed, uint256 holderSeed, uint256 destSeed, uint256 amount)
        internal
        view
        returns (PaymentPlan memory plan)
    {
        plan.side = sideSeed % 2;
        Side memory side = sides[plan.side];
        plan.budget = _pick(_budgets[plan.side], budgetSeed);
        plan.holder = holderSeed % 3 == 0 ? side.admin : side.member;
        bool reimburse = destSeed % 4 == 3;
        plan.destination = reimburse ? bytes32(0) : _vendor(destSeed >> 2);
        plan.payee = reimburse ? plan.holder : address(0);
        plan.amount = _amount(amount);
        plan.holderValid = _isHolder(plan.budget, side.agency, plan.holder);
        (plan.reason, plan.limit) =
            ledger.checkPayment(plan.budget, plan.holder, plan.destination, plan.payee, plan.amount);
        if (plan.reason != ViatikLedger.Reason.None) {
            plan.expected = ViatikLedger.RequestStatus.Rejected;
        } else if (
            plan.amount > ledger.getBudget(plan.budget).approvalThreshold
                || plan.amount > ledger.exceptionThresholdOf(side.agency)
        ) {
            plan.expected = ViatikLedger.RequestStatus.Pending;
        } else {
            plan.expected = ViatikLedger.RequestStatus.Executed;
        }
    }

    function _approvalError(
        bytes32 requestId,
        ViatikLedger.PaymentRequest memory request,
        address approver,
        Side memory side,
        uint256 exception
    ) internal view returns (bytes memory) {
        if (request.status != ViatikLedger.RequestStatus.Pending) return _invalidState(requestId);
        if (approver == request.requester) return _notAuthorized(approver);
        if (request.amount > exception) {
            if (ledger.roleOf(side.portfolio, approver) != ViatikLedger.Role.Investor) return _notAuthorized(approver);
        } else if (ledger.roleOf(side.agency, approver) != ViatikLedger.Role.Admin) {
            return _notAuthorized(approver);
        }
        if (
            !_isHolder(request.budget, side.agency, request.requester)
                || request.epoch != ledger.membershipEpoch(side.agency, request.requester)
        ) return _notAuthorized(request.requester);
        (ViatikLedger.Reason reason, uint256 limit) =
            ledger.checkPayment(request.budget, request.requester, request.destination, request.member, request.amount);
        if (reason == ViatikLedger.Reason.BudgetPaused) {
            return abi.encodeWithSelector(ViatikLedger.BudgetPaused.selector, request.budget);
        }
        if (reason == ViatikLedger.Reason.DestinationNotAllowed) {
            return
                abi.encodeWithSelector(ViatikLedger.DestinationNotAllowed.selector, request.budget, request.destination);
        }
        if (reason == ViatikLedger.Reason.LimitExceeded) {
            return _limit(ViatikLedger.LimitRule.PerOperation, limit, request.amount);
        }
        if (reason == ViatikLedger.Reason.InsufficientFunds) {
            return _insufficient(request.budget, limit, request.amount);
        }
        return "";
    }

    function _closeError(
        bytes32 requestId,
        ViatikLedger.PaymentRequest memory request,
        address closer,
        Side memory side
    ) internal view returns (bytes memory) {
        if (request.status != ViatikLedger.RequestStatus.Pending) return _invalidState(requestId);
        if (closer == request.requester) return "";
        bool isAdmin = ledger.roleOf(side.agency, closer) == ViatikLedger.Role.Admin;
        bool stale = request.epoch != ledger.membershipEpoch(side.agency, request.requester)
            || ledger.roleOf(side.agency, request.requester) == ViatikLedger.Role.None;
        bool isInvestor = ledger.roleOf(side.portfolio, closer) == ViatikLedger.Role.Investor
            && (stale || request.amount > ledger.exceptionThresholdOf(side.agency));
        return isAdmin || isInvestor ? bytes("") : _notAuthorized(closer);
    }

    /// pay's checks, in the contract's order.
    function _payError(
        Side memory side,
        bytes32 source,
        bool fromBudget,
        bytes32 destination,
        address payee,
        uint256 amount
    ) internal view returns (bytes memory) {
        if (payee != address(0) && ledger.roleOf(side.agency, payee) == ViatikLedger.Role.None) {
            return abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(uint256(uint160(payee))));
        }
        if (fromBudget) {
            ViatikLedger.Budget memory budget = ledger.getBudget(source);
            if (budget.paused) return abi.encodeWithSelector(ViatikLedger.BudgetPaused.selector, source);
            if (amount > budget.perOperationLimit) {
                return _limit(ViatikLedger.LimitRule.PerOperation, budget.perOperationLimit, amount);
            }
            if (payee == address(0) && !ledger.isDestinationAllowed(source, destination)) {
                return abi.encodeWithSelector(ViatikLedger.DestinationNotAllowed.selector, source, destination);
            }
        }
        uint256 exception = ledger.exceptionThresholdOf(side.agency);
        if (amount > exception) return _limit(ViatikLedger.LimitRule.Exception, exception, amount);
        uint256 balance = ledger.balanceOf(source);
        if (amount > balance) return _insufficient(source, balance, amount);
        return "";
    }

    function _isHolder(bytes32 budgetId, bytes32 agency, address holder) internal view returns (bool) {
        ViatikLedger.Role role = ledger.roleOf(agency, holder);
        ViatikLedger.Allowance memory allowance = ledger.getAllowance(budgetId, holder);
        return (role == ViatikLedger.Role.Member || role == ViatikLedger.Role.Admin) && allowance.active
            && allowance.epoch == ledger.membershipEpoch(agency, holder);
    }

    function _rejectionLogged(Vm.Log[] memory logs, bytes32 requestId, PaymentPlan memory plan)
        internal
        view
        returns (bool)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(ledger) || logs[i].topics[0] != ViatikLedger.PaymentRejected.selector
                    || logs[i].topics[1] != requestId
            ) continue;
            (address requester, uint256 amount, ViatikLedger.Reason reason, uint256 limit) =
                abi.decode(logs[i].data, (address, uint256, ViatikLedger.Reason, uint256));
            return requester == plan.holder && amount == plan.amount && reason == plan.reason && limit == plan.limit;
        }
        return false;
    }

    // ─── Outsider calls ─────────────────────────────────────────────────────

    /// One call by an outsider of side `t` (the stranger, or the other side's Investor,
    /// Admin or Member) with `t`'s ids. Every one of them must revert with the exact error.
    function _attack(uint256 targetSeed, uint256 actorSeed, uint256 which, uint256 idSeed, uint256 amount) internal {
        _begin();
        uint256 t = targetSeed % 2;
        Side memory own = sides[1 - t];
        uint256 pick = actorSeed % 4;
        address actor = pick == 0 ? stranger : pick == 1 ? own.investor : pick == 2 ? own.admin : own.member;
        amount = _bound(amount, 1, 10_000 * USD);
        if ((which == 12 || which == 13) && _requests[t].length == 0) which = 0;
        bytes memory data;
        bytes memory want;
        string memory what;
        if (which < 5 || (which >= 18 && which <= 20) || which == 25) {
            (data, want, what) = _fundingAttack(t, actor, which, idSeed, amount);
        } else if (which < 14 || which == 26) {
            (data, want, what) = _moneyAttack(t, actor, which, idSeed, amount);
        } else {
            (data, want, what) = _roleAttack(t, actor, which, idSeed, amount);
        }
        vm.prank(actor);
        (bool ok, bytes memory got) = address(ledger).call(data);
        if (ok) {
            _attackerWon(what);
        } else if (keccak256(got) != keccak256(want)) {
            _violation(string.concat("outsider ", what, ": unexpected error ", vm.toString(got)));
        } else {
            successes[msg.sig] += 1;
        }
        _end();
    }

    function _fundingAttack(uint256 t, address actor, uint256 which, uint256 seed, uint256 amount)
        internal
        returns (bytes memory data, bytes memory want, string memory what)
    {
        Side memory target = sides[t];
        Side memory own = sides[1 - t];
        want = _notAuthorized(actor);
        bytes32 trancheId = _pick(_tranches[t], seed);
        bytes32 agreementId = _pick(_agreements[t], seed);
        if (which == 0) {
            data = abi.encodeCall(ViatikLedger.releaseTranche, (trancheId, bytes32(0)));
            what = "releaseTranche";
        } else if (which == 1) {
            bytes32 account = seed % 2 == 0 ? _pick(_accounts[t], seed >> 1) : _pick(_accounts[1 - t], seed >> 1);
            data = abi.encodeCall(ViatikLedger.requestTranche, (trancheId, account, keccak256("x")));
            what = "requestTranche";
        } else if (which == 2) {
            data = abi.encodeCall(ViatikLedger.requestChanges, (trancheId, seed % 2 == 0));
            what = "requestChanges";
        } else if (which == 3) {
            data = abi.encodeCall(ViatikLedger.setAgreementPaused, (agreementId, seed % 2 == 0));
            what = "setAgreementPaused";
        } else if (which == 4) {
            what = "fundAgreement";
            if (actor == own.investor && seed % 2 == 1) {
                // Their own agreement, paid from the target's portfolio vault.
                data = abi.encodeCall(
                    ViatikLedger.fundAgreement,
                    (_fresh("x_fund"), _pick(_agreements[1 - t], seed), target.pfVault, amount)
                );
                want = _invalidState(target.pfVault);
            } else {
                data = abi.encodeCall(ViatikLedger.fundAgreement, (_fresh("x_fund"), agreementId, own.pfVault, amount));
            }
        } else if (which == 18) {
            (data, want) = _agreementAttack(t, actor, seed);
            what = "createAgreement";
        } else if (which == 19) {
            data = abi.encodeCall(ViatikLedger.acceptAgreement, (agreementId));
            what = "acceptAgreement";
        } else if (which == 20) {
            what = "registerAgency";
            if (actor == own.investor) {
                bytes32 taken = seed % 2 == 0 ? target.agency : target.portfolio;
                data = abi.encodeCall(ViatikLedger.registerAgency, (taken, own.portfolio, _fresh("x_vault")));
                want = _already(taken);
            } else {
                data =
                    abi.encodeCall(ViatikLedger.registerAgency, (_fresh("x_ag"), target.portfolio, _fresh("x_vault")));
            }
        } else {
            bytes[] memory batch = new bytes[](1);
            batch[0] = abi.encodeCall(ViatikLedger.releaseTranche, (trancheId, bytes32(0)));
            data = abi.encodeCall(Multicall.multicall, (batch));
            what = "multicall(releaseTranche)";
        }
    }

    function _agreementAttack(uint256 t, address actor, uint256 seed)
        internal
        returns (bytes memory data, bytes memory want)
    {
        Side memory own = sides[1 - t];
        bytes32[] memory ids = new bytes32[](1);
        ids[0] = _fresh("x_tr");
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1;
        bool[] memory milestones = new bool[](1);
        bytes32 agreementId = _fresh("x_fa");
        bytes32 agency = sides[t].agency;
        bytes32 vault = _fresh("x_vault");
        want = _notAuthorized(actor);
        if (actor == own.investor) {
            // Their own agency, but with the target's vault, tranche or agreement id.
            agency = own.agency;
            uint256 variant = seed % 3;
            if (variant == 0) {
                vault = _agreementGhost[_pick(_agreements[t], seed >> 2)].vault;
                want = _invalidState(vault);
            } else if (variant == 1) {
                ids[0] = _pick(_tranches[t], seed >> 2);
                want = _invalidState(ids[0]);
            } else {
                agreementId = _pick(_agreements[t], seed >> 2);
                want = _already(agreementId);
            }
        }
        data =
            abi.encodeCall(ViatikLedger.createAgreement, (agreementId, agency, vault, 1, 0, ids, amounts, milestones));
    }

    function _moneyAttack(uint256 t, address actor, uint256 which, uint256 seed, uint256 amount)
        internal
        returns (bytes memory data, bytes memory want, string memory what)
    {
        Side memory target = sides[t];
        Side memory own = sides[1 - t];
        want = _notAuthorized(actor);
        bytes32 budgetId = _pick(_budgets[t], seed);
        bytes32 account = _pick(_accounts[t], seed >> 1);
        if (which == 5) {
            what = "transfer";
            bytes32 from = actor == own.admin && seed % 2 == 1 ? own.operations : account;
            data =
                abi.encodeCall(ViatikLedger.transfer, (_fresh("x_xfer"), from, _pick(_accounts[t], seed >> 2), amount));
        } else if (which == 6) {
            what = "pay";
            if (actor == own.admin && seed % 2 == 1) {
                // From their own account, to a person of the target agency.
                address payee = seed % 4 == 1 ? target.member : target.admin;
                data = abi.encodeCall(
                    ViatikLedger.pay, (_fresh("x_pay"), own.operations, bytes32(0), payee, amount, bytes32(0))
                );
                want = abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, bytes32(uint256(uint160(payee))));
            } else {
                bytes32 source = seed % 4 == 0 ? budgetId : account;
                data =
                    abi.encodeCall(ViatikLedger.pay, (_fresh("x_pay"), source, VERCEL, address(0), amount, bytes32(0)));
            }
        } else if (which == 7) {
            data = abi.encodeCall(ViatikLedger.allocate, (_fresh("x_alloc"), budgetId, int256(amount)));
            what = "allocate";
        } else if (which == 8) {
            data = abi.encodeCall(ViatikLedger.updateRules, (budgetId, amount, amount, new bytes32[](0)));
            what = "updateRules";
        } else if (which == 9) {
            data = abi.encodeCall(ViatikLedger.setBudgetPaused, (budgetId, seed % 2 == 0));
            what = "setBudgetPaused";
        } else if (which == 10) {
            data = abi.encodeCall(ViatikLedger.setAllowance, (budgetId, actor, true, 0));
            what = "setAllowance";
        } else if (which == 11) {
            address payee = seed % 2 == 0 ? actor : address(0);
            bytes32 destination = payee == address(0) ? VERCEL : bytes32(0);
            data = abi.encodeCall(
                ViatikLedger.requestPayment,
                (_fresh("x_req"), _fresh("x_pay"), budgetId, destination, payee, amount, bytes32(0))
            );
            what = "requestPayment";
        } else if (which == 12 || which == 13) {
            bytes32 requestId = _pick(_requests[t], seed);
            if (ledger.getRequest(requestId).status != ViatikLedger.RequestStatus.Pending) {
                want = _invalidState(requestId);
            }
            if (which == 12) {
                data = abi.encodeCall(ViatikLedger.approvePayment, (requestId, _fresh("x_pay")));
                what = "approvePayment";
            } else {
                data = abi.encodeCall(ViatikLedger.closeRequest, (requestId));
                what = "closeRequest";
            }
        } else {
            data = abi.encodeCall(ViatikLedger.deposit, (_fresh("x_dep"), target.portfolio, target.pfVault, amount));
            what = "deposit into someone else's portfolio";
        }
    }

    function _roleAttack(uint256 t, address actor, uint256 which, uint256 seed, uint256 amount)
        internal
        returns (bytes memory data, bytes memory want, string memory what)
    {
        Side memory target = sides[t];
        want = _notAuthorized(actor);
        if (which == 14) {
            uint256 variant = seed % 3;
            data = variant == 0
                ? abi.encodeCall(ViatikLedger.revokeRole, (target.agency, target.admin))
                : variant == 1
                    ? abi.encodeCall(ViatikLedger.revokeRole, (target.agency, target.member))
                    : abi.encodeCall(ViatikLedger.revokeRole, (target.portfolio, target.investor));
            what = "revokeRole";
        } else if (which == 15) {
            data = abi.encodeCall(ViatikLedger.createAccount, (_fresh("x_acct"), target.agency, true));
            what = "createAccount";
        } else if (which == 16) {
            data = abi.encodeCall(
                ViatikLedger.createBudget, (_fresh("x_bud"), _pick(_accounts[t], seed), 1, 1, new bytes32[](0), 0)
            );
            what = "createBudget";
        } else if (which == 17) {
            data = abi.encodeCall(ViatikLedger.returnToAgency, (_fresh("x_ret"), target.agency, amount));
            what = "returnToAgency";
        } else if (which == 21) {
            data = abi.encodeCall(ViatikLedger.invalidatePermit, (target.member));
            what = "invalidatePermit";
        } else if (which == 22) {
            uint256 nonce = ledger.nonces(actor);
            uint256 deadline = block.timestamp + 1 days;
            bytes memory signature = _permit(actor, target.agency, ViatikLedger.Role.Admin, nonce, deadline, FORGER_KEY);
            data =
                abi.encodeCall(ViatikLedger.join, (target.agency, ViatikLedger.Role.Admin, nonce, deadline, signature));
            what = "join with a forged permit";
        } else if (which == 23) {
            data = abi.encodeCall(
                ViatikLedger.importLocation,
                (_fresh("x_seed"), ViatikLedger.LocationKind.Account, target.agency, amount, false)
            );
            want = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, actor);
            what = "importLocation";
        } else {
            data = abi.encodeCall(ViatikLedger.importRole, (target.agency, actor, ViatikLedger.Role.Admin));
            want = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, actor);
            what = "importRole";
        }
    }

    // ─── Bookkeeping ────────────────────────────────────────────────────────

    function _begin() internal {
        calls[msg.sig] += 1;
        vm.recordLogs();
        for (uint256 i; i < _allBudgets.length; ++i) {
            pausedAtStart[_allBudgets[i]] = ledger.getBudget(_allBudgets[i]).paused;
        }
    }

    /// Reads the action's logs, then records terminal states seen for the first time.
    function _end() internal returns (Vm.Log[] memory logs) {
        logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(ledger)) continue;
            bytes32 topic = logs[i].topics[0];
            if (topic == ViatikLedger.Recorded.selector) {
                bytes32 key = keccak256(abi.encode(logs[i].topics[2], logs[i].topics[1]));
                recordedCount[key] += 1;
                if (recordedCount[key] > 1) duplicateRecords += 1;
            } else if (topic == ViatikLedger.PaymentExecuted.selector) {
                (bytes32 source,,,,) = abi.decode(logs[i].data, (bytes32, bytes32, address, uint256, bytes32));
                if (pausedAtStart[source]) pausedPayouts += 1;
            } else if (topic == ViatikLedger.PaymentApproved.selector) {
                address approver = abi.decode(logs[i].data, (address));
                if (approver == ledger.getRequest(logs[i].topics[1]).requester) selfApprovals += 1;
            }
        }
        _syncFinalStates();
    }

    function _syncFinalStates() internal {
        for (uint256 i; i < _allTranches.length; ++i) {
            bytes32 id = _allTranches[i];
            if (finalTranche[id] != ViatikLedger.TrancheStatus.None) continue;
            ViatikLedger.TrancheStatus status = ledger.getTranche(id).status;
            if (status == ViatikLedger.TrancheStatus.Released || status == ViatikLedger.TrancheStatus.Rejected) {
                finalTranche[id] = status;
            }
        }
        for (uint256 i; i < _allRequests.length; ++i) {
            bytes32 id = _allRequests[i];
            if (finalRequest[id] != ViatikLedger.RequestStatus.None) continue;
            ViatikLedger.RequestStatus status = ledger.getRequest(id).status;
            if (status != ViatikLedger.RequestStatus.Pending) finalRequest[id] = status;
        }
    }

    function _succeeded(bytes memory want, string memory what) internal {
        if (want.length != 0) _violation(string.concat(what, ": succeeded but should revert ", vm.toString(want)));
        successes[msg.sig] += 1;
    }

    function _reverted(bytes memory want, bytes memory got, string memory what) internal {
        if (want.length == 0) _violation(string.concat(what, ": unexpected revert ", vm.toString(got)));
        else if (keccak256(got) != keccak256(want)) _violation(string.concat(what, ": wrong error ", vm.toString(got)));
    }

    function _violation(string memory what) internal {
        if (violations == 0) firstViolation = what;
        violations += 1;
    }

    function _attackerWon(string memory what) internal {
        if (attackerWins == 0) firstAttackerWin = what;
        attackerWins += 1;
    }

    function _claimed(address actor, bytes32 opId, uint256 s) internal {
        if (!ledger.processed(actor, opId)) _violation("a recorded operation is not marked processed");
        _claimedOps.push(ClaimedOp(actor, opId));
        _pool[s].push(opId);
    }

    function _trackLocation(uint256 s, bytes32 id) internal {
        _locations.push(id);
        _pool[s].push(id);
    }

    function _trackBudget(uint256 s, bytes32 id) internal {
        _budgets[s].push(id);
        _allBudgets.push(id);
        _trackLocation(s, id);
    }

    function _trackAgreement(uint256 s, bytes32 id, bytes32 vault, uint256 committed, bytes32[] memory trancheIds)
        internal
    {
        _allAgreements.push(id);
        _agreements[s].push(id);
        _pool[s].push(id);
        _trackLocation(s, vault);
        _agreementGhost[id] = AgreementGhost({side: s, vault: vault, committed: committed, funded: 0, released: 0});
        for (uint256 i; i < trancheIds.length; ++i) {
            _allTranches.push(trancheIds[i]);
            _tranches[s].push(trancheIds[i]);
            _pool[s].push(trancheIds[i]);
        }
    }

    // ─── Model updates (never revert: a surprise is counted instead) ────────

    function _add(bytes32 location, uint256 amount) internal {
        ghostBalance[location] += amount;
    }

    function _sub(bytes32 location, uint256 amount) internal {
        uint256 balance = ghostBalance[location];
        if (amount > balance) {
            _violation("model: debit above the modeled balance");
            amount = balance;
        }
        ghostBalance[location] = balance - amount;
    }

    function _move(bytes32 from, bytes32 to, uint256 amount) internal {
        _sub(from, amount);
        _add(to, amount);
    }

    function _subMember(bytes32 agency, address person, uint256 amount) internal {
        uint256 balance = ghostMemberBalance[agency][person];
        if (amount > balance) {
            _violation("model: member debit above the modeled balance");
            amount = balance;
        }
        ghostMemberBalance[agency][person] = balance - amount;
    }

    /// A vendor payout leaves the ledger for the sink; a person's payout stays booked.
    function _payout(uint256 s, bytes32 source, address payee, uint256 amount) internal {
        _sub(source, amount);
        if (payee == address(0)) {
            ghostVendorPaid += amount;
            agencyOut[s] += amount;
        } else {
            ghostMemberBalance[sides[s].agency][payee] += amount;
        }
    }

    // ─── Picking ids ────────────────────────────────────────────────────────

    function _fresh(string memory kind) internal returns (bytes32) {
        return keccak256(abi.encode("inv", kind, ++idNonce));
    }

    function _pick(bytes32[] storage list, uint256 seed) internal view returns (bytes32) {
        return list[seed % list.length];
    }

    function _poolAny(uint256 seed) internal view returns (bytes32) {
        return _pick(_pool[seed % 2], seed >> 1);
    }

    /// A payment amount: mostly within the story's per-operation limits, sometimes up to
    /// past both exception thresholds.
    function _amount(uint256 seed) internal pure returns (uint256) {
        return seed % 3 == 0 ? _bound(seed >> 2, 1, 5_000 * USD) : _bound(seed >> 2, 1, 1_000 * USD);
    }

    function _vendor(uint256 seed) internal pure returns (bytes32) {
        uint256 pick = seed % 3;
        return pick == 0 ? VERCEL : pick == 1 ? OTHER_VENDOR : UNLISTED_VENDOR;
    }

    function _allowlist(uint256 bits) internal pure returns (bytes32[] memory list) {
        uint256 mode = bits % 4;
        list = new bytes32[](mode == 0 ? 0 : mode == 3 ? 2 : 1);
        if (mode == 0) return list;
        list[0] = mode == 2 ? OTHER_VENDOR : VERCEL;
        if (mode == 3) list[1] = OTHER_VENDOR;
    }

    /// Mostly an agreement in `status` (scanning from the seed); sometimes any agreement.
    function _pickAgreement(uint256 seed, ViatikLedger.AgreementStatus status) internal view returns (bytes32) {
        uint256 n = _allAgreements.length;
        uint256 start = (seed >> 2) % n;
        if (seed % 4 == 0) return _allAgreements[start];
        for (uint256 i; i < n; ++i) {
            bytes32 id = _allAgreements[(start + i) % n];
            if (ledger.getAgreement(id).status == status) return id;
        }
        return _allAgreements[start];
    }

    /// Mostly a tranche of an active agreement that fits `mode` (0 open, 1 requested,
    /// 2 releasable); sometimes any tranche.
    function _pickTranche(uint256 seed, uint256 mode) internal view returns (bytes32) {
        uint256 n = _allTranches.length;
        uint256 start = (seed >> 2) % n;
        if (seed % 4 == 0) return _allTranches[start];
        for (uint256 i; i < n; ++i) {
            bytes32 id = _allTranches[(start + i) % n];
            ViatikLedger.Tranche memory tranche = ledger.getTranche(id);
            if (ledger.getAgreement(tranche.agreement).status != ViatikLedger.AgreementStatus.Active) continue;
            bool requested = tranche.status == ViatikLedger.TrancheStatus.Requested;
            bool fits = mode == 0
                ? tranche.status == ViatikLedger.TrancheStatus.Planned
                    || tranche.status == ViatikLedger.TrancheStatus.Available
                : mode == 1
                    ? requested
                    : requested || (tranche.status == ViatikLedger.TrancheStatus.Available && !tranche.milestone);
            if (fits) return id;
        }
        return _allTranches[start];
    }

    /// Mostly a pending request; sometimes any.
    function _pickRequest(uint256 seed) internal view returns (bytes32) {
        uint256 n = _allRequests.length;
        uint256 start = (seed >> 2) % n;
        if (seed % 4 == 0) return _allRequests[start];
        for (uint256 i; i < n; ++i) {
            bytes32 id = _allRequests[(start + i) % n];
            if (ledger.getRequest(id).status == ViatikLedger.RequestStatus.Pending) return id;
        }
        return _allRequests[start];
    }

    // ─── Errors and permits ─────────────────────────────────────────────────

    function _notAuthorized(address account) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, account);
    }

    function _invalidState(bytes32 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ViatikLedger.InvalidState.selector, id);
    }

    function _already(bytes32 id) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, id);
    }

    function _insufficient(bytes32 location, uint256 available, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, location, available, amount);
    }

    function _limit(ViatikLedger.LimitRule rule, uint256 limit, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ViatikLedger.LimitExceeded.selector, rule, limit, amount);
    }

    function _permit(
        address account,
        bytes32 scope,
        ViatikLedger.Role role,
        uint256 nonce,
        uint256 deadline,
        uint256 key
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

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Vm} from "forge-std/Vm.sol";

import {ViatikLedger} from "../src/ViatikLedger.sol";
import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Genesis (sections 2.6 and 2.8): the owner (this contract, which deployed the ledger)
/// seeds a whole world from scratch in ONE multicall; the seeded people then act on it,
/// and every import refuses what already exists or does not fit, without minting.
///
/// The seeded world: portfolio Northstar (Elena) with agencies Arc and Lumen. Arc has an
/// active agreement of 90,000 (60,000 funded, tranche 1 released, tranche 2 requested by
/// Maya with milestone evidence), an Operations account, a project account, a budget with
/// allowances for Alex and for Jordan (a seeded person without a wallet, imported under a
/// placeholder address) and Jordan's pending request.
contract ViatikLedgerGenesisTest is LedgerFixture {
    address internal elena = makeAddr("elena");
    address internal maya = makeAddr("maya");
    address internal alex = makeAddr("alex");
    address internal jordan = makeAddr("placeholder:jordan");

    bytes32 internal constant NONE = bytes32(0);
    bytes32 internal constant NS = keccak256("seed-7");
    bytes32 internal constant NORTHSTAR = keccak256("seed-7:pf_northstar");
    bytes32 internal constant NORTHSTAR_VAULT = keccak256("seed-7:vault_northstar");
    bytes32 internal constant ARC = keccak256("seed-7:ag_arc");
    bytes32 internal constant ARC_VAULT = keccak256("seed-7:vault_arc_funding");
    bytes32 internal constant ARC_OPS = keccak256("seed-7:acct_arc_operations");
    bytes32 internal constant ARC_PROJECT = keccak256("seed-7:acct_arc_project");
    bytes32 internal constant ARC_BUD = keccak256("seed-7:bud_arc_team");
    bytes32 internal constant LUMEN = keccak256("seed-7:ag_lumen");
    bytes32 internal constant LUMEN_OPS = keccak256("seed-7:acct_lumen_operations");
    bytes32 internal constant LUMEN_VAULT = keccak256("seed-7:vault_lumen_funding");
    bytes32 internal constant FIGMA = keccak256("seed-7:dest_figma");
    bytes32 internal constant ARC_FA = keccak256("seed-7:fa_arc");
    bytes32 internal constant ARC_T1 = keccak256("seed-7:tr_arc_1");
    bytes32 internal constant ARC_T2 = keccak256("seed-7:tr_arc_2");
    bytes32 internal constant ARC_T3 = keccak256("seed-7:tr_arc_3");
    bytes32 internal constant ARC_T4 = keccak256("seed-7:tr_arc_4");
    /// What a careless caller puts in `Tranche.agreement`: the import must overwrite it.
    bytes32 internal constant WRONG_AGREEMENT = keccak256("seed-7:fa_somebody_else");
    bytes32 internal constant MILESTONE_EVIDENCE = keccak256("seed-7:evidence_milestone");
    bytes32 internal constant JORDAN_REQ = keccak256("seed-7:req_jordan_figma");
    bytes32 internal constant INVOICE = keccak256("seed-7:evidence_invoice");

    /// Above TestUSD's MAX_MINT on purpose: the import mints it in chunks.
    uint256 internal constant NORTHSTAR_BALANCE = 2_500_000 * USD;
    uint256 internal constant ARC_COMMITTED = 90_000 * USD;
    uint256 internal constant ARC_FUNDED = 60_000 * USD;
    uint256 internal constant ARC_RELEASED = 30_000 * USD;
    uint256 internal constant ARC_EXCEPTION = 5_000 * USD;
    uint256 internal constant ARC_OPS_BALANCE = 12_000 * USD;
    uint256 internal constant ARC_PROJECT_BALANCE = 3_000 * USD;
    uint256 internal constant ARC_BUD_BALANCE = 4_000 * USD;
    uint256 internal constant ARC_PER_OP = 1_500 * USD;
    uint256 internal constant ARC_AUTO_APPROVE = 300 * USD;
    uint256 internal constant LUMEN_OPS_BALANCE = 1_000 * USD;
    uint256 internal constant ALEX_BALANCE = 250 * USD;
    uint256 internal constant JORDAN_AMOUNT = 800 * USD;
    uint256 internal constant IMPORTED = NORTHSTAR_BALANCE + (ARC_FUNDED - ARC_RELEASED) + ARC_OPS_BALANCE
        + ARC_PROJECT_BALANCE + ARC_BUD_BALANCE + LUMEN_OPS_BALANCE + ALEX_BALANCE;

    // A spare funding vault and agreement for the importAgreement guards.
    bytes32 internal constant SPARE_VAULT = keccak256("seed-7:vault_arc_spare");
    bytes32 internal constant SPARE_FA = keccak256("seed-7:fa_arc_spare");
    bytes32 internal constant SPARE_T = keccak256("seed-7:tr_arc_spare");
    uint256 internal constant SPARE = 10_000 * USD;

    /// No QA story here: a fresh ledger owned by this contract, built only by the genesis.
    function setUp() public override {
        _deployLedger();
        ledger.multicall(_genesis());
    }

    // ─── The seeded world ──────────────────────────────────────────────────

    function test_GenesisImportsScopesRolesAndLocations() public view {
        assertEq(ledger.namespace(), NS);
        assertEq(uint8(ledger.scopeKind(NORTHSTAR)), uint8(ViatikLedger.ScopeKind.Portfolio));
        assertEq(uint8(ledger.scopeKind(ARC)), uint8(ViatikLedger.ScopeKind.Agency));
        assertEq(uint8(ledger.scopeKind(LUMEN)), uint8(ViatikLedger.ScopeKind.Agency));
        assertEq(ledger.agencyPortfolio(ARC), NORTHSTAR);
        assertEq(ledger.agencyPortfolio(LUMEN), NORTHSTAR, "an existing portfolio takes a second agency");

        assertEq(uint8(ledger.roleOf(NORTHSTAR, elena)), uint8(ViatikLedger.Role.Investor));
        assertEq(uint8(ledger.roleOf(ARC, maya)), uint8(ViatikLedger.Role.Admin));
        assertEq(uint8(ledger.roleOf(ARC, alex)), uint8(ViatikLedger.Role.Member));
        assertEq(uint8(ledger.roleOf(ARC, jordan)), uint8(ViatikLedger.Role.Member));
        assertEq(uint8(ledger.roleOf(LUMEN, maya)), uint8(ViatikLedger.Role.None));

        _assertLocation(NORTHSTAR_VAULT, ViatikLedger.LocationKind.PortfolioVault, NORTHSTAR, NORTHSTAR_BALANCE);
        _assertLocation(ARC_VAULT, ViatikLedger.LocationKind.FundingVault, ARC, ARC_FUNDED - ARC_RELEASED);
        _assertLocation(ARC_OPS, ViatikLedger.LocationKind.Account, ARC, ARC_OPS_BALANCE);
        _assertLocation(ARC_PROJECT, ViatikLedger.LocationKind.Account, ARC, ARC_PROJECT_BALANCE);
        _assertLocation(ARC_BUD, ViatikLedger.LocationKind.Budget, ARC, ARC_BUD_BALANCE);
        _assertLocation(LUMEN_OPS, ViatikLedger.LocationKind.Account, LUMEN, LUMEN_OPS_BALANCE);
        _assertLocation(LUMEN_VAULT, ViatikLedger.LocationKind.FundingVault, LUMEN, 0);
        assertEq(ledger.operationsAccount(ARC), ARC_OPS);
        assertEq(ledger.operationsAccount(LUMEN), LUMEN_OPS);
        assertEq(ledger.memberBalance(ARC, alex), ALEX_BALANCE);
    }

    function test_GenesisNormalizesImportedTranches() public view {
        ViatikLedger.Agreement memory agreement = ledger.getAgreement(ARC_FA);
        assertEq(agreement.agency, ARC);
        assertEq(agreement.vault, ARC_VAULT);
        assertEq(agreement.committed, ARC_COMMITTED);
        assertEq(agreement.funded, ARC_FUNDED);
        assertEq(agreement.released, ARC_RELEASED);
        assertEq(uint8(agreement.status), uint8(ViatikLedger.AgreementStatus.Active));
        assertEq(ledger.vaultAgreement(ARC_VAULT), ARC_FA);
        assertEq(ledger.exceptionThresholdOf(ARC), ARC_EXCEPTION);

        bytes32[] memory stored = ledger.tranchesOf(ARC_FA);
        bytes32[] memory ids = _arcTrancheIds();
        ViatikLedger.Tranche[] memory sent = _arcTranches();
        assertEq(stored.length, ids.length);
        for (uint256 i; i < ids.length; ++i) {
            assertEq(stored[i], ids[i]);
            ViatikLedger.Tranche memory tranche = ledger.getTranche(ids[i]);
            assertEq(uint256(tranche.index), i, "1-based index normalized to the array position");
            assertEq(tranche.agreement, ARC_FA, "agreement field normalized");
            assertEq(tranche.amount, sent[i].amount);
            assertEq(tranche.milestone, sent[i].milestone);
            assertEq(uint8(tranche.status), uint8(sent[i].status));
            assertEq(tranche.requestedBy, sent[i].requestedBy);
            assertEq(tranche.destination, sent[i].destination);
            assertEq(tranche.evidenceHash, sent[i].evidenceHash);
        }
    }

    function test_GenesisDerivesBudgetDestinationsFromTheList() public view {
        ViatikLedger.Budget memory budget = ledger.getBudget(ARC_BUD);
        assertEq(budget.sourceAccount, ARC_OPS);
        assertEq(budget.perOperationLimit, ARC_PER_OP);
        assertEq(budget.approvalThreshold, ARC_AUTO_APPROVE);
        assertFalse(budget.paused);
        // The data said anyDestination = true and epoch 7: both come from the ledger instead.
        assertFalse(budget.anyDestination);
        assertEq(budget.destinationEpoch, 0);
        assertTrue(ledger.isDestinationAllowed(ARC_BUD, FIGMA));
        assertFalse(ledger.isDestinationAllowed(ARC_BUD, VERCEL));

        ViatikLedger.Allowance memory allowance = ledger.getAllowance(ARC_BUD, jordan);
        assertTrue(allowance.active);
        assertEq(allowance.perOperationLimit, 0);
        assertEq(allowance.epoch, 0);
        assertTrue(ledger.getAllowance(ARC_BUD, alex).active);
    }

    function test_GenesisImportsThePendingRequestUnderAPlaceholder() public view {
        ViatikLedger.PaymentRequest memory request = ledger.getRequest(JORDAN_REQ);
        assertEq(request.budget, ARC_BUD);
        assertEq(request.requester, jordan);
        assertEq(request.destination, FIGMA);
        assertEq(request.member, address(0));
        assertEq(request.amount, JORDAN_AMOUNT);
        assertEq(request.evidenceHash, INVOICE);
        assertEq(uint8(request.status), uint8(ViatikLedger.RequestStatus.Pending));
        assertTrue(ledger.processed(jordan, JORDAN_REQ), "claimed for the requester");
        assertFalse(ledger.processed(address(this), JORDAN_REQ), "not for the owner who imported it");
        (ViatikLedger.Reason reason,) = ledger.checkPayment(ARC_BUD, jordan, FIGMA, address(0), JORDAN_AMOUNT);
        assertEq(uint8(reason), uint8(ViatikLedger.Reason.None), "it fits the imported budget");
        assertEq(ledger.balanceOf(ARC_BUD), ARC_BUD_BALANCE, "pending holds nothing");
    }

    function test_MintedTestUSDEqualsImportedBalances() public view {
        uint256 booked = ledger.balanceOf(NORTHSTAR_VAULT) + ledger.balanceOf(ARC_VAULT) + ledger.balanceOf(ARC_OPS)
            + ledger.balanceOf(ARC_PROJECT) + ledger.balanceOf(ARC_BUD) + ledger.balanceOf(LUMEN_OPS)
            + ledger.balanceOf(LUMEN_VAULT) + ledger.memberBalance(ARC, alex);
        assertEq(booked, IMPORTED);
        assertEq(token.balanceOf(address(ledger)), IMPORTED);
        assertEq(token.totalSupply(), IMPORTED, "nothing else was minted");
    }

    function test_GenesisMintsInChunksAndRecordsNoReceipts() public {
        _deployLedger();
        uint256 max = token.MAX_MINT();
        vm.recordLogs();
        ledger.multicall(_genesis());
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256 mints;
        uint256 receipts;
        uint256 pending;
        for (uint256 i; i < logs.length; ++i) {
            bytes32 topic = logs[i].topics.length > 0 ? logs[i].topics[0] : bytes32(0);
            if (logs[i].emitter == address(token) && topic == keccak256("Transfer(address,address,uint256)")) {
                assertEq(logs[i].topics[1], NONE, "only mints");
                assertLe(abi.decode(logs[i].data, (uint256)), max, "each mint within MAX_MINT");
                ++mints;
            }
            if (logs[i].emitter != address(ledger)) continue;
            if (topic == ViatikLedger.Recorded.selector) ++receipts;
            if (topic == ViatikLedger.PaymentPending.selector) ++pending;
        }
        // 2,500,000 in three chunks, plus one mint per other non-zero balance (6).
        assertEq(mints, 9);
        assertEq(receipts, 0, "imported history is not a receipt");
        assertEq(pending, 1);
        assertEq(token.balanceOf(address(ledger)), IMPORTED);
    }

    function test_NonOwnerCannotRunAnyGenesisCall() public {
        bytes[] memory calls = _genesis();
        bytes memory expected = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger);
        for (uint256 i; i < calls.length; ++i) {
            vm.prank(stranger);
            (bool ok, bytes memory data) = address(ledger).call(calls[i]);
            assertFalse(ok);
            assertEq(data, expected);
        }
        vm.prank(stranger);
        vm.expectRevert(expected);
        ledger.multicall(calls);
        assertEq(token.balanceOf(address(ledger)), IMPORTED);
    }

    function test_AFailingImportRollsBackTheWholeGenesis() public {
        _deployLedger();
        bytes[] memory genesis = _genesis();
        bytes[] memory calls = new bytes[](genesis.length + 1);
        for (uint256 i; i < genesis.length; ++i) {
            calls[i] = genesis[i];
        }
        calls[genesis.length] = abi.encodeCall(
            ViatikLedger.importLocation, (ARC_OPS, ViatikLedger.LocationKind.Account, ARC, 1 * USD, false)
        );

        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC_OPS));
        ledger.multicall(calls);
        assertEq(token.balanceOf(address(ledger)), 0);
        assertEq(ledger.namespace(), NONE);
        assertEq(uint8(ledger.scopeKind(ARC)), uint8(ViatikLedger.ScopeKind.None));
        assertEq(uint8(ledger.getRequest(JORDAN_REQ).status), uint8(ViatikLedger.RequestStatus.None));
    }

    // ─── Seeded people act on it ───────────────────────────────────────────

    function test_SeededAdminApprovesTheImportedPendingRequest() public {
        bytes32 paymentId = keccak256("seed-7:pay_jordan_figma");
        uint256 ledgerTokens = token.balanceOf(address(ledger));

        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentApproved(JORDAN_REQ, paymentId, maya);
        vm.expectEmit(true, true, false, true, address(ledger));
        emit ViatikLedger.PaymentExecuted(paymentId, JORDAN_REQ, ARC_BUD, FIGMA, address(0), JORDAN_AMOUNT, INVOICE);
        vm.prank(maya);
        ledger.approvePayment(JORDAN_REQ, paymentId);

        assertEq(uint8(ledger.getRequest(JORDAN_REQ).status), uint8(ViatikLedger.RequestStatus.Executed));
        assertEq(ledger.balanceOf(ARC_BUD), ARC_BUD_BALANCE - JORDAN_AMOUNT);
        assertEq(token.balanceOf(sink), JORDAN_AMOUNT);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens - JORDAN_AMOUNT);
        assertTrue(ledger.processed(maya, paymentId));
    }

    function test_ReleasingImportedTrancheKPromotesTheNextArrayPosition() public {
        vm.prank(elena);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC_T1));
        ledger.releaseTranche(ARC_T1, NONE);

        // ARC_T2 sits at array position 1 (it came with index 2): it promotes position 2, not 3.
        vm.prank(elena);
        ledger.releaseTranche(ARC_T2, keccak256("seed-7:decision_t2"));
        assertEq(uint8(ledger.getTranche(ARC_T2).status), uint8(ViatikLedger.TrancheStatus.Released));
        assertEq(uint8(ledger.getTranche(ARC_T3).status), uint8(ViatikLedger.TrancheStatus.Available));
        assertEq(uint8(ledger.getTranche(ARC_T4).status), uint8(ViatikLedger.TrancheStatus.Planned));
        assertEq(ledger.balanceOf(ARC_PROJECT), ARC_PROJECT_BALANCE + 20_000 * USD, "to the requested account");
        assertEq(ledger.getAgreement(ARC_FA).released, ARC_RELEASED + 20_000 * USD);

        // Fund the rest; ARC_T3 (available, no milestone) goes to Operations and promotes ARC_T4.
        vm.startPrank(elena);
        ledger.fundAgreement(keccak256("seed-7:fund_rest"), ARC_FA, NORTHSTAR_VAULT, ARC_COMMITTED - ARC_FUNDED);
        ledger.releaseTranche(ARC_T3, NONE);
        vm.stopPrank();
        assertEq(uint8(ledger.getTranche(ARC_T4).status), uint8(ViatikLedger.TrancheStatus.Available));
        assertEq(ledger.balanceOf(ARC_OPS), ARC_OPS_BALANCE + 25_000 * USD);
        assertEq(ledger.balanceOf(ARC_VAULT), 15_000 * USD, "funded - released");
    }

    /// Wallet takeover: remove the old address and import the person again under the new one.
    function test_TakeoverMovesThePersonToTheNewWallet() public {
        address alexNew = makeAddr("alex:new-wallet");
        bytes32 oldRequest = keccak256("seed-7:req_alex_old");
        vm.prank(alex);
        ledger.requestPayment(oldRequest, keccak256("seed-7:pay_alex_old"), ARC_BUD, FIGMA, address(0), 400 * USD, NONE);
        uint256 ledgerTokens = token.balanceOf(address(ledger));

        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(ViatikLedger.importRole, (ARC, alex, ViatikLedger.Role.None));
        calls[1] = abi.encodeCall(ViatikLedger.importRole, (ARC, alexNew, ViatikLedger.Role.Member));
        calls[2] = abi.encodeCall(ViatikLedger.importAllowance, (ARC_BUD, alexNew, 0));
        calls[3] = abi.encodeCall(ViatikLedger.importMemberBalance, (ARC, alexNew, ALEX_BALANCE));
        ledger.multicall(calls);
        assertEq(uint8(ledger.roleOf(ARC, alex)), uint8(ViatikLedger.Role.None));
        assertEq(ledger.membershipEpoch(ARC, alex), 1);

        // The old wallet can neither spend nor return, and its pending request is stale.
        vm.prank(alex);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, alex));
        ledger.requestPayment(keccak256("seed-7:req_alex_x"), NONE, ARC_BUD, FIGMA, address(0), 10 * USD, NONE);
        vm.prank(alex);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, alex));
        ledger.returnToAgency(keccak256("seed-7:ret_alex_old"), ARC, 10 * USD);
        vm.prank(maya);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, alex));
        ledger.approvePayment(oldRequest, keccak256("seed-7:pay_alex_old2"));

        // The new wallet can.
        vm.prank(alexNew);
        ViatikLedger.RequestStatus outcome = ledger.requestPayment(
            keccak256("seed-7:req_alex_new"),
            keccak256("seed-7:pay_alex_new"),
            ARC_BUD,
            FIGMA,
            address(0),
            100 * USD,
            NONE
        );
        assertEq(uint8(outcome), uint8(ViatikLedger.RequestStatus.Executed));
        vm.prank(alexNew);
        ledger.returnToAgency(keccak256("seed-7:ret_alex_new"), ARC, 50 * USD);
        assertEq(ledger.memberBalance(ARC, alexNew), ALEX_BALANCE - 50 * USD);
        assertEq(ledger.balanceOf(ARC_OPS), ARC_OPS_BALANCE + 50 * USD);
        // The old balance stays booked under the old address; the re-import minted the new one.
        assertEq(ledger.memberBalance(ARC, alex), ALEX_BALANCE);
        assertEq(token.balanceOf(address(ledger)), ledgerTokens + ALEX_BALANCE - 100 * USD);

        // Even with a role again, the old wallet's allowance does not come back.
        ledger.importRole(ARC, alex, ViatikLedger.Role.Member);
        vm.prank(alex);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, alex));
        ledger.requestPayment(keccak256("seed-7:req_alex_y"), NONE, ARC_BUD, FIGMA, address(0), 10 * USD, NONE);
    }

    // ─── Guards: scopes and roles ──────────────────────────────────────────

    function test_RevertWhen_ImportScopeCollides() public {
        bytes32 newPortfolio = keccak256("seed-7:pf_new");
        bytes32 newAgency = keccak256("seed-7:ag_new");

        // An agency id offered as a portfolio collides, like createPortfolio(agencyId).
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC));
        ledger.importScope(ARC, newAgency);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC));
        ledger.importScope(newPortfolio, ARC);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, NORTHSTAR));
        ledger.importScope(newPortfolio, NORTHSTAR);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, NONE));
        ledger.importScope(NONE, newAgency);
        assertEq(uint8(ledger.scopeKind(newPortfolio)), uint8(ViatikLedger.ScopeKind.None));
        assertEq(uint8(ledger.scopeKind(newAgency)), uint8(ViatikLedger.ScopeKind.None));
        assertEq(ledger.agencyPortfolio(ARC), NORTHSTAR);

        // A live portfolio id cannot be imported as an agency, and seeded scopes cannot be reopened.
        bytes32 strangerPortfolio = keccak256("stranger:pf");
        vm.startPrank(stranger);
        ledger.createPortfolio(strangerPortfolio, keccak256("stranger:vault"));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC));
        ledger.createPortfolio(ARC, keccak256("stranger:vault2"));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, NORTHSTAR));
        ledger.createPortfolio(NORTHSTAR, keccak256("stranger:vault3"));
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, strangerPortfolio));
        ledger.importScope(newPortfolio, strangerPortfolio);
    }

    /// Regression (found in 6.4): a portfolio id a stranger opened first (front-running the
    /// genesis multicall, whose calldata shows every id) used to be adopted by importScope,
    /// leaving the stranger as Investor of a seeded agency. Genesis now refuses it.
    function test_GenesisRefusesAPortfolioIdSquattedBeforeIt() public {
        bytes32 portfolio = keccak256("seed-8:pf_fieldwork");
        bytes32 agency = keccak256("seed-8:ag_fieldwork");
        vm.prank(stranger);
        ledger.createPortfolio(portfolio, keccak256("stranger:vault"));

        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeCall(ViatikLedger.importScope, (portfolio, agency));
        calls[1] = abi.encodeCall(ViatikLedger.importRole, (portfolio, elena, ViatikLedger.Role.Investor));
        calls[2] = abi.encodeCall(ViatikLedger.importRole, (agency, maya, ViatikLedger.Role.Admin));
        (bool imported,) = address(ledger).call(abi.encodeCall(ledger.multicall, (calls)));

        assertFalse(imported, "the genesis attached a seeded agency to a stranger's portfolio");
    }

    function test_RevertWhen_ImportRoleDoesNotFitTheScope() public {
        bytes32 unknown = keccak256("seed-7:ag_unknown");
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, ARC));
        ledger.importRole(ARC, elena, ViatikLedger.Role.Investor);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, NORTHSTAR));
        ledger.importRole(NORTHSTAR, maya, ViatikLedger.Role.Admin);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, NORTHSTAR));
        ledger.importRole(NORTHSTAR, alex, ViatikLedger.Role.Member);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, unknown));
        ledger.importRole(unknown, alex, ViatikLedger.Role.Member);
        assertEq(uint8(ledger.roleOf(ARC, elena)), uint8(ViatikLedger.Role.None));
    }

    function test_RevertWhen_ImportAllowanceHolderHasNoRole() public {
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, _loc(stranger)));
        ledger.importAllowance(ARC_BUD, stranger, 0);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, ARC_OPS));
        ledger.importAllowance(ARC_OPS, alex, 0);
        assertFalse(ledger.getAllowance(ARC_BUD, stranger).active);
    }

    // ─── Guards: locations and balances ────────────────────────────────────

    function test_RevertWhen_ImportLocationKindIsNone() public {
        bytes32 id = keccak256("seed-7:acct_kindless");
        uint256 tokens = token.balanceOf(address(ledger));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, id));
        ledger.importLocation(id, ViatikLedger.LocationKind.None, ARC, 100 * USD, false);
        assertEq(token.balanceOf(address(ledger)), tokens, "no mint");
        assertEq(uint8(ledger.getLocation(id).kind), uint8(ViatikLedger.LocationKind.None));
    }

    function test_RevertWhen_ImportLocationMarksANonAccountAsOperations() public {
        ViatikLedger.LocationKind[3] memory kinds = [
            ViatikLedger.LocationKind.PortfolioVault,
            ViatikLedger.LocationKind.FundingVault,
            ViatikLedger.LocationKind.Budget
        ];
        uint256 tokens = token.balanceOf(address(ledger));
        for (uint256 i; i < kinds.length; ++i) {
            bytes32 id = keccak256(abi.encode("seed-7:not_an_account", i));
            vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, id));
            ledger.importLocation(id, kinds[i], LUMEN, 100 * USD, true);
        }
        assertEq(token.balanceOf(address(ledger)), tokens, "no mint");
        assertEq(ledger.operationsAccount(LUMEN), LUMEN_OPS);
    }

    function test_ASecondImportedOperationsAccountDoesNotReplaceTheFirst() public {
        bytes32 second = keccak256("seed-7:acct_arc_operations_2");
        ledger.importLocation(second, ViatikLedger.LocationKind.Account, ARC, 0, true);
        assertEq(ledger.operationsAccount(ARC), ARC_OPS);
        assertEq(uint8(ledger.getLocation(second).kind), uint8(ViatikLedger.LocationKind.Account));
    }

    function test_RevertWhen_ImportLocationIdExists() public {
        uint256 tokens = token.balanceOf(address(ledger));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC_OPS));
        ledger.importLocation(ARC_OPS, ViatikLedger.LocationKind.Budget, ARC, 500 * USD, false);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, NORTHSTAR_VAULT));
        ledger.importLocation(NORTHSTAR_VAULT, ViatikLedger.LocationKind.PortfolioVault, NORTHSTAR, 1 * USD, false);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, NONE));
        ledger.importLocation(NONE, ViatikLedger.LocationKind.Account, ARC, 500 * USD, false);

        _assertLocation(ARC_OPS, ViatikLedger.LocationKind.Account, ARC, ARC_OPS_BALANCE);
        assertEq(ledger.balanceOf(NORTHSTAR_VAULT), NORTHSTAR_BALANCE);
        assertEq(token.balanceOf(address(ledger)), tokens, "no mint");
    }

    function test_RevertWhen_ImportMemberBalanceRepeatsOrIsZero() public {
        uint256 tokens = token.balanceOf(address(ledger));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, ARC));
        ledger.importMemberBalance(ARC, alex, 1 * USD);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, ARC));
        ledger.importMemberBalance(ARC, maya, 0);
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, NORTHSTAR));
        ledger.importMemberBalance(NORTHSTAR, maya, 1 * USD);

        assertEq(ledger.memberBalance(ARC, alex), ALEX_BALANCE, "not credited twice");
        assertEq(ledger.memberBalance(ARC, maya), 0);
        assertEq(token.balanceOf(address(ledger)), tokens, "no mint");
    }

    // ─── Guards: budgets ───────────────────────────────────────────────────

    function test_RevertWhen_ImportBudgetSourceIsForeignOrZero() public {
        bytes32 budgetId = keccak256("seed-7:bud_arc_new");
        ledger.importLocation(budgetId, ViatikLedger.LocationKind.Budget, ARC, 0, false);
        ViatikLedger.Budget memory data = _arcBudget();
        bytes32[] memory none = new bytes32[](0);

        data.sourceAccount = LUMEN_OPS; // another agency's account
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, LUMEN_OPS));
        ledger.importBudget(budgetId, data, none);
        data.sourceAccount = NONE;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, NONE));
        ledger.importBudget(budgetId, data, none);
        data.sourceAccount = ARC_VAULT; // not an account
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, ARC_VAULT));
        ledger.importBudget(budgetId, data, none);
        data.sourceAccount = ARC_OPS;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, ARC_PROJECT));
        ledger.importBudget(ARC_PROJECT, data, none); // not a budget

        assertEq(ledger.getBudget(budgetId).sourceAccount, NONE);
        ledger.importBudget(budgetId, data, none);
        assertEq(ledger.getBudget(budgetId).sourceAccount, ARC_OPS);
        assertTrue(ledger.getBudget(budgetId).anyDestination, "an empty list accepts any destination");
    }

    function test_RevertWhen_ImportBudgetRepeats() public {
        ViatikLedger.Budget memory data = _arcBudget();
        data.perOperationLimit = 1 * USD;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, ARC_BUD));
        ledger.importBudget(ARC_BUD, data, new bytes32[](0));
        assertEq(ledger.getBudget(ARC_BUD).perOperationLimit, ARC_PER_OP);
    }

    // ─── Guards: agreements ────────────────────────────────────────────────

    function test_RevertWhen_ImportAgreementVaultIsNotAFreeFundingVaultOfTheAgency() public {
        _importSpareVault();
        ViatikLedger.Agreement memory data = _spareAgreement();
        ViatikLedger.Tranche[] memory tranches = _spareTranches(SPARE);
        bytes32 missing = keccak256("seed-7:vault_missing");

        data.vault = ARC_OPS; // an account
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, ARC_OPS));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
        data.vault = missing;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, missing));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
        data.vault = ARC_VAULT; // already backs ARC_FA
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, ARC_VAULT));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
        data.vault = LUMEN_VAULT; // another agency's
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, LUMEN_VAULT));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);

        // Nothing was left behind: the right vault still imports.
        data.vault = SPARE_VAULT;
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
        assertEq(ledger.vaultAgreement(SPARE_VAULT), SPARE_FA);
        assertEq(ledger.vaultAgreement(LUMEN_VAULT), NONE);
    }

    function test_RevertWhen_ImportAgreementVaultBalanceIsNotFundedMinusReleased() public {
        _importSpareVault();
        ViatikLedger.Agreement memory data = _spareAgreement();
        data.released = 4_000 * USD;
        vm.expectRevert(
            abi.encodeWithSelector(ViatikLedger.InsufficientFunds.selector, SPARE_VAULT, SPARE, SPARE - 4_000 * USD)
        );
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), _spareTranches(SPARE));
        assertEq(ledger.vaultAgreement(SPARE_VAULT), NONE);
    }

    function test_RevertWhen_ImportAgreementCapitalIsOutOfOrder() public {
        _importSpareVault();
        ViatikLedger.Agreement memory data = _spareAgreement();
        ViatikLedger.Tranche[] memory tranches = _spareTranches(SPARE);

        data.released = SPARE + 1; // released > funded
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_FA));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
        data.released = 0;
        data.funded = SPARE + 1; // funded > committed
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_FA));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
        assertEq(uint8(ledger.getAgreement(SPARE_FA).status), uint8(ViatikLedger.AgreementStatus.None));
    }

    function test_RevertWhen_ImportAgreementTranchesDoNotAddUp() public {
        _importSpareVault();
        ViatikLedger.Agreement memory data = _spareAgreement();
        vm.expectRevert(
            abi.encodeWithSelector(
                ViatikLedger.LimitExceeded.selector, ViatikLedger.LimitRule.Tranches, SPARE, SPARE - 1
            )
        );
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), _spareTranches(SPARE - 1));
        assertEq(uint8(ledger.getTranche(SPARE_T).status), uint8(ViatikLedger.TrancheStatus.None));
    }

    function test_RevertWhen_ImportAgreementReusesIds() public {
        _importSpareVault();
        ViatikLedger.Agreement memory data = _spareAgreement();

        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, ARC_FA));
        ledger.importAgreement(ARC_FA, data, _ids(SPARE_T), _spareTranches(SPARE));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, ARC_T1));
        ledger.importAgreement(SPARE_FA, data, _ids(ARC_T1), _spareTranches(SPARE));

        // The same tranche id twice in one import.
        ViatikLedger.Tranche[] memory halves = new ViatikLedger.Tranche[](2);
        halves[0] = _spareTranches(SPARE / 2)[0];
        halves[1] = halves[0];
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_T));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T, SPARE_T), halves);

        assertEq(ledger.getTranche(ARC_T1).agreement, ARC_FA, "the seeded tranche is untouched");
        assertEq(ledger.getAgreement(ARC_FA).committed, ARC_COMMITTED);
    }

    function test_RevertWhen_ImportAgreementShapeIsInvalid() public {
        _importSpareVault();
        ViatikLedger.Agreement memory data = _spareAgreement();
        ViatikLedger.Tranche[] memory tranches = _spareTranches(SPARE);

        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_FA));
        ledger.importAgreement(SPARE_FA, data, new bytes32[](0), new ViatikLedger.Tranche[](0));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_FA));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T, ARC_T4), tranches);

        data.status = ViatikLedger.AgreementStatus.None;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_FA));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);

        data.status = ViatikLedger.AgreementStatus.Pending;
        tranches[0].status = ViatikLedger.TrancheStatus.None;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, SPARE_T));
        ledger.importAgreement(SPARE_FA, data, _ids(SPARE_T), tranches);
    }

    // ─── Guards: pending requests ──────────────────────────────────────────

    function test_RevertWhen_ImportPendingRequestRepeatsAnExistingRequest() public {
        ViatikLedger.ImportedRequest memory data = _jordanRequest();
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, JORDAN_REQ));
        ledger.importPendingRequest(data);

        vm.prank(maya);
        ledger.approvePayment(JORDAN_REQ, keccak256("seed-7:pay_jordan_figma"));
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, JORDAN_REQ));
        ledger.importPendingRequest(data);
        assertEq(uint8(ledger.getRequest(JORDAN_REQ).status), uint8(ViatikLedger.RequestStatus.Executed));

        // A request made onchain is taken too.
        bytes32 alexRequest = keccak256("seed-7:req_alex_live");
        vm.prank(alex);
        ledger.requestPayment(
            alexRequest, keccak256("seed-7:pay_alex_live"), ARC_BUD, FIGMA, address(0), 50 * USD, NONE
        );
        data.requestId = alexRequest;
        data.requester = alex;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.AlreadyProcessed.selector, alexRequest));
        ledger.importPendingRequest(data);
        assertEq(uint8(ledger.getRequest(alexRequest).status), uint8(ViatikLedger.RequestStatus.Executed));
        assertEq(ledger.getRequest(alexRequest).amount, 50 * USD);
    }

    /// Section 2.6: a seeded person without a wallet needs a placeholder with a role and an
    /// allowance imported first.
    function test_RevertWhen_ImportedRequesterHasNoAllowance() public {
        ViatikLedger.ImportedRequest memory data = _jordanRequest();
        data.requestId = keccak256("seed-7:req_priya");

        data.requester = maya; // Admin, but no allowance on the budget
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, maya));
        ledger.importPendingRequest(data);
        data.requester = stranger; // no role at all
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, stranger));
        ledger.importPendingRequest(data);

        address priya = makeAddr("placeholder:priya");
        ledger.importRole(ARC, priya, ViatikLedger.Role.Member);
        data.requester = priya;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotAuthorized.selector, priya));
        ledger.importPendingRequest(data);

        ledger.importAllowance(ARC_BUD, priya, 0);
        ledger.importPendingRequest(data);
        assertEq(ledger.getRequest(data.requestId).requester, priya);
        assertEq(uint8(ledger.getRequest(data.requestId).status), uint8(ViatikLedger.RequestStatus.Pending));
    }

    function test_RevertWhen_ImportPendingRequestBudgetIsNotABudget() public {
        ViatikLedger.ImportedRequest memory data = _jordanRequest();
        data.requestId = keccak256("seed-7:req_nowhere");
        data.budget = ARC_OPS;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.NotRegistered.selector, ARC_OPS));
        ledger.importPendingRequest(data);
    }

    /// Regression (found in 6.4): a zero amount used to report `AlreadyProcessed` for a
    /// request id nobody used; like everywhere else (section 2.8) it is `InvalidState`.
    function test_ImportPendingRequestWithZeroAmountIsInvalidState() public {
        ViatikLedger.ImportedRequest memory data = _jordanRequest();
        data.requestId = keccak256("seed-7:req_zero");
        data.amount = 0;
        vm.expectRevert(abi.encodeWithSelector(ViatikLedger.InvalidState.selector, data.requestId));
        ledger.importPendingRequest(data);
    }

    // ─── The genesis ───────────────────────────────────────────────────────

    /// The whole seeded world, owner imports only, in the order the server sends them.
    function _genesis() internal view returns (bytes[] memory calls) {
        calls = new bytes[](20);
        uint256 n;
        calls[n++] = abi.encodeCall(ViatikLedger.setNamespace, (NS));
        calls[n++] = abi.encodeCall(ViatikLedger.importScope, (NORTHSTAR, ARC));
        calls[n++] = abi.encodeCall(ViatikLedger.importScope, (NORTHSTAR, LUMEN));
        calls[n++] = abi.encodeCall(ViatikLedger.importRole, (NORTHSTAR, elena, ViatikLedger.Role.Investor));
        calls[n++] = abi.encodeCall(ViatikLedger.importRole, (ARC, maya, ViatikLedger.Role.Admin));
        calls[n++] = abi.encodeCall(ViatikLedger.importRole, (ARC, alex, ViatikLedger.Role.Member));
        calls[n++] = abi.encodeCall(ViatikLedger.importRole, (ARC, jordan, ViatikLedger.Role.Member));
        calls[n++] = _location(NORTHSTAR_VAULT, ViatikLedger.LocationKind.PortfolioVault, NORTHSTAR, NORTHSTAR_BALANCE);
        calls[n++] = _location(ARC_VAULT, ViatikLedger.LocationKind.FundingVault, ARC, ARC_FUNDED - ARC_RELEASED);
        calls[n++] = abi.encodeCall(
            ViatikLedger.importLocation, (ARC_OPS, ViatikLedger.LocationKind.Account, ARC, ARC_OPS_BALANCE, true)
        );
        calls[n++] = _location(ARC_PROJECT, ViatikLedger.LocationKind.Account, ARC, ARC_PROJECT_BALANCE);
        calls[n++] = _location(ARC_BUD, ViatikLedger.LocationKind.Budget, ARC, ARC_BUD_BALANCE);
        calls[n++] = abi.encodeCall(
            ViatikLedger.importLocation, (LUMEN_OPS, ViatikLedger.LocationKind.Account, LUMEN, LUMEN_OPS_BALANCE, true)
        );
        calls[n++] = _location(LUMEN_VAULT, ViatikLedger.LocationKind.FundingVault, LUMEN, 0);
        calls[n++] =
            abi.encodeCall(ViatikLedger.importAgreement, (ARC_FA, _arcAgreement(), _arcTrancheIds(), _arcTranches()));
        calls[n++] = abi.encodeCall(ViatikLedger.importBudget, (ARC_BUD, _arcBudget(), _ids(FIGMA)));
        calls[n++] = abi.encodeCall(ViatikLedger.importAllowance, (ARC_BUD, alex, 0));
        calls[n++] = abi.encodeCall(ViatikLedger.importAllowance, (ARC_BUD, jordan, 0));
        calls[n++] = abi.encodeCall(ViatikLedger.importMemberBalance, (ARC, alex, ALEX_BALANCE));
        calls[n++] = abi.encodeCall(ViatikLedger.importPendingRequest, (_jordanRequest()));
        assertEq(n, calls.length);
    }

    function _location(bytes32 id, ViatikLedger.LocationKind kind, bytes32 scope, uint256 balance)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(ViatikLedger.importLocation, (id, kind, scope, balance, false));
    }

    function _arcAgreement() internal pure returns (ViatikLedger.Agreement memory) {
        return ViatikLedger.Agreement({
            agency: ARC,
            vault: ARC_VAULT,
            committed: ARC_COMMITTED,
            funded: ARC_FUNDED,
            released: ARC_RELEASED,
            exceptionThreshold: ARC_EXCEPTION,
            status: ViatikLedger.AgreementStatus.Active
        });
    }

    function _arcTrancheIds() internal pure returns (bytes32[] memory ids) {
        ids = new bytes32[](4);
        ids[0] = ARC_T1;
        ids[1] = ARC_T2;
        ids[2] = ARC_T3;
        ids[3] = ARC_T4;
    }

    /// Indexes come 1-based and the agreement field wrong, as a careless caller sends them.
    function _arcTranches() internal view returns (ViatikLedger.Tranche[] memory list) {
        list = new ViatikLedger.Tranche[](4);
        list[0] = _tranche(30_000 * USD, 1, false, ViatikLedger.TrancheStatus.Released, address(0), ARC_OPS, NONE);
        list[1] = _tranche(
            20_000 * USD, 2, true, ViatikLedger.TrancheStatus.Requested, maya, ARC_PROJECT, MILESTONE_EVIDENCE
        );
        list[2] = _tranche(25_000 * USD, 3, false, ViatikLedger.TrancheStatus.Planned, address(0), NONE, NONE);
        list[3] = _tranche(15_000 * USD, 4, false, ViatikLedger.TrancheStatus.Planned, address(0), NONE, NONE);
    }

    function _tranche(
        uint256 amount,
        uint32 index,
        bool milestone,
        ViatikLedger.TrancheStatus status,
        address requestedBy,
        bytes32 destination,
        bytes32 evidenceHash
    ) internal pure returns (ViatikLedger.Tranche memory) {
        return ViatikLedger.Tranche({
            agreement: WRONG_AGREEMENT,
            amount: amount,
            index: index,
            milestone: milestone,
            status: status,
            requestedBy: requestedBy,
            destination: destination,
            evidenceHash: evidenceHash
        });
    }

    /// anyDestination and destinationEpoch are deliberately off: the ledger derives them.
    function _arcBudget() internal pure returns (ViatikLedger.Budget memory) {
        return ViatikLedger.Budget({
            sourceAccount: ARC_OPS,
            perOperationLimit: ARC_PER_OP,
            approvalThreshold: ARC_AUTO_APPROVE,
            paused: false,
            anyDestination: true,
            destinationEpoch: 7
        });
    }

    function _jordanRequest() internal view returns (ViatikLedger.ImportedRequest memory) {
        return ViatikLedger.ImportedRequest({
            requestId: JORDAN_REQ,
            budget: ARC_BUD,
            requester: jordan,
            destination: FIGMA,
            member: address(0),
            amount: JORDAN_AMOUNT,
            evidenceHash: INVOICE
        });
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /// A free funding vault of Arc holding SPARE, for a fully funded spare agreement.
    function _importSpareVault() internal {
        ledger.importLocation(SPARE_VAULT, ViatikLedger.LocationKind.FundingVault, ARC, SPARE, false);
    }

    function _spareAgreement() internal pure returns (ViatikLedger.Agreement memory) {
        return ViatikLedger.Agreement({
            agency: ARC,
            vault: SPARE_VAULT,
            committed: SPARE,
            funded: SPARE,
            released: 0,
            exceptionThreshold: 0,
            status: ViatikLedger.AgreementStatus.Pending
        });
    }

    function _spareTranches(uint256 amount) internal pure returns (ViatikLedger.Tranche[] memory list) {
        list = new ViatikLedger.Tranche[](1);
        list[0] = _tranche(amount, 0, false, ViatikLedger.TrancheStatus.Available, address(0), NONE, NONE);
    }

    function _assertLocation(bytes32 id, ViatikLedger.LocationKind kind, bytes32 scope, uint256 balance) internal view {
        ViatikLedger.Location memory location = ledger.getLocation(id);
        assertEq(uint8(location.kind), uint8(kind));
        assertEq(location.scope, scope);
        assertEq(location.balance, balance);
    }

    function _loc(address who) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(who)));
    }
}

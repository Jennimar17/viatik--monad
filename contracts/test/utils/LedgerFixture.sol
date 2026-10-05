// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";

import {TestUSD} from "../../src/TestUSD.sol";
import {ITestUSD, ViatikLedger} from "../../src/ViatikLedger.sol";

/// Shared setup for the ViatikLedger suites: the QA story from the live test of
/// 02/10 (portfolio, agency, a funded milestone agreement with tranche 1 released,
/// an Operations account and a budget with Leo's allowance), plus an optional
/// second, unrelated agency for isolation tests.
///
/// Notes for test authors:
/// - A prank applies to the very next call, view calls included: read values
///   (`token.MAX_MINT()`, `ledger.memberLocation(x)`…) into locals before `vm.prank`.
/// - With via-IR, a local computed from `block.timestamp` can be re-evaluated after
///   `vm.warp`: use fixed timestamps when warping.
abstract contract LedgerFixture is Test {
    TestUSD internal token;
    ViatikLedger internal ledger;

    address internal registrar;
    uint256 internal registrarKey;
    address internal sink = makeAddr("sink");
    address internal investor = makeAddr("jenni");
    address internal admin = makeAddr("ana");
    address internal member = makeAddr("leo");
    address internal stranger = makeAddr("stranger");

    // Second, unrelated portfolio and agency (see `_buildSecondAgency`).
    address internal investor2 = makeAddr("investor2");
    address internal admin2 = makeAddr("admin2");
    address internal member2 = makeAddr("member2");

    uint256 internal constant USD = 1e6;

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

    bytes32 internal constant PF2 = keccak256("qa2:pf");
    bytes32 internal constant PF2_VAULT = keccak256("qa2:vault_portfolio");
    bytes32 internal constant AG2 = keccak256("qa2:ag");
    bytes32 internal constant FUND_VAULT2 = keccak256("qa2:vault_funding");
    bytes32 internal constant FA2 = keccak256("qa2:fa");
    bytes32 internal constant T21 = keccak256("qa2:tr_1");
    bytes32 internal constant OPS2 = keccak256("qa2:acct_operations");
    bytes32 internal constant BUD2 = keccak256("qa2:bud");

    /// Story amounts after `_buildStory`.
    uint256 internal constant DEPOSIT = 200_000 * USD;
    uint256 internal constant COMMITTED = 100_000 * USD;
    uint256 internal constant TRANCHE_1 = 25_000 * USD;
    uint256 internal constant TRANCHE_2 = 75_000 * USD;
    uint256 internal constant EXCEPTION = 2_000 * USD;
    uint256 internal constant BUDGET = 5_000 * USD;
    uint256 internal constant PER_OP = 1_000 * USD;
    uint256 internal constant AUTO_APPROVE = 200 * USD;

    function setUp() public virtual {
        _deployLedger();
        _buildStory();
    }

    function _deployLedger() internal {
        (registrar, registrarKey) = makeAddrAndKey("registrar");
        token = new TestUSD();
        ledger = new ViatikLedger(ITestUSD(address(token)), registrar, sink);
    }

    /// Balances after it: portfolio vault 100,000; funding vault 75,000; Operations
    /// 20,000; budget 5,000; tranche 1 released, tranche 2 (no milestone) available.
    function _buildStory() internal {
        vm.startPrank(investor);
        ledger.createPortfolio(PF, PF_VAULT);
        ledger.registerAgency(AG, PF, FUND_VAULT);
        vm.stopPrank();

        _join(admin, AG, ViatikLedger.Role.Admin, 0);
        _join(member, AG, ViatikLedger.Role.Member, 0);

        vm.prank(investor);
        ledger.deposit(_id("dep_1"), PF, PF_VAULT, DEPOSIT);

        vm.prank(investor);
        ledger.createAgreement(
            FA, AG, FUND_VAULT, COMMITTED, EXCEPTION, _ids(T1, T2), _amounts(TRANCHE_1, TRANCHE_2), _flags(true, false)
        );

        vm.startPrank(admin);
        ledger.createAccount(OPS, AG, true);
        ledger.acceptAgreement(FA);
        vm.stopPrank();

        vm.prank(investor);
        ledger.fundAgreement(_id("fund_1"), FA, PF_VAULT, COMMITTED);

        vm.prank(admin);
        ledger.requestTranche(T1, OPS, EVIDENCE);
        vm.prank(investor);
        ledger.releaseTranche(T1, keccak256("decision"));

        vm.startPrank(admin);
        ledger.createBudget(BUD, OPS, PER_OP, AUTO_APPROVE, _ids(VERCEL), BUDGET);
        ledger.setAllowance(BUD, member, true, 0);
        vm.stopPrank();
    }

    /// A second portfolio and agency with their own people: an accepted, fully funded
    /// manual agreement of 50,000 with its single tranche released to OPS2, and a
    /// budget BUD2 of 3,000 (any destination) with member2's allowance.
    function _buildSecondAgency() internal {
        vm.startPrank(investor2);
        ledger.createPortfolio(PF2, PF2_VAULT);
        ledger.registerAgency(AG2, PF2, FUND_VAULT2);
        ledger.deposit(keccak256("qa2:dep"), PF2, PF2_VAULT, 60_000 * USD);
        ledger.createAgreement(
            FA2, AG2, FUND_VAULT2, 50_000 * USD, 4_000 * USD, _ids(T21), _amounts(50_000 * USD), _flags(false)
        );
        vm.stopPrank();

        _join(admin2, AG2, ViatikLedger.Role.Admin, 0);
        _join(member2, AG2, ViatikLedger.Role.Member, 0);

        vm.startPrank(admin2);
        ledger.createAccount(OPS2, AG2, true);
        ledger.acceptAgreement(FA2);
        vm.stopPrank();

        vm.startPrank(investor2);
        ledger.fundAgreement(keccak256("qa2:fund"), FA2, PF2_VAULT, 50_000 * USD);
        ledger.releaseTranche(T21, bytes32(0));
        vm.stopPrank();

        bytes32[] memory any = new bytes32[](0);
        vm.startPrank(admin2);
        ledger.createBudget(BUD2, OPS2, 1_000 * USD, 100 * USD, any, 3_000 * USD);
        ledger.setAllowance(BUD2, member2, true, 0);
        vm.stopPrank();
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    function _id(string memory name) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("qa:", name));
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
        return _permitFor(address(ledger), key, account, scope, role, nonce, deadline);
    }

    /// A permit for any ledger address (to test cross-contract replay).
    function _permitFor(
        address verifyingContract,
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
                verifyingContract
            )
        );
        bytes32 structHash = keccak256(abi.encode(ledger.JOIN_TYPEHASH(), account, scope, role, nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    /// Gives `holder` (who already has a role in the budget's agency) an allowance.
    function _allow(bytes32 budgetId, address holder) internal {
        address agencyAdmin = ledger.getLocation(budgetId).scope == AG2 ? admin2 : admin;
        vm.prank(agencyAdmin);
        ledger.setAllowance(budgetId, holder, true, 0);
    }

    function _ids(bytes32 a) internal pure returns (bytes32[] memory list) {
        list = new bytes32[](1);
        list[0] = a;
    }

    function _ids(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory list) {
        list = new bytes32[](2);
        list[0] = a;
        list[1] = b;
    }

    function _ids(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[] memory list) {
        list = new bytes32[](3);
        list[0] = a;
        list[1] = b;
        list[2] = c;
    }

    function _amounts(uint256 a) internal pure returns (uint256[] memory list) {
        list = new uint256[](1);
        list[0] = a;
    }

    function _amounts(uint256 a, uint256 b) internal pure returns (uint256[] memory list) {
        list = new uint256[](2);
        list[0] = a;
        list[1] = b;
    }

    function _amounts(uint256 a, uint256 b, uint256 c) internal pure returns (uint256[] memory list) {
        list = new uint256[](3);
        list[0] = a;
        list[1] = b;
        list[2] = c;
    }

    function _flags(bool a) internal pure returns (bool[] memory list) {
        list = new bool[](1);
        list[0] = a;
    }

    function _flags(bool a, bool b) internal pure returns (bool[] memory list) {
        list = new bool[](2);
        list[0] = a;
        list[1] = b;
    }

    function _flags(bool a, bool b, bool c) internal pure returns (bool[] memory list) {
        list = new bool[](3);
        list[0] = a;
        list[1] = b;
        list[2] = c;
    }
}

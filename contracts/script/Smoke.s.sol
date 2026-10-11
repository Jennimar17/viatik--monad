// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {TestUSD} from "../src/TestUSD.sol";
import {ViatikLedger} from "../src/ViatikLedger.sol";

/// End-to-end check of a deployed ViatikLedger on Monad testnet, with three wallets:
/// the deployer (Investor, and registrar on testnet), an Agency Admin and a Member.
/// Forge simulates the whole run against live state before broadcasting, so a failed
/// `require` here sends nothing.
///
///   LEDGER=0x… SMOKE_NS=smoke-1 DEPLOYER_PRIVATE_KEY=… SMOKE_ADMIN_KEY=… SMOKE_MEMBER_KEY=… \
///     FOUNDRY_PROFILE=monad forge script script/Smoke.s.sol --rpc-url "$MONAD_RPC_URL" --broadcast --slow
///
/// `--slow` waits for each receipt before sending the next transaction: three wallets take
/// turns, and each step depends on the previous one. Use a fresh SMOKE_NS on every run (ids
/// are single use).
///
/// It funds the Admin and the Member with a little MON for gas (these are direct calls
/// from plain wallets, not the app's sponsored path).
contract Smoke is Script {
    uint256 internal constant USD = 1e6;

    ViatikLedger internal ledger;
    TestUSD internal token;
    string internal ns;

    uint256 internal investorKey;
    uint256 internal adminKey;
    uint256 internal memberKey;
    address internal investor;
    address internal admin;
    address internal member;

    function run() external {
        require(block.chainid == 10143 || block.chainid == 31337, "Smoke: Monad testnet or local only");
        ledger = ViatikLedger(vm.envAddress("LEDGER"));
        token = TestUSD(address(ledger.TOKEN()));
        ns = vm.envString("SMOKE_NS");
        investorKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        adminKey = vm.envUint("SMOKE_ADMIN_KEY");
        memberKey = vm.envUint("SMOKE_MEMBER_KEY");
        investor = vm.addr(investorKey);
        admin = vm.addr(adminKey);
        member = vm.addr(memberKey);
        require(ledger.registrar() == investor, "Smoke: the deployer must be the registrar");

        bytes32 pf = _id("pf");
        bytes32 pfVault = _id("vault_portfolio");
        bytes32 ag = _id("ag");
        bytes32 fundVault = _id("vault_funding");
        bytes32 fa = _id("fa");
        bytes32 ops = _id("acct_operations");
        bytes32 bud = _id("bud");
        bytes32 vendor = _id("dest_vendor");

        // Investor: portfolio, agency, deposit and a 10,000 agreement (milestone + manual tranche).
        vm.startBroadcast(investorKey);
        _fund(admin, 0.5 ether);
        _fund(member, 0.3 ether);
        ledger.createPortfolio(pf, pfVault);
        ledger.registerAgency(ag, pf, fundVault);
        token.mint(investor, 50_000 * USD);
        token.approve(address(ledger), 50_000 * USD);
        ledger.deposit(_id("dep"), pf, pfVault, 50_000 * USD);
        bytes32[] memory tranches = new bytes32[](2);
        tranches[0] = _id("tr_1");
        tranches[1] = _id("tr_2");
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 4_000 * USD;
        amounts[1] = 6_000 * USD;
        bool[] memory milestones = new bool[](2);
        milestones[0] = true;
        ledger.createAgreement(fa, ag, fundVault, 10_000 * USD, 2_000 * USD, tranches, amounts, milestones);
        bytes memory adminPermit = _permit(admin, ag, ViatikLedger.Role.Admin, block.timestamp + 1 days);
        bytes memory memberPermit = _permit(member, ag, ViatikLedger.Role.Member, block.timestamp + 1 days);
        uint256 deadline = block.timestamp + 1 days;
        vm.stopBroadcast();

        // Admin joins, opens Operations and accepts in one multicall (one command, one tx).
        vm.startBroadcast(adminKey);
        ledger.join(ag, ViatikLedger.Role.Admin, 0, deadline, adminPermit);
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(ViatikLedger.createAccount, (ops, ag, true));
        calls[1] = abi.encodeCall(ViatikLedger.acceptAgreement, (fa));
        ledger.multicall(calls);
        vm.stopBroadcast();

        vm.broadcast(investorKey);
        ledger.fundAgreement(_id("fund"), fa, pfVault, 10_000 * USD);

        vm.broadcast(adminKey);
        ledger.requestTranche(tranches[0], ops, keccak256("smoke evidence"));

        vm.broadcast(investorKey);
        ledger.releaseTranche(tranches[0], keccak256("smoke decision"));
        require(ledger.balanceOf(ops) == 4_000 * USD, "Smoke: tranche 1 did not reach Operations");

        vm.broadcast(memberKey);
        ledger.join(ag, ViatikLedger.Role.Member, 0, deadline, memberPermit);

        // Admin: a 2,000 budget (500 per operation, automatic up to 200, only the vendor).
        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = vendor;
        vm.startBroadcast(adminKey);
        ledger.createBudget(bud, ops, 500 * USD, 200 * USD, allowed, 2_000 * USD);
        ledger.setAllowance(bud, member, true, 0);
        vm.stopBroadcast();

        uint256 sinkBefore = token.balanceOf(ledger.payoutSink());

        // Member: 120 is paid at once; 900 is rejected by the contract and recorded; 300 waits.
        vm.startBroadcast(memberKey);
        ViatikLedger.RequestStatus paid =
            ledger.requestPayment(_id("req_120"), _id("pay_120"), bud, vendor, address(0), 120 * USD, bytes32(0));
        ViatikLedger.RequestStatus rejected =
            ledger.requestPayment(_id("req_900"), _id("pay_900"), bud, vendor, address(0), 900 * USD, bytes32(0));
        ViatikLedger.RequestStatus pending =
            ledger.requestPayment(_id("req_300"), _id("pay_300a"), bud, vendor, address(0), 300 * USD, bytes32(0));
        vm.stopBroadcast();
        require(paid == ViatikLedger.RequestStatus.Executed, "Smoke: 120 should be paid");
        require(rejected == ViatikLedger.RequestStatus.Rejected, "Smoke: 900 should be rejected");
        require(pending == ViatikLedger.RequestStatus.Pending, "Smoke: 300 should wait for approval");

        vm.broadcast(adminKey);
        ledger.approvePayment(_id("req_300"), _id("pay_300"));

        // Member: a reimbursement to themselves, then returns part of it to Operations.
        vm.startBroadcast(memberKey);
        ledger.requestPayment(_id("req_35"), _id("pay_35"), bud, bytes32(0), member, 35 * USD, bytes32(0));
        ledger.returnToAgency(_id("ret"), ag, 20 * USD);
        vm.stopBroadcast();

        require(token.balanceOf(ledger.payoutSink()) == sinkBefore + 420 * USD, "Smoke: vendor payouts");
        require(ledger.balanceOf(bud) == 2_000 * USD - 455 * USD, "Smoke: budget balance");
        require(ledger.memberBalance(ag, member) == 15 * USD, "Smoke: member balance");
        require(ledger.balanceOf(ops) == 2_000 * USD + 20 * USD, "Smoke: Operations balance");

        console.log("namespace        ", ns);
        console.log("portfolio vault  ", ledger.balanceOf(pfVault));
        console.log("funding vault    ", ledger.balanceOf(fundVault));
        console.log("operations       ", ledger.balanceOf(ops));
        console.log("budget           ", ledger.balanceOf(bud));
        console.log("member balance   ", ledger.memberBalance(ag, member));
        console.log("admin / member   ", admin, member);
    }

    function _id(string memory name) internal view returns (bytes32) {
        return keccak256(abi.encodePacked(ns, ":", name));
    }

    function _fund(address to, uint256 amount) internal {
        if (to.balance >= amount) return;
        (bool ok,) = payable(to).call{value: amount - to.balance}("");
        require(ok, "Smoke: gas funding failed");
    }

    function _permit(address account, bytes32 scope, ViatikLedger.Role role, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ViatikLedger"),
                keccak256("1"),
                block.chainid,
                address(ledger)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(ledger.JOIN_TYPEHASH(), account, scope, role, ledger.nonces(account), deadline));
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(investorKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }
}

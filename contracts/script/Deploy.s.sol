// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";

import {TestUSD} from "../src/TestUSD.sol";
import {ITestUSD, ViatikLedger} from "../src/ViatikLedger.sol";

/// Deploys TestUSD and ViatikLedger on Monad testnet (or a local chain).
///
///   DEPLOYER_PRIVATE_KEY=… FOUNDRY_PROFILE=monad forge script script/Deploy.s.sol \
///     --rpc-url "$MONAD_RPC_URL" --broadcast
///
/// The deployer owns the ledger. On testnet it also signs role permits (registrar) and
/// receives vendor payouts (payout sink) and runs due scheduled payments (keeper) unless
/// LEDGER_REGISTRAR / LEDGER_PAYOUT_SINK / LEDGER_KEEPER name other addresses.
contract Deploy is Script {
    uint256 internal constant MONAD_TESTNET = 10143;
    uint256 internal constant LOCAL = 31337;

    function run() external returns (TestUSD token, ViatikLedger ledger) {
        require(block.chainid == MONAD_TESTNET || block.chainid == LOCAL, "Deploy: Monad testnet or local only");
        uint256 key = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(key);
        address registrar = vm.envOr("LEDGER_REGISTRAR", deployer);
        address sink = vm.envOr("LEDGER_PAYOUT_SINK", deployer);
        address keeper = vm.envOr("LEDGER_KEEPER", deployer);

        vm.startBroadcast(key);
        token = new TestUSD();
        ledger = new ViatikLedger(ITestUSD(address(token)), registrar, sink);
        ledger.setKeeper(keeper);
        vm.stopBroadcast();

        console.log("TestUSD      ", address(token));
        console.log("ViatikLedger ", address(ledger));
        console.log("owner        ", deployer);
        console.log("registrar    ", registrar);
        console.log("payout sink  ", sink);
        console.log("keeper       ", keeper);
    }
}

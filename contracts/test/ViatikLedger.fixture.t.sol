// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LedgerFixture} from "./utils/LedgerFixture.sol";

/// Pins the shared fixture so every suite can rely on its starting balances.
contract LedgerFixtureTest is LedgerFixture {
    function setUp() public override {
        super.setUp();
        _buildSecondAgency();
    }

    function test_StoryStartsWhereTheSuitesExpect() public view {
        assertEq(ledger.balanceOf(PF_VAULT), DEPOSIT - COMMITTED);
        assertEq(ledger.balanceOf(FUND_VAULT), COMMITTED - TRANCHE_1);
        assertEq(ledger.balanceOf(OPS), TRANCHE_1 - BUDGET);
        assertEq(ledger.balanceOf(BUD), BUDGET);
        assertEq(ledger.exceptionThresholdOf(AG), EXCEPTION);
    }

    function test_SecondAgencyStartsWhereTheSuitesExpect() public view {
        assertEq(ledger.balanceOf(PF2_VAULT), 10_000 * USD);
        assertEq(ledger.balanceOf(FUND_VAULT2), 0);
        assertEq(ledger.balanceOf(OPS2), 47_000 * USD);
        assertEq(ledger.balanceOf(BUD2), 3_000 * USD);
        assertEq(ledger.exceptionThresholdOf(AG2), 4_000 * USD);
        assertEq(token.balanceOf(address(ledger)), DEPOSIT + 60_000 * USD);
    }
}

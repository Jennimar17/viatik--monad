// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

import {TestUSD} from "../src/TestUSD.sol";

contract TestUSDTest is Test {
    TestUSD internal token;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        token = new TestUSD();
    }

    function test_Metadata() public view {
        assertEq(token.name(), "Viatik Test USD");
        assertEq(token.symbol(), "vtUSD");
        assertEq(token.decimals(), 6);
        assertEq(token.totalSupply(), 0);
    }

    function test_AnyoneCanMintUpToTheCap() public {
        // Read the cap first: a prank applies to the very next call, view calls included.
        uint256 max = token.MAX_MINT();
        vm.prank(bob);
        token.mint(alice, max);
        assertEq(token.balanceOf(alice), 1_000_000e6);
        assertEq(token.totalSupply(), 1_000_000e6);
    }

    function test_RevertWhen_DeployedOnMonadMainnet() public {
        vm.chainId(143);
        vm.expectRevert(TestUSD.MainnetNotAllowed.selector);
        new TestUSD();
    }

    function test_MintEmitsTransferFromZero() public {
        vm.expectEmit(true, true, false, true, address(token));
        emit IERC20.Transfer(address(0), alice, 250e6);
        token.mint(alice, 250e6);
    }

    function test_RevertWhen_MintAboveTheCap() public {
        uint256 max = token.MAX_MINT();
        vm.expectRevert(abi.encodeWithSelector(TestUSD.MintTooLarge.selector, max + 1, max));
        token.mint(alice, max + 1);
    }

    function test_RevertWhen_MintToTheZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0)));
        token.mint(address(0), 1e6);
    }

    function test_RepeatedMintsAddUp() public {
        token.mint(alice, 1_000_000e6);
        token.mint(alice, 1_000_000e6);
        assertEq(token.balanceOf(alice), 2_000_000e6);
    }

    function test_TransferMovesBalance() public {
        token.mint(alice, 100e6);
        vm.prank(alice);
        assertTrue(token.transfer(bob, 40e6));
        assertEq(token.balanceOf(alice), 60e6);
        assertEq(token.balanceOf(bob), 40e6);
    }

    function testFuzz_AnyoneMintsWithinTheCap(address caller, address to, uint256 amount) public {
        vm.assume(to != address(0));
        amount = bound(amount, 0, token.MAX_MINT());
        vm.prank(caller);
        token.mint(to, amount);
        assertEq(token.balanceOf(to), amount);
        assertEq(token.totalSupply(), amount);
    }

    function testFuzz_RevertWhen_MintAboveTheCap(uint256 amount) public {
        amount = bound(amount, token.MAX_MINT() + 1, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(TestUSD.MintTooLarge.selector, amount, token.MAX_MINT()));
        token.mint(alice, amount);
    }
}

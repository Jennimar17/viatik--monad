// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestUSD
/// @notice Testnet stand-in for USDC on Monad: 6 decimals, and anyone can mint
/// up to `MAX_MINT` per call. It has no value and refuses to deploy on Monad
/// mainnet. ViatikLedger holds TestUSD behind every balance it records, and
/// mints to itself when someone adds funds.
contract TestUSD is ERC20 {
    /// @notice The most one `mint` call can create: 1,000,000 TestUSD.
    uint256 public constant MAX_MINT = 1_000_000e6;
    /// @notice Monad mainnet, where an open-mint "USD" must never exist.
    uint256 public constant MONAD_MAINNET = 143;

    error MintTooLarge(uint256 amount, uint256 max);
    error MainnetNotAllowed();

    constructor() ERC20("Viatik Test USD", "vtUSD") {
        if (block.chainid == MONAD_MAINNET) revert MainnetNotAllowed();
    }

    /// @notice Same as USDC, so amounts convert 1:1 (1 cent = 10_000 units).
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Open faucet for testnet: mints `amount` to `to`.
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge(amount, MAX_MINT);
        _mint(to, amount);
    }
}

import type { Address } from 'viem'

import type { MonadNetwork } from './chains'

/**
 * Onchain addresses Viatik depends on. Checked against docs.monad.xyz on
 * 2026-09-23; re-verify before a mainnet deployment.
 */
export const USDC: Record<MonadNetwork, Address> = {
  mainnet: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  testnet: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
}

export const USDC_DECIMALS = 6

/** ERC-4337 EntryPoint v0.7, same address on both networks. */
export const ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032'

export const MULTICALL3: Address = '0xcA11bde05977b3631167028862bE2a173976CA11'

/**
 * Monad's staking precompile (docs.monad.xyz, "Staking precompile"). It only accepts a
 * top-level CALL: see `src/web3/abi/monad-staking.ts`.
 */
export const STAKING_PRECOMPILE: Address = '0x0000000000000000000000000000000000001000'

/**
 * Viatik's own test stake, shown read-only on the Investor's Vaults page as a preview of how
 * rewards on idle assets would be reported. Monad Testnet only: the deployer delegated 3 MON
 * of its own test funds to validator 1. It belongs to Viatik, is never anyone's capital and is
 * never counted in a portfolio. Rewards are left unclaimed, so "unclaimed" means "since start".
 * Checked onchain on 2026-10-10.
 */
export const TEST_STAKE = {
  network: 'testnet',
  /** The deployer (Viatik's operator account on testnet). */
  delegator: '0x19F79Be75A05360af0BED0D99d9317eE3Df6D6c9',
  validatorId: 1n,
  /** `delegate(1)` with 3 MON, block 69,173,908 (2026-10-08 05:36:30 UTC). */
  delegateTx: '0xbe101daed02066da327765aeb3b98c842f319c252f4ed16f7d0b5203a8694d22',
  /** The `Delegate` event's activation epoch: the stake earns from its first block. */
  activeFromEpoch: 1385,
  activeFromBlock: 69_204_974,
  /** The timestamp of `activeFromBlock`. */
  activeFrom: '2026-10-08T08:14:43Z',
} as const satisfies {
  network: MonadNetwork
  delegator: Address
  validatorId: bigint
  delegateTx: `0x${string}`
  activeFromEpoch: number
  activeFromBlock: number
  activeFrom: string
}

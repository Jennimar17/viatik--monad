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

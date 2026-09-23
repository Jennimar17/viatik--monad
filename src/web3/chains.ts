import { monad, monadTestnet } from 'viem/chains'

import { publicEnv } from '@/lib/env'

export const chains = {
  mainnet: monad,
  testnet: monadTestnet,
} as const

export type MonadNetwork = keyof typeof chains

/** Network selected by NEXT_PUBLIC_MONAD_NETWORK (testnet by default). */
export const activeChain = chains[publicEnv.NEXT_PUBLIC_MONAD_NETWORK]

/**
 * Monad charges the full gas limit, not the gas used, so operations pad
 * estimates modestly instead of generously.
 */
export const GAS_LIMIT_MULTIPLIER = 1.15

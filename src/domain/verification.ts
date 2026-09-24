import { chains, type MonadNetwork } from '@/web3/chains'

import { pseudoAddress, pseudoHash } from './ids'
import type { ISODate, VerifiedDetails } from './types'

/**
 * Display metadata for Monad networks, derived from the chain definitions in
 * `src/web3`. Contract addresses, ABIs and RPC endpoints stay in the ledger
 * adapter; this is only what "Verified details" shows to people.
 */
export function networkInfo(network: MonadNetwork) {
  const chain = chains[network]
  return { name: chain.name, chainId: chain.id, explorer: chain.blockExplorers.default.url }
}

/** Genesis-relative block height used to derive plausible demo block numbers. */
const DEMO_BLOCK_EPOCH = Date.UTC(2026, 0, 1)
const BLOCK_TIME_MS = 400

export function simulatedVerification(input: {
  operationId: string
  account: string
  timestamp: ISODate
  contractPolicy: string
  network?: MonadNetwork
}): VerifiedDetails {
  const network = networkInfo(input.network ?? 'testnet')
  const transaction = pseudoHash(`tx:${input.operationId}`)
  const block =
    18_000_000 +
    Math.max(0, Math.floor((new Date(input.timestamp).getTime() - DEMO_BLOCK_EPOCH) / BLOCK_TIME_MS))
  return {
    status: 'confirmed',
    network: network.name,
    chainId: network.chainId,
    account: pseudoAddress(input.account),
    transaction,
    block,
    timestamp: input.timestamp,
    receiptHash: pseudoHash(`receipt:${input.operationId}:${input.timestamp}`),
    contractPolicy: input.contractPolicy,
    explorerUrl: `${network.explorer}/tx/${transaction}`,
    simulated: true,
  }
}

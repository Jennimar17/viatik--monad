/**
 * What people see about the Monad networks: name, chain id, explorer and the asset operations
 * settle in. Kept free of viem so product screens never bundle the chain registry;
 * `chains.ts` holds the viem definitions for the ledger adapter.
 */
export type MonadNetwork = 'mainnet' | 'testnet'

/** The one place that names the settlement asset; amounts are shown in USD everywhere else. */
export type SettlementAsset = {
  symbol: string
  /** The asset line of Vault asset details and network details. */
  detail: string
  /** On testnet: the asset it stands in for, one to one. */
  standsInFor?: string
}

export type NetworkInfo = { name: string; chainId: number; explorer: string; asset: SettlementAsset }

export const MONAD_NETWORKS: Record<MonadNetwork, NetworkInfo> = {
  mainnet: {
    name: 'Monad',
    chainId: 143,
    explorer: 'https://monadscan.com',
    asset: { symbol: 'USDC', detail: 'USDC (6 decimals)' },
  },
  testnet: {
    name: 'Monad Testnet',
    chainId: 10_143,
    explorer: 'https://testnet.monadvision.com',
    asset: { symbol: 'TestUSD', detail: 'TestUSD (6 decimals, no value)', standsInFor: 'USDC' },
  },
}

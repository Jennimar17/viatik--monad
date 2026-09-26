/**
 * What people see about the Monad networks: name, chain id and explorer.
 * Kept free of viem so product screens never bundle the chain registry;
 * `chains.ts` holds the viem definitions for the ledger adapter.
 */
export type MonadNetwork = 'mainnet' | 'testnet'

export type NetworkInfo = { name: string; chainId: number; explorer: string }

export const MONAD_NETWORKS: Record<MonadNetwork, NetworkInfo> = {
  mainnet: { name: 'Monad', chainId: 143, explorer: 'https://monadscan.com' },
  testnet: { name: 'Monad Testnet', chainId: 10_143, explorer: 'https://testnet.monadexplorer.com' },
}

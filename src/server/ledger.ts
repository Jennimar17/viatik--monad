import { privateKeyToAccount } from 'viem/accounts'

import { MonadLedgerAdapter } from '@/ledger/monad'
import { publicEnv, readServerEnv } from '@/lib/env'

let adapter: MonadLedgerAdapter | null | undefined

/**
 * The Monad ledger, when the deployment is configured (`VIATIK_LEDGER_ADDRESS`
 * and `MONAD_RPC_URL`); null otherwise, and operations settle on the mock.
 */
export function getMonadLedger(): MonadLedgerAdapter | null {
  if (adapter !== undefined) return adapter
  const env = readServerEnv()
  adapter =
    env.VIATIK_LEDGER_ADDRESS && env.MONAD_RPC_URL
      ? new MonadLedgerAdapter({
          network: publicEnv.NEXT_PUBLIC_MONAD_NETWORK,
          rpcUrl: env.MONAD_RPC_URL,
          ledgerAddress: env.VIATIK_LEDGER_ADDRESS,
          tokenAddress: env.TEST_USD_ADDRESS,
          deployBlock: env.LEDGER_DEPLOY_BLOCK,
          registrar: env.LEDGER_REGISTRAR_PRIVATE_KEY
            ? privateKeyToAccount(env.LEDGER_REGISTRAR_PRIVATE_KEY)
            : undefined,
        })
      : null
  return adapter
}

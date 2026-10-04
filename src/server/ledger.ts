import { isNotNull } from 'drizzle-orm'
import type { Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import type { Id } from '@/domain/types'
import { genesisContext } from '@/ledger/genesis'
import { MonadLedgerAdapter } from '@/ledger/monad'
import { decodeLedgerError } from '@/ledger/revert'
import { ledgerSnapshot } from '@/ledger/snapshot'
import type { ChainContext } from '@/ledger/types'
import { publicEnv, readServerEnv } from '@/lib/env'

import { getDb } from './db/client'
import { users, type WorldLedger } from './db/schema'
import { ApiError } from './errors'
import { readWorld, saveLedgerBalances, type DbTx } from './repository'

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

/** A world bound to Monad settles there or not at all: never on the demo ledger instead. */
export function requireMonad(): MonadLedgerAdapter {
  const monad = getMonadLedger()
  if (!monad) {
    throw new ApiError(
      503,
      'not_configured',
      'Onchain settlement is not available right now. Nothing was moved.',
    )
  }
  return monad
}

/**
 * How the world's people map to Monad: their embedded account, or the
 * placeholder its genesis gave them. Only a real account signs.
 */
export async function chainContextFor(ledger: WorldLedger, db: DbTx | ReturnType<typeof getDb> = getDb()) {
  const rows = await db
    .select({ id: users.id, wallet: users.walletAddress })
    .from(users)
    .where(isNotNull(users.walletAddress))
  // An address two people claim belongs to neither: their plans answer account_not_ready.
  const holders = new Map<string, number>()
  for (const row of rows)
    holders.set(row.wallet!.toLowerCase(), (holders.get(row.wallet!.toLowerCase()) ?? 0) + 1)
  const accounts = new Map(
    rows
      .filter((row) => holders.get(row.wallet!.toLowerCase()) === 1)
      .map((row) => [row.id, row.wallet as Address]),
  )
  return genesisContext(ledger.namespace, (userId: Id) => accounts.get(userId), ledger.placeholders)
}

/**
 * Reads every balance of the world from Monad at the block a transaction
 * landed in and keeps it with the world, for the Ledger panel to compare with
 * the app. Best effort: a failed read is only logged.
 */
export async function saveBalancesAfter(
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  block: number,
  requestId: string,
) {
  try {
    const { state } = await readWorld()
    const snapshot = ledgerSnapshot(state)
    const of = (kind: string) => [...snapshot.places].filter(([, p]) => p.kind === kind).map(([id]) => id)
    const balances = await monad.readBalances({
      accountIds: of('account'),
      budgetIds: of('budget'),
      vaultIds: [...of('portfolio_vault'), ...of('funding_vault')],
      members: [...snapshot.members.keys()].map((key) => {
        const [agencyId, userId] = key.split('|') as [Id, Id]
        return { agencyId, userId }
      }),
      chain,
      block,
    })
    await saveLedgerBalances(balances, chain.namespace)
  } catch (error) {
    // The short message only: viem's full error repeats the RPC URL, which may carry a provider key.
    console.error(`[api] ${requestId} ledger balances: ${decodeLedgerError(error).raw}`)
  }
}

import { randomBytes, timingSafeEqual } from 'node:crypto'

import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Address } from 'viem'

import { createDemoState } from '@/domain/fixtures'
import type { Id } from '@/domain/types'
import { buildGenesis, GenesisError } from '@/ledger/genesis'
import { readServerEnv } from '@/lib/env'

import type { AppEnv } from './context'
import { getDb } from './db/client'
import { operations, users, type WorldLedger } from './db/schema'
import { ApiError } from './errors'
import { chainContextFor, getMonadLedger, saveBalancesAfter } from './ledger'
import { resetWorld, withWorld } from './repository'

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * A fresh epoch of ledger ids: unguessable, so nobody can take a seeded id
 * before the genesis lands, and within the contract's 32 bytes.
 */
const newNamespace = () => `s-${Date.now().toString(36)}-${randomBytes(6).toString('hex')}`

/**
 * `POST /v1/admin/seed`: restores the demo story for everyone (before
 * recording the video, or after a judge's session). Needs ADMIN_SEED_TOKEN in
 * the `x-admin-token` header; without that variable the route does not exist.
 * Real accounts keep their sign-in, but workspaces created since are gone.
 *
 * With the Monad ledger configured, the story is imported into ViatikLedger
 * first (a genesis under a new namespace, in one transaction) and the world is
 * bound to it; only then is the state replaced, so a failed genesis leaves
 * Viatik as it was. The people `DEMO_ACCOUNTS` binds (Elena, Maya, Alex) must
 * have signed in once, so the genesis gives them their own accounts: a
 * placeholder would hold their roles for good (the contract cannot move them
 * later). `?ledger=off` seeds on the demo ledger instead.
 */
export const admin = new Hono<AppEnv>().post('/seed', async (c) => {
  const env = readServerEnv()
  const expected = env.ADMIN_SEED_TOKEN
  if (!expected) throw new ApiError(404, 'not_found', 'This endpoint does not exist.')
  if (!sameSecret(c.req.header('x-admin-token') ?? '', expected)) {
    throw new ApiError(401, 'unauthenticated', 'A valid admin token is required.')
  }

  const state = createDemoState(new Date().toISOString())
  const monad = c.req.query('ledger') === 'off' ? null : getMonadLedger()
  let ledger: WorldLedger | null = null
  let genesisBlock = 0
  if (monad) {
    // The accounts of the story's people who signed in; everyone else gets a placeholder.
    const ids = state.users.map((u) => u.id)
    const rows = await getDb()
      .select({ id: users.id, wallet: users.walletAddress })
      .from(users)
      .where(inArray(users.id, ids))
    const accounts: Record<Id, Address> = {}
    for (const row of rows) if (row.wallet) accounts[row.id] = row.wallet as Address
    // Each person DEMO_ACCOUNTS binds must be in the story and have signed in under their story id.
    const problems: string[] = []
    for (const [email, userId] of Object.entries(env.DEMO_ACCOUNTS)) {
      if (accounts[userId]) continue
      const person = state.users.find((u) => u.id === userId)
      if (!person) {
        problems.push(`DEMO_ACCOUNTS binds ${userId}, who is not in the demo story`)
        continue
      }
      const [earlier] = await getDb()
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email}`, ne(users.id, userId)))
        .limit(1)
      problems.push(
        earlier
          ? `${person.name}'s email signed in before it was bound (account ${earlier.id}): delete that account, then sign in again`
          : `${person.name} must sign in once, so the roles on Monad go to their own account`,
      )
    }
    if (problems.length > 0)
      throw new ApiError(409, 'accounts_missing', `Not seeded yet. ${problems.join('. ')}.`)

    const namespace = newNamespace()
    let genesis
    try {
      genesis = buildGenesis(state, namespace, (userId) => accounts[userId])
    } catch (error) {
      if (!(error instanceof GenesisError)) throw error
      throw new ApiError(
        500,
        'genesis_invalid',
        `The demo story cannot be imported: ${error.problems.join('; ')}`,
      )
    }
    // Well inside the route's 60 s, so a slow receipt is answered with its hash rather than cut off.
    const run = await monad.runGenesis(genesis, { receiptTimeoutMs: 30_000 })
    if (run.status === 'failed') {
      throw new ApiError(
        502,
        'genesis_failed',
        `The genesis stopped at "${run.failedAt}" (${run.problem}). Viatik was not reset.`,
      )
    }
    genesisBlock = Math.max(0, ...run.transactions.map((t) => t.block ?? 0))
    ledger = {
      namespace,
      placeholders: genesis.placeholders,
      accounts,
      genesis: { at: new Date().toISOString(), transactions: run.transactions.map((t) => t.hash) },
    }
  }

  try {
    await withWorld(async (_world, tx) => {
      await resetWorld(tx, { state, ledger })
      // Replays would answer with results from the old story. Refusals and divergences stay (the
      // review trail), and operations still open are closed with the reason, so a device confirming
      // one is told why.
      await tx.delete(operations).where(eq(operations.status, 'done'))
      await tx
        .update(operations)
        .set({
          status: 'failed',
          statusCode: 409,
          response: {
            error: {
              code: 'invalid_state',
              message: 'Viatik was reset after this was prepared. It no longer applies.',
            },
          },
        })
        .where(inArray(operations.status, ['pending', 'expired']))
      return { state: null, result: null }
    })
  } catch (error) {
    if (!ledger) throw error
    // The genesis landed but the switch did not: Viatik is unchanged, and seeding again is safe.
    console.error(
      `[api] ${c.get('requestId')} seed not saved after genesis ${ledger.namespace}`,
      ledger.genesis,
    )
    throw new ApiError(
      500,
      'seed_not_saved',
      `The genesis landed (namespace ${ledger.namespace}, ${ledger.genesis?.transactions.join(', ')}) but Viatik could not switch to it. Viatik is unchanged: run the seed again.`,
    )
  }
  // The first read of Monad's balances, so screens show them verified from the start (best effort:
  // the seed is done either way, and the Ledger panel can read them again).
  if (monad && ledger) {
    const chain = await chainContextFor(ledger).catch(() => null)
    if (chain) await saveBalancesAfter(monad, chain, genesisBlock, c.get('requestId'))
  }
  return c.json({
    status: 'seeded',
    ledger: ledger ? 'monad' : 'demo',
    namespace: ledger?.namespace ?? null,
    transactions: ledger?.genesis?.transactions ?? [],
  })
})

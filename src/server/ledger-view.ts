import { and, count, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { Hono } from 'hono'
import { getAddress, isAddress, type Address } from 'viem'

import type { LedgerAccount, LedgerLocationKind, LedgerView, NetworkYield } from '@/data/api-contract'
import type { Id, ViatikState } from '@/domain/types'
import { scopeStateForUser } from '@/domain/visibility'
import { needsReseed } from '@/ledger/genesis'
import { ledgerId } from '@/ledger/ids'
import { decodeLedgerError } from '@/ledger/revert'
import { ledgerSnapshot } from '@/ledger/snapshot'
import {
  commissionPercent,
  createStakingClient,
  readTestStake,
  type StakingClient,
  type TestStakeRead,
} from '@/ledger/staking'
import type { Balances, PreparedTx } from '@/ledger/types'
import { unitsToCents } from '@/ledger/units'
import { publicEnv, readServerEnv } from '@/lib/env'
import { withTimeout } from '@/lib/timeout'
import { TEST_STAKE } from '@/web3/addresses'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { operations, users, type UserRow, type WorldLedger } from './db/schema'
import { ApiError } from './errors'
import { chainContextFor, getMonadLedger, refreshBalances, requireMonad } from './ledger'
import { readWorld, type World } from './repository'
import { requireUser } from './user'

const noStore = { 'cache-control': 'no-store' }

/**
 * What one press of "Get test funds" mints: 1,000,000 TestUSD, exactly TestUSD.MAX_MINT
 * (contracts/src/TestUSD.sol:13); more in one call reverts. The client mints
 * `testFunds * 10_000` units, so never raise this above 100_000_000.
 */
const TEST_FUNDS_CENTS = 100_000_000
const ACCOUNT_READ_MS = 5_000

/** Token units in cents; an unlimited approval is shown as the largest safe number. */
function safeCents(units: bigint): number {
  try {
    return unitsToCents(units).cents
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}

/** Each read of Monad is one multicall on a public RPC: one every few seconds is plenty. */
const REFRESH_EVERY_MS = 10_000
/** How long a GET waits for a read when the last one is for an older state. */
const STALE_READ_WAIT_MS = 4_000

let lastRefresh = 0
let refreshing: Promise<void> | null = null

/**
 * Reads Monad's balances again, unless a read started moments ago. A read
 * already running is shared, so a second caller gets its result too.
 */
function refreshOnce(ledger: WorldLedger): Promise<void> {
  if (refreshing) return refreshing
  if (Date.now() - lastRefresh < REFRESH_EVERY_MS) return Promise.resolve()
  const monad = requireMonad()
  const started = Date.now()
  lastRefresh = started
  refreshing = (async () => {
    try {
      await refreshBalances(monad, await chainContextFor(ledger))
    } catch (error) {
      // A failed read does not hold the next one back (unless a newer read started since).
      if (lastRefresh === started) lastRefresh = 0
      throw error
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

const chainBalance = (balances: Balances, kind: LedgerLocationKind, id: string) => {
  const of = kind === 'account' ? balances.accounts : kind === 'budget' ? balances.budgets : balances.vaults
  return of[id] ?? null
}

/**
 * Agencies whose every movement the caller sees, as their Investor or their
 * Admin (as `scopeStateForUser` decides). Elsewhere a Member sees only their
 * own records, so only their own balance there.
 */
function fullyVisibleAgencies(state: ViatikState, userId: Id): Set<Id> {
  const mine = state.memberships.filter((m) => m.userId === userId && m.status === 'active')
  const portfolios = new Set(mine.flatMap((m) => (m.scope.kind === 'portfolio' ? [m.scope.portfolioId] : [])))
  return new Set([
    ...state.agencies.filter((a) => portfolios.has(a.portfolioId)).map((a) => a.id),
    ...mine.flatMap((m) =>
      m.role === 'agency_admin' && m.scope.kind === 'agency' ? [m.scope.agencyId] : [],
    ),
  ])
}

/**
 * What a flagged operation moved: the sum of its records, leaving out a
 * request's pending record when the same transaction also paid or refused it.
 */
function amountOf(prepared: PreparedTx | null): number | null {
  const records = prepared?.records ?? []
  if (records.length === 0) return null
  const settled = records.filter((record) => record.kind !== 'payment_pending')
  return (settled.length > 0 ? settled : records).reduce((sum, record) => sum + record.amount, 0)
}

/** What the Ledger panel and the balance checks show the caller, from the last read of Monad. */
async function ledgerViewFor(world: World, user: UserRow): Promise<LedgerView> {
  const ledger = world.ledger
  if (!ledger) return { settlement: 'demo' }
  const monad = getMonadLedger()
  const visible = scopeStateForUser(world.state, user.id)
  const snapshot = ledgerSnapshot(visible)
  const balances = ledger.balances
  const inexact = new Set(balances?.inexact ?? [])
  const full = fullyVisibleAgencies(world.state, user.id)

  const locations = [...snapshot.places].map(([id, place]) => ({
    id,
    kind: place.kind,
    ledgerId: ledgerId(ledger.namespace, id),
    chain: balances ? chainBalance(balances, place.kind, id) : null,
    ...(inexact.has(id) ? { inexact: true as const } : {}),
  }))
  const members = [...snapshot.members.keys()].flatMap((key) => {
    const [agencyId, userId] = key.split('|') as [Id, Id]
    if (userId !== user.id && !full.has(agencyId)) return []
    return [
      {
        agencyId,
        userId,
        chain: balances?.members[agencyId]?.[userId] ?? null,
        ...(inexact.has(key) ? { inexact: true as const } : {}),
      },
    ]
  })

  const db = getDb()
  const [flagged, [open], wallets] = await Promise.all([
    db
      .select({
        key: operations.idempotencyKey,
        command: operations.command,
        txHash: operations.txHash,
        createdAt: operations.createdAt,
        prepared: operations.prepared,
      })
      .from(operations)
      .where(and(eq(operations.userId, user.id), eq(operations.status, 'diverged')))
      .orderBy(desc(operations.createdAt))
      .limit(20),
    // Waiting for Monad: prepared and not settled. An expired one was never found (or never signed).
    db
      .select({ value: count() })
      .from(operations)
      .where(and(eq(operations.userId, user.id), eq(operations.status, 'pending'))),
    db
      .select({ id: users.id, wallet: users.walletAddress })
      .from(users)
      .where(
        and(
          inArray(
            users.id,
            // Name-only records (a Member's view of their Admins and Investors) carry no account details.
            visible.users.filter((u) => u.email !== '').map((u) => u.id),
          ),
          isNotNull(users.walletAddress),
        ),
      ),
  ])

  return {
    settlement: 'monad',
    available: Boolean(monad?.isConfigured),
    contract: monad?.address ?? null,
    token: monad?.tokenAddress ?? null,
    namespace: ledger.namespace,
    genesis: ledger.genesis
      ? { at: ledger.genesis.at, transactions: ledger.genesis.transactions as `0x${string}`[] }
      : null,
    balances: balances ? { block: balances.block ?? null, readAt: balances.readAt } : null,
    locations,
    members,
    diverged: flagged.map((row) => {
      const prepared = row.prepared as PreparedTx | null
      return {
        key: row.key,
        command: row.command,
        txHash: (row.txHash as `0x${string}` | null) ?? null,
        at: row.createdAt.toISOString(),
        amount: amountOf(prepared),
        earlierReset: Boolean(prepared && prepared.namespace !== ledger.namespace),
      }
    }),
    open: open?.value ?? 0,
    needsReseed: wallets
      .filter((row) => needsReseed(row.id, row.wallet as Address, ledger.placeholders, ledger.accounts))
      .map((row) => row.id),
  }
}

// ─── Network yield preview ───────────────────────────────────────────────────

/** A read of the test stake is fresh for a minute: rewards move slowly and the route is public. */
const YIELD_FRESH_MS = 60_000
/** While the network cannot be read, the last read is still served (marked stale) for this long. */
const YIELD_STALE_MS = 15 * 60_000
/** After a failed read, the next one waits this long, so an outage is not hammered. */
const YIELD_RETRY_MS = 15_000
/** One read in all; the client already gives each RPC call 5 s and one retry. */
const YIELD_READ_MS = 8_000
/** How long the CDN keeps an answer once its own copy is old, while it asks again. */
const YIELD_CDN_SWR_S = 240

type YieldRead = Extract<NetworkYield, { available: true }>
const YIELD_UNAVAILABLE: NetworkYield = { available: false }

let stakingClient: StakingClient | null = null
let yieldLast: { at: number; value: YieldRead } | null = null
let yieldFailedAt = 0
let yieldReading: Promise<void> | null = null

function toNetworkYield(read: TestStakeRead, readAt: number): YieldRead {
  return {
    available: true,
    chainId: read.chainId,
    validatorId: Number(read.validatorId),
    delegator: read.delegator,
    stakeWei: read.stake.toString(),
    pendingStakeWei: read.pendingStake.toString(),
    pendingEpoch: read.pendingEpoch === null ? null : Number(read.pendingEpoch),
    rewardsWei: read.rewards.toString(),
    epoch: Number(read.epoch),
    inEpochDelayPeriod: read.inEpochDelayPeriod,
    validator: {
      active: read.validator.active,
      commissionPct: commissionPercent(read.validator.commission),
      stakeWei: read.validator.stake.toString(),
    },
    activeFrom: { epoch: read.activeFromEpoch, at: new Date(read.activeFrom).toISOString() },
    delegateTx: read.delegateTx,
    block: Number(read.block),
    blockAt: new Date(Number(read.blockTime) * 1000).toISOString(),
    readAt: new Date(readAt).toISOString(),
  }
}

/**
 * Reads the test stake again, on `MONAD_RPC_URL` (the public RPC when unset). A read already
 * running is shared, and after a failure the next one waits a little. Never throws.
 */
function readYieldOnce(requestId: string): Promise<void> {
  if (yieldReading) return yieldReading
  if (Date.now() - yieldFailedAt < YIELD_RETRY_MS) return Promise.resolve()
  yieldReading = (async () => {
    try {
      stakingClient ??= createStakingClient(readServerEnv().MONAD_RPC_URL)
      const read = await withTimeout(readTestStake(stakingClient), YIELD_READ_MS)
      yieldLast = { at: Date.now(), value: toNetworkYield(read, Date.now()) }
      yieldFailedAt = 0
    } catch (error) {
      yieldFailedAt = Date.now()
      // The short message only: viem's full error repeats the RPC URL, which may carry a provider key.
      console.error(`[api] ${requestId} yield read: ${decodeLedgerError(error).raw}`)
    } finally {
      yieldReading = null
    }
  })()
  return yieldReading
}

/** The test stake to answer with, and how long a shared cache may keep that answer (seconds). */
async function networkYield(requestId: string): Promise<{ body: NetworkYield; maxAge: number }> {
  // Testnet only: on mainnet there is no test stake, and nothing is read.
  if (publicEnv.NEXT_PUBLIC_MONAD_NETWORK !== TEST_STAKE.network)
    return { body: YIELD_UNAVAILABLE, maxAge: 300 }
  if (!yieldLast || Date.now() - yieldLast.at >= YIELD_FRESH_MS) await readYieldOnce(requestId)
  if (!yieldLast) return { body: YIELD_UNAVAILABLE, maxAge: YIELD_RETRY_MS / 1000 }
  const age = Date.now() - yieldLast.at
  if (age < YIELD_FRESH_MS)
    return { body: yieldLast.value, maxAge: Math.max(1, Math.ceil((YIELD_FRESH_MS - age) / 1000)) }
  if (age < YIELD_STALE_MS)
    return { body: { ...yieldLast.value, stale: true }, maxAge: YIELD_RETRY_MS / 1000 }
  return { body: YIELD_UNAVAILABLE, maxAge: YIELD_RETRY_MS / 1000 }
}

/**
 * `GET /v1/ledger`: where the caller's workspaces settle, and Monad's balances
 * at the last read for what the caller may see. When that read is for an
 * older state (an operation's own read failed, or was cut short), it reads
 * again first, briefly. `POST /v1/ledger/refresh` always reads again (at most
 * once every few seconds for everyone).
 */
export const ledgerView = new Hono<AppEnv>()
  .get('/', requireAccount, requireUser, async (c) => {
    let world = await readWorld()
    if (world.ledger && world.ledger.balances?.version !== world.version && getMonadLedger()?.isConfigured) {
      try {
        await withTimeout(refreshOnce(world.ledger), STALE_READ_WAIT_MS)
        world = await readWorld()
      } catch (error) {
        // The short message only: viem's full error repeats the RPC URL, which may carry a provider key.
        console.error(`[api] ${c.get('requestId')} ledger read: ${decodeLedgerError(error).raw}`)
      }
    }
    return c.json(await ledgerViewFor(world, c.get('user')), 200, noStore)
  })
  // The person's own account: TestUSD held and allowed to the ledger, read live (no cache: it
  // changes with every press of "Get test funds" and every approval).
  .get('/account', requireAccount, requireUser, async (c) => {
    const monad = getMonadLedger()
    const wallet = c.get('user').walletAddress
    const none: LedgerAccount = { available: false }
    if (!monad?.isConfigured || !monad.address || !wallet || !isAddress(wallet, { strict: false }))
      return c.json(none, 200, noStore)
    try {
      const address = getAddress(wallet)
      const read = await withTimeout(monad.readAccount(address), ACCOUNT_READ_MS)
      const account: LedgerAccount = {
        available: true,
        address,
        token: read.token,
        ledger: monad.address,
        balance: safeCents(read.balance),
        allowance: safeCents(read.allowance),
        testFunds: TEST_FUNDS_CENTS,
      }
      return c.json(account, 200, noStore)
    } catch (error) {
      console.error(`[api] ${c.get('requestId')} account read: ${decodeLedgerError(error).raw}`)
      throw new ApiError(
        503,
        'network_unavailable',
        'Monad could not be read right now. Try again in a moment.',
      )
    }
  })
  // Viatik's own test stake on Monad Testnet: public chain data about nobody's account, so no
  // sign-in, and the CDN may keep it for everyone (requests without Authorization). Never an error:
  // `available: false` when it cannot be read and no recent read is left.
  .get('/yield', async (c) => {
    const { body, maxAge } = await networkYield(c.get('requestId'))
    const swr = body.available && !body.stale ? `, stale-while-revalidate=${YIELD_CDN_SWR_S}` : ''
    return c.json(body, 200, { 'cache-control': `public, s-maxage=${maxAge}${swr}` })
  })
  .post('/refresh', requireAccount, requireUser, async (c) => {
    const world = await readWorld()
    if (world.ledger) {
      try {
        await refreshOnce(world.ledger)
      } catch (error) {
        if (error instanceof ApiError) throw error
        console.error(`[api] ${c.get('requestId')} ledger refresh: ${decodeLedgerError(error).raw}`)
        throw new ApiError(
          503,
          'network_unavailable',
          'Monad could not be read right now. Try again in a moment.',
        )
      }
    }
    return c.json(await ledgerViewFor(await readWorld(), c.get('user')), 200, noStore)
  })

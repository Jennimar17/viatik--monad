import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { and, eq, gt, inArray, isNotNull, like, lte, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Address, Hex } from 'viem'
import { z } from 'zod'

import { canonical } from '@/data/canonical'
import {
  bump,
  failureOf,
  keeperRunSeed,
  keeperTotals,
  noteFailure,
  noteReminders,
  runDueOnMock,
  runRowReplaceable,
  SYSTEM,
  type KeeperDone,
  type KeeperRunAnswer,
} from '@/data/keeper'
import { applySettlement, planSettlement } from '@/data/settlement'
import { DomainError, execute } from '@/domain/engine'
import { runScheduledPayment } from '@/domain/engine/system'
import { can, subjectFor } from '@/domain/permissions'
import {
  dueSchedules,
  nextRunNumber,
  recordKeeperPass,
  scheduleRunPaymentId,
  type KeeperCounts,
} from '@/domain/schedules'
import type { Id, ISODate, KeeperRun, Schedule, ViatikState } from '@/domain/types'
import type { LedgerSchedule, MonadLedgerAdapter } from '@/ledger/monad'
import type { ChainContext, ConfirmedTx, LedgerError, PreparedTx, SettlementPlan } from '@/ledger/types'
import { readServerEnv } from '@/lib/env'

import { requireAccount } from './auth'
import { operationHolding, releasedOverdue } from './commands'
import { heldByOperation } from './conflicts'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { operations, type OperationRow, type OperationStatus, type WorldLedger } from './db/schema'
import { ApiError } from './errors'
import { chainContextFor, requireMonad, saveBalancesAfter } from './ledger'
import { readWorld, saveKeeperQuietly, withWorld, type DbTx } from './repository'
import { requireUser } from './user'

/**
 * The keeper: pays scheduled payments when they are due, on Monad, and tells
 * Agency Admins about monthly payments on their due day.
 *
 * Triggers:
 * - `POST /v1/keeper/run`, every 10 minutes from Supabase Cron (pg_cron + pg_net,
 *   scripts/keeper-cron.sql) with KEEPER_TRIGGER_TOKEN in `x-keeper-token`:
 *   everything due, in every Agency. Without that variable the route does not exist.
 * - `POST /v1/keeper/run-now` `{ agencyId }`: an Agency Admin presses "Run due
 *   payments" (`send_payment` in that Agency); that Agency's due runs and
 *   reminders only, at most once every 30 seconds (15 after a press that failed).
 *
 * One pass at a time, under a lease (a row of the `operations` table: no schema
 * change), so two triggers never send from the keeper's account together (one
 * nonce). The lease is renewed while the pass works, and again before each run
 * is stored and sent: a pass that lost it sends nothing more. A pass works for
 * about 20 seconds and sends one transaction at a
 * time; what it leaves is picked up by the next one. For each due run it reads
 * the ledger's schedule (the truth: due, active, which run), skips a schedule
 * someone's operation is about to change, runs the engine on a snapshot, has
 * the plan simulated as the keeper, stores the run as an open operation of
 * `system:keeper` before sending (so a crash leaves a trace: the next pass
 * recovers it by its hash, or by `processed()` and the logs), sends it, waits
 * a few seconds for its receipt and applies it under the state lock, running
 * the engine again on the latest state with the same time and ids. A run the
 * app's rules or the ledger refuse moves nothing and stays due: it is noted
 * once per run ("Needs attention") and tried again on every pass.
 *
 * Monthly reminders and the pass's record do not depend on the payments: they
 * are written even when Monad cannot be used (`finishPass`). A pass that
 * changed nothing is recorded without a new state version (at most an hour
 * apart it is saved the normal way), so idle passes do not make every open
 * screen read the whole state again every 10 minutes.
 *
 * On a world settled on the demo ledger the same pass runs offchain
 * (`runDueOnMock`). Each pass is recorded on the state (`state.keeper`), so
 * screens can say when it last ran and what it did.
 */

/** The keeper's rows in `operations`: its lease, and each run it sends. */
export const KEEPER_USER = 'system:keeper'
const LEASE_KEY = 'lease'
const RUN_COMMAND = 'keeper:runScheduledPayment'
/** Longer than a function may live (`maxDuration` 60 s): a killed pass frees it on its own. */
const LEASE_SECONDS = 90
/** How often a holder renews its lease while it works (well inside LEASE_SECONDS). */
const LEASE_RENEW_MS = 30_000
/** How long one pass works; cron-job style triggers time out at 30 s, pg_net as configured. */
const PASS_BUDGET_MS = 20_000
/** A new run starts only with this much time left (prepare, send and a short wait for the receipt). */
const RUN_NEEDS_MS = 9_000
/** How long a pass waits for a run's receipt before leaving it to the next pass. */
const RECEIPT_WAIT_MS = 8_000
/** Runs one pass sends at most (one per schedule: the ledger pays a late schedule's missed dates one by one). */
const RUNS_PER_PASS = 5
/** A run stored with no hash, not claimed on the ledger after this, was never sent. */
const UNSENT_AFTER_MS = 2 * 60 * 1000
/** A stored hash Monad has never heard of after this is dropped (the logs are searched instead). */
const UNKNOWN_HASH_MS = 2 * 60 * 1000
/** "Run due payments" at most this often per Agency. */
const MANUAL_COOLDOWN_MS = 30_000
/** After a press that failed, the next one for that Agency waits this long. */
const FAILED_COOLDOWN_SECONDS = 15
/**
 * A pass that changed nothing is kept without a new state version, unless the
 * state was last saved with one longer ago than this: then it is saved the
 * normal way, so open screens still see the timer run (AUTOMATIC_RUNS_LAPSE_MS).
 */
const IDLE_SAVE_MS = 60 * 60 * 1000
/** Below this the keeper cannot pay the gas of a run: nothing is sent. */
const MIN_GAS_WEI = 5n * 10n ** 16n
/** Below this a warning is logged (Monad keeps a reserve; runs cost about 0.016 MON). */
const LOW_GAS_WEI = 11n * 10n ** 18n
/** How long a keeper check is trusted. */
const KEEPER_CHECK_MS = 5 * 60 * 1000
const OPEN: OperationStatus[] = ['pending', 'expired']
const KEY_TTL_MS = 24 * 60 * 60 * 1000

const noStore = { 'cache-control': 'no-store' }

type Landed = Extract<ConfirmedTx, { status: 'confirmed' }>
type Trigger = { kind: 'automatic' } | { kind: 'manual'; agencyId: Id; userId: Id }

/** What a stored run carries, to run the engine again exactly as it was prepared. */
type RunInput = { scheduleId: Id; run: number; dueAt: ISODate; now: ISODate; agencyId: Id }

/** One pass: its budget and what it did, per Agency. */
type Pass = {
  trigger: Trigger
  at: ISODate
  deadline: number
  requestId: string
  /** Who holds the lease for this pass. */
  holder: string
  /** The lease was lost (it expired and another holder took it): nothing more is sent. */
  leaseLost: boolean
  counts: Map<Id, KeeperCounts>
  /** Runs sent by an earlier pass that this one recorded, per Agency. */
  recovered: Map<Id, number>
  more: boolean
  landedBlocks: number[]
  /** This pass changed the state (a run recorded, a failure noted). */
  wrote: boolean
  /** Monad could not be used before due runs were looked at: they count as waiting. */
  paymentsSkipped: boolean
}

const timeLeft = (pass: Pass) => pass.deadline - Date.now()

/** When a lease taken now ends, by the database's clock (a constant: nothing user-given in it). */
const LEASE_ENDS = sql.raw(`now() + interval '${LEASE_SECONDS} seconds'`)

// ─── The lease ───────────────────────────────────────────────────────────────

/**
 * Takes the keeper's lease if it is free (or expired): one conditional upsert
 * on its `operations` row, timed by the database. Returns whether `holder`
 * holds it now. The admin seed takes it too: the genesis signs with the same key.
 */
export async function takeKeeperLease(holder: string): Promise<boolean> {
  const rows = await getDb()
    .insert(operations)
    .values({
      userId: KEEPER_USER,
      idempotencyKey: LEASE_KEY,
      command: 'keeper:lease',
      fingerprint: holder,
      status: 'done',
      statusCode: 200,
      response: { lease: true },
      expiresAt: LEASE_ENDS,
    })
    .onConflictDoUpdate({
      target: [operations.userId, operations.idempotencyKey],
      set: {
        fingerprint: holder,
        createdAt: sql`now()`,
        expiresAt: LEASE_ENDS,
      },
      setWhere: lte(operations.expiresAt, sql`now()`),
    })
    .returning({ fingerprint: operations.fingerprint })
  return rows[0]?.fingerprint === holder
}

/**
 * Extends the lease `holder` still holds by another LEASE_SECONDS. False when
 * it no longer holds it (it expired, and another pass or the seed took it):
 * the holder must not send anything more from the keeper's account.
 */
export async function renewKeeperLease(holder: string): Promise<boolean> {
  const rows = await getDb()
    .update(operations)
    .set({ expiresAt: LEASE_ENDS })
    .where(
      and(
        eq(operations.userId, KEEPER_USER),
        eq(operations.idempotencyKey, LEASE_KEY),
        eq(operations.fingerprint, holder),
        gt(operations.expiresAt, sql`now()`),
      ),
    )
    .returning({ fingerprint: operations.fingerprint })
  return rows.length > 0
}

/**
 * Renews `holder`'s lease every LEASE_RENEW_MS while long work runs (a pass, the
 * admin seed's genesis). Returns the function that stops it.
 */
export function keepKeeperLease(holder: string, requestId: string): () => void {
  const timer = setInterval(() => {
    renewKeeperLease(holder)
      .then((held) => {
        if (!held) console.error(`[api] ${requestId} keeper lease: lost while working`)
      })
      .catch((error: unknown) =>
        console.error(`[api] ${requestId} keeper lease: ${error instanceof Error ? error.message : error}`),
      )
  }, LEASE_RENEW_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** Frees the lease, if `holder` still holds it. */
export async function releaseKeeperLease(holder: string): Promise<void> {
  await getDb()
    .update(operations)
    .set({ expiresAt: sql`now()` })
    .where(
      and(
        eq(operations.userId, KEEPER_USER),
        eq(operations.idempotencyKey, LEASE_KEY),
        eq(operations.fingerprint, holder),
      ),
    )
}

export const newLeaseHolder = () => randomBytes(12).toString('hex')

// ─── A pass ──────────────────────────────────────────────────────────────────

/** Runs one keeper pass, or answers `busy` when another one holds the lease. */
export async function runKeeper(trigger: Trigger, requestId: string): Promise<KeeperRunAnswer> {
  const holder = newLeaseHolder()
  if (!(await takeKeeperLease(holder))) return { status: 'busy' }
  const stopRenewing = keepKeeperLease(holder, requestId)
  try {
    const world = await readWorld()
    const pass: Pass = {
      trigger,
      at: new Date().toISOString(),
      deadline: Date.now() + PASS_BUDGET_MS,
      requestId,
      holder,
      leaseLost: false,
      counts: new Map(),
      recovered: new Map(),
      more: false,
      landedBlocks: [],
      wrote: false,
      paymentsSkipped: false,
    }
    if (!world.ledger) return await passOnMock(pass)
    return await passOnMonad(pass, world.ledger)
  } finally {
    stopRenewing()
    await releaseKeeperLease(holder).catch((error: unknown) =>
      console.error(`[api] ${requestId} keeper lease: ${error instanceof Error ? error.message : error}`),
    )
  }
}

/**
 * A world on the demo ledger: the same pass, offchain, saved at once (an
 * automatic one that changed nothing without a new version, as on Monad).
 */
function passOnMock(pass: Pass): Promise<KeeperRunAnswer> {
  const manual = pass.trigger.kind === 'manual' ? pass.trigger : null
  return withWorld(async (world, db) => {
    const { state, answer, changed } = await runDueOnMock(world.state, {
      now: pass.at,
      trigger: pass.trigger.kind,
      agencyId: manual?.agencyId,
      by: manual?.userId,
    })
    if (!manual && !changed && state.keeper && (await saveKeeperQuietly(db, state.keeper, IDLE_SAVE_MS)))
      return { state: null, result: answer }
    return { state, result: answer }
  })
}

let keeperChecked: { at: number; keeper: Address } | null = null

/** The keeper key is the ledger's `keeper()`, checked at most every few minutes. */
async function requireKeeper(monad: MonadLedgerAdapter, requestId: string): Promise<Address> {
  if (keeperChecked && Date.now() - keeperChecked.at < KEEPER_CHECK_MS) return keeperChecked.keeper
  const check = await monad.checkKeeper()
  if (!check.ok) {
    console.error(`[api] ${requestId} keeper: ${check.problem}`)
    throw new ApiError(
      503,
      'keeper_unavailable',
      'Scheduled payments cannot run right now. Nothing was paid.',
    )
  }
  keeperChecked = { at: Date.now(), keeper: check.keeper }
  return check.keeper
}

/**
 * The pass on Monad: runs sent earlier, then due runs, then (whatever became of
 * those: Monad down, the keeper key wrong, an RPC error) the monthly reminders
 * and the pass's record. An error in the payment part is answered after that.
 */
async function passOnMonad(pass: Pass, ledger: WorldLedger): Promise<KeeperRunAnswer> {
  let failure: { error: unknown } | null = null
  let landedOn: { monad: MonadLedgerAdapter; chain: ChainContext } | null = null
  let reachedRuns = false
  try {
    const monad = requireMonad()
    const keeper = await requireKeeper(monad, pass.requestId)
    const chain = await chainContextFor(ledger)
    landedOn = { monad, chain }
    await recoverRuns(pass, monad, chain, ledger, keeper)
    reachedRuns = true
    await runDue(pass, monad, chain, ledger, keeper)
  } catch (error) {
    failure = { error }
    console.error(`[api] ${pass.requestId} keeper payments: ${messageOf(error)}`)
    if (!reachedRuns) pass.paymentsSkipped = true
  }
  const answer = await finishPass(pass)
  if (landedOn && pass.landedBlocks.length > 0)
    await saveBalancesAfter(landedOn.monad, landedOn.chain, Math.max(...pass.landedBlocks), pass.requestId)
  if (failure) throw failure.error
  return answer
}

/**
 * Tells today's monthly reminders and records the pass on the state, in one
 * write. The answer counts the Agencies the pass was run for only (a manual
 * pass is one Agency's, even when it recovered another's run). An automatic
 * pass that changed nothing is kept without a new state version
 * (`saveKeeperQuietly`), unless the last versioned save is IDLE_SAVE_MS old.
 */
function finishPass(pass: Pass): Promise<KeeperDone> {
  const manual = pass.trigger.kind === 'manual' ? pass.trigger : null
  return withWorld(async (world, db) => {
    const now = new Date().toISOString()
    if (pass.paymentsSkipped) {
      // Monad could not be used: what is due waits for the next pass.
      for (const schedule of dueSchedules(world.state, now, manual?.agencyId))
        bump(pass.counts, schedule.agencyId, 'waiting')
      pass.more = true
    }
    const state = noteReminders(world.state, now, pass.counts, manual?.agencyId)
    const changed = pass.wrote || state !== world.state
    const agencyIds = manual ? [manual.agencyId] : state.agencies.map((a) => a.id)
    recordKeeperPass(
      state,
      { at: pass.at, trigger: pass.trigger.kind, by: manual?.userId, agencyIds },
      pass.counts,
    )
    const totals = keeperTotals(pass.counts, agencyIds)
    const answer: KeeperDone = {
      status: 'done',
      at: pass.at,
      trigger: pass.trigger.kind,
      paid: totals.paid,
      failed: totals.failed,
      waiting: totals.waiting,
      reminders: totals.reminders,
      recovered: agencyIds.reduce((sum, agencyId) => sum + (pass.recovered.get(agencyId) ?? 0), 0),
      more: pass.more,
    }
    if (!manual && !changed && state.keeper && (await saveKeeperQuietly(db, state.keeper, IDLE_SAVE_MS)))
      return { state: null, result: answer }
    return { state, result: answer }
  })
}

// ─── Due runs ────────────────────────────────────────────────────────────────

async function runDue(
  pass: Pass,
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  ledger: WorldLedger,
  keeper: Address,
) {
  const world = await readWorld()
  const manual = pass.trigger.kind === 'manual' ? pass.trigger : null
  const due = dueSchedules(world.state, new Date().toISOString(), manual?.agencyId)
  if (due.length === 0) return
  const gas = await monad.gasBalance(keeper).catch(() => null)
  if (gas !== null && gas < MIN_GAS_WEI) {
    console.error(`[api] ${pass.requestId} keeper: ${keeper} cannot pay gas; nothing was sent`)
    for (const schedule of due) bump(pass.counts, schedule.agencyId, 'waiting')
    pass.more = true
    return
  }
  if (gas !== null && gas < LOW_GAS_WEI)
    console.warn(`[api] ${pass.requestId} keeper: ${keeper} is low on MON`)
  const inFlight = await keeperRunsInFlight()
  let started = 0
  for (const [index, schedule] of due.entries()) {
    if (pass.leaseLost || started >= RUNS_PER_PASS || timeLeft(pass) < RUN_NEEDS_MS) {
      for (const left of due.slice(index)) bump(pass.counts, left.agencyId, 'waiting')
      pass.more = true
      return
    }
    if (inFlight.has(schedule.id)) {
      bump(pass.counts, schedule.agencyId, 'waiting')
      continue
    }
    started += 1
    try {
      await runOne(pass, schedule, monad, chain, ledger, keeper)
    } catch (error) {
      // Monad or the database could not be read: the run stays due for the next pass.
      console.error(`[api] ${pass.requestId} keeper run ${schedule.id}: ${messageOf(error)}`)
      bump(pass.counts, schedule.agencyId, 'waiting')
    }
  }
}

/** One due run: from the ledger's schedule to a payment recorded in the app. */
async function runOne(
  pass: Pass,
  schedule: Schedule,
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  ledger: WorldLedger,
  keeper: Address,
) {
  const agencyId = schedule.agencyId
  const run = nextRunNumber(schedule)
  const wait = () => bump(pass.counts, agencyId, 'waiting')

  // 1. The ledger's schedule is the truth: active, due, and at the same run as the app.
  const onchain: LedgerSchedule = await monad.readSchedule(schedule.id, ledger.namespace)
  if (onchain.status === 'none') {
    await recordFailure(pass, schedule, {
      code: 'not_registered',
      message: 'The ledger has no record of this scheduled payment. Cancel it and schedule it again.',
    })
    return
  }
  // The ledger already paid this run (it landed after its row was given up as not sent): record it.
  const ledgerRun = schedule.runs - onchain.runsLeft + 1
  if (onchain.status === 'completed' || (onchain.status === 'active' && ledgerRun > run)) {
    if (!(await recoverLanded(pass, schedule, run, monad, chain, ledger, keeper))) wait()
    return
  }
  // Paused or cancelled there: a person's operation still being confirmed settles it.
  if (onchain.status !== 'active' || ledgerRun !== run) return wait()
  const now = new Date().toISOString()
  if (Date.parse(onchain.nextRunAt) > Date.parse(now)) return wait()

  // 2. Not while someone's operation on it (or on its money) is on its way. One nobody signed in
  //    time is looked for on Monad first, as a person's command would, and holds nothing once let go.
  if (await personOperationInTheWay(schedule, ledger, { requestId: pass.requestId })) return wait()

  // 3. The engine and the plan, on a snapshot.
  const input: RunInput = { scheduleId: schedule.id, run, dueAt: onchain.nextRunAt, now, agencyId }
  const world = await readWorld()
  const planned = planRun(world.state, input)
  if ('error' in planned) {
    if (planned.error.code === 'already_applied') return
    await recordFailure(pass, schedule, planned.error)
    return
  }

  // 4. Simulated as the keeper (Monad charges a reverted transaction's gas: only what passes is sent).
  const prepared = await monad.prepare(planned.plan, chain)
  if (prepared.status === 'done') {
    const error = prepared.result.error
    if (!error || error.code === 'not_due' || error.retryable) return wait()
    await recordFailure(pass, schedule, error)
    return
  }

  // 5. Stored before it is sent, under the state lock: it must still plan the same. Only while this
  //    pass still holds the lease (renewed now, so it lasts past the send): another holder would
  //    sign from the same account.
  if (!(await renewKeeperLease(pass.holder))) {
    console.error(`[api] ${pass.requestId} keeper: the lease was lost, nothing more is sent`)
    pass.leaseLost = true
    pass.more = true
    return wait()
  }
  const key = runKey(ledger.namespace, schedule.id, run)
  const stored = await storeRun(key, input, prepared.tx, ledger)
  if (stored !== 'stored') return wait()

  // 6. Sent from the keeper's account.
  const sent = await monad.sendPrepared(prepared.tx)
  if (sent.status === 'refused') {
    await finishRow(key, 'failed', failedBody(sent.error))
    if (sent.error.code === 'not_due' || sent.error.retryable) return wait()
    await recordFailure(pass, schedule, sent.error)
    return
  }
  if (sent.status === 'unclear') {
    // It may have gone out: the row stays open, and the next pass looks for it on Monad.
    console.error(`[api] ${pass.requestId} keeper send ${schedule.id}: ${sent.error.message}`)
    return wait()
  }
  await getDb()
    .update(operations)
    .set({ txHash: sent.hash })
    .where(and(rowWhere(key), inArray(operations.status, OPEN)))

  // 7. A short wait for its receipt; otherwise the next pass confirms it.
  const confirmed = await monad.confirm(prepared.tx, sent.hash, chain, {
    timeoutMs: Math.max(1_000, Math.min(RECEIPT_WAIT_MS, timeLeft(pass) - 1_000)),
  })
  if (confirmed.status !== 'confirmed') return wait()
  await settleRun(pass, key, input, prepared.tx, confirmed, schedule)
}

/** The engine's run of a schedule and its plan, on `state`; or why it cannot run. */
function planRun(
  state: ViatikState,
  input: RunInput,
): { after: ViatikState; plan: SettlementPlan } | { error: { code: string; message: string } } {
  try {
    const out = execute(
      state,
      { actor: SYSTEM, now: input.now, idSeed: keeperRunSeed(input.scheduleId, input.run) },
      (tx) => runScheduledPayment(tx, { scheduleId: input.scheduleId, dueAt: input.dueAt }),
    )
    const plan = planSettlement({ before: state, after: out.state, actor: SYSTEM })
    if (!plan || plan.signer !== 'keeper' || plan.uncovered.length > 0 || plan.ops.length !== 1) {
      return {
        error: {
          code: 'rule_drift',
          message: 'This run cannot be settled on the ledger as planned. It is flagged for review.',
        },
      }
    }
    return { after: out.state, plan }
  } catch (error) {
    if (error instanceof DomainError) return { error: failureOf(error) }
    throw error
  }
}

/** The plan as the ledger sees it, for comparing a run prepared earlier with the same run now. */
const comparable = (plan: SettlementPlan) => canonical(plan)

/**
 * Stores a run about to be sent as an open operation of the keeper, under the
 * state lock: the run must still plan the same on the latest state, no
 * person's operation may hold its schedule or its money (`refuseConflicts`
 * sees this row the same way from the other side), and an earlier attempt's
 * row is replaced only if it failed (`runRowReplaceable`): an open one may
 * still land (it is recovered by its hash), a done or diverged one moved money.
 */
async function storeRun(
  key: string,
  input: RunInput,
  tx: PreparedTx,
  ledger: WorldLedger,
): Promise<'stored' | 'changed' | 'in_the_way'> {
  return withWorld(async (latest, db) => {
    if (latest.ledger?.namespace !== ledger.namespace) return { state: null, result: 'changed' as const }
    const again = planRun(latest.state, input)
    if ('error' in again || comparable(again.plan) !== comparable(tx.plan))
      return { state: null, result: 'changed' as const }
    const schedule = latest.state.schedules.find((s) => s.id === input.scheduleId)
    if (!schedule || (await personOperationInTheWay(schedule, ledger, { db, state: latest.state })))
      return { state: null, result: 'in_the_way' as const }
    const [earlier] = await db
      .select({ status: operations.status })
      .from(operations)
      .where(rowWhere(key))
      .for('update')
    if (!runRowReplaceable(earlier?.status)) {
      const open = earlier !== undefined && OPEN.includes(earlier.status)
      return { state: null, result: open ? ('in_the_way' as const) : ('changed' as const) }
    }
    if (earlier) await db.delete(operations).where(and(rowWhere(key), eq(operations.status, 'failed')))
    await db.insert(operations).values({
      userId: KEEPER_USER,
      idempotencyKey: key,
      command: RUN_COMMAND,
      fingerprint: createHash('sha256').update(canonical(input)).digest('hex'),
      status: 'pending',
      statusCode: 202,
      response: { pending: true },
      input,
      prepared: tx,
      preparedAt: new Date(input.now),
      worldVersion: latest.version,
      expiresAt: new Date(Date.now() + KEY_TTL_MS),
    })
    return { state: null, result: 'stored' as const }
  })
}

/**
 * Applies a run that landed, under the state lock: the engine runs again on
 * the latest state with the time and ids it was prepared with, and must plan
 * the same. Anything else is a divergence: flagged on its row, and noted on
 * the schedule ("Needs attention"), since the money moved.
 */
async function settleRun(
  pass: Pass,
  key: string,
  input: RunInput,
  prepared: PreparedTx,
  confirmed: Landed,
  schedule: Pick<Schedule, 'id' | 'agencyId'>,
) {
  if (!confirmed.landed) {
    // It reverted: nothing moved, and the run stays due.
    await finishRow(key, 'failed', failedBody(confirmed.result.error), confirmed.hash)
    await recordFailure(pass, schedule, failureOf(confirmed.result.error))
    return
  }
  if (confirmed.result.status !== 'completed') {
    // It landed differently from what was prepared: flagged, never retried blindly.
    await finishRow(key, 'diverged', divergedBody(), confirmed.hash)
    await recordFailure(pass, schedule, {
      code: 'diverged',
      message: 'The ledger recorded this run differently from what was prepared. It is flagged for review.',
    })
    return
  }
  const outcome = await withWorld(async (world, db) => {
    const [row] = await db.select().from(operations).where(rowWhere(key)).for('update')
    if (!row || !OPEN.includes(row.status)) return { state: null, result: 'gone' as const }
    const again = world.ledger?.namespace === prepared.namespace ? planRun(world.state, input) : null
    if (!again || 'error' in again || comparable(again.plan) !== comparable(prepared.plan)) {
      await db
        .update(operations)
        .set({ status: 'diverged', statusCode: 409, response: divergedBody(), txHash: confirmed.hash })
        .where(rowWhere(key))
      return { state: null, result: 'diverged' as const }
    }
    applySettlement(world.state, again.after, again.plan, confirmed.result)
    await db
      .update(operations)
      .set({
        status: 'done',
        statusCode: 200,
        response: { result: { paymentId: scheduleRunPaymentId(input.scheduleId, input.run) } },
        txHash: confirmed.hash,
      })
      .where(rowWhere(key))
    return { state: again.after, result: 'applied' as const }
  })
  if (outcome === 'applied') {
    bump(pass.counts, input.agencyId, 'paid')
    pass.landedBlocks.push(confirmed.block)
    pass.wrote = true
  } else if (outcome === 'diverged') {
    console.error(`[api] ${pass.requestId} keeper run ${key} landed but could not be applied`)
    await recordFailure(pass, schedule, {
      code: 'diverged',
      message: 'This run was paid, but Viatik could not record it. It is flagged for review.',
    })
  }
  return outcome
}

/** Notes a run that could not be paid (once per run and reason) and counts it. */
async function recordFailure(
  pass: Pass,
  schedule: Pick<Schedule, 'id' | 'agencyId'>,
  failure: { code: string; message: string },
) {
  bump(pass.counts, schedule.agencyId, 'failed')
  // The ledger speaks to whoever signs ("your account"): the keeper signs a run, an Admin authorized it.
  const said =
    failure.code === 'not_authorized'
      ? {
          code: failure.code,
          message:
            'The ledger no longer accepts it from the Admin who scheduled it. Cancel it, and schedule it again if it is still needed.',
        }
      : failure
  const wrote = await withWorld(async (world) => {
    const current = world.state.schedules.find((s) => s.id === schedule.id)
    if (!current) return { state: null, result: false }
    const { state } = noteFailure(world.state, new Date().toISOString(), current, said)
    return state === world.state ? { state: null, result: false } : { state, result: true }
  })
  if (wrote) pass.wrote = true
}

// ─── Runs sent by an earlier pass ────────────────────────────────────────────

/**
 * Runs stored as sent (or about to be) that were never settled: the function
 * stopped, the receipt took longer than the pass, or the send's answer was
 * lost. Each one is confirmed by its hash, or looked for on Monad when it has
 * none and the ledger already claimed its payment id; one never claimed after
 * a couple of minutes was never sent, and its run is simply due again.
 */
async function recoverRuns(
  pass: Pass,
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  ledger: WorldLedger,
  keeper: Address,
) {
  const rows = await getDb()
    .select()
    .from(operations)
    .where(
      and(
        eq(operations.userId, KEEPER_USER),
        like(operations.idempotencyKey, 'run:%'),
        inArray(operations.status, OPEN),
      ),
    )
  for (const row of rows) {
    if (timeLeft(pass) < 3_000) {
      pass.more = true
      return
    }
    try {
      await recoverRun(pass, row, monad, chain, ledger, keeper)
    } catch (error) {
      console.error(`[api] ${pass.requestId} keeper recovery ${row.idempotencyKey}: ${messageOf(error)}`)
    }
  }
}

async function recoverRun(
  pass: Pass,
  row: OperationRow,
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  ledger: WorldLedger,
  keeper: Address,
) {
  const key = row.idempotencyKey
  const input = row.input as RunInput | null
  const prepared = row.prepared
  if (!input || !prepared || !row.preparedAt || prepared.namespace !== ledger.namespace) {
    await finishRow(key, 'failed', {
      error: { code: 'invalid_state', message: 'Viatik was reset after this run was prepared.' },
    })
    return
  }
  const age = Date.now() - row.preparedAt.getTime()
  let landed: Landed | null = null
  if (row.txHash) {
    const hash = row.txHash as Hex
    const confirmed = await monad.confirm(prepared, hash, chain, { timeoutMs: 0 })
    if (confirmed.status === 'confirmed') landed = confirmed
    else {
      const stale =
        confirmed.status === 'unrelated' ||
        (age > UNKNOWN_HASH_MS && (await monad.knowsTransaction(hash)) === false)
      if (stale) {
        await getDb()
          .update(operations)
          .set({ txHash: null })
          .where(and(rowWhere(key), eq(operations.txHash, hash)))
      }
      bump(pass.counts, input.agencyId, 'waiting')
      return
    }
  } else {
    const paymentId = scheduleRunPaymentId(input.scheduleId, input.run)
    if (await monad.isProcessed(keeper, paymentId, ledger.namespace)) {
      const found = await monad.findConfirmation(prepared, chain, {
        from: row.scannedTo == null ? undefined : row.scannedTo + 1,
        budgetMs: Math.max(1_000, Math.min(5_000, timeLeft(pass) - 2_000)),
      })
      if (found.status !== 'found') {
        if (found.status === 'searched') {
          await getDb()
            .update(operations)
            .set({ scannedTo: found.scannedTo })
            .where(and(rowWhere(key), inArray(operations.status, OPEN)))
        }
        bump(pass.counts, input.agencyId, 'waiting')
        return
      }
      landed = found.confirmed
    } else if (age < UNSENT_AFTER_MS) {
      bump(pass.counts, input.agencyId, 'waiting')
      return
    } else {
      // Never claimed on the ledger: it was not sent. The run is due again and this pass may send it.
      await finishRow(key, 'failed', {
        error: { code: 'not_sent', message: 'This run was not sent. It is tried again.' },
      })
      return
    }
  }
  pass.recovered.set(input.agencyId, (pass.recovered.get(input.agencyId) ?? 0) + 1)
  await settleRun(pass, key, input, prepared, landed, { id: input.scheduleId, agencyId: input.agencyId })
}

/**
 * A run the ledger paid whose row was closed as not sent (its transaction
 * landed later than the keeper waited): reopened and recovered like any run
 * sent by an earlier pass, if the ledger claimed its payment id. Returns
 * whether it was found.
 */
async function recoverLanded(
  pass: Pass,
  schedule: Pick<Schedule, 'id'>,
  run: number,
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  ledger: WorldLedger,
  keeper: Address,
): Promise<boolean> {
  const key = runKey(ledger.namespace, schedule.id, run)
  const [row] = await getDb().select().from(operations).where(rowWhere(key)).limit(1)
  if (!row?.prepared || row.status !== 'failed') return false
  const paymentId = scheduleRunPaymentId(schedule.id, run)
  if (!(await monad.isProcessed(keeper, paymentId, ledger.namespace))) return false
  const [reopened] = await getDb()
    .update(operations)
    .set({ status: 'pending', statusCode: 202, response: { pending: true } })
    .where(and(rowWhere(key), eq(operations.status, 'failed')))
    .returning()
  if (!reopened) return false
  await recoverRun(pass, reopened, monad, chain, ledger, keeper)
  return true
}

/** Schedules with a run of the keeper still open (sent, or about to be): not sent again meanwhile. */
async function keeperRunsInFlight(): Promise<Set<Id>> {
  const rows = await getDb()
    .select({ input: operations.input })
    .from(operations)
    .where(
      and(
        eq(operations.userId, KEEPER_USER),
        like(operations.idempotencyKey, 'run:%'),
        inArray(operations.status, OPEN),
      ),
    )
  return new Set(rows.map((row) => (row.input as RunInput | null)?.scheduleId).filter(Boolean) as Id[])
}

// ─── People's operations in the way ──────────────────────────────────────────

/**
 * Whether a person's open operation (prepared, maybe signed, not confirmed)
 * names this schedule or takes money from where it pays from. Its transaction
 * may land first: the run would then land on a state its confirmation, or
 * theirs, no longer fits. The run waits for the next pass instead.
 *
 * What still holds follows a person's command's rule (`operationHolding`, as
 * in `refuseConflicts`): one with a hash, or pending and not overdue, holds;
 * one marked expired with no hash holds nothing; one overdue with no hash
 * (nobody said it was signed) is looked for on Monad first (`releasedOverdue`:
 * with a `requestId`, outside the state lock) and holds nothing once a complete
 * search let it go. Under the lock (no `requestId`) nothing is looked for, and
 * such an operation holds.
 */
async function personOperationInTheWay(
  schedule: Schedule,
  ledger: WorldLedger,
  options: { db?: DbTx; state?: ViatikState; requestId?: string } = {},
): Promise<boolean> {
  const db = options.db ?? getDb()
  const rows = await db
    .select()
    .from(operations)
    .where(
      and(
        inArray(operations.status, OPEN),
        isNotNull(operations.prepared),
        gt(operations.expiresAt, new Date()),
        ne(operations.userId, KEEPER_USER),
      ),
    )
  if (rows.length === 0) return false
  const current = options.state ?? (await readWorld()).state
  const source = schedule.budgetId ?? schedule.sourceAccountId
  const now = Date.now()
  const overdue: OperationRow[] = []
  for (const row of rows) {
    if (!row.prepared || row.prepared.namespace !== ledger.namespace) continue
    const hold = operationHolding(row, now)
    if (hold === 'no') continue
    const held = heldByOperation(row.command, row.input, row.prepared.plan, current)
    if (!held.has(`schedule:${schedule.id}`) && !debitedBy(row.prepared.plan, current).has(source)) continue
    if (hold === 'yes') return true
    overdue.push(row)
  }
  if (overdue.length === 0) return false
  if (!options.requestId) return true
  return !(await releasedOverdue(overdue, ledger, options.requestId))
}

/** The accounts and budgets a plan takes money from. */
function debitedBy(plan: SettlementPlan, state: ViatikState): Set<Id> {
  const debited = new Set<Id>()
  for (const op of plan.ops) {
    switch (op.call) {
      case 'pay':
      case 'payOutside':
        debited.add(op.sourceId)
        break
      case 'transfer':
        debited.add(op.fromAccountId)
        break
      case 'returnCapital':
        debited.add(op.fromAccountId)
        break
      case 'requestPayment':
        debited.add(op.budgetId)
        break
      case 'approvePayment': {
        const budgetId = state.requests.find((r) => r.id === op.requestId)?.budgetId
        if (budgetId) debited.add(budgetId)
        break
      }
      case 'allocate':
        if (op.delta < 0) debited.add(op.budgetId)
        else {
          const sourceAccountId = state.budgets.find((b) => b.id === op.budgetId)?.sourceAccountId
          if (sourceAccountId) debited.add(sourceAccountId)
        }
        break
      case 'createBudget':
        if (op.allocation > 0) debited.add(op.sourceAccountId)
        break
    }
  }
  return debited
}

// ─── Rows ────────────────────────────────────────────────────────────────────

/** A run's row key: one per namespace, schedule and run, so a retry of the same run reuses it. */
const runKey = (namespace: string, scheduleId: Id, run: number) => `run:${namespace}:${scheduleId}:${run}`

const rowWhere = (key: string) => and(eq(operations.userId, KEEPER_USER), eq(operations.idempotencyKey, key))

const failedBody = (error: LedgerError | undefined) => ({
  error: {
    code: error?.code ?? 'ledger_failed',
    message: error?.message ?? 'The run could not be completed. Nothing was moved.',
  },
})

const divergedBody = () => ({
  error: { code: 'diverged', message: 'Monad recorded this run differently from what was prepared.' },
})

async function finishRow(key: string, status: OperationStatus, response: unknown, txHash?: Hex) {
  await getDb()
    .update(operations)
    .set({ status, statusCode: status === 'done' ? 200 : 409, response, ...(txHash ? { txHash } : {}) })
    .where(and(rowWhere(key), inArray(operations.status, OPEN)))
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError || error instanceof DomainError) return `${error.code}: ${error.message}`
  // The short message only: viem's full error repeats the RPC URL, which may carry a provider key.
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.name
  return String(error)
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/** The trigger's token, compared by digest in constant time (the length leaks nothing either). */
function sameToken(given: string, expected: string) {
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

const runNowBody = z.object({ agencyId: z.string().min(1).max(80) })

/** The row that rests "Run due payments" for an Agency after a press that failed. */
const cooldownKey = (agencyId: Id) => `cooldown:${agencyId}`

/** Whether a press that failed for this Agency was less than FAILED_COOLDOWN_SECONDS ago. */
async function inFailedCooldown(agencyId: Id): Promise<boolean> {
  const [row] = await getDb()
    .select({ expiresAt: operations.expiresAt })
    .from(operations)
    .where(and(rowWhere(cooldownKey(agencyId)), gt(operations.expiresAt, sql`now()`)))
    .limit(1)
  return row !== undefined
}

/** Rests the Agency's "Run due payments" for FAILED_COOLDOWN_SECONDS, timed by the database. */
async function startFailedCooldown(agencyId: Id): Promise<void> {
  const ends = sql.raw(`now() + interval '${FAILED_COOLDOWN_SECONDS} seconds'`)
  await getDb()
    .insert(operations)
    .values({
      userId: KEEPER_USER,
      idempotencyKey: cooldownKey(agencyId),
      command: 'keeper:cooldown',
      fingerprint: 'failed',
      status: 'done',
      statusCode: 200,
      response: { cooldown: true },
      expiresAt: ends,
    })
    .onConflictDoUpdate({
      target: [operations.userId, operations.idempotencyKey],
      set: { createdAt: sql`now()`, expiresAt: ends },
    })
}

export const keeper = new Hono<AppEnv>()
  .post('/run', async (c) => {
    const expected = readServerEnv().KEEPER_TRIGGER_TOKEN
    if (!expected) throw new ApiError(404, 'not_found', 'This endpoint does not exist.')
    if (!sameToken(c.req.header('x-keeper-token') ?? '', expected))
      throw new ApiError(401, 'unauthenticated', 'A valid keeper token is required.')
    // 200 even when busy: a trigger counts errors, and another pass is doing the work.
    return c.json(await runKeeper({ kind: 'automatic' }, c.get('requestId')), 200, noStore)
  })
  .post(
    '/run-now',
    requireAccount,
    requireUser,
    bodyLimit({
      maxSize: 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'This request is too large.')
      },
    }),
    async (c) => {
      const user = c.get('user')
      const parsed = runNowBody.safeParse(await c.req.json().catch(() => null))
      if (!parsed.success) throw new ApiError(422, 'validation', 'Choose the Agency to run due payments for.')
      const { agencyId } = parsed.data
      const { state } = await readWorld()
      if (!state.agencies.some((a) => a.id === agencyId))
        throw new ApiError(404, 'not_found', 'Agency not found.')
      if (!can(subjectFor(state, user.id), 'send_payment', { agencyId, agencies: state.agencies }))
        throw new ApiError(403, 'forbidden', 'You do not have permission to do this.')
      const last: KeeperRun | undefined = state.keeper?.agencies?.[agencyId]
      if (last?.trigger === 'manual' && Date.now() - Date.parse(last.at) < MANUAL_COOLDOWN_MS) {
        throw new ApiError(429, 'cooldown', 'Due payments were just run. Try again in a few seconds.')
      }
      if (await inFailedCooldown(agencyId))
        throw new ApiError(429, 'cooldown', 'Running due payments just failed. Try again in a few seconds.')
      try {
        const answer = await runKeeper({ kind: 'manual', agencyId, userId: user.id }, c.get('requestId'))
        return c.json(answer, 200, noStore)
      } catch (error) {
        // A failed press rests too, so repeated presses do not hammer Monad or the database.
        await startFailedCooldown(agencyId).catch((cooldownError: unknown) =>
          console.error(`[api] ${c.get('requestId')} keeper cooldown: ${messageOf(cooldownError)}`),
        )
        throw error
      }
    },
  )

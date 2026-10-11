import { DomainError, execute } from '@/domain/engine'
import { noteReminderDue, noteScheduleFailed, runScheduledPayment } from '@/domain/engine/system'
import {
  dueSchedules,
  nextRunNumber,
  NO_KEEPER_COUNTS,
  recordKeeperPass,
  remindersToNotify,
  type KeeperCounts,
} from '@/domain/schedules'
import type { Actor, Id, ISODate, KeeperRun, Schedule, ViatikState } from '@/domain/types'
import { MockLedgerAdapter } from '@/ledger/mock'
import type { LedgerError } from '@/ledger/types'

import { applySettlement, planSettlement } from './settlement'

/**
 * The keeper's pieces that run anywhere: the ids its system commands are
 * seeded with, how a failure is noted, how due monthly reminders are told, a
 * whole pass on the demo ledger (the demo's "Run due payments", and the server
 * on a world without Monad), and the answer every trigger gets. The pass on
 * Monad (lease, simulation, the keeper's transactions, recovery) is
 * src/server/keeper.ts.
 */

/** What `POST /v1/keeper/run`, `POST /v1/keeper/run-now` and the demo's "Run due payments" answer. */
export type KeeperRunAnswer =
  /** Another pass is running right now (only one at a time): nothing was done. */
  | { status: 'busy' }
  | {
      status: 'done'
      at: ISODate
      trigger: KeeperRun['trigger']
      /** Due runs paid. */
      paid: number
      /** Due runs that could not be paid: noted ("Needs attention") and tried again next time. */
      failed: number
      /** Due runs left for the next pass (time ran out, another operation was on it, or still confirming). */
      waiting: number
      /** Monthly payments whose due day was told to the Admins. */
      reminders: number
      /** Runs sent by an earlier pass that this one found landed and recorded. */
      recovered: number
      /** Something due was left for the next pass. */
      more: boolean
    }

export type KeeperDone = Extract<KeeperRunAnswer, { status: 'done' }>

export const SYSTEM: Actor = { kind: 'system' }

/** One run of one schedule: applied twice, it is refused (`already_applied`). */
export const keeperRunSeed = (scheduleId: Id, run: number) => `keeper:${scheduleId}:${run}`
/**
 * A failure noted for a run, by its reason, and by how many times the schedule
 * was resumed (a resume clears the failure: the run failing again is told again).
 */
export const keeperFailureSeed = (scheduleId: Id, run: number, code: string, resumes = 0) =>
  `keeper-failed:${scheduleId}:${run}:${code}${resumes > 0 ? `:resumed${resumes}` : ''}`
/** A monthly payment's due day, told once. */
export const reminderSeed = (reminderId: Id, dueDay: string) => `reminder:${reminderId}:${dueDay}`

/** A refusal (the engine's or the ledger's) as a schedule's failure. */
export function failureOf(error: unknown): { code: string; message: string } {
  if (error instanceof DomainError) return { code: error.code, message: error.message }
  const ledger = error as Partial<LedgerError> | undefined
  if (ledger && typeof ledger.code === 'string' && typeof ledger.message === 'string')
    return { code: ledger.code, message: ledger.message }
  return { code: 'unknown', message: 'The payment could not be made.' }
}

/** Adds one to a count of an Agency's pass. */
export function bump(counts: Map<Id, KeeperCounts>, agencyId: Id, key: keyof KeeperCounts, by = 1) {
  const current = counts.get(agencyId) ?? { ...NO_KEEPER_COUNTS }
  current[key] += by
  counts.set(agencyId, current)
}

/**
 * What a pass answers: its counts in the Agencies it was run for only (a manual
 * pass is one Agency's; recovering runs an earlier pass sent may count others').
 */
export function keeperTotals(counts: ReadonlyMap<Id, KeeperCounts>, agencyIds: readonly Id[]): KeeperCounts {
  const totals = { ...NO_KEEPER_COUNTS }
  for (const agencyId of new Set(agencyIds)) {
    const theirs = counts.get(agencyId)
    if (!theirs) continue
    for (const key of Object.keys(totals) as (keyof KeeperCounts)[]) totals[key] += theirs[key]
  }
  return totals
}

/**
 * Whether a new attempt of a run may replace its stored row: only when there is
 * none, or the earlier attempt failed (nothing moved). An open one (sent, or
 * about to be) is recovered by its hash instead, and a done or diverged one
 * moved money: never replaced, never sent again.
 */
export const runRowReplaceable = (status: string | undefined) => status === undefined || status === 'failed'

/**
 * Notes that a schedule's due run could not be paid (`noteScheduleFailed`).
 * The state is returned unchanged when that failure is already noted. When its
 * notice was already given under the same seed (`already_applied`), the failure
 * is still noted, quietly: the schedule must show "Needs attention" either way.
 */
export function noteFailure(
  state: ViatikState,
  now: ISODate,
  schedule: Pick<Schedule, 'id' | 'runs' | 'runsLeft' | 'resumes'>,
  failure: { code: string; message: string },
): { state: ViatikState; noted: boolean } {
  const run = nextRunNumber(schedule)
  const idSeed = keeperFailureSeed(schedule.id, run, failure.code, schedule.resumes ?? 0)
  const note = (quiet: boolean) =>
    execute(state, { actor: SYSTEM, now, idSeed }, (tx) =>
      noteScheduleFailed(tx, { scheduleId: schedule.id, run, ...failure, ...(quiet ? { quiet } : {}) }),
    )
  try {
    let outcome: ReturnType<typeof note>
    try {
      outcome = note(false)
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== 'already_applied') throw error
      outcome = note(true)
    }
    return outcome.result.status === 'known'
      ? { state, noted: false }
      : { state: outcome.state, noted: outcome.result.status === 'noted' }
  } catch (error) {
    if (error instanceof DomainError) return { state, noted: false }
    throw error
  }
}

/**
 * Tells the Admins about monthly payments whose due day has come (once per
 * due day: a day already told is refused as `already_applied` and skipped).
 */
export function noteReminders(
  state: ViatikState,
  now: ISODate,
  counts: Map<Id, KeeperCounts>,
  agencyId?: Id,
): ViatikState {
  let next = state
  for (const notice of remindersToNotify(state, now, agencyId)) {
    try {
      const outcome = execute(
        next,
        { actor: SYSTEM, now, idSeed: reminderSeed(notice.reminder.id, notice.dueDay) },
        (tx) =>
          noteReminderDue(tx, {
            reminderId: notice.reminder.id,
            dueDay: notice.dueDay,
            overdue: notice.overdue,
          }),
      )
      if (outcome.result.notified.length === 0) continue
      next = outcome.state
      bump(counts, notice.reminder.agencyId, 'reminders')
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
    }
  }
  return next
}

export type MockPassOptions = {
  now: ISODate
  trigger: KeeperRun['trigger']
  /** A manual pass looks at this Agency only; an automatic one at every Agency. */
  agencyId?: Id
  /** Who pressed "Run due payments". */
  by?: Id
}

/**
 * One keeper pass on the demo ledger, as the server's does on Monad: every due
 * run (one per schedule) is paid by the keeper on the mock ledger, a run the
 * app's rules or the ledger refuse is noted once ("Needs attention", it stays
 * due), due monthly reminders are told, and the pass is recorded on the state.
 * Returns the next state, to save as a whole.
 */
export async function runDueOnMock(
  state: ViatikState,
  options: MockPassOptions,
): Promise<{
  state: ViatikState
  answer: KeeperDone
  /** Whether the pass changed anything besides its own record (a run paid, a failure noted, a reminder told). */
  changed: boolean
}> {
  const { now } = options
  const counts = new Map<Id, KeeperCounts>()
  const ledger = new MockLedgerAdapter({ latencyMs: 0, now: () => now })
  let current = state
  for (const due of dueSchedules(current, now, options.agencyId)) {
    const run = nextRunNumber(due)
    let outcome: { state: ViatikState; result: unknown }
    try {
      outcome = execute(current, { actor: SYSTEM, now, idSeed: keeperRunSeed(due.id, run) }, (tx) =>
        runScheduledPayment(tx, { scheduleId: due.id }),
      )
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      if (error.code === 'already_applied') continue
      current = noteFailure(current, now, due, failureOf(error)).state
      bump(counts, due.agencyId, 'failed')
      continue
    }
    const plan = planSettlement({ before: current, after: outcome.state, actor: SYSTEM })
    if (plan) {
      const settled = await ledger.settle(plan, { before: current })
      if (settled.status === 'failed') {
        current = noteFailure(current, now, due, failureOf(settled.error)).state
        bump(counts, due.agencyId, 'failed')
        continue
      }
      applySettlement(current, outcome.state, plan, settled)
    }
    current = outcome.state
    bump(counts, due.agencyId, 'paid')
  }
  current = noteReminders(current, now, counts, options.agencyId)
  const changed = current !== state
  const next = changed ? current : structuredClone(state)
  const agencyIds = options.agencyId ? [options.agencyId] : next.agencies.map((a) => a.id)
  recordKeeperPass(next, { at: now, trigger: options.trigger, by: options.by, agencyIds }, counts)
  const totals = keeperTotals(counts, agencyIds)
  return {
    state: next,
    answer: {
      status: 'done',
      at: now,
      trigger: options.trigger,
      paid: totals.paid,
      failed: totals.failed,
      waiting: 0,
      reminders: totals.reminders,
      recovered: 0,
      more: false,
    },
    changed,
  }
}

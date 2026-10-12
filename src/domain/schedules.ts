import { remindersDue } from './accountability'
import { dayIn } from './days'
import { can, type Subject } from './permissions'
import type { Id, ISODate, KeeperRun, KeeperStatus, Payment, Reminder, Schedule, ViatikState } from './types'

/**
 * Scheduled payments as screens and the keeper read them. Nothing here is
 * stored: a schedule's state, its next run as an upcoming payment and what the
 * keeper should look at are derived from `state.schedules`, so they read the
 * same in the engine, on the server and on a viewer's scoped state.
 */

/** The shortest gap between two runs: the ledger's `MIN_INTERVAL`. */
export const SCHEDULE_MIN_INTERVAL_SECONDS = 60
/** The ledger allows 52 runs (`MAX_RUNS`); the app offers up to 12. */
export const SCHEDULE_MAX_RUNS = 12
/** A first run at least this far ahead, so it is still in the future when its transaction lands. */
export const SCHEDULE_MIN_LEAD_MS = 60_000
/** And at most this many days ahead. */
export const SCHEDULE_MAX_LEAD_DAYS = 366
/** The quick option the scheduling form offers for the demo ("In 5 minutes"). */
export const SCHEDULE_QUICK_MINUTES = 5

const DAY_MS = 24 * 60 * 60 * 1000

/** The payment a run makes: the same id on the ledger (`runSchedule`) and in the app, so a retry never pays twice. */
export const scheduleRunPaymentId = (scheduleId: Id, run: number): Id => `${scheduleId}_run${run}`

/** The run that is due next (1 = the first); once completed, one past the last. */
export const nextRunNumber = (schedule: Pick<Schedule, 'runs' | 'runsLeft'>): number =>
  schedule.runs - schedule.runsLeft + 1

/** A time in whole seconds, as the ledger keeps it (`uint64` seconds). */
export const toLedgerTime = (iso: ISODate): ISODate =>
  new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toISOString()

/** Seconds since the epoch, as the ledger compares times. */
export const ledgerSeconds = (iso: ISODate): number => Math.floor(Date.parse(iso) / 1000)

/**
 * What a schedule shows:
 * - scheduled: waiting for its date.
 * - due: its date passed; the keeper pays it within minutes.
 * - needs_attention: its due run could not be paid (money, a paused budget…); it is tried again.
 * - stopped: the Admin who authorized it is no longer an Agency Admin, so the ledger will not run
 *   it. Cancel it (and schedule it again if it is still needed).
 * - paused, cancelled, completed: as stored.
 */
export type ScheduleState =
  'scheduled' | 'due' | 'needs_attention' | 'stopped' | 'paused' | 'cancelled' | 'completed'

/**
 * Whether the Admin who authorized it still holds the role. Undefined when the
 * viewer cannot tell (a Member's scoped state has no one else's memberships).
 */
export function isCreatorActive(
  state: Pick<ViatikState, 'memberships'>,
  schedule: Pick<Schedule, 'agencyId' | 'createdBy'>,
): boolean | undefined {
  const theirs = state.memberships.filter(
    (m) =>
      m.userId === schedule.createdBy &&
      m.role === 'agency_admin' &&
      m.scope.kind === 'agency' &&
      m.scope.agencyId === schedule.agencyId,
  )
  if (theirs.length === 0) return undefined
  return theirs.some((m) => m.status === 'active')
}

export function scheduleState(
  state: Pick<ViatikState, 'memberships'>,
  schedule: Schedule,
  now: ISODate,
): ScheduleState {
  if (schedule.status === 'completed') return 'completed'
  if (schedule.status === 'cancelled') return 'cancelled'
  if (isCreatorActive(state, schedule) === false) return 'stopped'
  if (schedule.status === 'paused') return 'paused'
  if (schedule.failure && schedule.failure.run === nextRunNumber(schedule)) return 'needs_attention'
  return Date.parse(schedule.nextRunAt) <= Date.parse(now) ? 'due' : 'scheduled'
}

/** Still to run: active or paused (a stopped one included, until someone cancels it). */
export const isOpenSchedule = (schedule: Pick<Schedule, 'status'>) =>
  schedule.status === 'active' || schedule.status === 'paused'

export type ScheduleFilter = {
  agencyId?: Id
  /** Schedules that pay this person's Viatik balance. */
  recipientUserId?: Id
  /** Schedules that pay this vendor. */
  destinationId?: Id
  billId?: Id
  /** Only active and paused ones. */
  open?: boolean
}

/** Schedules matching the filter, the next due first (finished ones by when they ended, newest first, after). */
export function schedulesOf(state: Pick<ViatikState, 'schedules'>, filter: ScheduleFilter = {}): Schedule[] {
  const ended = (s: Schedule) => Date.parse(s.completedAt ?? s.cancelledAt ?? s.nextRunAt)
  return (state.schedules ?? [])
    .filter(
      (s) =>
        (!filter.agencyId || s.agencyId === filter.agencyId) &&
        (!filter.recipientUserId ||
          (s.recipient.kind === 'member' && s.recipient.userId === filter.recipientUserId)) &&
        (!filter.destinationId ||
          (s.recipient.kind === 'destination' && s.recipient.destinationId === filter.destinationId)) &&
        (!filter.billId || s.billId === filter.billId) &&
        (!filter.open || isOpenSchedule(s)),
    )
    .sort((a, b) => {
      const openA = isOpenSchedule(a)
      const openB = isOpenSchedule(b)
      if (openA !== openB) return openA ? -1 : 1
      return openA ? Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt) : ended(b) - ended(a)
    })
}

/**
 * The next run of every active schedule as a payment with status `scheduled`
 * (the id it will have once paid), soonest first. Screens that list upcoming
 * payments (the Scheduled tile, a Member's next payment, a vendor's upcoming
 * total) merge these with `state.payments`: a scheduled payment is not a
 * payment until the keeper pays it. Stopped schedules are left out.
 */
export function upcomingPayments(
  state: Pick<ViatikState, 'schedules' | 'memberships'>,
  filter: ScheduleFilter = {},
): Payment[] {
  return schedulesOf(state, filter)
    .filter((s) => s.status === 'active' && isCreatorActive(state, s) !== false)
    .map((s): Payment => {
      const run = nextRunNumber(s)
      return {
        id: scheduleRunPaymentId(s.id, run),
        agencyId: s.agencyId,
        type: s.type,
        sourceAccountId: s.sourceAccountId,
        budgetId: s.budgetId,
        recipient: s.recipient,
        amount: s.amount,
        category: s.category,
        memo: s.memo,
        status: 'scheduled',
        createdBy: { kind: 'user', userId: s.createdBy },
        scheduledFor: s.nextRunAt,
        billId: s.billId,
        scheduleId: s.id,
        scheduleRun: run,
      }
    })
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor))
}

/** Active schedules whose next run is due at `now`, oldest first: what the keeper pays. Stopped ones are left out. */
export function dueSchedules(state: ViatikState, now: ISODate, agencyId?: Id): Schedule[] {
  return (state.schedules ?? [])
    .filter(
      (s) =>
        s.status === 'active' &&
        s.runsLeft > 0 &&
        (!agencyId || s.agencyId === agencyId) &&
        Date.parse(s.nextRunAt) <= Date.parse(now) &&
        isCreatorActive(state, s) !== false,
    )
    .sort((a, b) => Date.parse(a.nextRunAt) - Date.parse(b.nextRunAt))
}

/** Open schedules an Agency Admin should look at: a due run that could not pay, or stopped ones. */
export function schedulesNeedingAttention(state: ViatikState, agencyId: Id, now: ISODate): Schedule[] {
  return schedulesOf(state, { agencyId, open: true }).filter((s) => {
    const shown = scheduleState(state, s, now)
    return shown === 'needs_attention' || shown === 'stopped'
  })
}

/** Whether the person acts on this Agency's schedules as the Investor of its portfolio (as the ledger decides). */
export function actsAsInvestor(
  state: Pick<ViatikState, 'memberships' | 'agencies'>,
  userId: Id,
  agencyId: Id,
): boolean {
  const portfolioId = state.agencies.find((a) => a.id === agencyId)?.portfolioId
  return state.memberships.some(
    (m) =>
      m.userId === userId &&
      m.status === 'active' &&
      m.role === 'investor' &&
      m.scope.kind === 'portfolio' &&
      m.scope.portfolioId === portfolioId,
  )
}

export type ScheduleActions = {
  pause: boolean
  resume: boolean
  cancel: boolean
  /** Why resume is not offered although the schedule is paused (the Investor paused it). */
  resumeBlocked?: string
}

/** What a person may do to a schedule now: the same rules as the engine (and the ledger). */
export function scheduleActions(
  state: Pick<ViatikState, 'memberships' | 'agencies'>,
  subject: Subject,
  schedule: Schedule,
): ScheduleActions {
  const allowed = can(subject, 'manage_schedules', { agencyId: schedule.agencyId, agencies: state.agencies })
  if (!allowed || subject.actor.kind !== 'user') return { pause: false, resume: false, cancel: false }
  const investor = actsAsInvestor(state, subject.actor.userId, schedule.agencyId)
  const lockedByInvestor = schedule.status === 'paused' && schedule.pausedByInvestor === true && !investor
  return {
    pause: schedule.status === 'active',
    resume: schedule.status === 'paused' && !lockedByInvestor,
    cancel: isOpenSchedule(schedule),
    resumeBlocked: lockedByInvestor
      ? 'The Investor paused it, so only the Investor can resume it.'
      : undefined,
  }
}

// ─── The keeper's last pass ──────────────────────────────────────────────────

/**
 * The timer (Supabase Cron) runs a pass every 10 minutes, and an idle pass
 * reaches open screens at least once an hour (src/server/keeper.ts). A world
 * whose last automatic pass is older than this has no timer running, yet or
 * any more: screens then say a due payment is paid when someone runs due
 * payments, never "within about 10 minutes".
 */
export const AUTOMATIC_RUNS_LAPSE_MS = 3 * 60 * 60 * 1000

/** Whether due scheduled payments are paid on a timer here: an automatic pass ran recently. */
export function automaticRunsOn(state: Pick<ViatikState, 'keeper'>, now: ISODate): boolean {
  const at = state.keeper?.lastAutomaticAt
  if (!at) return false
  return Date.parse(now) - Date.parse(at) < AUTOMATIC_RUNS_LAPSE_MS
}

/** What screens show about the keeper for an Agency: the timer's last pass, and the last pass that looked at it. */
export function keeperStatusFor(
  state: Pick<ViatikState, 'keeper'>,
  agencyId: Id,
): { lastAutomaticAt?: ISODate; lastRun?: KeeperRun } {
  return { lastAutomaticAt: state.keeper?.lastAutomaticAt, lastRun: state.keeper?.agencies[agencyId] }
}

/** What one pass did in one Agency. */
export type KeeperCounts = Pick<KeeperRun, 'paid' | 'failed' | 'waiting' | 'reminders'>

export const NO_KEEPER_COUNTS: KeeperCounts = { paid: 0, failed: 0, waiting: 0, reminders: 0 }

/**
 * Records a keeper pass on the state (in place): when the timer ran (automatic
 * passes), and for each Agency it looked at, what it did there.
 */
export function recordKeeperPass(
  state: ViatikState,
  pass: { at: ISODate; trigger: KeeperRun['trigger']; by?: Id; agencyIds: Id[] },
  counts: ReadonlyMap<Id, KeeperCounts>,
): ViatikState {
  const keeper: KeeperStatus = (state.keeper ??= { agencies: {} })
  keeper.agencies ??= {}
  if (pass.trigger === 'automatic') keeper.lastAutomaticAt = pass.at
  for (const agencyId of pass.agencyIds) {
    keeper.agencies[agencyId] = {
      at: pass.at,
      trigger: pass.trigger,
      ...(pass.by ? { by: pass.by } : {}),
      ...(counts.get(agencyId) ?? NO_KEEPER_COUNTS),
    }
  }
  return state
}

// ─── Monthly reminders on their due day ──────────────────────────────────────

export type ReminderNotice = {
  reminder: Reminder
  /** The day it is due (YYYY-MM-DD): the keeper tells the Admins once per due day. */
  dueDay: string
  /** The due day passed in the Agency's time zone (it was not told on the day). */
  overdue: boolean
}

/**
 * Active monthly reminders whose due day has come in their Agency's time zone
 * (UTC when it has none): the keeper tells the Agency's Admins once per due
 * day (`noteReminderDue`, seeded by reminder and day). A due day only moves on
 * once the month is paid, so an unpaid reminder is told once, not every pass.
 */
export function remindersToNotify(state: ViatikState, now: ISODate, agencyId?: Id): ReminderNotice[] {
  const notices: ReminderNotice[] = []
  for (const agency of state.agencies) {
    if (agencyId && agency.id !== agencyId) continue
    const today = dayIn(now, agency.timeZone)
    for (const due of remindersDue(state, agency.id, now)) {
      const dueDay = due.dueAt.slice(0, 10)
      if (today >= dueDay) notices.push({ reminder: due.reminder, dueDay, overdue: today > dueDay })
    }
  }
  return notices
}

// ─── Payments scheduled before schedules existed ─────────────────────────────

/**
 * A payment saved as scheduled before Phase F: nothing ever paid it. The state
 * upgrade (`upgradeState`) turns it into `action_required` and never into a
 * schedule (it was never authorized on the ledger): screens show it as not
 * scheduled, with "Schedule again" (the new schedule replaces it:
 * `replacesPaymentId`) and "Dismiss" (`dismissUnscheduledPayment`).
 */
export const isUnscheduledPayment = (payment: Pick<Payment, 'status' | 'completedAt' | 'receiptId'>) =>
  payment.status === 'action_required' && !payment.completedAt && !payment.receiptId

/** A first run in the allowed window: at least a minute from `now` and within a year. */
export function firstRunProblem(firstRunAt: ISODate, now: ISODate): string | null {
  const at = Date.parse(firstRunAt)
  if (Number.isNaN(at)) return 'Choose when to pay it.'
  if (at < Date.parse(now) + SCHEDULE_MIN_LEAD_MS) return 'Choose a time at least a minute from now.'
  if (at > Date.parse(now) + SCHEDULE_MAX_LEAD_DAYS * DAY_MS) return 'Choose a date within a year.'
  return null
}

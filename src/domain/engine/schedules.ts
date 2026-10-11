import { newId } from '../ids'
import type { Cents } from '../money'
import { accountBalance, budgetUsage } from '../selectors'
import {
  actsAsInvestor,
  firstRunProblem,
  isUnscheduledPayment,
  ledgerSeconds,
  SCHEDULE_MAX_RUNS,
  SCHEDULE_MIN_INTERVAL_SECONDS,
  toLedgerTime,
} from '../schedules'
import type {
  Bill,
  Id,
  ISODate,
  Payment,
  PaymentType,
  Schedule,
  SpendingCategory,
  ViatikRecipient,
} from '../types'
import { DomainError, requireText, usdText, type Tx } from './core'
import { checkAgencyPayment } from './operations'

/**
 * Scheduled payments: an Agency Admin authorizes a payment once, for a later
 * date (recurring-ready: every `intervalSeconds`, `runs` times; the screens
 * offer a single run for now), and the keeper pays each run on Monad when it
 * is due (`runScheduledPayment` in system.ts). Each schedule mirrors the
 * ledger's (`createSchedule`, under the same id): the same rules as paying by
 * hand apply when it is created and again at every run, and an Admin or the
 * portfolio's Investor can pause, resume or cancel it. Scheduling also needs
 * the money to be there today (the ledger checks it only when a run pays).
 */

export type SchedulePaymentInput = {
  agencyId: Id
  /** Money for purchases (an advance) only ever comes from a request. */
  type: Exclude<PaymentType, 'advance'>
  /** A vendor or a person's Viatik balance. */
  recipient: ViatikRecipient
  /** The account it pays from (the budget's source account when paying from a budget). */
  accountId: Id
  budgetId?: Id
  amount: Cents
  category: SpendingCategory
  memo: string
  /** When the first run is due: an ISO date-time with its offset, at least a minute from now and within a year. */
  firstRunAt: ISODate
  /** Seconds between runs; 0 or absent for a single run. At least 60 when it repeats. */
  intervalSeconds?: number
  /** How many runs, 1 to 12 (1 when absent). */
  runs?: number
  /** Set by `payBill` only: the bill it pays. */
  billId?: Id
  /**
   * "Schedule again" on a payment saved as scheduled before schedules existed
   * (`isUnscheduledPayment`, of this Agency): that never-paid payment is dropped
   * once this schedule is created, in the same command.
   */
  replacesPaymentId?: Id
}

const ONE_RUN = 1

/**
 * An Agency Admin schedules a payment. Checked as the ledger's `createSchedule`
 * checks it (the payee, the budget's pause, per-operation limit and approved
 * vendors, the Investor's exception threshold, the first run in the future,
 * 1 to 52 runs with no interval for a single one), plus the app's own: at most
 * 12 runs, the first run at least a minute ahead, and the money available
 * today. Moves nothing: the keeper pays each run when it is due.
 */
export function schedulePayment(tx: Tx, input: SchedulePaymentInput): Schedule {
  tx.authorize(input.recipient.kind === 'member' ? 'pay_member' : 'send_payment', {
    agencyId: input.agencyId,
  })
  const { account, budget, portfolioId, recipientName } = checkAgencyPayment(tx, input)
  const memo = requireText(input.memo, 'Memo', 200)
  const replaced =
    input.replacesPaymentId === undefined
      ? undefined
      : requireUnscheduledPayment(tx, input.replacesPaymentId, input.agencyId)
  if (replaced && input.billId)
    throw new DomainError('validation', 'A bill is scheduled again from the bill itself.')

  const problem = firstRunProblem(input.firstRunAt, tx.now)
  if (problem) throw new DomainError('validation', problem)
  const runs = input.runs ?? ONE_RUN
  const intervalSeconds = input.intervalSeconds ?? 0
  if (!Number.isInteger(runs) || runs < 1 || runs > SCHEDULE_MAX_RUNS)
    throw new DomainError('validation', `A scheduled payment runs 1 to ${SCHEDULE_MAX_RUNS} times.`)
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 0)
    throw new DomainError('validation', 'Choose how often it repeats.')
  if (runs === 1 && intervalSeconds !== 0)
    throw new DomainError('validation', 'A payment that runs once does not repeat.')
  if (runs > 1 && intervalSeconds < SCHEDULE_MIN_INTERVAL_SECONDS)
    throw new DomainError('validation', 'Repeats must be at least a minute apart.')

  // The ledger only checks the money when a run pays; scheduling without it would promise what is not there.
  const available = budget
    ? budgetUsage(tx.state, budget, tx.now).available
    : accountBalance(tx.state, account.id)
  if (available < input.amount) {
    throw new DomainError(
      'insufficient_funds',
      `${budget ? budget.name : account.name} has ${usdText(available)} available.`,
    )
  }

  const firstRunAt = toLedgerTime(input.firstRunAt)
  const schedule: Schedule = {
    id: newId('sched'),
    agencyId: input.agencyId,
    sourceAccountId: account.id,
    budgetId: budget?.id,
    recipient: input.recipient,
    type: input.type,
    amount: input.amount,
    category: input.category,
    memo,
    billId: input.billId,
    firstRunAt,
    nextRunAt: firstRunAt,
    intervalSeconds,
    runs,
    runsLeft: runs,
    status: 'active',
    createdBy: tx.userId,
    createdAt: tx.now,
    paymentIds: [],
  }
  tx.state.schedules.push(schedule)
  // Scheduled again: the old payment nothing ever paid is replaced by this schedule.
  if (replaced) tx.state.payments = tx.state.payments.filter((p) => p.id !== replaced.id)
  tx.activity(
    'payment_scheduled',
    `Scheduled ${usdText(input.amount)} to ${recipientName}`,
    { kind: 'schedule', id: schedule.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      amount: input.amount,
      subjectUserId: input.recipient.kind === 'member' ? input.recipient.userId : undefined,
    },
  )
  if (input.recipient.kind === 'member') {
    tx.notify(
      [input.recipient.userId],
      'Payment scheduled',
      `${usdText(input.amount)} from ${agencyNameOf(tx, input.agencyId)}: ${memo}.`,
      `/member/${input.agencyId}/payments`,
    )
  }
  return schedule
}

export type ScheduleRefInput = { scheduleId: Id }

/**
 * Pauses an active schedule: nothing is paid while it is paused. An Agency
 * Admin or the portfolio's Investor may; when the Investor pauses it, only the
 * Investor resumes it (as on the ledger).
 */
export function pauseSchedule(tx: Tx, input: ScheduleRefInput): Schedule {
  const schedule = requireManagedSchedule(tx, input.scheduleId)
  if (schedule.status !== 'active')
    throw new DomainError('invalid_state', 'Only an active scheduled payment can be paused.')
  const byInvestor = actsAsInvestor(tx.state, tx.userId, schedule.agencyId)
  schedule.status = 'paused'
  schedule.pausedByInvestor = byInvestor
  schedule.pausedBy = tx.userId
  schedule.pausedAt = tx.now
  changed(tx, schedule, 'Paused', byInvestor)
  return schedule
}

/**
 * Resumes a paused schedule. If the Investor paused it, only the Investor can.
 * Dates that passed while it was paused are skipped, not paid, and the runs
 * left stay the same, so it ends later (a single run that was due runs as soon
 * as possible): the ledger's own arithmetic (`resumeSchedule`).
 */
export function resumeSchedule(tx: Tx, input: ScheduleRefInput): Schedule {
  const schedule = requireManagedSchedule(tx, input.scheduleId)
  if (schedule.status !== 'paused')
    throw new DomainError('invalid_state', 'This scheduled payment is not paused.')
  const byInvestor = actsAsInvestor(tx.state, tx.userId, schedule.agencyId)
  if (schedule.pausedByInvestor && !byInvestor)
    throw new DomainError(
      'forbidden',
      'The Investor paused this payment, so only the Investor can resume it.',
    )
  schedule.status = 'active'
  schedule.pausedByInvestor = false
  delete schedule.pausedBy
  delete schedule.pausedAt
  // A failure noted before the pause was about a run that may now be on another date. The run
  // failing again is a new failure: `resumes` keeps its notice apart from the one before.
  delete schedule.failure
  schedule.resumes = (schedule.resumes ?? 0) + 1
  const now = ledgerSeconds(tx.now)
  let next = ledgerSeconds(schedule.nextRunAt)
  if (next <= now) {
    if (schedule.intervalSeconds === 0) next = now
    else {
      const skipped = Math.floor((now - next) / schedule.intervalSeconds) + 1
      next += skipped * schedule.intervalSeconds
    }
  }
  schedule.nextRunAt = new Date(next * 1000).toISOString()
  syncBill(tx, schedule)
  changed(tx, schedule, 'Resumed', byInvestor)
  return schedule
}

/** Cancels a schedule for good, active or paused. An Agency Admin or the portfolio's Investor may. */
export function cancelSchedule(tx: Tx, input: ScheduleRefInput): Schedule {
  const schedule = requireManagedSchedule(tx, input.scheduleId)
  if (schedule.status !== 'active' && schedule.status !== 'paused')
    throw new DomainError('invalid_state', 'This scheduled payment already ended.')
  stopSchedule(tx, schedule)
  changed(tx, schedule, 'Cancelled', actsAsInvestor(tx.state, tx.userId, schedule.agencyId))
  if (schedule.recipient.kind === 'member') {
    tx.notify(
      [schedule.recipient.userId],
      'Scheduled payment cancelled',
      `${usdText(schedule.amount)} from ${agencyNameOf(tx, schedule.agencyId)} will not be paid: ${schedule.memo}.`,
      `/member/${schedule.agencyId}/payments`,
    )
  }
  return schedule
}

/**
 * Cancels a schedule without the activity of `cancelSchedule` (paying or
 * rescheduling a scheduled bill replaces its schedule in the same transaction).
 * A bill it was paying goes back to "To pay".
 */
export function stopSchedule(tx: Tx, schedule: Schedule) {
  schedule.status = 'cancelled'
  schedule.cancelledBy = tx.userId
  schedule.cancelledAt = tx.now
  delete schedule.failure
  const bill = billOf(tx, schedule)
  if (bill && bill.status === 'scheduled') {
    bill.status = 'to_pay'
    delete bill.scheduledFor
    delete bill.scheduleId
  }
}

// ─── Payments scheduled before schedules existed ─────────────────────────────

export type DismissUnscheduledPaymentInput = { paymentId: Id }

/**
 * An Agency Admin dismisses a payment saved as scheduled before schedules
 * existed (`isUnscheduledPayment`): nothing ever paid it and nothing was
 * authorized for later, so it is simply dropped from the list (no money moved
 * for it, it has no receipt). Offchain only. "Schedule again" drops it the same
 * way once its new schedule is created (`replacesPaymentId`).
 */
export function dismissUnscheduledPayment(tx: Tx, input: DismissUnscheduledPaymentInput): { paymentId: Id } {
  const payment = tx.find('payments', input.paymentId, 'Payment')
  requireUnscheduledPayment(tx, payment.id, payment.agencyId)
  tx.state.payments = tx.state.payments.filter((p) => p.id !== payment.id)
  const recipient =
    payment.recipient.kind === 'address'
      ? payment.recipient.payee
      : scheduleRecipientName(tx, { recipient: payment.recipient })
  tx.activity(
    'schedule_updated',
    `Dismissed the never-paid ${usdText(payment.amount)} to ${recipient}`,
    { kind: 'payment', id: payment.id },
    {
      portfolioId: tx.portfolioOfAgency(payment.agencyId),
      agencyId: payment.agencyId,
      amount: payment.amount,
    },
  )
  return { paymentId: payment.id }
}

/**
 * A payment of `agencyId` saved as scheduled before schedules existed, that an
 * Agency Admin (`send_payment`) may schedule again or dismiss: still never paid,
 * and not a bill's (a bill is scheduled again from the bill).
 */
function requireUnscheduledPayment(tx: Tx, paymentId: Id, agencyId: Id): Payment {
  tx.authorize('send_payment', { agencyId })
  const payment = tx.state.payments.find((p) => p.id === paymentId && p.agencyId === agencyId)
  if (!payment)
    throw new DomainError(
      'invalid_state',
      'This payment was already scheduled again or dismissed. Refresh to see it.',
    )
  if (!isUnscheduledPayment(payment) || payment.billId)
    throw new DomainError(
      'invalid_state',
      'Only a payment that was never paid can be scheduled again or dismissed here.',
    )
  return payment
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

/** A schedule the actor may pause, resume or cancel. */
function requireManagedSchedule(tx: Tx, scheduleId: Id): Schedule {
  const schedule = tx.find('schedules', scheduleId, 'Scheduled payment')
  tx.authorize('manage_schedules', { agencyId: schedule.agencyId })
  return schedule
}

function billOf(tx: Tx, schedule: Schedule): Bill | undefined {
  return schedule.billId ? tx.state.bills.find((b) => b.id === schedule.billId) : undefined
}

/** A scheduled bill shows when its schedule is due. */
function syncBill(tx: Tx, schedule: Schedule) {
  const bill = billOf(tx, schedule)
  if (bill && bill.status === 'scheduled' && bill.scheduleId === schedule.id)
    bill.scheduledFor = schedule.nextRunAt
}

function agencyNameOf(tx: Tx, agencyId: Id) {
  return tx.state.agencies.find((a) => a.id === agencyId)?.name ?? 'your Agency'
}

/** Who a schedule pays, by name. */
export function scheduleRecipientName(tx: Tx, schedule: Pick<Schedule, 'recipient'>): string {
  return schedule.recipient.kind === 'member'
    ? tx.nameOf(schedule.recipient.userId)
    : (tx.state.destinations.find((d) => d.id === (schedule.recipient as { destinationId: Id }).destinationId)
        ?.name ?? 'Payment destination')
}

/** The activity of a pause, a resume or a cancellation; the Agency's Admins are told when the Investor acted. */
function changed(tx: Tx, schedule: Schedule, verb: 'Paused' | 'Resumed' | 'Cancelled', byInvestor: boolean) {
  const summary = `${verb} the scheduled ${usdText(schedule.amount)} to ${scheduleRecipientName(tx, schedule)}`
  tx.activity(
    'schedule_updated',
    summary,
    { kind: 'schedule', id: schedule.id },
    {
      portfolioId: tx.portfolioOfAgency(schedule.agencyId),
      agencyId: schedule.agencyId,
      amount: schedule.amount,
    },
  )
  if (byInvestor) {
    tx.notify(
      tx.holders('agency_admin', { agencyId: schedule.agencyId }),
      `Scheduled payment ${verb.toLowerCase()} by the Investor`,
      `${tx.actorName()} ${verb.toLowerCase()} the scheduled ${usdText(schedule.amount)} to ${scheduleRecipientName(tx, schedule)}.`,
      `/agency/${schedule.agencyId}/payments?tab=scheduled`,
    )
  }
}

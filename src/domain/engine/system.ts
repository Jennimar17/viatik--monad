import { newId } from '../ids'
import { cents, type Cents } from '../money'
import { isCreatorActive, nextRunNumber, scheduleRunPaymentId, toLedgerTime } from '../schedules'
import { accountBalance, budgetUsage } from '../selectors'
import type { Id, ISODate, Notification, Payment, Schedule, ViatikState } from '../types'
import { DomainError, requirePositive, usdText, type Tx } from './core'
import { checkAgencyPayment } from './operations'
import { scheduleRecipientName } from './schedules'

/**
 * Engine functions only the server runs, as `{ kind: 'system' }`, for things
 * that happened outside Viatik (a webhook from Alchemy) or that Viatik does on
 * its own when they are due (the keeper: scheduled payments and monthly
 * reminders, src/server/keeper.ts). They are deliberately not in the
 * `commands` map: every entry there can be called by any signed-in person
 * through `POST /v1/commands/:name`, which would let anyone forge them.
 */

/**
 * Where a person sees their Viatik account: an Investor on Add funds, a Member
 * on Payments, an Admin on their agency's overview (in that order when they
 * have several roles), and the home page for someone without a workspace yet.
 */
export function fundsArrivedHref(state: ViatikState, userId: Id): string {
  const active = state.memberships.filter((m) => m.userId === userId && m.status === 'active')
  for (const membership of active)
    if (membership.role === 'investor' && membership.scope.kind === 'portfolio')
      return `/investor/${membership.scope.portfolioId}/vaults/add-funds`
  for (const membership of active)
    if (membership.role === 'member' && membership.scope.kind === 'agency')
      return `/member/${membership.scope.agencyId}/payments`
  for (const membership of active)
    if (membership.role === 'agency_admin' && membership.scope.kind === 'agency')
      return `/agency/${membership.scope.agencyId}/overview`
  return '/'
}

/** Arrivals under 1.00 USD are not told: the balance still shows them, but they are not worth a notification. */
export const FUNDS_ARRIVED_MIN: Cents = cents(100)

/**
 * An unread "Funds arrived" created this recently already tells the person to
 * look at their account: money arriving meanwhile writes no second one.
 */
export const FUNDS_ARRIVED_QUIET_MS = 10 * 60 * 1000

export type FundsArrivedInput = {
  /** The person whose Viatik account received the money. */
  userId: Id
  amount: Cents
  /** Minted TestUSD (from 0x0, as "Get test funds" does): told as "Test funds arrived". */
  mint?: boolean
}

export type FundsArrivedOutcome =
  /** The "Funds arrived" written for the person. */
  | { status: 'notified'; notification: Notification }
  /** Viatik does not know this person yet (they never opened the app): nobody to tell. */
  | { status: 'unknown' }
  /** Under FUNDS_ARRIVED_MIN. */
  | { status: 'small' }
  /** They still have an unread "Funds arrived" from the last FUNDS_ARRIVED_QUIET_MS. */
  | { status: 'recent' }

/**
 * Money reached a person's Viatik account from outside Viatik: tells them, so
 * their screens read the balance again. Informational only: no balance in the
 * state changes (the account's balance is always read from Monad). Nothing is
 * written for someone Viatik does not know yet (never opened the app), for an
 * amount under FUNDS_ARRIVED_MIN, or while the person still has an unread
 * "Funds arrived" created in the last FUNDS_ARRIVED_QUIET_MS (it already tells
 * them to look), so a burst of transfers is one notification.
 *
 * Run it with an id seed derived from the transfer (`alchemy:<txHash>:<logIndex>`),
 * so the same transfer delivered twice is refused as `already_applied`. A
 * skipped arrival still claims the id its notification would have had, so a
 * transfer already told is refused that way whatever else arrived since.
 */
export function noteFundsArrived(tx: Tx, input: FundsArrivedInput): FundsArrivedOutcome {
  if (tx.actor.kind !== 'system')
    throw new DomainError('forbidden', 'Only Viatik can record money arriving from outside.')
  requirePositive(input.amount)
  if (!tx.state.users.some((user) => user.id === input.userId)) return { status: 'unknown' }

  const now = Date.parse(tx.now)
  const skip =
    input.amount < FUNDS_ARRIVED_MIN
      ? 'small'
      : tx.state.notifications.some(
            (n) =>
              n.userId === input.userId &&
              n.kind === 'funds_arrived' &&
              !n.readAt &&
              now - Date.parse(n.createdAt) < FUNDS_ARRIVED_QUIET_MS,
          )
        ? 'recent'
        : null
  if (skip) {
    // The id its notification would have had: `execute` refuses it as already_applied if it exists.
    newId('ntf')
    return { status: skip }
  }

  tx.notify(
    [input.userId],
    input.mint ? 'Test funds arrived' : 'Funds arrived',
    `${usdText(input.amount)}${input.mint ? ' of test funds' : ''} arrived in your Viatik account.`,
    fundsArrivedHref(tx.state, input.userId),
    'funds_arrived',
  )
  return { status: 'notified', notification: tx.state.notifications[0]! }
}

// ─── Scheduled payments (the keeper) ─────────────────────────────────────────

/** Only the keeper (the server, as `{ kind: 'system' }`) runs these. */
function requireKeeper(tx: Tx) {
  if (tx.actor.kind !== 'system')
    throw new DomainError('forbidden', 'Only Viatik runs scheduled payments when they are due.')
}

/** Where an Agency's Admins see their scheduled payments. */
export const scheduledPaymentsHref = (agencyId: Id) => `/agency/${agencyId}/payments?tab=scheduled`

export type RunScheduledPaymentInput = {
  scheduleId: Id
  /**
   * When this run was due on the ledger (`getSchedule().nextRunAt`); the app's
   * own date when absent. After a resume the two can differ by seconds, and
   * the next run follows the ledger's.
   */
  dueAt?: ISODate
}

/**
 * The keeper pays the due run of a schedule: an ordinary completed payment
 * (`<scheduleId>_run<n>`, its receipt and money movement), as the ledger's
 * `runSchedule` records it. Everything is checked again now, as the ledger
 * does (the schedule is active and due, its Admin still holds the role, the
 * payee is still in the Agency, the budget's rules and the exception
 * threshold), plus what the app checks by hand (an approved vendor, the money
 * available). A refusal here means nothing is sent: the run stays due and the
 * keeper notes it (`noteScheduleFailed`). A run moves the schedule on (or
 * completes it), pays a linked bill and tells the payee and the Admin.
 *
 * Run it with the id seed `keeper:<scheduleId>:<run>`, so the same run applied
 * twice is refused (`already_applied`).
 */
export function runScheduledPayment(tx: Tx, input: RunScheduledPaymentInput): Payment {
  requireKeeper(tx)
  const schedule = tx.find('schedules', input.scheduleId, 'Scheduled payment')
  if (schedule.status === 'paused')
    throw new DomainError('invalid_state', 'This scheduled payment is paused.')
  if (schedule.status !== 'active' || schedule.runsLeft <= 0)
    throw new DomainError('invalid_state', 'This scheduled payment already ended.')
  const dueAt = toLedgerTime(input.dueAt ?? schedule.nextRunAt)
  if (Date.parse(tx.now) < Date.parse(dueAt))
    throw new DomainError('invalid_state', 'This scheduled payment is not due yet.')
  const run = nextRunNumber(schedule)
  const paymentId = scheduleRunPaymentId(schedule.id, run)
  if (tx.state.payments.some((p) => p.id === paymentId))
    throw new DomainError('already_applied', 'This run was already paid. Refresh to see it.')
  if (isCreatorActive(tx.state, schedule) !== true) {
    throw new DomainError(
      'forbidden',
      `${tx.nameOf(schedule.createdBy)} is no longer an Agency Admin, so this scheduled payment stopped. Cancel it, and schedule it again if it is still needed.`,
    )
  }
  const { account, budget, portfolioId, recipientName } = checkAgencyPayment(tx, {
    agencyId: schedule.agencyId,
    recipient: schedule.recipient,
    accountId: schedule.sourceAccountId,
    budgetId: schedule.budgetId,
    amount: schedule.amount,
  })
  const available = budget
    ? budgetUsage(tx.state, budget, tx.now).available
    : accountBalance(tx.state, account.id)
  if (available < schedule.amount) {
    throw new DomainError(
      'insufficient_funds',
      `${budget ? budget.name : account.name} has ${usdText(available)} available.`,
    )
  }

  const creator = tx.nameOf(schedule.createdBy)
  const payment: Payment = {
    id: paymentId,
    agencyId: schedule.agencyId,
    type: schedule.type,
    sourceAccountId: account.id,
    budgetId: budget?.id,
    recipient: schedule.recipient,
    amount: schedule.amount,
    category: schedule.category,
    memo: schedule.memo,
    status: 'completed',
    createdBy: { kind: 'user', userId: schedule.createdBy },
    scheduledFor: dueAt,
    completedAt: tx.now,
    billId: schedule.billId,
    scheduleId: schedule.id,
    scheduleRun: run,
  }
  const receipt = tx.receipt({
    kind: 'payment',
    amount: schedule.amount,
    fromLabel: budget ? `${account.name} · ${budget.name}` : account.name,
    toLabel: recipientName,
    description: schedule.memo,
    policyLabel: `Scheduled by ${creator} · paid automatically when due${
      budget ? ` · per-operation limit ${usdText(budget.perOperationLimit)}` : ''
    }`,
    operationId: payment.id,
    portfolioId,
    agencyId: schedule.agencyId,
  })
  tx.move(
    'payment',
    schedule.amount,
    budget ? { kind: 'budget', budgetId: budget.id } : { kind: 'account', accountId: account.id },
    { kind: 'recipient', recipient: schedule.recipient },
    { portfolioId, agencyId: schedule.agencyId, refId: payment.id, receiptId: receipt.id },
  )
  payment.receiptId = receipt.id
  tx.state.payments.push(payment)

  // The ledger's arithmetic: one run fewer; completed at zero, otherwise the next date one interval on.
  schedule.runsLeft -= 1
  schedule.paymentIds.push(payment.id)
  delete schedule.failure
  if (schedule.runsLeft === 0) {
    schedule.status = 'completed'
    schedule.completedAt = tx.now
    schedule.nextRunAt = dueAt
  } else {
    schedule.nextRunAt = new Date(Date.parse(dueAt) + schedule.intervalSeconds * 1000).toISOString()
  }
  const bill = schedule.billId ? tx.state.bills.find((b) => b.id === schedule.billId) : undefined
  if (bill && bill.scheduleId === schedule.id && bill.status === 'scheduled') {
    bill.status = 'paid'
    bill.paymentId = payment.id
    delete bill.scheduledFor
  }

  tx.activity(
    'payment_completed',
    `Paid the scheduled ${usdText(schedule.amount)} to ${recipientName}`,
    { kind: 'payment', id: payment.id },
    {
      portfolioId,
      agencyId: schedule.agencyId,
      amount: schedule.amount,
      subjectUserId: schedule.recipient.kind === 'member' ? schedule.recipient.userId : undefined,
    },
  )
  const agency = tx.state.agencies.find((a) => a.id === schedule.agencyId)?.name ?? 'your Agency'
  if (schedule.recipient.kind === 'member') {
    tx.notify(
      [schedule.recipient.userId],
      'Payment received',
      `${usdText(schedule.amount)} from ${agency}: ${schedule.memo}.`,
      `/member/${schedule.agencyId}/payments`,
    )
  }
  tx.notify(
    [schedule.createdBy],
    'Scheduled payment paid',
    `${usdText(schedule.amount)} to ${recipientName} was paid as scheduled.`,
    `/receipts/${receipt.id}`,
  )
  return payment
}

export type NoteScheduleFailedInput = {
  scheduleId: Id
  /** The run that could not be paid (1 = the first). */
  run: number
  /** A domain or ledger error code. */
  code: string
  /** Product language, safe to show to the Agency's Admins and Investors. */
  message: string
  /**
   * Notes it without telling anyone: its notice was already given under the id
   * seed it would use (`noteFailure` falls back to this when that seed collides),
   * so the schedule still shows "Needs attention".
   */
  quiet?: boolean
}

export type ScheduleFailedOutcome =
  /** First failure of this run: noted, and the Agency's Admins told. */
  | { status: 'noted'; schedule: Schedule }
  /** This run already failed for another reason: the reason is updated, nobody is told again. */
  | { status: 'updated'; schedule: Schedule }
  /** Already noted with this reason, or the schedule is not active any more: nothing changes. */
  | { status: 'known' }

/**
 * A due run could not be paid (refused by the app's rules, or by the ledger's
 * when it was simulated or sent). It stays due and the keeper tries it again
 * on every pass; the schedule shows "Needs attention" until a run pays (or an
 * Admin pauses or cancels it). The Agency's Admins are told once per run, and
 * once more if it fails again after a resume (which clears the failure).
 * Run it with the id seed `keeperFailureSeed` (by schedule, run, reason and
 * resumes), and with `quiet` when that seed was already used.
 */
export function noteScheduleFailed(tx: Tx, input: NoteScheduleFailedInput): ScheduleFailedOutcome {
  requireKeeper(tx)
  const schedule = tx.find('schedules', input.scheduleId, 'Scheduled payment')
  if (schedule.status !== 'active' || input.run !== nextRunNumber(schedule)) return { status: 'known' }
  const previous = schedule.failure
  if (previous?.run === input.run && previous.code === input.code) return { status: 'known' }
  schedule.failure = { run: input.run, code: input.code, message: input.message, at: tx.now }
  if (previous?.run === input.run || input.quiet) return { status: 'updated', schedule }

  const recipientName = scheduleRecipientName(tx, schedule)
  const portfolioId = tx.portfolioOfAgency(schedule.agencyId)
  tx.activity(
    'schedule_failed',
    `Could not pay the scheduled ${usdText(schedule.amount)} to ${recipientName}`,
    { kind: 'schedule', id: schedule.id },
    { portfolioId, agencyId: schedule.agencyId, amount: schedule.amount },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: schedule.agencyId }),
    'Scheduled payment needs attention',
    `${usdText(schedule.amount)} to ${recipientName} is due and could not be paid: ${input.message} It is tried again each time due payments run.`,
    scheduledPaymentsHref(schedule.agencyId),
  )
  return { status: 'noted', schedule }
}

export type NoteReminderDueInput = {
  reminderId: Id
  /** The due day (YYYY-MM-DD) being told. */
  dueDay: string
  /** The due day already passed when it is told. */
  overdue?: boolean
}

/**
 * A monthly payment's due day has come (`remindersToNotify`): its Agency's
 * Admins are told. Nothing else changes. Run it with the id seed
 * `reminder:<reminderId>:<dueDay>`, so each due day is told once
 * (`already_applied` the second time).
 */
export function noteReminderDue(tx: Tx, input: NoteReminderDueInput): { notified: Id[] } {
  requireKeeper(tx)
  const reminder = tx.find('reminders', input.reminderId, 'Reminder')
  if (reminder.status !== 'active') return { notified: [] }
  const admins = [...new Set(tx.holders('agency_admin', { agencyId: reminder.agencyId }))]
  const amount = reminder.amount ? ` (${usdText(reminder.amount)})` : ''
  tx.notify(
    admins,
    input.overdue ? 'Monthly payment overdue' : 'Monthly payment due today',
    `${reminder.title}: pay ${reminder.payee}${amount} and upload its invoice.`,
    `/agency/${reminder.agencyId}/bills?tab=monthly`,
  )
  return { notified: admins }
}

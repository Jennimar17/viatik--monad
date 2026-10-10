import { cents, clampToZero, min, sum, type Cents } from './money'
import { isOutsidePayment } from './queries'
import { memberHeld } from './selectors'
import type { Expense, Id, ISODate, Movement, Payment, PaymentRequest, Reminder, ViatikState } from './types'

/**
 * Accountability: what people still have to justify with receipts, and what
 * the Agency Admin still has to document. Nothing here is stored: everything
 * is derived from payments, expenses, movements and activity, so it reads the
 * same in the engine and on a viewer's scoped state (a Member sees their own).
 */

/** A person justifies money for purchases (an advance) within this many days of receiving it. */
export const JUSTIFY_WITHIN_DAYS = 30
/** An Agency Admin attaches the invoice of an outside payment within this many days. */
export const PROOF_WITHIN_DAYS = 7
/** An Agency Admin reminds the same person about receipts at most this often. */
export const REMIND_EVERY_HOURS = 24

const DAY_MS = 24 * 60 * 60 * 1000

export function addDays(iso: ISODate, days: number): ISODate {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString()
}

/** `a` is strictly later than `b` (parsed, so date-only and full timestamps compare correctly). */
const isAfter = (a: ISODate, b: ISODate) => Date.parse(a) > Date.parse(b)

/** Newest first, by the given date. */
const newestFirst =
  <T>(dateOf: (item: T) => ISODate) =>
  (a: T, b: T) =>
    Date.parse(dateOf(b)) - Date.parse(dateOf(a))

/**
 * When a payment's money arrived (scheduled payments have not arrived yet). Due dates
 * (receipts, invoices, monthly payments) count from it, so screens use it too.
 */
export const paidAt = (payment: Pick<Payment, 'completedAt' | 'scheduledFor'>): ISODate =>
  payment.completedAt ?? payment.scheduledFor

/** A completed advance: money paid into a person's Viatik balance for purchases. */
export type AdvancePayment = Payment & { type: 'advance'; recipient: { kind: 'member'; userId: Id } }

/** Money a person requested for purchases and received: they justify it with receipts or return the rest. */
export const isAdvance = (p: Payment): p is AdvancePayment =>
  p.type === 'advance' && p.recipient.kind === 'member' && p.status === 'completed'

export type AdvanceStanding = {
  payment: Payment
  request?: PaymentRequest
  userId: Id
  agencyId: Id
  amount: Cents
  /** Expenses linked to this advance. */
  expenses: Expense[]
  /** Give-backs that settle this advance. */
  returns: Movement[]
  /** Linked expenses with a receipt. */
  justified: Cents
  /** Given back to the Agency for this advance. */
  returned: Cents
  /** Still to justify or return. */
  pending: Cents
  dueAt: ISODate
  /** Something is still pending after the due date. */
  overdue: boolean
  settled: boolean
}

/** Where one advance stands: justified with receipts, given back, and what is still pending. */
export function advanceStanding(state: ViatikState, payment: Payment, now: ISODate): AdvanceStanding {
  const userId = payment.recipient.kind === 'member' ? payment.recipient.userId : ''
  const expenses = state.expenses.filter((e) => e.paymentId === payment.id && e.agencyId === payment.agencyId)
  const returns = state.movements.filter((m) => m.settlesPaymentId === payment.id)
  // Only an uploaded receipt justifies money: a declared amount without one does not.
  const justified = sum(
    expenses.filter((e) => e.receipt?.kind === 'file'),
    (e) => e.amount,
  )
  const returned = sum(returns, (m) => m.amount)
  const pending = clampToZero(cents(payment.amount - justified - returned))
  const dueAt = addDays(paidAt(payment), JUSTIFY_WITHIN_DAYS)
  return {
    payment,
    request: payment.requestId ? state.requests.find((r) => r.id === payment.requestId) : undefined,
    userId,
    agencyId: payment.agencyId,
    amount: payment.amount,
    expenses,
    returns,
    justified,
    returned,
    pending,
    dueAt,
    overdue: pending > 0 && isAfter(now, dueAt),
    settled: pending === 0,
  }
}

/** A person's (or everyone's) advances in an Agency, newest first. */
export function advancesOf(
  state: ViatikState,
  f: { agencyId: Id; userId?: Id },
  now: ISODate,
): AdvanceStanding[] {
  return state.payments
    .filter(isAdvance)
    .filter((p) => p.agencyId === f.agencyId && (!f.userId || p.recipient.userId === f.userId))
    .sort(newestFirst(paidAt))
    .map((p) => advanceStanding(state, p, now))
}

/** What "Return the rest" can give back now: the pending part, but only what is still in the Viatik balance. */
export function returnableFor(state: ViatikState, s: AdvanceStanding): Cents {
  const held = clampToZero(cents(memberHeld(state, s.agencyId, s.userId)))
  return min(s.pending, held)
}

/**
 * What a person can give back as "Other money" (a return that names no money
 * for purchases): their Viatik balance in the Agency beyond what their open
 * advances still have pending. Unused money for purchases goes back against
 * the advance it came from ("Return the rest", capped by `returnableFor`), so
 * it never leaves as other money and its advance never stays pending after it.
 */
export function otherMoneyReturnable(
  state: ViatikState,
  f: { agencyId: Id; userId: Id },
  now: ISODate,
): Cents {
  const held = memberHeld(state, f.agencyId, f.userId)
  const pending = sum(advancesOf(state, f, now), (s) => s.pending)
  return clampToZero(cents(held - pending))
}

/** Expenses still missing a receipt that are not advance expenses (vendor-payment expenses). */
export function missingReceipts(state: ViatikState, f: { agencyId: Id; userId?: Id }): Expense[] {
  const advanceIds = new Set(state.payments.filter((p) => p.type === 'advance').map((p) => p.id))
  return state.expenses
    .filter(
      (e) =>
        e.agencyId === f.agencyId &&
        (!f.userId || e.userId === f.userId) &&
        !e.receipt &&
        !(e.paymentId && advanceIds.has(e.paymentId)),
    )
    .sort(newestFirst((e: Expense) => e.spentAt))
}

export type ProofStanding = { payment: Payment; dueAt: ISODate; overdue: boolean }

/** Outside payments still waiting for their invoice, the one due first at the top. */
export function outsidePaymentsWithoutProof(state: ViatikState, agencyId: Id, now: ISODate): ProofStanding[] {
  return state.payments
    .filter((p) => p.agencyId === agencyId && isOutsidePayment(p) && p.status === 'completed' && !p.proof)
    .map((payment) => {
      const dueAt = addDays(paidAt(payment), PROOF_WITHIN_DAYS)
      return { payment, dueAt, overdue: isAfter(now, dueAt) }
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
}

export type PersonAccountability = {
  userId: Id
  /** Still to justify or return, across their open advances. */
  pending: Cents
  /** The part of `pending` that is past its due date. */
  overdue: Cents
  overdueCount: number
  /** Vendor-payment expenses without a receipt. */
  missingReceipts: number
  /** Their open advances (something still pending), newest first. */
  advances: AdvanceStanding[]
  lastRemindedAt?: ISODate
}

/** Everyone in an Agency with something open: pending advances or missing receipts. Most overdue first. */
export function accountabilityByPerson(
  state: ViatikState,
  agencyId: Id,
  now: ISODate,
): PersonAccountability[] {
  const open = advancesOf(state, { agencyId }, now).filter((s) => s.pending > 0)
  const missing = missingReceipts(state, { agencyId })
  const userIds = new Set([...open.map((s) => s.userId), ...missing.map((e) => e.userId)])
  return [...userIds]
    .map((userId) => {
      const advances = open.filter((s) => s.userId === userId)
      const late = advances.filter((s) => s.overdue)
      return {
        userId,
        pending: sum(advances, (s) => s.pending),
        overdue: sum(late, (s) => s.pending),
        overdueCount: late.length,
        missingReceipts: missing.filter((e) => e.userId === userId).length,
        advances,
        lastRemindedAt: lastReminded(state, agencyId, userId),
      }
    })
    .sort((a, b) => b.overdue - a.overdue || b.pending - a.pending || b.missingReceipts - a.missingReceipts)
}

export type AgencyAccountability = {
  agencyId: Id
  pending: Cents
  overdue: Cents
  peopleOverdue: number
  missingReceipts: number
  withoutProof: ProofStanding[]
  proofOverdue: number
}

/** An Agency's open accountability: people's pending money and outside payments without an invoice. */
export function agencyAccountability(state: ViatikState, agencyId: Id, now: ISODate): AgencyAccountability {
  const people = accountabilityByPerson(state, agencyId, now)
  const withoutProof = outsidePaymentsWithoutProof(state, agencyId, now)
  return {
    agencyId,
    pending: sum(people, (p) => p.pending),
    overdue: sum(people, (p) => p.overdue),
    peopleOverdue: people.filter((p) => p.overdueCount > 0).length,
    missingReceipts: people.reduce((total, p) => total + p.missingReceipts, 0),
    withoutProof,
    proofOverdue: withoutProof.filter((p) => p.overdue).length,
  }
}

/** One entry per Agency of the Portfolio. */
export function portfolioAccountability(
  state: ViatikState,
  portfolioId: Id,
  now: ISODate,
): AgencyAccountability[] {
  return state.agencies
    .filter((a) => a.portfolioId === portfolioId)
    .map((a) => agencyAccountability(state, a.id, now))
}

/** When this person was last reminded about receipts in this agency (from receipts_reminded activities). */
export function lastReminded(state: ViatikState, agencyId: Id, userId: Id): ISODate | undefined {
  let latest: ISODate | undefined
  for (const a of state.activity) {
    if (a.type !== 'receipts_reminded' || a.agencyId !== agencyId || a.subjectUserId !== userId) continue
    if (!latest || isAfter(a.createdAt, latest)) latest = a.createdAt
  }
  return latest
}

export type ReminderDue = { reminder: Reminder; dueAt: ISODate; overdue: boolean; lastPayment?: Payment }

/** The `dayOfMonth` of the month `monthsLater` after `from`'s month (UTC midnight, like other due dates). */
function dayOfMonthAfter(from: ISODate, monthsLater: number, dayOfMonth: number): ISODate {
  const date = new Date(Date.parse(from))
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthsLater, dayOfMonth)).toISOString()
}

/**
 * Active reminders and their next due date: the dayOfMonth of the month after the last linked payment
 * (or of the creation month when never paid); overdue = now > dueAt. Due first at the top.
 */
export function remindersDue(state: ViatikState, agencyId: Id, now: ISODate): ReminderDue[] {
  return state.reminders
    .filter((r) => r.agencyId === agencyId && r.status === 'active')
    .map((reminder) => {
      const lastPayment = state.payments
        .filter((p) => p.reminderId === reminder.id && p.agencyId === agencyId && p.status === 'completed')
        .sort(newestFirst(paidAt))[0]
      const dueAt = lastPayment
        ? dayOfMonthAfter(paidAt(lastPayment), 1, reminder.dayOfMonth)
        : dayOfMonthAfter(reminder.createdAt, 0, reminder.dayOfMonth)
      return { reminder, dueAt, overdue: isAfter(now, dueAt), lastPayment }
    })
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
}

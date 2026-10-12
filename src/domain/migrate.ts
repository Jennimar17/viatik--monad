import type { ViatikState } from './types'

/**
 * A stored state may predate fields that screens now read. Fills them with empty
 * defaults, so a world saved by an older version keeps working. Changes the
 * state in place and returns it.
 */
export function upgradeState(state: ViatikState): ViatikState {
  state.payoutAddresses ??= []
  state.reminders ??= []
  state.schedules ??= []
  if (state.keeper) state.keeper.agencies ??= {}
  forgetPhantomSchedules(state)
  relabelSeededReferences(state)
  return state
}

/**
 * The payment references the seed gave its providers before they read as references: labels
 * that looked like a payment method (a card, an account), though no provider has one. Each
 * maps to the seed's reference now, with the same digits.
 */
const SEEDED_REFERENCES = new Map([
  ['Card on file •• 1107', 'Customer no. 1107'],
  ['Card on file •• 6612', 'Customer no. 6612'],
  ['USDC account •• 4821', 'Customer no. 4821'],
  ['USDC account •• 9f3a', 'Customer no. 9f3a'],
  ['USDC account •• 7730', 'Customer no. 7730'],
  ['USDC account •• 2204', 'Customer no. 2204'],
  ['USDC account •• 5518', 'Customer no. 5518'],
  ['USDC account •• 3190', 'Customer no. 3190'],
  ['USDC account •• 8045', 'Customer no. 8045'],
])

/**
 * Worlds seeded before (production, saved demo data) keep those labels: only the exact seeded
 * values are relabelled, so whatever an Admin typed stays as it is. Providers are not on the
 * ledger, so nothing else changes. Runs on every read and changes nothing once applied.
 */
function relabelSeededReferences(state: ViatikState) {
  for (const destination of state.destinations) {
    const reference = SEEDED_REFERENCES.get(destination.settlementLabel)
    if (reference) destination.settlementLabel = reference
  }
}

/**
 * Before scheduled payments ran on Monad, a payment or bill with a future date
 * was only saved as "scheduled", and nothing ever paid it. None of them was
 * authorized on the ledger, so none can become a schedule:
 * - a bill waiting on such a payment (or on no schedule at all) goes back to
 *   "To pay", where it can be paid or scheduled again; the never-paid payment
 *   behind it is dropped (no money moved for it, it had no receipt);
 * - any other such payment stays in the history as `action_required`, never
 *   paid (`isUnscheduledPayment`), so screens offer to schedule it again.
 * Runs on every read and changes nothing once applied.
 */
function forgetPhantomSchedules(state: ViatikState) {
  const phantom = (p: ViatikState['payments'][number]) =>
    p.status === 'scheduled' && !p.scheduleId && !p.completedAt && !p.receiptId
  if (!state.payments.some(phantom) && !state.bills.some((b) => b.status === 'scheduled')) return

  const live = new Set(
    state.schedules.filter((s) => s.status === 'active' || s.status === 'paused').map((s) => s.id),
  )
  const dropped = new Set<string>()
  for (const payment of state.payments) {
    if (!phantom(payment)) continue
    if (payment.billId) dropped.add(payment.id)
    else payment.status = 'action_required'
  }
  if (dropped.size > 0) state.payments = state.payments.filter((p) => !dropped.has(p.id))
  for (const bill of state.bills) {
    if (bill.status !== 'scheduled' || (bill.scheduleId && live.has(bill.scheduleId))) continue
    bill.status = 'to_pay'
    delete bill.scheduledFor
    delete bill.scheduleId
    if (bill.paymentId && !state.payments.some((p) => p.id === bill.paymentId)) delete bill.paymentId
  }
}

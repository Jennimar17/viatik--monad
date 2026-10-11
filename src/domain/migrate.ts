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
  return state
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

import { newId } from '../ids'
import { cents, type Cents } from '../money'
import type { Id, Notification, ViatikState } from '../types'
import { DomainError, requirePositive, usdText, type Tx } from './core'

/**
 * Engine functions only the server runs, as `{ kind: 'system' }`, for things
 * that happened outside Viatik (a webhook from Alchemy). They are deliberately
 * not in the `commands` map: every entry there can be called by any signed-in
 * person through `POST /v1/commands/:name`, which would let anyone forge them.
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
    'Funds arrived',
    `${usdText(input.amount)} arrived in your Viatik account.`,
    fundsArrivedHref(tx.state, input.userId),
    'funds_arrived',
  )
  return { status: 'notified', notification: tx.state.notifications[0]! }
}

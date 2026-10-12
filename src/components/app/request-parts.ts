import type { Option } from '@/components/app/form-controls'
import { JUSTIFY_WITHIN_DAYS, type AdvanceStanding } from '@/domain/accountability'
import { requestTypeLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { budgetName, destinationName, userName } from '@/domain/queries'
import type { Id, PaymentRequest, RequestType, ViatikState } from '@/domain/types'
import { formatDate } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

/**
 * Shared words for requests and the money they pay: where it goes, what each
 * request type means once paid, and how money for purchases stands. Used by
 * the Agency Admin's approvals and review sheet, the Investor's exceptions and
 * the Member's request pages, so every screen says the same thing.
 */

/** Request types that pay the requester's own Viatik balance instead of a vendor. */
export const PAYS_REQUESTER: ReadonlySet<RequestType> = new Set(['funds', 'reimbursement', 'work'])

/** The request types in the order filters and pickers list them. */
export const REQUEST_TYPES: readonly RequestType[] = [
  'funds',
  'reimbursement',
  'work',
  'vendor_payment',
  'automation',
]

/** "All types" plus one option per request type, for a Type filter (value 'all' means no filter). */
export const requestTypeOptions: Option[] = [
  { value: 'all', label: 'All types' },
  ...REQUEST_TYPES.map((type) => ({ value: type, label: requestTypeLabel[type] })),
]

/**
 * Where a request's money goes, as the reader sees it: the vendor, or a
 * person's Viatik balance ("Your Viatik balance" when the reader is that person).
 */
export function requestRecipientLabel(
  state: ViatikState,
  request: Pick<PaymentRequest, 'destination'>,
  viewerUserId?: Id,
): string {
  const { destination } = request
  if (destination.kind === 'destination') return destinationName(state, destination.destinationId)
  return destination.userId === viewerUserId
    ? 'Your Viatik balance'
    : `${userName(state, destination.userId)}’s Viatik balance`
}

/**
 * What a request type asks of the person it pays, once paid: money for purchases
 * is justified with receipts or returned. Undefined when nothing follows.
 */
export function requestFollowUp(
  state: ViatikState,
  request: Pick<PaymentRequest, 'type' | 'destination'>,
  viewerUserId?: Id,
): string | undefined {
  const { destination } = request
  // Requests from before money for purchases paid the requester went to a vendor: nothing to justify.
  if (request.type !== 'funds' || destination.kind !== 'member') return undefined
  if (destination.userId === viewerUserId) {
    return `Add its receipts within ${JUSTIFY_WITHIN_DAYS} days or return what you do not use.`
  }
  return `${userName(state, destination.userId)} adds its receipts within ${JUSTIFY_WITHIN_DAYS} days or returns what they do not use.`
}

/** Per-type words for one request, as its reader sees them. */
export type RequestTypeCopy = {
  /** "Money for purchases", "Payment for work"… (also the row's tag). */
  label: string
  /** A short line for queue rows: what follows once it is paid. */
  rowNote: string
  /** What the reviewer should know about this type before deciding (review sheet). */
  reviewNote: string
  /** What approving it does, in one sentence (the review sheet's summary). */
  what: string
  /** What happened, once it is paid (the review sheet's success message). */
  paid: string
}

/**
 * Everything a review screen says about a request's type:
 * - funds: paid into the requester's Viatik balance, justified with receipts within 30 days;
 * - reimbursement: a pay-back for something already bought, with its receipt and merchant;
 * - work: always reviewed by an Agency Admin, nothing to justify afterwards;
 * - vendor payment / AI Agent payment: paid straight to the vendor.
 * `viewerUserId` turns "Alex’s Viatik balance" into "your Viatik balance" for the requester.
 */
export function requestTypeCopy(
  state: ViatikState,
  request: Pick<
    PaymentRequest,
    'type' | 'destination' | 'amount' | 'budgetId' | 'purpose' | 'merchant' | 'spentAt'
  >,
  viewerUserId?: Id,
): RequestTypeCopy {
  const amount = formatUsd(request.amount, { withCode: true })
  const budget = budgetName(state, request.budgetId)
  const label = requestTypeLabel[request.type]
  const { destination } = request

  // Paid to a vendor (vendor and AI Agent payments, and money for purchases from before it paid the requester).
  if (destination.kind === 'destination') {
    const vendor = destinationName(state, destination.destinationId)
    return {
      label,
      rowNote: `Paid straight to ${vendor}`,
      reviewNote:
        request.type === 'automation'
          ? 'An AI Agent payment: paid straight to an approved vendor, within the Agent’s caps.'
          : 'Paid straight to the vendor. Nobody holds the money in between.',
      what: `${amount} is paid from ${budget} straight to ${vendor} for “${request.purpose}”.`,
      paid: `${amount} was paid to ${vendor}.`,
    }
  }

  const own = destination.userId === viewerUserId
  const name = userName(state, destination.userId)
  const balance = own ? 'your Viatik balance' : `${name}’s Viatik balance`

  if (request.type === 'funds') {
    return {
      label,
      rowNote: `Receipts within ${JUSTIFY_WITHIN_DAYS} days`,
      reviewNote: `Money for purchases must be justified with receipts within ${JUSTIFY_WITHIN_DAYS} days; what is not used goes back to the Agency.`,
      what: own
        ? `${amount} goes from ${budget} into your Viatik balance to buy “${request.purpose}”. You add its receipts within ${JUSTIFY_WITHIN_DAYS} days or return what you do not use.`
        : `${amount} goes from ${budget} into ${balance} to buy “${request.purpose}”. ${name} adds its receipts within ${JUSTIFY_WITHIN_DAYS} days or returns what they do not use.`,
      paid: own
        ? `${amount} is in your Viatik balance. Add its receipts within ${JUSTIFY_WITHIN_DAYS} days or return what you do not use.`
        : `${amount} is in ${balance}. ${name} has ${JUSTIFY_WITHIN_DAYS} days to add its receipts or return the rest.`,
    }
  }

  if (request.type === 'reimbursement') {
    const where = request.merchant ? ` at ${request.merchant}` : ''
    const when = request.spentAt ? ` on ${formatDate(request.spentAt)}` : ''
    return {
      label,
      rowNote: request.merchant ? `Paid at ${request.merchant}` : 'Pay-back with its receipt',
      reviewNote: 'A pay-back for something already bought: check the receipt, the merchant and the date.',
      what: `${amount} goes from ${budget} into ${balance} to pay back what ${own ? 'you' : name} spent${where}${when}. Its receipt is attached.`,
      paid: `${amount} is back in ${balance}.`,
    }
  }

  if (request.type === 'work') {
    return {
      label,
      rowNote: 'Always reviewed by an Agency Admin',
      reviewNote:
        'Payment for work is always reviewed by an Agency Admin, whatever the amount. Nothing to justify afterwards.',
      what: `${amount} goes from ${budget} into ${balance} as payment for “${request.purpose}”. Nothing to justify afterwards.`,
      paid: `${amount} is in ${balance}.`,
    }
  }

  // A vendor or AI Agent payment paying a person's balance does not happen; say plainly where it goes.
  return {
    label,
    rowNote: `Paid into ${balance}`,
    reviewNote: `Paid into ${balance}.`,
    what: `${amount} goes from ${budget} into ${balance} for “${request.purpose}”.`,
    paid: `${amount} is in ${balance}.`,
  }
}

// ─── Money for purchases (advances) ──────────────────────────────────────────

/** What an advance was for: its request's purpose, or the payment's memo. */
export const advanceTitle = (s: Pick<AdvanceStanding, 'request' | 'payment'>): string =>
  s.request?.purpose ?? s.payment.memo

/**
 * "due Nov 1, 2026", "overdue since Oct 1, 2026" or "justified", lowercase to follow
 * other details. `short` drops the year, for dense rows. The deadline is an instant (30 days
 * after the payment), so it reads on the viewer's clock like the day it was received.
 * `timeZone` replaces the viewer's (tests).
 */
export function advanceDueText(
  s: Pick<AdvanceStanding, 'dueAt' | 'overdue' | 'settled'>,
  { short = false, timeZone }: { short?: boolean; timeZone?: string } = {},
): string {
  if (s.settled) return 'justified'
  const date = formatLocalDate(s.dueAt, { withYear: !short, timeZone })
  return s.overdue ? `overdue since ${date}` : `due ${date}`
}

/**
 * What still has to happen to an advance, as a sentence: for the person who
 * received it ("Add its receipts by Nov 1…"), or about them ("Alex adds…").
 */
export function advanceFollowUp(
  state: ViatikState,
  s: Pick<AdvanceStanding, 'userId' | 'dueAt' | 'overdue' | 'settled'>,
  viewerUserId?: Id,
): string {
  const due = formatLocalDate(s.dueAt)
  if (s.settled) return 'Justified: receipts and returns cover all of it.'
  if (s.userId === viewerUserId) {
    return s.overdue
      ? `Overdue since ${due}: add receipts or return the rest.`
      : `Add its receipts by ${due} or return what you do not use.`
  }
  const name = userName(state, s.userId)
  return s.overdue
    ? `Overdue since ${due}: ${name} still has to add receipts or return the rest.`
    : `${name} adds its receipts by ${due} or returns what they do not use.`
}

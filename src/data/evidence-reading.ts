import { z } from 'zod'

import { advancesOf, outsidePaymentsWithoutProof, paidAt } from '@/domain/accountability'
import { cents, formatUsd, type Cents } from '@/domain/money'
import type { Id, ISODate, Reminder, ViatikState } from '@/domain/types'

import type { EvidenceReadProposal, EvidenceReadPurpose } from './api-contract'

/**
 * The pure parts of Kimi's reader: the open items a document may pay, the
 * shape of Kimi's answer, and the checks that turn it into a proposal. The
 * server runs them around a live reading (src/server/receipt-reader.ts), and
 * the demo around a recorded one (kimi-samples.ts), so both say the same.
 * Nothing here is server-only: no environment, no Node modules, no API errors.
 */

const DAY_MS = 24 * 60 * 60 * 1000

// ─── Candidates ──────────────────────────────────────────────────────────────

/** An open item the document may pay. Kimi only ever sees its short key, never the id. */
export type ReaderCandidate = {
  /** `c1`, `c2`… in the order sent. */
  key: string
  kind: 'advance' | 'outside_payment'
  id: Id
  /** What the person and Kimi read, e.g. "Hotel in Bogotá" or "Figma · Professional plan". */
  label: string
  /** Advances: what is still to justify (a receipt may be less). Outside payments: what was paid (equal). */
  amount: Cents
  /** When the money arrived or was paid (YYYY-MM-DD). */
  date: string
  /** Advances: a receipt dated before the money was requested does not justify it (the engine refuses it). */
  earliest?: string
  /** Outside payments made for a monthly payment. */
  reminderId?: Id
}

const MAX_CANDIDATES = 25

const day = (iso: ISODate) => iso.slice(0, 10)

/** One line of untrusted or free text: no line breaks or column separators, at most `max` characters. */
function oneLine(value: string, max: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
}

/**
 * The open items a document read for `purpose` may pay, from the caller's own
 * scoped state (`scopeStateForUser`): a Member's receipt goes with their own
 * money for purchases that still has something to justify, an Admin's invoice
 * with the Agency's payments outside Viatik still waiting for one. Whether
 * the caller may use the proposal is not checked here (the server's
 * `readerCandidates` refuses whoever could not).
 */
export function openCandidates(
  state: ViatikState,
  input: { userId: Id; agencyId: Id; purpose: EvidenceReadPurpose; now: ISODate },
): ReaderCandidate[] {
  const { userId, agencyId, purpose, now } = input
  if (purpose === 'receipt') {
    return advancesOf(state, { agencyId, userId }, now)
      .filter((s) => s.pending > 0)
      .slice(0, MAX_CANDIDATES)
      .map((s, index) => ({
        key: `c${index + 1}`,
        kind: 'advance' as const,
        id: s.payment.id,
        label: oneLine(s.request?.purpose ?? s.payment.memo, 120) || 'Money for purchases',
        amount: s.pending,
        date: day(paidAt(s.payment)),
        earliest: day(s.request?.createdAt ?? s.payment.scheduledFor),
      }))
  }
  return outsidePaymentsWithoutProof(state, agencyId, now)
    .slice(0, MAX_CANDIDATES)
    .map(({ payment }, index) => {
      const payee = payment.recipient.kind === 'address' ? payment.recipient.payee : ''
      return {
        key: `c${index + 1}`,
        kind: 'outside_payment' as const,
        id: payment.id,
        label: oneLine([payee, payment.memo].filter(Boolean).join(' · '), 120) || 'Payment outside Viatik',
        amount: payment.amount,
        date: day(paidAt(payment)),
        reminderId: payment.reminderId,
      }
    })
}

// ─── Kimi's answer ───────────────────────────────────────────────────────────

/** Trimmed text, with empty strings as null. */
const text = z
  .string()
  .nullable()
  .transform((value) => (value === null || value.trim() === '' ? null : value.trim()))

export const answerSchema = z.object({
  readable: z.boolean(),
  merchant: text,
  // A model that answers a number instead of a string (the k2.6 fallback): its text, checked as text below.
  amount: z
    .union([z.string(), z.number()])
    .nullable()
    .transform((value) => {
      const raw = typeof value === 'number' ? String(value) : value
      return raw === null || raw.trim() === '' ? null : raw.trim()
    }),
  currency: text,
  date: text,
  isRecurringMonthly: z.boolean(),
  recurringHint: text,
  matchKey: text,
  confidence: z.number(),
})

export type ReaderAnswer = z.infer<typeof answerSchema>

// ─── The checks ──────────────────────────────────────────────────────────────

/** "1250.00" → 125000 cents, from the text (never through a float); null when not a positive amount. */
export function amountToCents(value: string | null): Cents | null {
  if (value === null) return null
  const parts = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!parts) return null
  const total =
    Number.parseInt(parts[1] ?? '0', 10) * 100 + Number.parseInt((parts[2] ?? '').padEnd(2, '0'), 10)
  return total > 0 ? cents(total) : null
}

/** The longest a merchant can be where the proposal goes: an expense (80) or a payee (120). */
const MERCHANT_MAX: Record<EvidenceReadPurpose, number> = { receipt: 80, invoice: 120 }
/** A date older than this is a misreading. */
const MAX_PAST_DAYS = 730
/** The highest confidence a proposal keeps once the server had to leave something out. */
export const UNSURE_CONFIDENCE = 0.5

function checkDate(value: string | null, now: ISODate): { date: string | null; note?: string } {
  if (!value) return { date: null }
  if (!z.iso.date().safeParse(value).success) {
    return { date: null, note: 'Kimi read a date that is not valid, so it was left out.' }
  }
  const at = Date.parse(`${value}T00:00:00.000Z`)
  const today = Date.parse(`${day(now)}T00:00:00.000Z`)
  if (at > today + DAY_MS) return { date: null, note: 'Kimi read a date in the future, so it was left out.' }
  if (at < today - MAX_PAST_DAYS * DAY_MS) {
    return { date: null, note: 'Kimi read a date more than two years ago, so it was left out.' }
  }
  return { date: value }
}

/** Words that say nothing about who the payee is. */
const FILLER = new Set([
  'inc',
  'llc',
  'ltd',
  'pbc',
  'corp',
  'corporation',
  'company',
  'gmbh',
  'sas',
  'the',
  'and',
  'pay',
  'invoice',
  'upload',
  'monthly',
  'payment',
  'subscription',
  'plan',
])

/** A payee's words: lowercase, without accents or punctuation, and without the ones in FILLER. */
const payeeWords = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0 && !FILLER.has(word))

/** Whether `part` is in `whole` as consecutive whole words. */
function hasWords(whole: string[], part: string[]): boolean {
  if (part.length === 0 || part.length > whole.length) return false
  for (let start = 0; start + part.length <= whole.length; start++) {
    if (part.every((word, index) => whole[start + index] === word)) return true
  }
  return false
}

/**
 * Whether two names are the same payee: equal once case, accents, punctuation
 * and words such as "Inc" are ignored, or one is the other with more words
 * ("Anthropic, PBC" and "Anthropic \u00b7 Claude Teams"). Sharing a word is not
 * enough: "Google Cloud" is not "Google Workspace".
 */
export function samePayee(a: string, b: string): boolean {
  const left = payeeWords(a)
  const right = payeeWords(b)
  return hasWords(left, right) || hasWords(right, left)
}

/**
 * The Agency's monthly payment that already covers this payee, if any: the
 * one the matched payment was made for, or one with the same payee (never
 * the title's words). Active ones first; archived ones never count.
 */
function existingReminder(reminders: Reminder[], merchant: string, reminderId: Id | undefined) {
  const covering = reminders.filter(
    (reminder) =>
      reminder.status !== 'archived' && (reminder.id === reminderId || samePayee(reminder.payee, merchant)),
  )
  return covering.find((reminder) => reminder.status === 'active') ?? covering[0]
}

/** Day of the month a monthly payment falls on: the document's, kept within 1–28 (every month has it). */
const dayOfMonthFor = (date: string) => Math.min(28, Math.max(1, Number.parseInt(date.slice(8, 10), 10) || 1))

export type ProposalContext = {
  purpose: EvidenceReadPurpose
  /** What Kimi was offered, by key. */
  sent: ReaderCandidate[]
  /** The same list read again once Kimi answered: a match must still be open (someone may have acted meanwhile). */
  current: ReaderCandidate[]
  /** The Agency's monthly payments that are not archived (active and paused); used for invoices only. */
  reminders: Reminder[]
  now: ISODate
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/**
 * The proposal the person sees, from Kimi's answer and the server's checks:
 * amounts only in USD, dates within reason, and a match only when its key was
 * offered, the item is still open and the amount fits (equal for an outside
 * payment; at most what is still to justify for money for purchases).
 * Anything left out lowers the confidence and says why.
 */
export function buildProposal(answer: ReaderAnswer, ctx: ProposalContext): EvidenceReadProposal {
  const notes: string[] = []
  let unsure = false
  const leaveOut = (note: string) => {
    unsure = true
    notes.push(note)
  }

  if (!answer.readable) {
    return {
      readable: false,
      merchant: null,
      amount: null,
      foreignAmount: null,
      currencyUnknown: false,
      date: null,
      match: null,
      recurringMonthly: false,
      recurringHint: null,
      reminder: null,
      confidence: Math.round(Math.min(clamp01(answer.confidence), UNSURE_CONFIDENCE) * 100) / 100,
      notes: [`Kimi could not find a ${ctx.purpose} it can read in this file. Fill in the details yourself.`],
    }
  }

  const merchantText = answer.merchant ? oneLine(answer.merchant, MERCHANT_MAX[ctx.purpose]) : ''
  const merchant = merchantText.length >= 2 ? merchantText : null

  const currency =
    answer.currency && /^[a-z]{3}$/i.test(answer.currency) ? answer.currency.toUpperCase() : null
  const total = amountToCents(answer.amount)
  if (answer.amount !== null && total === null) {
    leaveOut('Kimi read a total that is not a valid amount, so it was left out.')
  }
  let amount: Cents | null = null
  let foreignAmount: EvidenceReadProposal['foreignAmount'] = null
  let currencyUnknown = false
  if (total !== null && answer.amount !== null) {
    if (currency && currency !== 'USD') {
      foreignAmount = { amount: answer.amount, currency }
      notes.push(`The document is in ${currency}. Viatik records USD, so enter the amount in USD yourself.`)
    } else {
      amount = total
      if (!currency) {
        currencyUnknown = true
        notes.push('The document does not show its currency. Check that the amount is in USD.')
      }
    }
  }

  const checked = checkDate(answer.date, ctx.now)
  if (checked.note) leaveOut(checked.note)
  const date = checked.date

  let match: EvidenceReadProposal['match'] = null
  let matched: ReaderCandidate | undefined
  if (answer.matchKey) {
    const offered = ctx.sent.find((c) => c.key === answer.matchKey)
    const open = offered && ctx.current.find((c) => c.id === offered.id && c.kind === offered.kind)
    const usd = (value: Cents) => formatUsd(value, { withCode: true })
    const problem = !offered
      ? 'Kimi pointed to an item Viatik did not offer, so no match is proposed.'
      : !open
        ? `“${offered.label}” is no longer open, so it is not proposed.`
        : amount === null
          ? 'Without an amount in USD, Viatik cannot check the match, so it is not proposed.'
          : open.kind === 'advance' && amount > open.amount
            ? `The total is more than the ${usd(open.amount)} still to justify for “${open.label}”, so it is not proposed.`
            : open.kind === 'advance' && date && open.earliest && date < open.earliest
              ? `The receipt is dated before “${open.label}” was requested, so it is not proposed.`
              : open.kind === 'outside_payment' && amount !== open.amount
                ? `The total does not match the ${usd(open.amount)} paid for “${open.label}”, so it is not proposed.`
                : null
    if (problem || !open) leaveOut(problem ?? 'No match is proposed.')
    else {
      matched = open
      match = { kind: open.kind, id: open.id, label: open.label }
    }
  }

  const recurringMonthly = answer.isRecurringMonthly
  const hint = recurringMonthly && answer.recurringHint ? oneLine(answer.recurringHint, 200) : ''
  let reminder: EvidenceReadProposal['reminder'] = null
  if (ctx.purpose === 'invoice' && recurringMonthly && merchant) {
    const existing = existingReminder(ctx.reminders, merchant, matched?.reminderId)
    if (existing?.status === 'paused') {
      notes.push(
        `A monthly payment for “${existing.title}” already exists. It is paused: you can resume it in Bills ▸ Monthly.`,
      )
    } else if (existing) notes.push(`A monthly payment for “${existing.title}” already exists.`)
    else {
      reminder = {
        title: merchant,
        payee: merchant,
        amount,
        dayOfMonth: dayOfMonthFor(date ?? day(ctx.now)),
      }
    }
  }

  const confidence = unsure
    ? Math.min(clamp01(answer.confidence), UNSURE_CONFIDENCE)
    : clamp01(answer.confidence)
  return {
    readable: true,
    merchant,
    amount,
    foreignAmount,
    currencyUnknown,
    date,
    match,
    recurringMonthly,
    recurringHint: hint || null,
    reminder,
    confidence: Math.round(confidence * 100) / 100,
    notes,
  }
}

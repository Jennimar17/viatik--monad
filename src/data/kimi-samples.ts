import { addDays } from '@/domain/accountability'
import { cents } from '@/domain/money'
import type { Id, ISODate, PaymentRequest, ViatikState } from '@/domain/types'

import type {
  EvidenceReadAnswer,
  EvidenceReadProposal,
  EvidenceReadPurpose,
  EvidenceReadRequest,
} from './api-contract'
import { DataSourceError } from './data-source'
import { buildProposal, openCandidates, type ReaderAnswer, type ReaderCandidate } from './evidence-reading'
import { KIMI_RECORDINGS } from './kimi-recordings'

/**
 * Kimi in the demo: it read a few sample files once (scripts/kimi-record.mjs,
 * with the server's own reader), and the demo replays those readings through
 * the same checks the server runs, against the visitor's own demo state. The
 * demo never sends a file to Kimi, and shows no reading for any other file.
 */

export type DemoSampleId = 'kestrel-receipt' | 'figma-invoice' | 'loomwise-invoice'

/**
 * An open item Kimi was offered when it read the sample, without its ids
 * (they change with the day the demo is seeded): the match is found again by
 * kind and label. The amount is in cents.
 */
export type RecordedCandidate = Omit<ReaderCandidate, 'id' | 'reminderId' | 'amount'> & { amount: number }

/** One sample file and what Kimi answered when it read it. */
export type KimiRecording = {
  id: DemoSampleId
  purpose: EvidenceReadPurpose
  /** The file in public/: the reading is shown only for these exact bytes. */
  file: { path: `/demo/kimi/${string}`; name: string; mimeType: string; sizeBytes: number; sha256: string }
  /** When Kimi read it; the demo story was seeded at that moment. */
  recordedAt: ISODate
  model: string
  sent: RecordedCandidate[]
  /** Kimi's answer, as the server parsed it. */
  answer: ReaderAnswer
  /** The proposal the server's checks built from it then (a reference for the smoke). */
  proposal: EvidenceReadProposal
}

/** A recorded reading, replayed: the proposal for this visitor, and how it was recorded. */
export type RecordedAnswer = EvidenceReadAnswer & {
  recorded: {
    recordedAt: ISODate
    sample: DemoSampleId
    /** The receipt's printed date, when the demo moved it to fit this demo's dates; else null. */
    movedFrom: string | null
  }
}

export const recordingOf = (id: DemoSampleId) => KIMI_RECORDINGS.find((r) => r.id === id)

export const recordingBySha256 = (sha256: string) => KIMI_RECORDINGS.find((r) => r.file.sha256 === sha256)

/** The sample each reader offers unless the screen picks another. */
export const DEFAULT_SAMPLE: Record<EvidenceReadPurpose, DemoSampleId> = {
  receipt: 'kestrel-receipt',
  invoice: 'figma-invoice',
}

/** Requests whose files no longer back any money (as in the engine's requireUnusedReceipts). */
const CLOSED_REQUESTS: ReadonlySet<PaymentRequest['status']> = new Set<PaymentRequest['status']>([
  'declined',
  'cancelled',
  'rejected',
])

/** Whether this demo already used the sample's file in the Agency (the engine's requireUnusedReceipts would refuse it). */
export function sampleUsed(state: ViatikState, agencyId: Id, sha256: string): boolean {
  return (
    state.expenses.some((e) => e.agencyId === agencyId && e.receipt?.sha256 === sha256) ||
    state.requests.some(
      (r) =>
        r.agencyId === agencyId &&
        !CLOSED_REQUESTS.has(r.status) &&
        r.attachments.some((a) => a.sha256 === sha256),
    ) ||
    state.payments.some((p) => p.agencyId === agencyId && p.proof?.sha256 === sha256) ||
    state.bills.some((b) => b.agencyId === agencyId && b.document.sha256 === sha256)
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days from one YYYY-MM-DD date to another. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS)

/**
 * Kimi's recorded reading of a sample file, replayed for this visitor
 * (`state` is their scoped state). The proposal comes from the same
 * `buildProposal` the server runs, so it says what a live reading would: a
 * match the visitor already used is no longer open, a monthly payment they
 * already created already exists. Any other file is refused.
 */
export function recordedReading(input: {
  state: ViatikState
  userId: Id
  now: ISODate
  request: EvidenceReadRequest
}): RecordedAnswer {
  const { state, userId, now, request } = input
  const { agencyId, purpose } = request
  const rec = recordingBySha256(request.sha256)
  if (!rec || rec.purpose !== purpose) {
    throw new DataSourceError(
      'In the demo, Kimi only shows its recorded readings of the sample files. Use the sample, or fill in the details yourself.',
      'demo_sample_only',
    )
  }

  // This demo's open items, and the one Kimi matched, found again by kind and label.
  const current = openCandidates(state, { userId, agencyId, purpose, now })
  const recordedMatch = rec.sent.find((c) => c.key === rec.answer.matchKey)
  const mapped =
    recordedMatch && current.find((c) => c.kind === recordedMatch.kind && c.label === recordedMatch.label)
  let sent = current
  let matchKey = mapped?.key ?? null
  if (recordedMatch && !mapped) {
    // No longer open here: offered as Kimi saw it, so the checks say it is not proposed.
    sent = [
      ...current,
      { ...recordedMatch, key: 'recorded', id: 'recorded', amount: cents(recordedMatch.amount) },
    ]
    matchKey = 'recorded'
  }

  // The printed date fits a demo seeded up to ten days after the recording. In a later one it would
  // fall before the money was requested: it moves as far as this demo's dates did (never past today),
  // and the card says so.
  let date = rec.answer.date
  let movedFrom: string | null = null
  if (
    purpose === 'receipt' &&
    date &&
    recordedMatch?.earliest &&
    mapped?.earliest &&
    date < mapped.earliest
  ) {
    const moved = addDays(date, daysBetween(recordedMatch.earliest, mapped.earliest)).slice(0, 10)
    const today = now.slice(0, 10)
    movedFrom = date
    date = moved < today ? moved : today
  }

  const proposal = buildProposal(
    { ...rec.answer, matchKey, date },
    {
      purpose,
      sent,
      current,
      // Paused ones too: the person is told to resume it rather than create a second one.
      reminders:
        purpose === 'invoice'
          ? state.reminders.filter((r) => r.agencyId === agencyId && r.status !== 'archived')
          : [],
      now,
    },
  )
  return { proposal, model: rec.model, recorded: { recordedAt: rec.recordedAt, sample: rec.id, movedFrom } }
}

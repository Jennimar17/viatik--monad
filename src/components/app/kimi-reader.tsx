'use client'

import { ArrowUpRight, FilePlus2, Info, Loader2, ScanText, Sparkles } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { newKey, type DraftFile } from '@/components/viatik/forms'
import { KeyValueList } from '@/components/viatik/layout'
import type { UploadedFile } from '@/data'
import type { EvidenceReadAnswer, EvidenceReadProposal, EvidenceReadPurpose } from '@/data/api-contract'
import {
  DEFAULT_SAMPLE,
  recordingOf,
  sampleUsed,
  type DemoSampleId,
  type RecordedAnswer,
} from '@/data/kimi-samples'
import { useViatikState } from '@/data/react'
import { useEvidenceReader } from '@/data/use-evidence-reader'
import { cents, formatUsd } from '@/domain/money'
import { formatDate } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'
import { cn } from '@/lib/utils'

export type { EvidenceReadProposal }

/** The proposal's amount as cents (the wire carries a plain number). */
export const proposalAmount = (proposal: EvidenceReadProposal) =>
  proposal.amount !== null ? cents(proposal.amount) : null

/** The words each purpose uses for who was paid and what the document pays. */
const WORDS: Record<
  EvidenceReadPurpose,
  { merchant: string; date: string; match: string; document: string }
> = {
  receipt: { merchant: 'Merchant', date: 'Date', match: 'Money for purchases', document: 'receipt' },
  invoice: { merchant: 'Payee', date: 'Invoice date', match: 'Payment', document: 'invoice' },
}

type Result = {
  sha256: string
  answer?: EvidenceReadAnswer | RecordedAnswer
  error?: string
  used?: boolean
}

/**
 * "Read with Kimi" for a receipt or invoice the person just uploaded: Kimi
 * (Moonshot AI) reads the file and proposes its details, which the person
 * checks before using them. "Use these details" only fills in the page's own
 * fields; nothing is submitted, and the usual command still asks to confirm.
 *
 * Renders nothing unless the reader is on (a real account on a deployment
 * with a Kimi key, or the demo) and `file` is stored and verified. The demo
 * sends nothing to Kimi: with `onSampleFile` it offers a sample file while
 * the form has none, and shows Kimi's recorded reading of it, labelled so.
 */
export function KimiReader({
  file,
  agencyId,
  purpose,
  onUse,
  useLabel = 'Use these details',
  canUse,
  extra,
  usedText = 'Details filled in from Kimi’s reading. Check them before you continue.',
  againLabel,
  onSampleFile,
  sample,
  className,
}: {
  /** The uploaded file (the form's first file). */
  file: DraftFile | undefined
  agencyId: string
  purpose: EvidenceReadPurpose
  /** Fills in the page's fields from the proposal. */
  onUse: (proposal: EvidenceReadProposal) => void
  useLabel?: string
  /** Whether the proposal can be used here (e.g. it must name a payment); the button is disabled otherwise. */
  canUse?: (proposal: EvidenceReadProposal) => boolean
  /** Page-specific lines or actions for the proposal; they stay once it is used. */
  extra?: (proposal: EvidenceReadProposal) => React.ReactNode
  /** What shows instead of the card once it is used (above it, with `againLabel`). */
  usedText?: string
  /**
   * Keeps the card once it is used, with this action to use it again without reading the file again
   * (e.g. reopen a sheet the person closed without finishing).
   */
  againLabel?: string
  /** The demo only: puts the sample file in the form, as if it was uploaded. Without it, no sample is offered. */
  onSampleFile?: (file: DraftFile) => void
  /** The demo's sample for this screen (default: the one for `purpose`). */
  sample?: DemoSampleId
  className?: string
}) {
  const reader = useEvidenceReader()
  const [result, setResult] = React.useState<Result | null>(null)
  const [reading, setReading] = React.useState<string | null>(null)
  const alive = React.useRef(false)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const ready = file?.kind === 'file' && file.sha256 && !file.upload ? file.sha256 : undefined
  if (!reader.enabled) return null
  const words = WORDS[purpose]
  if (!ready) {
    // The demo offers its sample while the form has no file (one still uploading shows nothing).
    return reader.attachSample && !file && onSampleFile ? (
      <SampleOffer
        className={className}
        sample={sample ?? DEFAULT_SAMPLE[purpose]}
        agencyId={agencyId}
        purpose={purpose}
        attach={reader.attachSample}
        onSampleFile={onSampleFile}
      />
    ) : null
  }
  // The demo has Kimi's readings of its sample files only.
  const recording = reader.recordingOf(ready)
  if (reader.recorded && recording?.purpose !== purpose) {
    return (
      <p className={cn('flex gap-2 text-sm text-pretty text-muted-foreground', className)}>
        <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
        <span>
          In the demo, Kimi only shows its recorded readings of the sample {words.document}s.{' '}
          {onSampleFile
            ? 'To try it, remove this file and use the sample, or fill in the details yourself.'
            : 'Fill in the details yourself.'}
        </span>
      </p>
    )
  }
  // A reading of another file (the person replaced it) no longer applies.
  const current = result?.sha256 === ready ? result : null
  const busy = reading === ready

  const read = async () => {
    const sha256 = ready
    setReading(sha256)
    setResult(null)
    try {
      const answer = await reader.read({ sha256, agencyId, purpose })
      if (alive.current) setResult({ sha256, answer })
    } catch (error) {
      if (alive.current) {
        setResult({
          sha256,
          error:
            error instanceof Error
              ? error.message
              : 'Kimi could not read this file. Fill in the details yourself.',
        })
      }
    } finally {
      if (alive.current) setReading((now) => (now === sha256 ? null : now))
    }
  }

  const proposal = current?.answer?.proposal
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {!proposal ? (
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-2.5">
            <ScanText className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
            <div className="flex min-w-0 flex-col gap-0.5">
              {recording ? (
                <>
                  <p className="text-sm text-pretty text-foreground">
                    Kimi read this sample {words.document} before the demo was published.
                  </p>
                  <p className="text-xs text-pretty text-subtle">
                    Recorded with {recording.model} on {formatLocalDate(recording.recordedAt)}. The demo sends
                    nothing to Kimi.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-pretty text-foreground">
                    Kimi can read this {words.document} and fill in its details for you to check.
                  </p>
                  <p className="text-xs text-pretty text-subtle">
                    The file is sent to Kimi (Moonshot AI) to be read.
                  </p>
                </>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="pill-sm"
            className="shrink-0"
            disabled={busy}
            onClick={() => void read()}
          >
            {busy ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <ScanText data-icon="inline-start" />
            )}
            {busy
              ? recording
                ? 'Loading…'
                : 'Reading…'
              : current?.error
                ? 'Try again'
                : recording
                  ? 'Show Kimi’s reading'
                  : 'Read with Kimi'}
          </Button>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {busy
          ? recording
            ? 'Loading Kimi’s recorded reading.'
            : 'Kimi is reading the file.'
          : proposal
            ? 'Kimi read the file. Check its details.'
            : ''}
      </p>
      {busy ? (
        <p className="text-xs text-subtle">
          {recording
            ? 'Loading Kimi’s recorded reading.'
            : 'Kimi is reading the file. This can take up to two minutes.'}
        </p>
      ) : null}
      {current?.error ? (
        <p className="text-sm text-pretty text-danger" role="alert">
          {current.error}
        </p>
      ) : null}

      {proposal && current?.answer ? (
        <>
          {current.used ? (
            <p className="flex gap-2 text-sm text-pretty text-muted-foreground">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
              {usedText}
            </p>
          ) : null}
          {!current.used || againLabel ? (
            <ProposalCard
              answer={current.answer}
              purpose={purpose}
              useLabel={current.used && againLabel ? againLabel : useLabel}
              usable={proposal.readable && (canUse ? canUse(proposal) : true)}
              onUse={() => {
                onUse(proposal)
                setResult({ ...current, used: true })
              }}
              onDismiss={() => setResult(null)}
            />
          ) : null}
        </>
      ) : null}
      {proposal ? extra?.(proposal) : null}
    </div>
  )
}

/** What Kimi read, laid out for checking, with the server's notes (in the demo, labelled as recorded). */
function ProposalCard({
  answer,
  purpose,
  useLabel,
  usable,
  onUse,
  onDismiss,
}: {
  answer: EvidenceReadAnswer | RecordedAnswer
  purpose: EvidenceReadPurpose
  useLabel: string
  usable: boolean
  onUse: () => void
  onDismiss: () => void
}) {
  const { proposal, model } = answer
  const recorded = 'recorded' in answer ? answer.recorded : undefined
  const words = WORDS[purpose]
  const notes =
    recorded?.movedFrom && proposal.date
      ? [
          `The receipt is dated ${formatDate(recorded.movedFrom)}. The demo moves it to ${formatDate(proposal.date)} to fit this demo’s dates.`,
          ...proposal.notes,
        ]
      : proposal.notes
  const missing = <span className="text-subtle">Not found</span>
  const amount = proposalAmount(proposal)
  const items: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode }[] =
    proposal.readable
      ? [
          { label: words.merchant, value: proposal.merchant ?? missing },
          {
            label: 'Amount',
            value:
              amount !== null ? (
                formatUsd(amount, { withCode: true })
              ) : proposal.foreignAmount ? (
                <span className="text-subtle">
                  {proposal.foreignAmount.amount} {proposal.foreignAmount.currency}
                </span>
              ) : (
                missing
              ),
          },
          { label: words.date, value: proposal.date ? formatDate(proposal.date) : missing },
          {
            label: words.match,
            value: proposal.match ? proposal.match.label : <span className="text-subtle">No match</span>,
          },
          ...(proposal.recurringMonthly
            ? [{ label: 'Monthly charge', value: proposal.recurringHint ?? 'Yes' }]
            : []),
        ]
      : []

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-info/30 bg-info-soft p-4">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">
            {recorded
              ? 'Kimi read this sample. Check it before using it.'
              : 'Kimi read this. Check it before using it.'}
          </p>
          <p className="text-xs text-subtle">
            {proposal.confidence >= 0.8 ? 'A clear reading' : 'An unsure reading: check each detail'} ·{' '}
            {recorded
              ? `Recorded reading from Kimi (${model}) · ${formatLocalDate(recorded.recordedAt)}`
              : model}
          </p>
        </div>
      </div>
      {items.length > 0 ? <KeyValueList dense items={items} /> : null}
      {notes.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {notes.map((note) => (
            <li key={note} className="flex gap-2 text-sm text-pretty text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
              {note}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="pill-sm" onClick={onDismiss}>
          Dismiss
        </Button>
        {proposal.readable ? (
          <Button size="pill-sm" disabled={!usable} onClick={onUse}>
            {useLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * The demo's way in: Kimi read a sample file before the demo was published,
 * and "Use the sample" adds that file to the form as an upload would, so its
 * recorded reading can be shown. A file is used once per Agency: once the
 * sample was, this says so instead.
 */
function SampleOffer({
  sample,
  agencyId,
  purpose,
  attach,
  onSampleFile,
  className,
}: {
  sample: DemoSampleId
  agencyId: string
  purpose: EvidenceReadPurpose
  attach: (id: DemoSampleId) => Promise<UploadedFile>
  onSampleFile: (file: DraftFile) => void
  className?: string
}) {
  const { state } = useViatikState()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const alive = React.useRef(false)
  React.useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const rec = recordingOf(sample)
  if (!rec) return null
  const words = WORDS[purpose]
  if (sampleUsed(state, agencyId, rec.file.sha256)) {
    return (
      <p className={cn('flex gap-2 text-sm text-pretty text-muted-foreground', className)}>
        <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
        The sample {words.document} is already used in this demo. Use Reset demo to try it again.
      </p>
    )
  }

  const use = async () => {
    setBusy(true)
    setError(null)
    try {
      const stored = await attach(sample)
      if (alive.current) onSampleFile({ ...stored, key: newKey() })
    } catch (failure) {
      if (alive.current) {
        setError(failure instanceof Error ? failure.message : 'The sample could not be loaded. Try again.')
      }
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-2.5">
          <ScanText className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium text-pretty text-foreground">
              Try Kimi with a sample {words.document}
            </p>
            <p className="text-xs text-pretty text-subtle">
              The demo sends nothing to Kimi. Use the sample to see the reading Kimi recorded of it.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={rec.file.path}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Open the sample
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <Button variant="outline" size="pill-sm" disabled={busy} onClick={() => void use()}>
            {busy ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <FilePlus2 data-icon="inline-start" />
            )}
            {busy ? 'Loading…' : `Use the sample ${words.document}`}
          </Button>
        </div>
      </div>
      {error ? (
        <p className="text-sm text-pretty text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

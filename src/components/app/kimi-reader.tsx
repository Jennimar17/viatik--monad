'use client'

import { Info, Loader2, ScanText, Sparkles } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import type { DraftFile } from '@/components/viatik/forms'
import { KeyValueList } from '@/components/viatik/layout'
import type { EvidenceReadAnswer, EvidenceReadProposal, EvidenceReadPurpose } from '@/data/api-contract'
import { useEvidenceReader } from '@/data/use-evidence-reader'
import { cents, formatUsd } from '@/domain/money'
import { formatDate } from '@/lib/format'
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

type Result = { sha256: string; answer?: EvidenceReadAnswer; error?: string; used?: boolean }

/**
 * "Read with Kimi" for a receipt or invoice the person just uploaded: Kimi
 * (Moonshot AI) reads the file and proposes its details, which the person
 * checks before using them. "Use these details" only fills in the page's own
 * fields; nothing is submitted, and the usual command still asks to confirm.
 *
 * Renders nothing unless the reader is on (a real account on a deployment
 * with a Kimi key; never in the demo) and `file` is stored and verified.
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
  if (!reader.enabled || !ready) return null
  // A reading of another file (the person replaced it) no longer applies.
  const current = result?.sha256 === ready ? result : null
  const busy = reading === ready
  const words = WORDS[purpose]

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
              <p className="text-sm text-pretty text-foreground">
                Kimi can read this {words.document} and fill in its details for you to check.
              </p>
              <p className="text-xs text-pretty text-subtle">
                The file is sent to Kimi (Moonshot AI) to be read.
              </p>
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
            {busy ? 'Reading…' : current?.error ? 'Try again' : 'Read with Kimi'}
          </Button>
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {busy ? 'Kimi is reading the file.' : proposal ? 'Kimi read the file. Check its details.' : ''}
      </p>
      {busy ? (
        <p className="text-xs text-subtle">Kimi is reading the file. This can take up to two minutes.</p>
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

/** What Kimi read, laid out for checking, with the server's notes. */
function ProposalCard({
  answer,
  purpose,
  useLabel,
  usable,
  onUse,
  onDismiss,
}: {
  answer: EvidenceReadAnswer
  purpose: EvidenceReadPurpose
  useLabel: string
  usable: boolean
  onUse: () => void
  onDismiss: () => void
}) {
  const { proposal, model } = answer
  const words = WORDS[purpose]
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
          <p className="text-sm font-medium text-foreground">Kimi read this. Check it before using it.</p>
          <p className="text-xs text-subtle">
            {proposal.confidence >= 0.8 ? 'A clear reading' : 'An unsure reading: check each detail'} ·{' '}
            {model}
          </p>
        </div>
      </div>
      {items.length > 0 ? <KeyValueList dense items={items} /> : null}
      {proposal.notes.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {proposal.notes.map((note) => (
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

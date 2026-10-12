'use client'

import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDashed,
  Clock,
  Copy,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react'
import * as React from 'react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { formatUsd } from '@/domain/money'
import type { LedgerReason, VerifiedDetails } from '@/domain/types'
import { formatDateTime, shortHash } from '@/lib/format'
import { cn } from '@/lib/utils'

export type OperationPhase =
  'idle' | 'preparing' | 'waiting_for_confirmation' | 'processing' | 'completed' | 'failed'

const steps: { phase: Exclude<OperationPhase, 'idle' | 'failed'>; label: string }[] = [
  { phase: 'preparing', label: 'Preparing' },
  { phase: 'waiting_for_confirmation', label: 'Waiting for confirmation' },
  { phase: 'processing', label: 'Processing' },
  { phase: 'completed', label: 'Completed' },
]

/** Human operation lifecycle. Raw infrastructure states never appear here. */
export function PendingOperation({
  phase,
  error,
  steps: ownSteps,
  className,
}: {
  phase: OperationPhase
  error?: string
  /** This operation's steps in its own words, in place of the generic lifecycle. */
  steps?: Step[]
  className?: string
}) {
  const currentIndex = phase === 'failed' ? -1 : steps.findIndex((s) => s.phase === phase)
  return (
    <div className={cn('flex flex-col gap-3', className)} role="status" aria-live="polite">
      {ownSteps ? <Steps steps={ownSteps} /> : null}
      <ol className={cn('flex flex-col gap-2.5', ownSteps && 'hidden')}>
        {steps.map((step, index) => {
          const done = phase === 'completed' || index < currentIndex
          const active = index === currentIndex && phase !== 'completed'
          return (
            <li key={step.phase} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full border',
                  done && 'border-sage bg-sage text-primary-foreground',
                  active && 'border-mist text-foreground',
                  !done && !active && 'border-border text-subtle',
                )}
                aria-hidden="true"
              >
                {done ? (
                  <Check className="size-3" />
                ) : active ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <CircleDashed className="size-3" />
                )}
              </span>
              <span className={cn(done || active ? 'text-foreground' : 'text-subtle')}>{step.label}</span>
            </li>
          )
        })}
      </ol>
      {phase === 'failed' ? (
        <p className="flex items-start gap-2 rounded-lg border border-danger/35 bg-danger-soft p-3 text-sm text-foreground">
          <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
          {error ?? 'The operation could not be completed. Nothing was moved.'}
        </p>
      ) : error ? (
        // Not a failure: it is on its way and shows up once it is final.
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted p-3 text-sm text-foreground">
          <Clock className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

export type StepState = 'done' | 'current' | 'upcoming' | 'failed'

export type Step = { id: string; label: React.ReactNode; detail?: React.ReactNode; state: StepState }

const stepIcon: Record<StepState, React.ReactNode> = {
  done: <Check className="size-3.5" />,
  current: <Loader2 className="size-3.5 animate-spin" />,
  upcoming: <CircleDashed className="size-3.5" />,
  failed: <X className="size-3.5" />,
}

const stepStateText: Record<StepState, string> = {
  done: 'Done',
  current: 'In progress',
  upcoming: 'Not started',
  failed: 'Failed',
}

const stepMarker: Record<StepState, string> = {
  done: 'border-sage bg-sage text-primary-foreground',
  current: 'border-warning text-warning',
  upcoming: 'border-border text-subtle',
  failed: 'border-danger bg-danger-soft text-danger',
}

/** The path of a record so far (a request, a bill…). A stopped path ends at the step that stopped it. */
export function Steps({ steps, className }: { steps: Step[]; className?: string }) {
  return (
    <ol className={cn('flex flex-col gap-4', className)}>
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-3">
          <span
            className={cn(
              'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
              stepMarker[step.state],
            )}
            aria-hidden="true"
          >
            {stepIcon[step.state]}
          </span>
          <span className="sr-only">{stepStateText[step.state]}: </span>
          <span className="flex min-w-0 flex-col">
            <span className={cn('text-sm font-medium', step.state === 'upcoming' && 'text-subtle')}>
              {step.label}
            </span>
            {step.detail ? <span className="text-sm text-muted-foreground">{step.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** How the ledger names why it rejected a request (its `Reason`), shown under Advanced. */
const REASON_NAME: Record<LedgerReason, string> = {
  budget_paused: 'BudgetPaused',
  destination_not_allowed: 'DestinationNotAllowed',
  limit_exceeded: 'LimitExceeded',
  insufficient_funds: 'InsufficientFunds',
}

const OUTCOME_LABEL: Record<NonNullable<VerifiedDetails['outcome']>, string> = {
  executed: 'Paid',
  pending: 'Sent for approval',
  rejected: 'Rejected',
}

type Row = { label: string; value: string; copy?: string; mono?: boolean }

const hashRow = (label: string, value: string, head = 10, tail = 8): Row => ({
  label,
  value: shortHash(value, head, tail),
  copy: value,
  mono: true,
})

function reasonText(reason: NonNullable<VerifiedDetails['reason']>) {
  const name = REASON_NAME[reason.code]
  if (reason.limit === undefined) return name
  const amount = formatUsd(reason.limit, { withCode: true })
  if (reason.code === 'limit_exceeded') return `${name} · limit ${amount}`
  if (reason.code === 'insufficient_funds') return `${name} · available ${amount}`
  return name
}

/** What the record says happened, in one line above the table. Simulated details never name Monad. */
function summary(details: VerifiedDetails) {
  if (details.imported) return 'An example record from the demo story.'
  const ledger = details.simulated ? 'the demo ledger' : 'Monad'
  if (details.outcome === 'rejected') return `Recorded on ${ledger} and rejected under the budget rules.`
  if (details.outcome === 'pending') return `Recorded on ${ledger} when it was sent for approval.`
  if (!details.receiptHash) return `Recorded on ${ledger}.`
  return `This operation was settled and recorded on ${ledger}.`
}

/** The verified details table, shown in a drawer on demand ("View verified details"). */
export function VerifiedDetailsList({
  details,
  className,
}: {
  details: VerifiedDetails
  className?: string
}) {
  const rows: Row[] = [
    { label: 'Status', value: details.status === 'confirmed' ? 'Confirmed' : 'Pending' },
    { label: 'Network', value: `${details.network} · chain ${details.chainId}` },
    hashRow('Account', details.account, 8, 6),
    hashRow('Transaction', details.transaction),
    { label: 'Block', value: details.block.toLocaleString('en-US'), mono: true },
    { label: 'Timestamp', value: formatDateTime(details.timestamp, { withYear: true, withZone: true }) },
    ...(details.receiptHash ? [hashRow('Receipt hash', details.receiptHash)] : []),
    { label: 'Contract policy', value: details.contractPolicy },
  ]
  // Raw ledger data, shown only when opened.
  const advanced: Row[] = [
    ...(details.outcome ? [{ label: 'Outcome', value: OUTCOME_LABEL[details.outcome] }] : []),
    ...(details.reason ? [{ label: 'Reason', value: reasonText(details.reason) }] : []),
    ...(details.evidenceHash
      ? [hashRow('Evidence fingerprint', details.evidenceHash, 8, 6)]
      : details.evidenceHash === null
        ? [{ label: 'Evidence fingerprint', value: 'No documents attached' }]
        : []),
    ...(details.decisionHash ? [hashRow('Decision fingerprint', details.decisionHash, 8, 6)] : []),
    ...(details.contract ? [hashRow('Contract', details.contract, 8, 6)] : []),
    ...(details.operationRef ? [hashRow('Operation reference', details.operationRef, 8, 6)] : []),
  ]
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-sage" aria-hidden="true" />
        {summary(details)}
      </p>
      <DetailRows rows={rows} />
      {advanced.length > 0 ? (
        <Collapsible className="flex flex-col gap-2">
          <CollapsibleTrigger className="group inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            Advanced
            <ChevronDown
              className="size-4 transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <DetailRows rows={advanced} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {details.simulated ? (
        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-subtle">
          {details.imported
            ? 'Imported when the demo story was set up: it is not a Monad transaction of its own.'
            : 'Simulated details: nothing was sent to Monad.'}
        </p>
      ) : null}
      {details.simulated ? (
        <span
          aria-disabled="true"
          className="inline-flex h-10 w-fit cursor-not-allowed items-center gap-2 rounded-full border border-border px-4 text-sm font-medium opacity-60"
        >
          View in explorer
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </span>
      ) : (
        <a
          href={details.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 w-fit items-center gap-2 rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          View in explorer
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      )}
    </div>
  )
}

function DetailRows({ rows }: { rows: Row[] }) {
  return (
    <dl className="overflow-hidden rounded-xl border border-border">
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            'flex justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0',
            row.mono ? 'items-center' : 'items-start',
          )}
        >
          <dt className="shrink-0 text-sm text-muted-foreground">{row.label}</dt>
          <dd
            className={cn(
              'flex min-w-0 items-center gap-1.5 text-right text-sm text-foreground',
              row.mono && 'font-mono text-xs',
            )}
          >
            {/* Hashes are already shortened; a rule reads in full. */}
            <span className={row.mono ? 'truncate' : 'text-pretty break-words'}>{row.value}</span>
            {row.copy ? <CopyButton value={row.copy} label={`Copy ${row.label.toLowerCase()}`} /> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => setCopied(false), 1500)
        } catch {
          setCopied(false)
        }
      }}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

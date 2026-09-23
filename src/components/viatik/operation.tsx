'use client'

import { ArrowUpRight, Check, CircleDashed, Copy, Loader2, ShieldCheck, X } from 'lucide-react'
import * as React from 'react'

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
  className,
}: {
  phase: OperationPhase
  error?: string
  className?: string
}) {
  const currentIndex = phase === 'failed' ? -1 : steps.findIndex((s) => s.phase === phase)
  return (
    <div className={cn('flex flex-col gap-3', className)} role="status" aria-live="polite">
      <ol className="flex flex-col gap-2.5">
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
      ) : null}
    </div>
  )
}

/** Settlement record of one operation. The only place chain terms appear. */
export type VerifiedDetails = {
  status: 'confirmed' | 'pending'
  network: string
  chainId: number
  account: string
  transaction: string
  block: number
  timestamp: string
  receiptHash: string
  contractPolicy: string
  explorerUrl: string
  /** Produced by the mock ledger; not published onchain yet. */
  simulated: boolean
}

/** The verified details table, shown in a drawer on demand ("View verified details"). */
export function VerifiedDetailsList({
  details,
  className,
}: {
  details: VerifiedDetails
  className?: string
}) {
  const rows: { label: string; value: string; copy?: string; mono?: boolean }[] = [
    { label: 'Status', value: details.status === 'confirmed' ? 'Confirmed' : 'Pending' },
    { label: 'Network', value: `${details.network} · chain ${details.chainId}` },
    { label: 'Account', value: shortHash(details.account, 8, 6), copy: details.account, mono: true },
    {
      label: 'Transaction',
      value: shortHash(details.transaction, 10, 8),
      copy: details.transaction,
      mono: true,
    },
    { label: 'Block', value: details.block.toLocaleString('en-US'), mono: true },
    { label: 'Timestamp', value: `${formatDateTime(details.timestamp)} UTC` },
    {
      label: 'Receipt hash',
      value: shortHash(details.receiptHash, 10, 8),
      copy: details.receiptHash,
      mono: true,
    },
    { label: 'Contract policy', value: details.contractPolicy },
  ]
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldCheck className="size-4 text-sage" aria-hidden="true" />
        This operation was settled and recorded on Monad.
      </p>
      <dl className="overflow-hidden rounded-xl border border-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 border-t border-border px-4 py-3 first:border-t-0"
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-right text-sm text-foreground',
                row.mono && 'font-mono text-xs',
              )}
            >
              <span className="truncate">{row.value}</span>
              {row.copy ? <CopyButton value={row.copy} label={`Copy ${row.label.toLowerCase()}`} /> : null}
            </dd>
          </div>
        ))}
      </dl>
      {details.simulated ? (
        <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-subtle">
          Demo ledger: these details are simulated and are not published on Monad yet.
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
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
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

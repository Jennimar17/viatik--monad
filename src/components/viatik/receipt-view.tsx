import { ShieldCheck } from 'lucide-react'
import type * as React from 'react'

import { formatUsd, type Cents } from '@/domain/money'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import { ViatikLogo } from './viatik-logo'

export type ReceiptRow = { label: string; value: string; mono?: boolean }

/** Where the operation was recorded: on Monad, on the demo ledger, or imported with the demo story. */
export type ReceiptRecorded = 'monad' | 'simulated' | 'example'

const FOOTNOTE: Record<ReceiptRecorded, string> = {
  monad:
    'This operation was settled and recorded on Monad. Documents stay private; only their fingerprints are recorded. Open verified details to check the transaction.',
  simulated:
    'This operation was settled on the demo ledger; nothing was sent to Monad. Documents stay private; only their fingerprints are recorded.',
  example:
    'An example record, imported when the demo story was set up: it is not a Monad transaction of its own. Documents stay private.',
}

/**
 * Verifiable receipt on the paper surface (`theme-light`), printable. The
 * page around it owns the actions (print, verified details).
 */
export function ReceiptView({
  kindLabel,
  number,
  description,
  amount,
  issuedAt,
  rows,
  evidence = [],
  recorded = 'simulated',
  className,
}: {
  /** e.g. "Payment receipt". */
  kindLabel: string
  number: string
  description: string
  amount: Cents
  issuedAt: string
  /** From, To, Organization, Policy applied, Receipt hash… */
  rows: ReceiptRow[]
  /** Supporting documents; only their fingerprints are recorded onchain. */
  /** `name` may be a control that opens the document; `label` is its plain name. */
  evidence?: { id: string; name: React.ReactNode; label: string; fingerprint: string }[]
  /** Where it was recorded; only 'monad' (read from Monad) says it settled there. */
  recorded?: ReceiptRecorded
  className?: string
}) {
  return (
    <article className={cn('theme-light overflow-hidden rounded-2xl border border-border', className)}>
      <header className="flex items-start justify-between gap-4 border-b border-border p-6 sm:p-8">
        <div className="flex flex-col gap-3">
          <ViatikLogo href="" tone="dark" className="min-h-0 [&_img]:h-7" />
          <h1 className="text-sm font-normal text-muted-foreground">{kindLabel}</h1>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-xs font-medium text-success">
            <ShieldCheck className="size-3.5" aria-hidden="true" /> Verified
          </span>
          <span className="font-mono text-xs text-muted-foreground">{number}</span>
        </div>
      </header>

      <section className="flex flex-col gap-2 p-6 sm:p-8">
        <p className="text-sm text-muted-foreground">{description}</p>
        <p className="font-display text-4xl tracking-tight break-words num sm:text-5xl">
          {formatUsd(amount)}
          <span className="ml-2 text-lg text-muted-foreground">USD</span>
        </p>
        <p className="text-sm text-muted-foreground">
          {formatDateTime(issuedAt, { withYear: true, withZone: true })}
        </p>
      </section>

      <dl className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="flex flex-col gap-1 bg-canvas p-5">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className={row.mono ? 'font-mono text-sm break-all' : 'text-sm'}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {evidence.length > 0 ? (
        <section className="border-t border-border p-6 sm:p-8">
          <h2 className="mb-3 text-sm font-medium">Supporting evidence</h2>
          <ul className="flex flex-col gap-2">
            {evidence.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="font-mono text-2xs text-muted-foreground">
                  {item.fingerprint.slice(0, 12)}…
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="border-t border-border p-6 text-xs text-pretty text-muted-foreground sm:p-8">
        {FOOTNOTE[recorded]}
      </footer>
    </article>
  )
}

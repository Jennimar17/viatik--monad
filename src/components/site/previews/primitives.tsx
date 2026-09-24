import type * as React from 'react'
import { cn } from '@/lib/utils'

import { CURRENCY, type Status, type StatusTone } from '@/components/site/content/demo-data'

/**
 * Shared building blocks so every embedded product preview reads as one
 * application: theme-aware surfaces, soft inset edges, tabular numbers,
 * and plain-language statuses that stay legible on glass.
 */

export function PreviewPanel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('preview-panel rounded-2xl border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  )
}

export function PreviewHeader({
  label,
  title,
  meta,
  className,
}: {
  label: string
  title?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <PreviewLabel>{label}</PreviewLabel>
        {title ? <p className="text-sm font-medium text-foreground sm:text-base">{title}</p> : null}
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : null}
    </div>
  )
}

export function PreviewLabel({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-xs text-subtle', className)} {...props} />
}

export function Money({
  amount,
  currency = CURRENCY,
  className,
  currencyClassName,
}: {
  amount: string
  currency?: string
  className?: string
  currencyClassName?: string
}) {
  return (
    <span className={cn('whitespace-nowrap num', className)}>
      {amount}
      <span className={cn('ml-1 text-sm text-subtle', currencyClassName)}>{currency}</span>
    </span>
  )
}

const toneMarker: Record<StatusTone, string> = {
  neutral: 'bg-subtle',
  accent: 'bg-violet',
  success: 'bg-success',
  warning: 'bg-warning',
}

export function StatusChip({
  status,
  className,
  size = 'sm',
  ...props
}: React.ComponentProps<'span'> & {
  status: Status
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 font-medium whitespace-nowrap text-foreground',
        size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-[1px]', toneMarker[status.tone])} />
      {status.label}
    </span>
  )
}

export function ProgressLine({
  value,
  label,
  className,
  segments,
}: {
  value: number
  label: string
  className?: string
  /** Renders the track as N equal segments, filled up to `value`. */
  segments?: number
}) {
  if (segments) {
    const filled = Math.round((value / 100) * segments)
    return (
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className={cn('flex gap-1', className)}
      >
        {Array.from({ length: segments }, (_, i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-[1px]', i < filled ? 'bg-violet' : 'bg-muted')} />
        ))}
      </div>
    )
  }

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      className={cn('h-1 w-full overflow-hidden rounded-[1px] bg-muted', className)}
    >
      <span className="block h-full bg-violet" style={{ width: `${value}%` }} />
    </div>
  )
}

export function KeyValueList({
  items,
  className,
  dense = false,
}: {
  items: { label: string; value: React.ReactNode }[]
  className?: string
  dense?: boolean
}) {
  return (
    <dl className={cn('flex flex-col', className)}>
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            'flex items-baseline justify-between gap-4 border-t border-border first:border-t-0',
            dense ? 'py-2' : 'py-2.5',
          )}
        >
          <dt className="text-sm text-muted-foreground">{item.label}</dt>
          <dd className="text-right text-sm text-foreground num">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Stat({
  label,
  value,
  className,
  valueClassName,
}: {
  label: string
  value: React.ReactNode
  className?: string
  valueClassName?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <PreviewLabel>{label}</PreviewLabel>
      <p className={cn('text-base font-medium text-foreground num', valueClassName)}>{value}</p>
    </div>
  )
}

export function DemoNote({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <p className={cn('text-xs text-subtle', className)}>{children ?? 'Fictional interface data shown.'}</p>
  )
}

export function PreviewDivider({ className }: { className?: string }) {
  return <hr className={cn('border-border', className)} />
}

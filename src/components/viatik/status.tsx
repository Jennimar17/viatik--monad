import type * as React from 'react'

import { cn } from '@/lib/utils'

export type StatusTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger'

/** A human status: the label always says it, the tone only reinforces it. */
export type StatusDescriptor = { label: string; tone: StatusTone }

const toneStyles: Record<StatusTone, { marker: string; chip: string }> = {
  neutral: { marker: 'bg-subtle', chip: 'border-border bg-muted/60 text-foreground' },
  info: { marker: 'bg-info', chip: 'border-info/25 bg-info-soft text-foreground' },
  accent: { marker: 'bg-mist', chip: 'border-mist/30 bg-mist/10 text-foreground' },
  success: { marker: 'bg-success', chip: 'border-success/30 bg-success-soft text-foreground' },
  warning: { marker: 'bg-warning', chip: 'border-warning/30 bg-warning-soft text-foreground' },
  danger: { marker: 'bg-danger', chip: 'border-danger/35 bg-danger-soft text-foreground' },
}

/**
 * Human status language with a small square marker, as in the landing
 * previews. Color is never the only signal: the label always says it.
 */
export function StatusBadge({
  status,
  size = 'sm',
  pulse = false,
  className,
  ...props
}: React.ComponentProps<'span'> & { status: StatusDescriptor; size?: 'sm' | 'md'; pulse?: boolean }) {
  const tone = toneStyles[status.tone]
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-2 rounded-full border font-medium whitespace-nowrap',
        size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-7 px-3 text-sm',
        tone.chip,
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn('size-1.5 shrink-0 rounded-[1px]', tone.marker, pulse && 'pending-pulse')}
      />
      {status.label}
    </span>
  )
}

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block size-2 shrink-0 rounded-[2px]', toneStyles[tone].marker, className)}
    />
  )
}

/** Boxed monospace tag, used for role and scope labels (e.g. AGENCY ADMIN). */
export function Tag({ className, ...props }: React.ComponentProps<'span'>) {
  return <span className={cn('box-tag', className)} {...props} />
}

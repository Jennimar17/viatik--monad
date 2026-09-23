import { CloudOff, RotateCw, TriangleAlert } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Empty state; each screen passes the spec's exact copy. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
  titleAs,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
  compact?: boolean
  /** Use h1 when the empty state is the whole page. Defaults to h3 in panels, h2 otherwise. */
  titleAs?: 'h1' | 'h2' | 'h3'
}) {
  const Title = titleAs ?? (compact ? 'h3' : 'h2')
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      {icon ? (
        <div className="flex size-11 items-center justify-center rounded-xl border border-border text-subtle [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <div className="flex max-w-sm flex-col gap-1.5">
        <Title className="font-display text-lg font-medium text-foreground">{title}</Title>
        {description ? <p className="text-sm text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

/** Error state. `onRetry` needs a client component parent (e.g. an error boundary). */
export function ErrorState({
  title = 'We could not load this page',
  description = 'Your data is safe. Check your connection and try again.',
  onRetry,
  className,
  titleAs: Title = 'h2',
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
  titleAs?: 'h1' | 'h2' | 'h3'
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft px-6 py-12 text-center',
        className,
      )}
      role="alert"
    >
      <TriangleAlert className="size-6 text-danger" aria-hidden="true" />
      <div className="flex max-w-sm flex-col gap-1.5">
        <Title className="font-display text-lg font-medium">{title}</Title>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="pill-sm" onClick={onRetry} className="mt-2">
          <RotateCw data-icon="inline-start" />
          Try again
        </Button>
      ) : null}
    </div>
  )
}

/** Shown while the device is offline; recent data stays visible. */
export function OfflineState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm',
        className,
      )}
      role="status"
    >
      <CloudOff className="size-4 text-warning" aria-hidden="true" />
      You are offline. Recent data is shown; new operations will wait until you reconnect.
    </div>
  )
}

/** Page-shaped loading skeleton so the layout does not jump when data arrives. */
export function PageSkeleton({ kpis = 4, className }: { kpis?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-8', className)} aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border lg:grid-cols-4">
        {Array.from({ length: kpis }, (_, i) => (
          <div key={i} className="flex flex-col gap-3 bg-card p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

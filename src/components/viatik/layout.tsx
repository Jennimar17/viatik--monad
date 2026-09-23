import type * as React from 'react'

import { cn } from '@/lib/utils'

/** Page title block: scope eyebrow, heading, one-line description, actions. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  meta?: React.ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-col gap-5 md:flex-row md:items-end md:justify-between', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-subtle">{eyebrow}</div>
        ) : null}
        <h1 className="font-display text-3xl leading-tight font-medium tracking-tight text-balance text-foreground sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-base text-pretty text-muted-foreground">{description}</p>
        ) : null}
        {meta ? <div className="mt-1 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** Flat, opaque data surface with an optional header row. Money always sits on one of these. */
export function Panel({
  title,
  description,
  action,
  children,
  className,
  contentClassName,
  as: Component = 'section',
  ...props
}: Omit<React.ComponentProps<'section'>, 'title' | 'ref'> & {
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  contentClassName?: string
  as?: 'section' | 'div' | 'article'
}) {
  return (
    <Component className={cn('surface flex min-w-0 flex-col rounded-xl', className)} {...props}>
      {title || action ? (
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-1 sm:px-6">
          <div className="flex min-w-0 flex-col gap-1">
            {title ? <h2 className="text-base font-medium text-foreground">{title}</h2> : null}
            {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className={cn('flex min-w-0 flex-1 flex-col px-5 py-4 sm:px-6', contentClassName)}>{children}</div>
    </Component>
  )
}

/** Floating chrome surface (the landing's glass panel). Never used for money tables. */
export function GlassPanel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('glass-panel rounded-2xl', className)} {...props} />
}

/** Film grain over any surface, as on the landing's hero and canvas. */
export function GrainLayer({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('grain', className)} {...props} />
}

/** Cells joined edge to edge by hairlines, e.g. a row of KPI tiles. */
export function HairlineGrid({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('hairline-grid overflow-hidden rounded-xl', className)} {...props} />
}

export function KeyValueList({
  items,
  className,
  dense = false,
}: {
  items: { label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode }[]
  className?: string
  dense?: boolean
}) {
  return (
    <dl className={cn('flex flex-col', className)}>
      {items.map((item, index) => (
        <div
          key={index}
          className={cn(
            'flex items-baseline justify-between gap-4 border-t border-border first:border-t-0',
            dense ? 'py-2' : 'py-2.5',
          )}
        >
          <dt className="text-sm text-muted-foreground">
            {item.label}
            {item.hint ? <span className="mt-0.5 block text-xs text-subtle">{item.hint}</span> : null}
          </dt>
          <dd className="min-w-0 text-right text-sm break-words text-foreground num">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function SectionLabel({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p className={cn('text-xs font-medium tracking-[0.08em] text-subtle uppercase', className)} {...props} />
  )
}

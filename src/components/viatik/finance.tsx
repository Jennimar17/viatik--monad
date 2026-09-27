import { ArrowDownRight, ArrowUpRight, Check, Circle, CircleDot, X } from 'lucide-react'
import type { Route } from 'next'
import { AppLink as Link } from '@/components/viatik/app-link'
import type * as React from 'react'

import { add, formatUsd, percentOf, ZERO, type Cents } from '@/domain/money'
import { cn } from '@/lib/utils'

import { Amount } from './amount'
import { Sparkline } from './charts'
import { AgentAvatar, PersonAvatar } from './people'
import { StatusBadge, type StatusDescriptor } from './status'

const usd = (value: Cents) => formatUsd(value, { withCode: true })

// ─── KPI ─────────────────────────────────────────────────────────────────────

export function KpiTile({
  label,
  value,
  hint,
  delta,
  trend,
  icon,
  className,
  emphasis = false,
}: {
  label: string
  /** Cents render as an Amount; anything else renders as given. */
  value: Cents | React.ReactNode
  hint?: React.ReactNode
  delta?: { value: string; direction: 'up' | 'down'; good?: boolean }
  trend?: number[]
  icon?: React.ReactNode
  className?: string
  emphasis?: boolean
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 p-5', emphasis && 'bg-surface', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          {icon ? <span className="text-subtle [&_svg]:size-4">{icon}</span> : null}
          {label}
        </p>
        {delta ? (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 text-xs font-medium',
              (delta.good ?? delta.direction === 'up') ? 'text-success' : 'text-danger',
            )}
          >
            {delta.direction === 'up' ? (
              <ArrowUpRight className="size-3.5" />
            ) : (
              <ArrowDownRight className="size-3.5" />
            )}
            {delta.value}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        {typeof value === 'number' ? <Amount value={value as Cents} size="lg" code={false} /> : value}
      </div>
      {trend && trend.length > 1 ? <Sparkline data={trend} /> : null}
      {hint ? <p className="text-xs text-subtle">{hint}</p> : null}
    </div>
  )
}

// ─── Capital states ──────────────────────────────────────────────────────────

export type CapitalStates = Record<
  'committed' | 'funded' | 'released' | 'allocated' | 'reserved' | 'spent' | 'returned',
  Cents
>

const capitalMeta: { key: keyof CapitalStates; label: string; color: string; description: string }[] = [
  {
    key: 'committed',
    label: 'Committed',
    color: 'var(--color-stone)',
    description: 'Promised under agreements',
  },
  {
    key: 'funded',
    label: 'Funded',
    color: 'color-mix(in srgb, var(--color-mist) 55%, transparent)',
    description: 'Deposited into funding vaults',
  },
  {
    key: 'released',
    label: 'Released',
    color: 'var(--color-mist)',
    description: 'Made available to agencies',
  },
  { key: 'allocated', label: 'Allocated', color: 'var(--color-info)', description: 'Assigned to budgets' },
  {
    key: 'reserved',
    label: 'Reserved',
    color: 'var(--color-warning)',
    description: 'Held for pending payments',
  },
  { key: 'spent', label: 'Spent', color: 'var(--color-sage)', description: 'Settled to final destinations' },
  {
    key: 'returned',
    label: 'Returned',
    color: 'var(--color-chart-4)',
    description: 'Sent back under agreement rules',
  },
]

/**
 * The seven capital states side by side. They are never merged into a
 * single balance: each gets its own row, amount and share of commitment.
 */
export function CapitalStateList({ states, className }: { states: CapitalStates; className?: string }) {
  const base = (states.committed > 0 ? states.committed : Math.max(states.funded, 1)) as Cents
  return (
    <ul className={cn('flex flex-col gap-3', className)}>
      {capitalMeta.map((meta) => {
        const value = states[meta.key]
        const pct = percentOf(value, base)
        return (
          <li key={meta.key} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5">
            <span
              className="flex min-w-0 items-center gap-2 text-sm text-foreground"
              title={meta.description}
            >
              <span
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: meta.color }}
                aria-hidden="true"
              />
              <span className="truncate">{meta.label}</span>
              <span className="sr-only">{meta.description}</span>
            </span>
            <Amount value={value} size="sm" className="justify-self-end" />
            <span className="col-span-2 h-1 overflow-hidden rounded-[1px] bg-muted" aria-hidden="true">
              <span
                className="block h-full rounded-[1px]"
                style={{ width: `${pct}%`, background: meta.color }}
              />
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Compact stacked bar: funded, released and spent within the commitment. */
export function CapitalBar({
  committed,
  funded,
  released,
  spent,
  className,
}: {
  committed: Cents
  funded: Cents
  released: Cents
  /** Omit where spending is not attributable, e.g. a single agreement. */
  spent?: Cents
  className?: string
}) {
  const f = percentOf(funded, committed)
  const r = percentOf(released, committed)
  const s = spent === undefined ? 0 : percentOf(spent, committed)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className="relative h-2 overflow-hidden rounded-[2px] bg-muted"
        role="img"
        aria-label={`${usd(released)} released of ${usd(committed)} committed`}
      >
        <span className="absolute inset-y-0 left-0 bg-mist/25" style={{ width: `${f}%` }} />
        <span className="absolute inset-y-0 left-0 bg-mist" style={{ width: `${r}%` }} />
        <span className="absolute inset-y-0 left-0 bg-sage" style={{ width: `${s}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {spent === undefined ? null : <Legend color="bg-sage" label="Spent" value={spent} />}
        <Legend color="bg-mist" label="Released" value={released} />
        <Legend color="bg-mist/25" label="Funded" value={funded} />
        <Legend color="bg-muted" label="Committed" value={committed} />
      </div>
    </div>
  )
}

function Legend({ color, label, value }: { color: string; label: string; value: Cents }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-[2px]', color)} aria-hidden="true" />
      {label} <span className="text-foreground num">{formatUsd(value)}</span>
    </span>
  )
}

// ─── Funding progress, tranches and milestones ──────────────────────────────

export type TrancheSegment = {
  id: string
  label: string
  amount: Cents
  state: 'released' | 'review' | 'available' | 'planned' | 'rejected'
}

/** One segment per tranche, width proportional to its amount. */
export function FundingProgress({ segments, className }: { segments: TrancheSegment[]; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.amount, 0)
  const grow = (amount: number) => ({ flexGrow: total > 0 ? amount / total : 1, flexBasis: 0 })
  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex gap-1" role="list" aria-label="Tranches">
        {segments.map((segment) => (
          <div
            key={segment.id}
            role="listitem"
            aria-label={`${segment.label}: ${usd(segment.amount)}, ${segment.state}`}
            className={cn(
              'h-2 rounded-[2px]',
              segment.state === 'released' && 'bg-mist',
              segment.state === 'review' && 'pending-pulse bg-warning',
              segment.state === 'available' && 'bg-info/70',
              segment.state === 'planned' && 'bg-muted',
              segment.state === 'rejected' && 'bg-danger/60',
            )}
            style={grow(segment.amount)}
          />
        ))}
      </div>
      <div className="flex gap-1 text-xs text-subtle">
        {segments.map((segment) => (
          <span key={segment.id} className="min-w-0 truncate" style={grow(segment.amount)}>
            {segment.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/** A tranche of a funding agreement: amount, linked milestone, status and the next action. */
export function TrancheCard({
  label,
  amount,
  status,
  milestone,
  detail,
  action,
  className,
}: {
  label: string
  amount: Cents
  status: StatusDescriptor
  milestone?: React.ReactNode
  detail?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <article className={cn('surface flex min-w-0 flex-col gap-4 rounded-xl p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          <Amount value={amount} size="lg" />
        </div>
        <StatusBadge status={status} pulse={status.tone === 'warning'} />
      </div>
      {milestone || detail ? (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          {milestone ? <p className="text-sm text-foreground">{milestone}</p> : null}
          {detail ? <p className="text-xs text-subtle">{detail}</p> : null}
        </div>
      ) : null}
      {action ? <div className="flex flex-wrap gap-2">{action}</div> : null}
    </article>
  )
}

export type TimelineItem = {
  id: string
  title: React.ReactNode
  subtitle?: React.ReactNode
  date?: React.ReactNode
  amount?: Cents
  status: StatusDescriptor
  state: 'done' | 'current' | 'upcoming' | 'blocked'
  action?: React.ReactNode
}

export function MilestoneTimeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn('relative flex flex-col', className)}>
      {items.map((item, index) => (
        <li key={item.id} className="relative flex gap-4 pb-6 last:pb-0">
          {index < items.length - 1 ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-6 bottom-0 left-[11px] w-px',
                item.state === 'done' ? 'bg-mist/40' : 'bg-border',
              )}
            />
          ) : null}
          <span
            aria-hidden="true"
            className={cn(
              'relative z-[1] mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
              item.state === 'done' && 'border-mist bg-mist text-primary-foreground',
              item.state === 'current' && 'border-warning bg-canvas text-warning',
              item.state === 'upcoming' && 'border-border bg-canvas text-subtle',
              item.state === 'blocked' && 'border-danger bg-canvas text-danger',
            )}
          >
            {item.state === 'done' ? (
              <Check className="size-3.5" />
            ) : item.state === 'current' ? (
              <CircleDot className="size-3.5" />
            ) : item.state === 'blocked' ? (
              <X className="size-3.5" />
            ) : (
              <Circle className="size-2.5" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              {item.subtitle ? <p className="text-sm text-muted-foreground">{item.subtitle}</p> : null}
              {item.date ? <p className="text-xs text-subtle">{item.date}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
              {item.amount !== undefined ? <Amount value={item.amount} size="sm" /> : null}
              <StatusBadge status={item.status} />
              {item.action}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

export function UsageBar({
  used,
  limit,
  reserved = 0 as Cents,
  label,
  className,
  showLegend = true,
}: {
  used: Cents
  limit: Cents
  reserved?: Cents
  label?: string
  className?: string
  showLegend?: boolean
}) {
  const usedPct = percentOf(used, limit)
  const reservedPct = Math.min(100 - usedPct, percentOf(reserved, limit))
  const tone =
    usedPct + reservedPct >= 90 ? 'bg-danger' : usedPct + reservedPct >= 70 ? 'bg-warning' : 'bg-sage'
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className="flex h-1.5 overflow-hidden rounded-[2px] bg-muted"
        role="progressbar"
        aria-label={label ?? 'Usage'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usedPct}
      >
        <span className={cn('h-full', tone)} style={{ width: `${usedPct}%` }} />
        {reservedPct > 0 ? (
          <span className="h-full bg-warning/50" style={{ width: `${reservedPct}%` }} />
        ) : null}
      </div>
      {showLegend ? (
        <div className="flex justify-between text-xs text-subtle">
          <span>
            <span className="text-foreground num">{formatUsd(used)}</span> used
            {reserved > 0 ? (
              <>
                {' '}
                · <span className="num">{formatUsd(reserved)}</span> reserved
              </>
            ) : null}
          </span>
          <span className="num">{formatUsd(limit)}</span>
        </div>
      ) : null}
    </div>
  )
}

export type BudgetAssignee = { name: string; kind: 'user' | 'ai_agent' }

/** A budget at a glance: source account, consumption, period, assignees and status. */
export function BudgetCard({
  name,
  source,
  allocated,
  spent,
  reserved = 0 as Cents,
  period,
  status,
  assignees = [],
  action,
  className,
}: {
  name: string
  source: string
  allocated: Cents
  spent: Cents
  reserved?: Cents
  period: string
  status: StatusDescriptor
  assignees?: BudgetAssignee[]
  action?: React.ReactNode
  className?: string
}) {
  const available = Math.max(0, allocated - spent - reserved) as Cents
  return (
    <article className={cn('surface flex min-w-0 flex-col gap-4 rounded-xl p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="truncate text-base font-medium text-foreground">{name}</h3>
          <p className="text-xs text-subtle">
            From {source} · {period}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xs text-muted-foreground">Available</p>
        <Amount value={available} size="lg" />
      </div>
      <UsageBar used={spent} reserved={reserved} limit={allocated} label={`${name} usage`} />
      {assignees.length > 0 || action ? (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <div className="flex -space-x-2" aria-label={`${assignees.length} assigned`}>
            {assignees
              .slice(0, 5)
              .map((person) =>
                person.kind === 'ai_agent' ? (
                  <AgentAvatar key={person.name} size="xs" className="ring-2 ring-card" />
                ) : (
                  <PersonAvatar key={person.name} name={person.name} size="xs" className="ring-2 ring-card" />
                ),
              )}
          </div>
          {action}
        </div>
      ) : null}
    </article>
  )
}

export type BudgetHealthItem = {
  id: string
  name: string
  used: Cents
  reserved?: Cents
  limit: Cents
  /** Makes the row a link to the budget. */
  href?: Route
  /** Right-hand text or badge; defaults to the percentage used. */
  note?: React.ReactNode
}

const committedShare = (b: BudgetHealthItem) => percentOf(add(b.used, b.reserved ?? ZERO), b.limit)

/** Consumption of every budget in one list, worst first. */
export function BudgetHealth({ budgets, className }: { budgets: BudgetHealthItem[]; className?: string }) {
  const ranked = [...budgets].sort((a, b) => committedShare(b) - committedShare(a))
  return (
    <ul className={cn('flex flex-col gap-4', className)}>
      {ranked.map((budget) => {
        const content = (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-sm font-medium text-foreground">{budget.name}</span>
              <span className="shrink-0 text-xs text-subtle num">
                {budget.note ?? `${committedShare(budget)}%`}
              </span>
            </div>
            <UsageBar
              used={budget.used}
              reserved={budget.reserved}
              limit={budget.limit}
              label={`${budget.name} usage`}
              showLegend={false}
            />
          </>
        )
        return (
          <li key={budget.id}>
            {budget.href ? (
              <Link
                href={budget.href}
                className="flex flex-col gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {content}
              </Link>
            ) : (
              <div className="flex flex-col gap-1.5">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

// ─── Capital trail ───────────────────────────────────────────────────────────

export type TrailStep = {
  id: string
  label: string
  title: React.ReactNode
  amount?: Cents
  detail?: React.ReactNode
}

/** Commitment → release → budget → payment → receipt, left to right. */
export function CapitalTrail({ steps, className }: { steps: TrailStep[]; className?: string }) {
  return (
    <ol
      className={cn(
        'grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none',
        className,
      )}
    >
      {steps.map((step, index) => (
        <li key={step.id} className="bg-card p-4">
          <span className="flex items-center justify-between gap-2">
            <span className="box-tag">
              {String(index + 1).padStart(2, '0')} · {step.label}
            </span>
            {index < steps.length - 1 ? (
              <ArrowUpRight className="hidden size-3.5 rotate-45 text-subtle lg:block" aria-hidden="true" />
            ) : null}
          </span>
          <span className="mt-3 block text-sm font-medium text-foreground">{step.title}</span>
          {step.amount !== undefined ? <Amount value={step.amount} size="md" className="mt-1" /> : null}
          {step.detail ? <span className="mt-1 block text-xs text-subtle">{step.detail}</span> : null}
        </li>
      ))}
    </ol>
  )
}

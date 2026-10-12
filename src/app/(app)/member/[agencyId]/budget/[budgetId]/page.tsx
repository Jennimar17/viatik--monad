'use client'

import { Plus } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'

import { ButtonLink } from '@/components/app/button-link'
import { providerKindLine } from '@/components/app/provider-parts'
import { requestRecipientLabel } from '@/components/app/request-parts'
import { useHref, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Amount } from '@/components/viatik/amount'
import { MoneyBarChart, UsageRing } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { budgetPeriodLabel, budgetPeriodUnit, categoryLabel } from '@/domain/labels'
import { formatUsd, sum } from '@/domain/money'
import { describeBudgetPolicy } from '@/domain/policy'
import { destinationName, memberBudgets } from '@/domain/queries'
import { committedAt, lastMonths } from '@/domain/selectors'
import { budgetStatus, requestStatusFor } from '@/domain/status'
import type { RequestStatus } from '@/domain/types'
import { formatDate, formatRelative, pluralize } from '@/lib/format'

/** Requests that count against the allowance: approved holds, settling and settled payments. */
const SPENT: ReadonlySet<RequestStatus> = new Set(['approved', 'processing', 'completed'])

export default function MemberBudgetDetailPage() {
  const { budgetId } = useParams<{ budgetId: string }>()
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()

  const entry = memberBudgets(state, agencyId, userId, now).find((b) => b.budget.id === budgetId)
  if (!entry) {
    return (
      <ScreenUnavailable
        title="Budget not found"
        description="You may no longer have access to it, or the link is out of date."
      />
    )
  }

  const { budget, allowance, used, remaining, usage } = entry
  const unit = budgetPeriodUnit[budget.period]
  const mine = state.requests
    .filter((r) => r.budgetId === budget.id && r.requester.kind === 'user' && r.requester.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const spent = mine.filter((r) => SPENT.has(r.status))
  const spend = lastMonths(now, 6).map((month) => ({
    month: month.label,
    spent: sum(
      spent.filter((r) => committedAt(r) >= month.start && committedAt(r) < month.end),
      (r) => r.amount,
    ),
  }))
  const hasSpend = spend.some((row) => row.spent > 0)
  const rules = describeBudgetPolicy(budget, {
    destinationNames: budget.allowedDestinationIds.map((id) => destinationName(state, id)),
    categoryLabels: categoryLabel,
    allowance,
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('budget')} className="hover:text-foreground">
            My budget
          </Link>
        }
        title={budget.name}
        description={budget.purpose}
        meta={
          <>
            <StatusBadge status={budgetStatus[budget.status]} size="md" />
            <Tag>{budgetPeriodLabel[budget.period]}</Tag>
          </>
        }
        actions={
          budget.status === 'active' ? (
            <ButtonLink href={href(`requests/new?budget=${budget.id}`)} size="pill">
              <Plus data-icon="inline-start" /> New request
            </ButtonLink>
          ) : null
        }
      />

      {budget.status === 'paused' ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          This budget is paused. New requests wait until your Agency Admin resumes it.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
        <Panel>
          <div className="flex flex-col items-center gap-3 py-2">
            <UsageRing value={used} max={allowance.periodLimit} size={160} label="Allowance used">
              <span className="text-2xs tracking-[0.1em] text-subtle uppercase">Left</span>
              <span className="font-display text-xl num">{formatUsd(remaining)}</span>
            </UsageRing>
            <p className="text-sm text-muted-foreground">
              {formatUsd(used, { withCode: true })} of {formatUsd(allowance.periodLimit, { withCode: true })}{' '}
              used
            </p>
            <p className="text-xs text-subtle">
              {budget.period === 'one_time'
                ? 'One-time budget, no reset'
                : `Resets on ${formatDate(usage.window.end)}`}
            </p>
          </div>
        </Panel>
        <Panel title="Rules for you" description="Checked on every request, in the app and at settlement.">
          <PolicySummary
            title="In plain language"
            lines={[
              `You can spend up to ${formatUsd(allowance.periodLimit, { withCode: true })} per ${unit}.`,
              ...rules.slice(1),
            ]}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Where you can pay">
          {budget.allowedDestinationIds.length === 0 ? (
            <p className="text-sm text-muted-foreground">Any approved payment destination of the Agency.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {budget.allowedDestinationIds.map((id) => {
                const destination = state.destinations.find((d) => d.id === id)
                return (
                  <li key={id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{destination?.name ?? 'Payment destination'}</span>
                    <span className="text-xs text-subtle">
                      {destination ? providerKindLine(destination) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Approved uses">
          <div className="flex flex-wrap gap-2">
            {budget.allowedCategories.map((c) => (
              <span
                key={c}
                className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground"
              >
                {categoryLabel[c]}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Your spending" description="Last six months on this budget.">
        {hasSpend ? (
          <MoneyBarChart
            data={spend}
            series={[{ key: 'spent', label: 'Spent', color: 'var(--color-sage)' }]}
            className="h-52"
          />
        ) : (
          <EmptyState
            compact
            title="No spending yet"
            description="Your approved requests will show here by month."
          />
        )}
      </Panel>

      <Panel title="Your requests on this budget" description={pluralize(mine.length, 'request')}>
        {mine.length === 0 ? (
          <EmptyState
            compact
            title="No requests yet"
            description="Requests you make from this budget will appear here."
            action={
              budget.status === 'active' ? (
                <ButtonLink href={href(`requests/new?budget=${budget.id}`)} variant="outline" size="pill-sm">
                  New request
                </ButtonLink>
              ) : undefined
            }
          />
        ) : (
          <ul className="flex flex-col">
            {mine.map((r) => (
              <li key={r.id} className="border-t border-border first:border-t-0">
                <Link
                  href={href(`requests/${r.id}`)}
                  className="flex items-center gap-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{r.purpose}</span>
                    <span className="truncate text-xs text-subtle">
                      {requestRecipientLabel(state, r, userId)} · {formatRelative(r.createdAt, now)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Amount value={r.amount} size="sm" />
                    <StatusBadge status={requestStatusFor(r)} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

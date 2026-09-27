'use client'

import { PieChart, Plus } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/app/button-link'
import { useHref, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { UsageBar } from '@/components/viatik/finance'
import { PageHeader } from '@/components/viatik/layout'
import { Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { budgetPeriodLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { memberBudgets } from '@/domain/queries'
import { formatDate, pluralize } from '@/lib/format'

export default function MyBudgetPage() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const budgets = memberBudgets(state, agencyId, userId, now)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="My budget"
        description="The budgets you can spend from, and how much is left this period."
        meta={
          budgets.length ? (
            <span className="text-sm text-subtle">{pluralize(budgets.length, 'budget')} assigned to you</span>
          ) : null
        }
        actions={
          budgets.length ? (
            <ButtonLink href={href('requests/new')} size="pill">
              <Plus data-icon="inline-start" /> New request
            </ButtonLink>
          ) : null
        }
      />

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart />}
          title="No spending access yet"
          description="Your Agency Admin has not assigned a budget to you. Once they do, it shows up here."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {budgets.map((b) => (
            <Link
              key={b.budget.id}
              href={href(`budget/${b.budget.id}`)}
              className="surface flex flex-col gap-4 rounded-xl p-5 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">{b.budget.name}</span>
                  <span className="text-xs text-pretty text-subtle">{b.budget.purpose}</span>
                </span>
                <Tag>{budgetPeriodLabel[b.budget.period]}</Tag>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-subtle">Left this period</span>
                <Amount value={b.remaining} size="xl" />
              </div>
              <UsageBar used={b.used} limit={b.allowance.periodLimit} label={`${b.budget.name} allowance`} />
              <p className="text-xs text-subtle">
                {b.budget.period === 'one_time'
                  ? 'One-time budget, no reset'
                  : `Resets on ${formatDate(b.usage.window.end)}`}{' '}
                · max {formatUsd(b.budget.perOperationLimit, { withCode: true })} per payment
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

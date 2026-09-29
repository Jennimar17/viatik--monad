'use client'

import { PieChart, Plus } from 'lucide-react'
import Link from '@/components/viatik/link'

import { ButtonLink } from '@/components/app/button-link'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { EmptyState } from '@/components/viatik/feedback'
import { BudgetCard, KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { budgetPeriodLabel } from '@/domain/labels'
import { formatUsd, sum } from '@/domain/money'
import { accountName, holderName } from '@/domain/queries'
import { budgetUsage } from '@/domain/selectors'
import { budgetStatus } from '@/domain/status'
import { pluralize } from '@/lib/format'

export default function BudgetsPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId)
  const usages = budgets.map((budget) => ({ budget, usage: budgetUsage(state, budget, now) }))
  const canCreate = can('create_budget')
  const createButton = canCreate ? (
    <ButtonLink href={href('budgets/new')} size="pill">
      <Plus data-icon="inline-start" /> Create budget
    </ButtonLink>
  ) : null

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Budgets"
        description="Budgets hold the rules: who can spend, how much, when, and where the money can go."
        actions={createButton}
      />
      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart />}
          title="No budgets yet"
          description="Create a budget to assign capital, limits, and approved uses."
          action={createButton}
        />
      ) : (
        <>
          <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Available in budgets" value={sum(usages, (u) => u.usage.available)} emphasis />
            <KpiTile
              label="Reserved"
              value={sum(usages, (u) => u.usage.reserved)}
              hint="Held for approved requests"
            />
            <KpiTile label="Spent this period" value={sum(usages, (u) => u.usage.spentThisPeriod)} />
            <KpiTile
              label="Active budgets"
              value={
                <span className="font-display text-2xl">
                  {budgets.filter((b) => b.status === 'active').length}
                </span>
              }
              hint={pluralize(budgets.length, 'budget')}
            />
          </HairlineGrid>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {usages.map(({ budget, usage }) => {
              const holders = state.allowances.filter(
                (a) => a.budgetId === budget.id && a.status === 'active',
              )
              return (
                <Link
                  key={budget.id}
                  href={href(`budgets/${budget.id}`)}
                  className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <BudgetCard
                    name={budget.name}
                    source={accountName(state, budget.sourceAccountId)}
                    period={budgetPeriodLabel[budget.period]}
                    status={budgetStatus[budget.status]}
                    allocated={usage.balance}
                    spent={usage.spentThisPeriod}
                    reserved={usage.reserved}
                    assignees={holders.map((h) => ({
                      name: holderName(state, h.holder),
                      kind: h.holder.kind === 'member' ? 'user' : 'ai_agent',
                    }))}
                    action={
                      <span className="text-xs text-subtle">
                        {holders.length === 0 ? 'No one assigned · ' : ''}Max{' '}
                        {formatUsd(budget.perOperationLimit)} per payment
                      </span>
                    }
                    className="h-full transition-colors group-hover:border-foreground/25"
                  />
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

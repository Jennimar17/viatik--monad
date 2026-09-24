'use client'

import { PieChart, Plus } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/app/button-link'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile, UsageBar } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { AgentAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { budgetPeriodLabel } from '@/domain/labels'
import { formatUsd, sum } from '@/domain/money'
import { accountName, userName } from '@/domain/queries'
import { budgetUsage } from '@/domain/selectors'
import { budgetStatus } from '@/domain/status'

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
    <div className="flex flex-col gap-6">
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
              hint={`${budgets.length} in total`}
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
                  className="surface flex flex-col gap-4 rounded-xl p-5 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-medium">{budget.name}</span>
                      <span className="text-xs text-subtle">
                        From {accountName(state, budget.sourceAccountId)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1.5">
                      <StatusBadge status={budgetStatus[budget.status]} />
                      <Tag>{budgetPeriodLabel[budget.period]}</Tag>
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-subtle">Available</span>
                    <Amount value={usage.available} size="lg" />
                  </div>
                  <UsageBar
                    used={usage.spentThisPeriod}
                    reserved={usage.reserved}
                    limit={budget.periodLimit}
                    label={`${budget.name} usage`}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex -space-x-2">
                      {holders
                        .slice(0, 5)
                        .map((h) =>
                          h.holder.kind === 'member' ? (
                            <PersonAvatar
                              key={h.id}
                              name={userName(state, h.holder.userId)}
                              size="xs"
                              className="ring-2 ring-card"
                            />
                          ) : (
                            <AgentAvatar key={h.id} size="xs" className="ring-2 ring-card" />
                          ),
                        )}
                      {holders.length === 0 ? (
                        <span className="text-xs text-subtle">No one assigned</span>
                      ) : null}
                    </span>
                    <span className="text-xs text-subtle">
                      Max {formatUsd(budget.perOperationLimit)} per payment
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

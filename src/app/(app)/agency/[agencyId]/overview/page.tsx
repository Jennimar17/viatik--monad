'use client'

import {
  ArrowRight,
  ArrowUpRight,
  FileClock,
  HandCoins,
  PieChart,
  ReceiptText,
  Send,
  Users,
} from 'lucide-react'
import Link from '@/components/viatik/link'

import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { WelcomeCard } from '@/components/app/welcome-card'
import { Amount } from '@/components/viatik/amount'
import { MoneyBarChart } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { BudgetHealth, KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { formatUsd } from '@/domain/money'
import {
  activeAgreement,
  actorName,
  adminApprovals,
  billState,
  destinationName,
  openBills,
} from '@/domain/queries'
import { agencyCapital, budgetUsage, spendByMonth } from '@/domain/selectors'
import { budgetStatus, trancheStatus } from '@/domain/status'
import { seriesColor, seriesKey } from '@/lib/chart-colors'
import { dueLabel, formatDate, formatRelative, partOfDay, pluralize } from '@/lib/format'

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })

export default function AgencyOverviewPage() {
  const { state, now, user } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()

  const agency = state.agencies.find((a) => a.id === agencyId)
  const capital = agencyCapital(state, agencyId, now)
  const agreement = activeAgreement(state, agencyId)
  const investor = agreement ? state.portfolios.find((p) => p.id === agreement.portfolioId)?.name : undefined
  const tranches = agreement
    ? state.tranches.filter((t) => t.agreementId === agreement.id).sort((a, b) => a.index - b.index)
    : []
  const nextTranche = tranches.find((t) => t.status !== 'released' && t.status !== 'cancelled')
  const nextMilestone = nextTranche?.milestoneId
    ? state.milestones.find((m) => m.id === nextTranche.milestoneId)
    : undefined
  const approvals = adminApprovals(state, agencyId)
  const bills = openBills(state, agencyId, now).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId)
  const budgetSeries = budgets.map((b, i) => ({
    key: seriesKey(i),
    label: b.name,
    color: seriesColor(i),
    id: b.id,
  }))
  const spend = spendByMonth(
    state,
    { agencyId },
    (m) => {
      if (m.from.kind !== 'budget') return null
      const budgetId = m.from.budgetId
      return budgetSeries.find((s) => s.id === budgetId)?.key ?? null
    },
    now,
    6,
  )
  const hasSpend = spend.some((row) => budgetSeries.some((s) => Number(row[s.key] ?? 0) > 0))
  const monthSpendTrend = spend.map((row) =>
    budgetSeries.reduce((sum, s) => sum + Number(row[s.key] ?? 0), 0),
  )
  const pending = [...approvals.mine, ...approvals.withInvestor]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Tag>Agency</Tag>
            <span>{agency?.name}</span>
            {investor ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Funded by {investor}</span>
              </>
            ) : null}
          </>
        }
        title={`Good ${partOfDay(now)}, ${user?.name.split(' ')[0]}`}
        description="What your Agency can operate with today, what is waiting for you, and where money went this month."
        actions={
          <ButtonLink href={href('funding')} size="pill">
            <HandCoins data-icon="inline-start" /> Request funding
          </ButtonLink>
        }
      />

      <WelcomeCard />

      <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {can('create_budget') ? (
          <ButtonLink href={href('budgets/new')} variant="secondary" size="pill-sm">
            <PieChart data-icon="inline-start" /> Create budget
          </ButtonLink>
        ) : null}
        {can('pay_member') ? (
          <ButtonLink href={href('payments/team')} variant="secondary" size="pill-sm">
            <Users data-icon="inline-start" /> Pay team
          </ButtonLink>
        ) : null}
        {can('manage_bills') ? (
          <ButtonLink href={href('bills')} variant="secondary" size="pill-sm">
            <ReceiptText data-icon="inline-start" /> Pay bill
          </ButtonLink>
        ) : null}
        {can('transfer_funds') ? (
          <ButtonLink href={href('accounts/transfer')} variant="secondary" size="pill-sm">
            <Send data-icon="inline-start" /> Transfer funds
          </ButtonLink>
        ) : null}
      </div>

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Available to operate"
          value={capital.availableToOperate}
          hint="Across operating accounts"
          emphasis
        />
        <KpiTile
          label="Allocated to budgets"
          value={capital.allocated}
          hint={pluralize(budgets.filter((b) => b.status === 'active').length, 'active budget')}
        />
        <KpiTile label="Reserved for payments" value={capital.reserved} hint="Held for approved requests" />
        <KpiTile
          label="Spent this period"
          value={capital.spentThisPeriod}
          trend={monthSpendTrend}
          hint={monthName.format(new Date(now))}
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Next expected tranche">
          {nextTranche && agreement ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">
                  {nextTranche.name} · {agreement.title}
                </span>
                <Amount value={nextTranche.amount} size="xl" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={trancheStatus[nextTranche.status]}
                  pulse={nextTranche.status === 'under_review'}
                />
                {nextMilestone ? (
                  <span className="text-sm text-muted-foreground">{nextMilestone.title}</span>
                ) : null}
              </div>
              <p className="text-sm text-pretty text-muted-foreground">
                {nextTranche.status === 'under_review'
                  ? `${investor} is reviewing your evidence. You will be notified when the funds are released.`
                  : nextMilestone
                    ? `Submit evidence for “${nextMilestone.title}” to request this tranche. Due ${formatDate(nextMilestone.dueDate)}.`
                    : nextTranche.scheduledFor
                      ? `Scheduled for ${formatDate(nextTranche.scheduledFor)}.`
                      : 'Request this tranche when you are ready.'}
              </p>
              <ButtonLink href={href('funding')} variant="outline" size="pill-sm" className="w-fit">
                Open funding <ArrowRight data-icon="inline-end" />
              </ButtonLink>
            </div>
          ) : (
            <EmptyState
              compact
              title="No active funding agreement"
              description="Once an Investor creates and activates an agreement, its tranches and milestones will appear here."
            />
          )}
        </Panel>

        <Panel
          title="Pending requests"
          description="Spending that needs your decision."
          action={
            <ButtonLink href={href('approvals')} variant="ghost" size="pill-sm">
              Approvals <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {pending.length === 0 ? (
            <EmptyState
              compact
              title="Nothing needs your attention"
              description="Requests that require your decision will appear here."
            />
          ) : (
            <ul className="flex flex-col">
              {pending.slice(0, 4).map((request) => (
                <li key={request.id} className="border-t border-border first:border-t-0">
                  <Link
                    href={href('approvals')}
                    className="flex items-center gap-3 py-3 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PersonAvatar name={actorName(state, request.requester)} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{request.purpose}</span>
                      <span className="truncate text-xs text-subtle">
                        {actorName(state, request.requester)} · {formatRelative(request.createdAt, now)}
                        {approvals.withInvestor.includes(request) ? ' · With Investor' : ''}
                      </span>
                    </span>
                    <Amount value={request.amount} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Bills due"
          action={
            <ButtonLink href={href('bills')} variant="ghost" size="pill-sm">
              All bills <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {bills.length === 0 ? (
            <EmptyState
              compact
              icon={<FileClock />}
              title="No bills due"
              description="Upload a bill to schedule or pay it."
            />
          ) : (
            <ul className="flex flex-col">
              {bills.slice(0, 4).map((bill) => {
                const overdue = billState(bill, now) === 'overdue'
                return (
                  <li key={bill.id} className="border-t border-border first:border-t-0">
                    <Link
                      href={href(`bills/${bill.id}`)}
                      className="flex items-center gap-3 py-3 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {destinationName(state, bill.destinationId)}
                        </span>
                        <span className={overdue ? 'text-xs text-danger' : 'text-xs text-subtle'}>
                          {bill.status === 'scheduled'
                            ? `Scheduled · ${dueLabel(bill.dueDate, now)}`
                            : dueLabel(bill.dueDate, now)}
                        </span>
                      </span>
                      <Amount value={bill.amount} size="sm" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Spending by budget" description="Last six months.">
          {hasSpend ? (
            <MoneyBarChart data={spend} series={budgetSeries} className="h-72" />
          ) : (
            <EmptyState
              compact
              title="No spending yet"
              description={
                budgets.length === 0
                  ? 'Create a budget to start tracking spend by month.'
                  : 'Payments from your budgets will show here by month.'
              }
              action={
                budgets.length === 0 && can('create_budget') ? (
                  <ButtonLink href={href('budgets/new')} size="pill-sm" variant="outline">
                    Create budget
                  </ButtonLink>
                ) : undefined
              }
            />
          )}
        </Panel>
        <Panel
          title="Budget health"
          description="Used this period against each limit."
          action={
            <ButtonLink href={href('budgets')} variant="ghost" size="pill-sm">
              Budgets <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {budgets.length === 0 ? (
            <EmptyState
              compact
              title="No budgets yet"
              description="Create a budget to assign capital, limits, and approved uses."
            />
          ) : (
            <BudgetHealth
              budgets={budgets.map((budget) => {
                const usage = budgetUsage(state, budget, now)
                return {
                  id: budget.id,
                  name: budget.name,
                  used: usage.spentThisPeriod,
                  reserved: usage.reserved,
                  limit: budget.periodLimit,
                  href: href(`budgets/${budget.id}`),
                  note:
                    budget.status !== 'active' ? (
                      <StatusBadge status={budgetStatus[budget.status]} />
                    ) : (
                      `${formatUsd(usage.available)} available`
                    ),
                }
              })}
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent activity"
        action={
          <ButtonLink href={href('activity')} variant="ghost" size="pill-sm">
            All activity <ArrowUpRight data-icon="inline-end" />
          </ButtonLink>
        }
      >
        <ActivityList
          state={state}
          records={state.activity.filter((a) => a.agencyId === agencyId).slice(0, 8)}
          now={now}
        />
      </Panel>
    </div>
  )
}

'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, ArrowUpRight, Building2, FileClock, Plus, TriangleAlert } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'

import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { useHref, useRole } from '@/components/app/role-context'
import { WelcomeCard } from '@/components/app/welcome-card'
import { Amount } from '@/components/viatik/amount'
import { MoneyAreaChart, MoneyBarChart } from '@/components/viatik/charts'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { CapitalStateList, KpiTile, MilestoneTimeline, UsageBar } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag, type StatusDescriptor } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import {
  JUSTIFY_WITHIN_DAYS,
  portfolioAccountability,
  PROOF_WITHIN_DAYS,
  type AgencyAccountability,
} from '@/domain/accountability'
import { formatUsd, percentOf, sum, type Cents } from '@/domain/money'
import { agreementsOf, investorApprovals } from '@/domain/queries'
import {
  agencyCapital,
  agencyFunding,
  agreementBadge,
  budgetUsage,
  capitalOverTime,
  portfolioCapital,
} from '@/domain/selectors'
import { milestoneStatus } from '@/domain/status'
import { formatDate, formatShortDate, partOfDay, pluralize } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

/** "1 invoice and 400.00 USD to justify are overdue": what is late in one Agency. */
function overdueHeadline(item: AgencyAccountability): string {
  const parts = [
    item.proofOverdue > 0 ? pluralize(item.proofOverdue, 'invoice') : null,
    item.overdue > 0 ? `${formatUsd(item.overdue, { withCode: true })} to justify` : null,
  ].filter(Boolean)
  const several = parts.length > 1 || item.proofOverdue > 1
  return `${parts.join(' and ')} ${several ? 'are' : 'is'} overdue`
}

/** Why it is late, in the Agency's terms. */
function overdueDetail(item: AgencyAccountability): string {
  return [
    item.proofOverdue > 0
      ? `${pluralize(item.proofOverdue, 'payment')} made outside Viatik ${item.proofOverdue === 1 ? 'has' : 'have'} no invoice after ${PROOF_WITHIN_DAYS} days.`
      : null,
    item.overdue > 0
      ? `${pluralize(item.peopleOverdue, 'person', 'people')} ${item.peopleOverdue === 1 ? 'has' : 'have'} not justified money for purchases within ${JUSTIFY_WITHIN_DAYS} days.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
}

type AgencyRow = {
  id: string
  name: string
  agreement: string
  status: StatusDescriptor
  committed: Cents
  released: Cents
  spentThisMonth: Cents
  /** Committed spend this period against the sum of active budget limits. */
  budgetUsed: Cents
  budgetLimit: Cents
  health: number
  nextMilestone: string
}

export default function InvestorOverviewPage() {
  const { state, now, user } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const router = useRouter()

  const portfolio = state.portfolios.find((p) => p.id === portfolioId)
  const capital = portfolioCapital(state, portfolioId, now)
  const history = capitalOverTime(state, { portfolioId }, now, 6)
  const approvals = investorApprovals(state, portfolioId)
  const agencies = state.agencies.filter((a) => a.portfolioId === portfolioId)
  const agreementCount = state.agreements.filter(
    (a) => a.portfolioId === portfolioId && a.status !== 'draft' && a.status !== 'cancelled',
  ).length

  if (agencies.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Portfolio overview" />
        <EmptyState
          icon={<Building2 />}
          title="Your portfolio starts with an Agency"
          description="Add the first team or project you want to fund and define how capital should be released."
          action={
            <ButtonLink href={href('agencies/new')} size="pill">
              Create Agency
            </ButtonLink>
          }
        />
      </div>
    )
  }

  const rows: AgencyRow[] = agencies.map((agency) => {
    // An Agency can have several agreements: the row adds them up and shows the one that needs
    // attention first (waiting for acceptance, then active, then paused; completed ones last).
    const agreements = agreementsOf(state, agency.id)
    const agreement = agreements[0]
    const funding = agencyFunding(state, agency.id)
    const released = funding.released
    const cap = agencyCapital(state, agency.id, now)
    const usage = state.budgets
      .filter((b) => b.agencyId === agency.id && b.status === 'active')
      .map((b) => budgetUsage(state, b, now))
    const limit = sum(usage, (u) => u.periodLimit)
    const used = sum(usage, (u) => u.committedThisPeriod)
    const agreementIds = new Set(agreements.map((a) => a.id))
    // A milestone still to come: an approved or rejected one is decided.
    const next = state.milestones
      .filter((m) => agreementIds.has(m.agreementId) && m.status !== 'approved' && m.status !== 'rejected')
      .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0]
    return {
      id: agency.id,
      name: agency.name,
      agreement:
        agreements.length > 1 ? `${agreements.length} agreements` : (agreement?.title ?? 'No agreement'),
      status: agreement ? agreementBadge(state, agreement) : { label: 'No agreement', tone: 'neutral' },
      committed: funding.committed,
      released,
      spentThisMonth: cap.spentThisPeriod,
      budgetUsed: used,
      budgetLimit: limit,
      health: percentOf(used, limit),
      nextMilestone: next ? `${next.title} · ${formatShortDate(next.dueDate)}` : '—',
    }
  })

  const deployment = agencies.map((agency) => {
    const cap = agencyCapital(state, agency.id, now)
    return {
      agency: agency.name,
      spent: cap.states.spent,
      allocated: cap.allocated + cap.reserved,
      available: cap.availableToOperate + cap.heldInReserve,
    }
  })

  const upcoming = state.milestones
    .filter(
      (m) =>
        state.agreements.some((a) => a.id === m.agreementId && a.portfolioId === portfolioId) &&
        m.status !== 'approved' &&
        m.status !== 'rejected',
    )
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
    .slice(0, 4)

  const columns: ColumnDef<AgencyRow, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Agency',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={row.original.name} size="sm" />
          <span className="flex flex-col">
            <span className="font-medium">{row.original.name}</span>
            <span className="text-xs text-subtle">{row.original.agreement}</span>
          </span>
        </span>
      ),
    },
    {
      accessorKey: 'committed',
      header: 'Committed',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.committed} size="sm" />,
    },
    {
      accessorKey: 'released',
      header: 'Released',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.released} size="sm" />,
    },
    {
      accessorKey: 'spentThisMonth',
      header: 'Spent this month',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.spentThisMonth} size="sm" />,
    },
    {
      accessorKey: 'health',
      header: 'Budget health',
      cell: ({ row }) => (
        <span className="flex w-28 flex-col gap-1">
          <UsageBar
            used={row.original.budgetUsed}
            limit={row.original.budgetLimit}
            label={`${row.original.name} budget limits used`}
            showLegend={false}
          />
          <span className="text-xs text-subtle">{row.original.health}% of limits used</span>
        </span>
      ),
    },
    {
      accessorKey: 'nextMilestone',
      header: 'Next milestone',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.nextMilestone}</span>,
    },
    { id: 'status', header: 'Status', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
  ]

  // Agencies with something overdue (invoices, or money for purchases not justified), most late first.
  // Overdue blocks nothing, so this row is how the Investor hears about it.
  const overdue = portfolioAccountability(state, portfolioId, now)
    .filter((item) => item.proofOverdue > 0 || item.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue || b.proofOverdue - a.proofOverdue)

  const reviewTranche = approvals.tranches[0]
  const reviewMilestone = reviewTranche?.milestoneId
    ? state.milestones.find((m) => m.id === reviewTranche.milestoneId)
    : undefined
  const reviewAgreement = reviewTranche
    ? state.agreements.find((a) => a.id === reviewTranche.agreementId)
    : undefined
  const reviewAgency = reviewAgreement
    ? state.agencies.find((a) => a.id === reviewAgreement.agencyId)
    : undefined

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Tag>Portfolio</Tag>
            <span>{portfolio?.name}</span>
            <span aria-hidden="true">·</span>
            <span>{formatLocalDate(now)}</span>
          </>
        }
        title={`Good ${partOfDay(now)}, ${user?.name.split(' ')[0]}`}
        description="Committed, funded and released capital across every Agency, and what needs your decision."
        actions={
          <>
            <ButtonLink href={href('vaults/add-funds')} variant="outline" size="pill">
              Add funds
            </ButtonLink>
            <ButtonLink href={href('funding/new')} size="pill">
              <Plus data-icon="inline-start" /> Create agreement
            </ButtonLink>
          </>
        }
      />

      <WelcomeCard />

      {reviewTranche && reviewMilestone && reviewAgreement && reviewAgency ? (
        <Link
          href={href(`funding/${reviewAgreement.id}/milestones/${reviewMilestone.id}`)}
          className="group flex flex-col gap-4 rounded-xl border border-warning/30 bg-warning-soft p-5 transition-colors outline-none hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-warning/40 text-warning">
            <FileClock className="size-5" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {reviewAgency.name} submitted “{reviewMilestone.title}”
            </span>
            <span className="text-sm text-muted-foreground">
              Review the evidence to release {reviewTranche.name} of {reviewAgreement.title}.
              {approvals.total > 1 ? ` ${pluralize(approvals.total - 1, 'more item')} in Approvals.` : ''}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <Amount value={reviewTranche.amount} size="md" code />
            <span className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground">
              Review milestone{' '}
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </span>
        </Link>
      ) : null}

      {overdue.length > 0 ? (
        <div className="flex flex-col gap-3">
          {overdue.map((item) => {
            const agency = agencies.find((a) => a.id === item.agencyId)
            if (!agency) return null
            return (
              <Link
                key={item.agencyId}
                href={href(`agencies/${item.agencyId}?tab=accountability`)}
                className="group flex flex-col gap-4 rounded-xl border border-danger/30 bg-danger-soft p-5 transition-colors outline-none hover:bg-danger/20 focus-visible:ring-2 focus-visible:ring-ring sm:flex-row sm:items-center"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-danger/40 text-danger">
                  <TriangleAlert className="size-5" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-medium text-pretty text-foreground">
                    {agency.name}: {overdueHeadline(item)}
                  </span>
                  <span className="text-sm text-pretty text-muted-foreground">{overdueDetail(item)}</span>
                </span>
                <span className="inline-flex h-10 w-fit shrink-0 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium text-foreground">
                  Open accountability
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </span>
              </Link>
            )
          })}
        </div>
      ) : null}

      <HairlineGrid className="grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Total committed"
          value={capital.committed}
          hint={pluralize(agreementCount, 'agreement')}
        />
        <KpiTile
          label="Total funded"
          value={capital.funded}
          trend={history.map((h) => h.funded)}
          hint={`${percentOf(capital.funded, capital.committed)}% of commitments`}
        />
        <KpiTile
          label="Total released"
          value={capital.released}
          trend={history.map((h) => h.released)}
          hint={`${percentOf(capital.released, capital.funded)}% of funded`}
        />
        <KpiTile
          label="Available capital"
          value={capital.availableCapital}
          hint={
            capital.returned > 0
              ? `In the Portfolio Vault · ${formatUsd(capital.returned)} returned by Agencies`
              : 'In the Portfolio Vault'
          }
        />
        <KpiTile
          label="Active agencies"
          value={<span className="font-display text-2xl">{capital.activeAgencies}</span>}
          hint={`${agencies.length - capital.activeAgencies} onboarding`}
        />
        <KpiTile
          label="Pending tranche requests"
          value={<span className="font-display text-2xl">{approvals.tranches.length}</span>}
          hint={
            approvals.exceptions.length > 0
              ? `${pluralize(approvals.exceptions.length, 'exception')} waiting`
              : 'Nothing else waiting'
          }
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Capital over time"
          description="Cumulative funded, released and spent capital."
        >
          <MoneyAreaChart
            data={history}
            series={[
              {
                key: 'funded',
                label: 'Funded',
                color: 'color-mix(in srgb, var(--color-mist) 55%, transparent)',
              },
              { key: 'released', label: 'Released', color: 'var(--color-mist)' },
              { key: 'spent', label: 'Spent', color: 'var(--color-sage)' },
            ]}
            className="h-72"
          />
        </Panel>
        <Panel title="Capital states" description="Never merged into one balance.">
          <CapitalStateList states={capital.states} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Capital deployment by Agency"
          description="Where released capital sits today."
        >
          <MoneyBarChart
            data={deployment}
            xKey="agency"
            layout="horizontal-bars"
            series={[
              { key: 'spent', label: 'Spent', color: 'var(--color-sage)' },
              { key: 'allocated', label: 'In budgets', color: 'var(--color-info)' },
              { key: 'available', label: 'Available to operate', color: 'var(--color-mist)' },
            ]}
            className="h-56"
          />
        </Panel>
        <Panel
          title="Upcoming milestones"
          action={
            <ButtonLink href={href('funding')} variant="ghost" size="pill-sm">
              All funding <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          <MilestoneTimeline
            items={upcoming.map((m) => {
              const agreement = state.agreements.find((a) => a.id === m.agreementId)
              const agency = state.agencies.find((a) => a.id === agreement?.agencyId)
              const tranche = state.tranches.find((t) => t.id === m.trancheId)
              return {
                id: m.id,
                title: m.title,
                subtitle: agency?.name,
                date: `Due ${formatDate(m.dueDate)}`,
                amount: tranche?.amount,
                status: milestoneStatus[m.status],
                state:
                  m.status === 'ready_for_review'
                    ? 'current'
                    : m.status === 'changes_requested' || m.status === 'rejected'
                      ? 'blocked'
                      : 'upcoming',
              }
            })}
          />
        </Panel>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="agencies-title">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 id="agencies-title" className="font-display text-xl font-medium">
              Agencies
            </h2>
            <p className="text-sm text-muted-foreground">
              Commitment, release and spend for every team you fund.
            </p>
          </div>
          <ButtonLink href={href('agencies')} variant="ghost" size="pill-sm">
            View all <ArrowUpRight data-icon="inline-end" />
          </ButtonLink>
        </div>
        <DataTable
          data={rows}
          columns={columns}
          caption="Agencies in this portfolio"
          onRowClick={(row) => router.push(href(`agencies/${row.id}`))}
          renderMobile={(row) => (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3">
                  <OrgAvatar name={row.name} size="sm" />
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">{row.name}</span>
                    <span className="text-xs text-subtle">{row.agreement}</span>
                  </span>
                </span>
                <StatusBadge status={row.status} />
              </div>
              <UsageBar
                used={row.released}
                limit={row.committed}
                label="Released of committed"
                showLegend={false}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  <Amount value={row.released} size="xs" /> released
                </span>
                <span>
                  of <Amount value={row.committed} size="xs" />
                </span>
              </div>
            </div>
          )}
        />
      </section>

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
          records={state.activity.filter((a) => a.portfolioId === portfolioId).slice(0, 8)}
          now={now}
          showAgency
        />
      </Panel>
    </div>
  )
}

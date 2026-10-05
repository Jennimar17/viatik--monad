'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Building2, LayoutGrid, Plus, Rows3 } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { useHref, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { CapitalBar, UsageBar } from '@/components/viatik/finance'
import { PageHeader } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { agencyTypeLabel } from '@/domain/labels'
import { percentOf, sum, type Cents } from '@/domain/money'
import { userName } from '@/domain/queries'
import { agencyCapital, agencyFunding, budgetUsage } from '@/domain/selectors'
import { agencyStatus } from '@/domain/status'
import type { Agency, AgencyStatus, AgencyType } from '@/domain/types'
import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'

type Row = {
  agency: Agency
  admin: string
  committed: Cents
  funded: Cents
  released: Cents
  spent: Cents
  spentThisMonth: Cents
  budgetUsed: Cents
  budgetLimit: Cents
  health: number
}

const STATUS_OPTIONS = (Object.keys(agencyStatus) as AgencyStatus[]).map((status) => ({
  value: status,
  label: agencyStatus[status].label,
}))

const TYPE_OPTIONS = (Object.keys(agencyTypeLabel) as AgencyType[]).map((type) => ({
  value: type,
  label: agencyTypeLabel[type],
}))

export default function AgenciesPage() {
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const router = useRouter()
  const [view, setView] = React.useState<'table' | 'cards'>('table')
  const agencies = state.agencies.filter((a) => a.portfolioId === portfolioId)

  const rows: Row[] = agencies.map((agency) => {
    const capital = agencyFunding(state, agency.id)
    const operating = agencyCapital(state, agency.id, now)
    const usage = state.budgets
      .filter((b) => b.agencyId === agency.id && b.status === 'active')
      .map((b) => budgetUsage(state, b, now))
    const budgetLimit = sum(usage, (u) => u.periodLimit)
    const budgetUsed = sum(usage, (u) => u.committedThisPeriod)
    const admin = state.memberships.find(
      (m) =>
        m.role === 'agency_admin' &&
        m.status === 'active' &&
        m.scope.kind === 'agency' &&
        m.scope.agencyId === agency.id,
    )
    return {
      agency,
      admin: admin ? userName(state, admin.userId) : 'Invitation pending',
      committed: capital.committed,
      funded: capital.funded,
      released: capital.released,
      spent: operating.states.spent,
      spentThisMonth: operating.spentThisPeriod,
      budgetUsed,
      budgetLimit,
      health: percentOf(budgetUsed, budgetLimit),
    }
  })

  const columns: ColumnDef<Row, unknown>[] = [
    {
      id: 'agency',
      header: 'Agency',
      accessorFn: (row) => row.agency.name,
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={row.original.agency.name} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.agency.name}</span>
            <span className="text-xs text-subtle">{agencyTypeLabel[row.original.agency.type]}</span>
          </span>
        </span>
      ),
    },
    {
      accessorKey: 'admin',
      header: 'Admin',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.admin}</span>,
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
      cell: ({ row }) =>
        row.original.budgetLimit > 0 ? (
          <span className="flex w-28 flex-col gap-1">
            <UsageBar
              used={row.original.budgetUsed}
              limit={row.original.budgetLimit}
              label={`${row.original.agency.name} budget limits used`}
              showLegend={false}
            />
            <span className="text-xs text-subtle">{row.original.health}% of limits used</span>
          </span>
        ) : (
          <span className="text-xs text-subtle">No budgets yet</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={agencyStatus[row.original.agency.status]} />,
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Agencies"
        description="Teams and projects you fund, with their commitment, releases and spending."
        meta={
          agencies.length ? (
            <span className="text-sm text-subtle">
              {pluralize(agencies.length, 'agency', 'agencies')} ·{' '}
              {agencies.filter((a) => a.status === 'active').length} active
            </span>
          ) : null
        }
        actions={
          <ButtonLink href={href('agencies/new')} size="pill">
            <Plus data-icon="inline-start" /> Create Agency
          </ButtonLink>
        }
      />

      {agencies.length === 0 ? (
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
      ) : (
        <>
          <div className="flex justify-end">
            <div className="flex rounded-full border border-border p-1" role="group" aria-label="View">
              {(
                [
                  ['table', 'Table', Rows3],
                  ['cards', 'Cards', LayoutGrid],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  onClick={() => setView(key)}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    view === key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" /> {label}
                </button>
              ))}
            </div>
          </div>

          {view === 'table' ? (
            <DataTable
              data={rows}
              columns={columns}
              caption="Agencies in this portfolio"
              searchPlaceholder="Search agencies"
              searchText={(r) => `${r.agency.name} ${r.admin} ${agencyTypeLabel[r.agency.type]}`}
              facets={[
                { id: 'status', label: 'Status', accessor: (r) => r.agency.status, options: STATUS_OPTIONS },
                { id: 'type', label: 'Type', accessor: (r) => r.agency.type, options: TYPE_OPTIONS },
              ]}
              initialSorting={[{ id: 'agency', desc: false }]}
              onRowClick={(r) => router.push(href(`agencies/${r.agency.id}`))}
              renderMobile={(r) => (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <OrgAvatar name={r.agency.name} size="sm" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">{r.agency.name}</span>
                        <span className="truncate text-xs text-subtle">{r.admin}</span>
                      </span>
                    </span>
                    <StatusBadge status={agencyStatus[r.agency.status]} />
                  </div>
                  <CapitalBar
                    committed={r.committed}
                    funded={r.funded}
                    released={r.released}
                    spent={r.spent}
                  />
                </div>
              )}
              empty={
                <EmptyState
                  compact
                  icon={<Building2 />}
                  title="No agencies here"
                  description="Agencies matching this status or type will appear here."
                />
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => (
                <Link
                  key={r.agency.id}
                  href={href(`agencies/${r.agency.id}`)}
                  className="surface flex flex-col gap-4 rounded-xl p-5 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <OrgAvatar name={r.agency.name} size="md" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{r.agency.name}</span>
                        <span className="truncate text-xs text-subtle">
                          {agencyTypeLabel[r.agency.type]} · {r.admin}
                        </span>
                      </span>
                    </span>
                    <StatusBadge status={agencyStatus[r.agency.status]} />
                  </div>
                  <p className="text-sm text-pretty text-muted-foreground">{r.agency.description}</p>
                  <CapitalBar
                    committed={r.committed}
                    funded={r.funded}
                    released={r.released}
                    spent={r.spent}
                  />
                  <div className="flex justify-between text-xs text-subtle">
                    <span>
                      <Amount value={r.spentThisMonth} size="xs" /> spent this month
                    </span>
                    <span>{r.budgetLimit > 0 ? `${r.health}% of budget limits` : 'No budgets yet'}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

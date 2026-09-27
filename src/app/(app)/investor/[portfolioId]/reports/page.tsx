'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { ChartColumn, Download } from 'lucide-react'
import * as React from 'react'

import { SimpleSelect } from '@/components/app/form-controls'
import { useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { MoneyAreaChart, MoneyBarChart, MoneyDonut } from '@/components/viatik/charts'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import { cents, formatUsd, percentOf, sum, ZERO, type Cents } from '@/domain/money'
import {
  agencyCapital,
  agreementCapital,
  budgetUsage,
  capitalOverTime,
  spendByMonth,
} from '@/domain/selectors'
import type { SpendingCategory } from '@/domain/types'
import { seriesColor, seriesKey } from '@/lib/chart-colors'
import { pluralize } from '@/lib/format'

const RANGE_OPTIONS = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '12', label: 'Last 12 months' },
]

type Row = {
  id: string
  name: string
  released: Cents
  spent: Cents
  burn: Cents
  runwayMonths: number | null
  onTime: string
  budgetUse: number
}

export default function ReportsPage() {
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const [months, setMonths] = React.useState('6')
  const range = Number(months)

  const agencies = state.agencies.filter((a) => a.portfolioId === portfolioId)
  const agencyIds = new Set(agencies.map((a) => a.id))
  const payments = state.payments.filter((p) => agencyIds.has(p.agencyId))
  const history = capitalOverTime(state, { portfolioId }, now, range)
  const categories = Array.from(new Set(payments.map((p) => p.category))) as SpendingCategory[]
  const categorySeries = categories.map((category, i) => ({
    key: seriesKey(i),
    label: categoryLabel[category],
    color: seriesColor(i),
    category,
  }))
  const spend = spendByMonth(
    state,
    {},
    (m) => {
      if (!m.agencyId || !agencyIds.has(m.agencyId)) return null
      const category = state.payments.find((p) => p.id === m.refId)?.category
      return categorySeries.find((s) => s.category === category)?.key ?? null
    },
    now,
    range,
  )
  const totals = categorySeries
    .map((s) => ({
      key: s.key,
      label: s.label,
      color: s.color,
      value: spend.reduce((acc, row) => acc + Number(row[s.key] ?? 0), 0),
    }))
    .filter((t) => t.value > 0)
  const totalSpend = cents(totals.reduce((acc, t) => acc + t.value, 0))

  const rows: Row[] = agencies.map((agency) => {
    const agreement = state.agreements.find((a) => a.agencyId === agency.id && a.status !== 'cancelled')
    const capital = agreement ? agreementCapital(state, agreement.id) : undefined
    const operating = agencyCapital(state, agency.id, now)
    const milestones = agreement
      ? state.milestones.filter((m) => m.agreementId === agreement.id && m.submittedAt)
      : []
    const onTime = milestones.filter((m) => (m.submittedAt ?? '') <= m.dueDate).length
    const usage = state.budgets
      .filter((b) => b.agencyId === agency.id && b.status === 'active')
      .map((b) => budgetUsage(state, b, now))
    const limit = sum(usage, (u) => u.periodLimit)
    const used = sum(usage, (u) => u.spentThisPeriod)
    const recent = spendByMonth(state, { agencyId: agency.id }, () => 'spent', now, 3)
    const burn = cents(Math.round(recent.reduce((acc, r) => acc + Number(r.spent ?? 0), 0) / 3))
    const runway = operating.availableToOperate + operating.allocated
    return {
      id: agency.id,
      name: agency.name,
      released: capital?.released ?? ZERO,
      spent: operating.states.spent,
      burn,
      runwayMonths: burn > 0 ? Math.floor(runway / burn) : null,
      onTime: milestones.length ? `${Math.round((onTime / milestones.length) * 100)}%` : 'No milestones yet',
      budgetUse: limit > 0 ? percentOf(used, limit) : 0,
    }
  })

  const exportReport = () => {
    const header = [
      'Agency',
      'Released (USD)',
      'Spent (USD)',
      'Monthly burn (USD)',
      'Runway (months)',
      'Milestones on time',
      'Budget use (%)',
    ]
    const lines = rows.map((r) => [
      r.name,
      (r.released / 100).toFixed(2),
      (r.spent / 100).toFixed(2),
      (r.burn / 100).toFixed(2),
      r.runwayMonths === null ? '' : String(r.runwayMonths),
      r.onTime,
      String(r.budgetUse),
    ])
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `viatik-report-${now.slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Agency',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={row.original.name} size="sm" />
          <span className="font-medium">{row.original.name}</span>
        </span>
      ),
    },
    {
      accessorKey: 'released',
      header: 'Released',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.released} size="sm" />,
    },
    {
      accessorKey: 'spent',
      header: 'Spent',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.spent} size="sm" />,
    },
    {
      accessorKey: 'burn',
      header: 'Monthly burn',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.burn} size="sm" />,
    },
    {
      accessorKey: 'runwayMonths',
      header: 'Runway',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.runwayMonths === null
            ? 'No spend yet'
            : pluralize(row.original.runwayMonths, 'month')}
        </span>
      ),
    },
    {
      accessorKey: 'onTime',
      header: 'Milestones on time',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.onTime}</span>,
    },
    {
      accessorKey: 'budgetUse',
      header: 'Budget use',
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{row.original.budgetUse}%</span>,
    },
  ]

  if (agencies.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Reports" description="How deployed capital is being used across the portfolio." />
        <EmptyState
          icon={<ChartColumn />}
          title="Nothing to report yet"
          description="Reports fill in once you fund an Agency and it starts spending."
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Reports"
        description="How deployed capital is being used across the portfolio."
        actions={
          <>
            <SimpleSelect value={months} onValueChange={setMonths} options={RANGE_OPTIONS} className="w-44" />
            <Button variant="outline" size="pill" onClick={exportReport}>
              <Download data-icon="inline-start" /> Export report
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Capital deployed over time"
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
        <Panel title="Spend by category" description={`Last ${range} months, all Agencies.`}>
          {totals.length === 0 ? (
            <EmptyState compact title="No spending yet" description="Payments will show here by category." />
          ) : (
            <>
              <MoneyDonut
                data={totals}
                centerValue={formatUsd(totalSpend, { compact: true })}
                centerLabel="USD spent"
              />
              <ul className="mt-4 flex flex-col gap-2">
                {totals.map((t) => (
                  <li key={t.key} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span
                        className="size-2 rounded-[2px]"
                        style={{ background: t.color }}
                        aria-hidden="true"
                      />
                      {t.label}
                    </span>
                    <Amount value={cents(t.value)} size="sm" />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
      </div>

      <Panel title="Monthly spend by category">
        {totals.length === 0 ? (
          <EmptyState
            compact
            title="No spending yet"
            description="Monthly spending will show here by category."
          />
        ) : (
          <MoneyBarChart data={spend} series={categorySeries} className="h-72" />
        )}
      </Panel>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Agency comparison</h2>
        <DataTable
          data={rows}
          columns={columns}
          caption="Capital use by Agency"
          initialSorting={[{ id: 'spent', desc: true }]}
          renderMobile={(r) => (
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-xs text-subtle">
                  Runway {r.runwayMonths === null ? 'n/a' : pluralize(r.runwayMonths, 'month')} · on time{' '}
                  {r.onTime}
                </span>
              </span>
              <Amount value={r.spent} size="sm" />
            </div>
          )}
          empty={<EmptyState compact title="No agencies" description="Fund an Agency to compare it here." />}
        />
      </section>
    </div>
  )
}

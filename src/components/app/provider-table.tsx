'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { destinationKindLabel } from '@/components/app/money-setup'
import { Amount } from '@/components/viatik/amount'
import { DataTable, type Facet } from '@/components/viatik/data-table'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import type { Cents } from '@/domain/money'
import type { PaymentDestination } from '@/domain/types'
import { pluralize } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

import { providerKindLine, providerKindOptions, providerStatus, providerSummary } from './provider-parts'
import { useHref } from './role-context'

type ProviderRow = {
  provider: PaymentDestination
  totalPaid: Cents
  lastPaidAt?: string
  budgets: number
  openBills: number
}

// Stable across renders: the table recomputes its filtered rows when its facets change.
const FACETS: Facet<ProviderRow>[] = [
  { id: 'kind', label: 'Type', accessor: (row) => row.provider.kind, options: providerKindOptions },
]

/** The Agency's providers, each with what was paid to it and where it is used. Rows open the provider. */
export function ProvidersTable({
  providers,
  empty,
}: {
  providers: PaymentDestination[]
  empty?: React.ReactNode
}) {
  const { state, now } = useViatikState()
  const href = useHref()
  const router = useRouter()
  const rows = React.useMemo(
    () =>
      providers.map<ProviderRow>((provider) => {
        const summary = providerSummary(state, provider, now)
        return {
          provider,
          totalPaid: summary.totalPaid,
          lastPaidAt: summary.lastPaidAt,
          budgets: summary.budgets.length,
          openBills: summary.openBills.length,
        }
      }),
    [providers, state, now],
  )

  const columns: ColumnDef<ProviderRow, unknown>[] = [
    {
      id: 'name',
      accessorFn: (row) => row.provider.name.toLowerCase(),
      header: 'Provider',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={row.original.provider.name} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.provider.name}</span>
            <span className="truncate text-xs text-subtle">{providerKindLine(row.original.provider)}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'reference',
      header: 'Payment reference',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.provider.settlementLabel || '—'}</span>
      ),
    },
    {
      id: 'used',
      header: 'Budgets',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col text-sm text-muted-foreground">
          <span>
            {row.original.budgets
              ? `Listed in ${pluralize(row.original.budgets, 'budget')}`
              : 'Not listed by name'}
          </span>
          {row.original.openBills ? (
            <span className="text-xs text-subtle">{pluralize(row.original.openBills, 'bill')} to pay</span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'paid',
      accessorFn: (row) => row.totalPaid,
      header: 'Paid in total',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="flex flex-col items-end">
          <Amount value={row.original.totalPaid} size="sm" />
          <span className="text-xs text-subtle">
            {row.original.lastPaidAt ? `Last ${formatLocalDate(row.original.lastPaidAt)}` : 'Not paid yet'}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <StatusBadge status={providerStatus[row.original.provider.status]} />,
    },
  ]

  return (
    <DataTable
      data={rows}
      columns={columns}
      caption="Providers"
      initialSorting={[{ id: 'name', desc: false }]}
      empty={empty}
      searchPlaceholder="Search providers"
      searchText={(row) =>
        [
          row.provider.name,
          destinationKindLabel[row.provider.kind],
          categoryLabel[row.provider.category],
          row.provider.settlementLabel,
          row.provider.website ?? '',
        ].join(' ')
      }
      facets={FACETS}
      onRowClick={(row) => router.push(href(`providers/${row.provider.id}`))}
      renderMobile={(row) => (
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-3">
            <OrgAvatar name={row.provider.name} size="sm" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{row.provider.name}</span>
              <span className="truncate text-xs text-subtle">{providerKindLine(row.provider)}</span>
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <Amount value={row.totalPaid} size="sm" />
            <StatusBadge status={providerStatus[row.provider.status]} />
          </span>
        </div>
      )}
    />
  )
}

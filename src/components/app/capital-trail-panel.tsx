'use client'

import type { ColumnDef } from '@tanstack/react-table'

import { Amount } from '@/components/viatik/amount'
import { DataTable } from '@/components/viatik/data-table'
import { CapitalTrail } from '@/components/viatik/finance'
import { formatUsd, sum } from '@/domain/money'
import { accountName, budgetName, receiptFor, recipientName } from '@/domain/queries'
import { agreementCapital } from '@/domain/selectors'
import type { Location, Movement, ViatikState } from '@/domain/types'
import { formatDateTime } from '@/lib/format'

import { useReceiptDrawer } from './receipt-details'

export const movementLabel: Record<Movement['kind'], string> = {
  deposit: 'Funds added',
  fund_agreement: 'Agreement funded',
  release_tranche: 'Tranche released',
  transfer: 'Transfer',
  allocate: 'Allocated to budget',
  deallocate: 'Returned from budget',
  payment: 'Payment',
  capital_return: 'Capital returned',
}

export function locationLabel(state: ViatikState, location: Location): string {
  switch (location.kind) {
    case 'external':
      return location.label
    case 'vault':
      return state.vaults.find((v) => v.id === location.vaultId)?.name ?? 'Vault'
    case 'account':
      return accountName(state, location.accountId)
    case 'budget':
      return budgetName(state, location.budgetId)
    case 'recipient':
      return recipientName(state, location.recipient)
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * Commitment → release → budget → payment → receipt for one agreement, plus
 * every movement behind it with its verifiable receipt.
 */
export function CapitalTrailPanel({ state, agreementId }: { state: ViatikState; agreementId: string }) {
  const receipts = useReceiptDrawer()
  const agreement = state.agreements.find((a) => a.id === agreementId)
  if (!agreement) return null

  const capital = agreementCapital(state, agreementId)
  const movements = state.movements.filter(
    (m) => m.agencyId === agreement.agencyId || m.agreementId === agreementId,
  )
  const payments = movements.filter((m) => m.kind === 'payment')
  const released = state.tranches.filter((t) => t.agreementId === agreementId && t.status === 'released')
  const trancheCount = state.tranches.filter((t) => t.agreementId === agreementId).length
  const budgetCount = state.budgets.filter((b) => b.agencyId === agreement.agencyId).length
  const receiptCount = movements.filter((m) => m.receiptId).length
  const rows = [...movements].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const columns: ColumnDef<Movement, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'Movement',
      cell: ({ row }) => <span className="text-sm font-medium">{movementLabel[row.original.kind]}</span>,
    },
    {
      id: 'route',
      header: 'From → to',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {locationLabel(state, row.original.from)} →{' '}
          <span className="text-foreground">{locationLabel(state, row.original.to)}</span>
        </span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.amount} size="sm" />,
    },
    {
      id: 'receipt',
      header: 'Receipt',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const receipt = receiptFor(state, row.original.receiptId)
        return receipt ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              receipts.show(receipt)
            }}
            className="font-mono text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {receipt.number}
          </button>
        ) : (
          <span className="text-xs text-subtle">—</span>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <CapitalTrail
        steps={[
          {
            id: 'commit',
            label: 'Commitment',
            title: agreement.title,
            amount: capital.committed,
            detail: plural(trancheCount, 'tranche'),
          },
          {
            id: 'fund',
            label: 'Funded',
            title: 'Funding Vault',
            amount: capital.funded,
            detail: capital.unfunded > 0 ? `${formatUsd(capital.unfunded)} still to fund` : 'Fully funded',
          },
          {
            id: 'release',
            label: 'Released',
            title: `${plural(released.length, 'tranche')} released`,
            amount: capital.released,
            detail: 'To Agency accounts',
          },
          {
            id: 'budget',
            label: 'Budgets',
            title: 'Allocated to budgets',
            amount: sum(
              movements.filter((m) => m.kind === 'allocate'),
              (m) => m.amount,
            ),
            detail: plural(budgetCount, 'budget'),
          },
          {
            id: 'payment',
            label: 'Payments',
            title: plural(payments.length, 'payment'),
            amount: sum(payments, (m) => m.amount),
            detail: 'Team, vendors and tools',
          },
          {
            id: 'receipt',
            label: 'Receipts',
            title: `${plural(receiptCount, 'verifiable receipt')}`,
            detail: 'Recorded on Monad',
          },
        ]}
      />
      <DataTable
        data={rows}
        columns={columns}
        pageSize={12}
        caption="Capital movements"
        searchPlaceholder="Search movements"
        searchText={(m) =>
          `${movementLabel[m.kind]} ${locationLabel(state, m.from)} ${locationLabel(state, m.to)}`
        }
        facets={[
          {
            id: 'kind',
            label: 'Movement type',
            accessor: (m) => m.kind,
            options: [
              { value: 'release_tranche', label: 'Releases' },
              { value: 'allocate', label: 'Allocations' },
              { value: 'payment', label: 'Payments' },
              { value: 'transfer', label: 'Transfers' },
            ],
          },
        ]}
        onRowClick={(m) => receipts.show(receiptFor(state, m.receiptId))}
        renderMobile={(m) => (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{movementLabel[m.kind]}</span>
              <span className="truncate text-xs text-subtle">
                {locationLabel(state, m.from)} → {locationLabel(state, m.to)}
              </span>
            </span>
            <Amount value={m.amount} size="sm" />
          </div>
        )}
      />
      {receipts.drawer}
    </div>
  )
}

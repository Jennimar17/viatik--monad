'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { ShieldCheck } from 'lucide-react'
import * as React from 'react'

import { Amount } from '@/components/viatik/amount'
import { DataTable, type Facet } from '@/components/viatik/data-table'
import { AgentAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { paymentTypeLabel } from '@/domain/labels'
import { budgetName, isOutsidePayment, receiptFor, recipientName } from '@/domain/queries'
import { operationStatus, type StatusDescriptor } from '@/domain/status'
import type { Payment } from '@/domain/types'
import { formatDate } from '@/lib/format'

import { useReceiptDrawer } from './receipt-details'

export function PaymentsTable({
  payments,
  facets,
  toolbar,
  empty,
  pageSize = 10,
  showBudget = true,
  direction = 'out',
  statusFor,
}: {
  payments: Payment[]
  facets?: Facet<Payment>[]
  toolbar?: React.ReactNode
  empty?: React.ReactNode
  pageSize?: number
  showBudget?: boolean
  /** "in" renders amounts as received (Member payouts). */
  direction?: 'out' | 'in'
  /** A row's status instead of the operation's, e.g. money for purchases shows how it is justified. */
  statusFor?: (payment: Payment) => StatusDescriptor | undefined
}) {
  const { state } = useViatikState()
  const receipts = useReceiptDrawer()
  const rows = React.useMemo(
    () => [...payments].sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1)),
    [payments],
  )
  const incoming = direction === 'in'
  const counterparty = (p: Payment) =>
    incoming
      ? (state.agencies.find((a) => a.id === p.agencyId)?.name ?? 'Agency')
      : recipientName(state, p.recipient)
  // Paid by an Agency Admin outside Viatik: the payee, tagged (the address stays in the receipt).
  const outside = (p: Payment) => !incoming && isOutsidePayment(p)
  const amount = (p: Payment) => (
    <Amount value={p.amount} size="sm" signed={incoming} tone={incoming ? 'positive' : 'default'} />
  )

  const columns: ColumnDef<Payment, unknown>[] = [
    {
      accessorKey: 'scheduledFor',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDate(row.original.completedAt ?? row.original.scheduledFor)}
        </span>
      ),
    },
    {
      id: 'recipient',
      header: incoming ? 'From' : 'Recipient',
      cell: ({ row }) => {
        const p = row.original
        const name = counterparty(p)
        return (
          <span className="flex items-center gap-3">
            {p.createdBy.kind === 'ai_agent' ? (
              <AgentAvatar size="sm" />
            ) : (
              <PersonAvatar name={name} size="sm" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{name}</span>
                {outside(p) ? <Tag className="shrink-0">Outside Viatik</Tag> : null}
              </span>
              <span className="truncate text-xs text-subtle">{p.memo}</span>
            </span>
          </span>
        )
      },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{paymentTypeLabel[row.original.type]}</span>
      ),
    },
    ...(showBudget
      ? [
          {
            id: 'budget',
            header: 'Budget',
            cell: ({ row }) => (
              <span className="text-sm text-muted-foreground">
                {row.original.budgetId ? budgetName(state, row.original.budgetId) : 'Account'}
              </span>
            ),
          } satisfies ColumnDef<Payment, unknown>,
        ]
      : []),
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => amount(row.original),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={statusFor?.(row.original) ?? operationStatus[row.original.status]} />
      ),
    },
    {
      id: 'receipt',
      header: '',
      meta: { align: 'right' },
      cell: ({ row }) =>
        row.original.receiptId ? (
          <button
            type="button"
            aria-label="View verified details"
            onClick={(event) => {
              event.stopPropagation()
              receipts.show(receiptFor(state, row.original.receiptId))
            }}
            className="inline-flex size-8 items-center justify-center rounded-full text-subtle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ShieldCheck className="size-4" />
          </button>
        ) : null,
    },
  ]

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        pageSize={pageSize}
        facets={facets}
        toolbar={toolbar}
        empty={empty}
        caption="Payments"
        searchPlaceholder="Search payments"
        searchText={(p) =>
          `${recipientName(state, p.recipient)} ${p.memo} ${paymentTypeLabel[p.type]}${outside(p) ? ' Outside Viatik' : ''}`
        }
        onRowClick={(p) => receipts.show(receiptFor(state, p.receiptId))}
        renderMobile={(p) => (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{incoming ? p.memo : counterparty(p)}</span>
              <span className="truncate text-xs text-subtle">
                {formatDate(p.completedAt ?? p.scheduledFor)} ·{' '}
                {(statusFor?.(p) ?? operationStatus[p.status]).label}
                {outside(p) ? ' · Outside Viatik' : ''}
              </span>
            </span>
            {amount(p)}
          </div>
        )}
      />
      {receipts.drawer}
    </>
  )
}

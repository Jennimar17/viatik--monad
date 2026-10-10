'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { useRouter } from 'next/navigation'

import { Amount } from '@/components/viatik/amount'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { billState, budgetName, destinationName } from '@/domain/queries'
import { scheduleState } from '@/domain/schedules'
import { billStatus, scheduleStatus, type StatusDescriptor } from '@/domain/status'
import type { Bill } from '@/domain/types'
import { dueLabel, formatDate } from '@/lib/format'
import { formatLocalDateTime } from '@/lib/local-time'
import { cn } from '@/lib/utils'

import { useHref } from './role-context'
import { billSchedule } from './schedules'

/**
 * An Agency's bills. `scheduled` shows when each one's scheduled payment runs
 * (on the viewer's clock) and that schedule's state (Due, Needs attention,
 * Paused…) instead of when the bill was issued.
 */
export function BillsTable({
  bills,
  emptyTitle = 'No bills here',
  scheduled = false,
  now: clock,
}: {
  bills: Bill[]
  emptyTitle?: string
  scheduled?: boolean
  /** A ticking clock (`useClock`), so a scheduled payment turns "Due" on time. */
  now?: string
}) {
  const { state, now: loadedAt } = useViatikState()
  const now = clock ?? loadedAt
  const href = useHref()
  const router = useRouter()
  const unpaid = (bill: Bill) => {
    const status = billState(bill, now)
    return status === 'to_pay' || status === 'overdue'
  }
  const statusOf = (bill: Bill): StatusDescriptor => {
    const schedule = scheduled ? billSchedule(state, bill) : undefined
    return schedule ? scheduleStatus[scheduleState(state, schedule, now)] : billStatus[billState(bill, now)]
  }
  const paysAt = (bill: Bill) => {
    const schedule = billSchedule(state, bill)
    return schedule ? formatLocalDateTime(schedule.nextRunAt) : undefined
  }

  const issued: ColumnDef<Bill, unknown> = scheduled
    ? {
        id: 'pays',
        header: 'Pays',
        cell: ({ row }) => (
          <span className="text-sm whitespace-nowrap text-muted-foreground">
            {paysAt(row.original) ?? '—'}
          </span>
        ),
      }
    : {
        accessorKey: 'issueDate',
        header: 'Issued',
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatDate(row.original.issueDate)}</span>
        ),
      }

  const columns: ColumnDef<Bill, unknown>[] = [
    {
      id: 'vendor',
      header: 'Vendor',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={destinationName(state, row.original.destinationId)} size="sm" />
          <span className="flex flex-col">
            <span className="font-medium">{destinationName(state, row.original.destinationId)}</span>
            <span className="font-mono text-2xs text-subtle">{row.original.number}</span>
          </span>
        </span>
      ),
    },
    issued,
    {
      accessorKey: 'dueDate',
      header: 'Due',
      cell: ({ row }) => {
        const overdue = billState(row.original, now) === 'overdue'
        return (
          <span className="flex flex-col">
            <span className="text-sm">{formatDate(row.original.dueDate)}</span>
            {unpaid(row.original) ? (
              <span className={cn('text-xs', overdue ? 'text-danger' : 'text-subtle')}>
                {dueLabel(row.original.dueDate, now)}
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: 'budget',
      header: 'Budget',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.budgetId ? budgetName(state, row.original.budgetId) : 'Account'}
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
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={statusOf(row.original)} />,
    },
  ]

  return (
    <DataTable
      data={[...bills].sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1))}
      columns={columns}
      caption="Bills"
      empty={
        <EmptyState
          compact
          title={emptyTitle}
          description="Upload a bill to pay it and keep its evidence with the payment."
        />
      }
      searchPlaceholder="Search bills"
      searchText={(b) => `${destinationName(state, b.destinationId)} ${b.number}`}
      onRowClick={(b) => router.push(href(`bills/${b.id}`))}
      renderMobile={(b) => {
        const status = billState(b, now)
        return (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">{destinationName(state, b.destinationId)}</span>
              <span className={cn('text-xs', status === 'overdue' ? 'text-danger' : 'text-subtle')}>
                {b.number} ·{' '}
                {scheduled && paysAt(b)
                  ? `pays ${paysAt(b)}`
                  : unpaid(b)
                    ? dueLabel(b.dueDate, now)
                    : formatDate(b.dueDate)}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <Amount value={b.amount} size="sm" />
              <StatusBadge status={statusOf(b)} />
            </span>
          </div>
        )
      }}
    />
  )
}

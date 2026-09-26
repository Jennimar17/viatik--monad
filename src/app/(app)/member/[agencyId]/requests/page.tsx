'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Send } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { useHref, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader } from '@/components/viatik/layout'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { budgetName, recipientName } from '@/domain/queries'
import { requestStatus } from '@/domain/status'
import type { PaymentRequest, RequestStatus } from '@/domain/types'
import { formatDate } from '@/lib/format'

const IN_PROGRESS: ReadonlySet<RequestStatus> = new Set(['needs_approval', 'approved', 'processing'])
const NOT_APPROVED: ReadonlySet<RequestStatus> = new Set(['rejected', 'declined', 'cancelled'])

export default function MemberRequestsPage() {
  const { state, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const mine = state.requests
    .filter((r) => r.agencyId === agencyId && r.requester.kind === 'user' && r.requester.userId === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const columns: ColumnDef<PaymentRequest, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
    {
      accessorKey: 'purpose',
      header: 'Request',
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.original.purpose}</span>
          <span className="text-xs text-subtle">
            {recipientName(state, row.original.destination)} · {budgetName(state, row.original.budgetId)}
          </span>
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
      cell: ({ row }) => <StatusBadge status={requestStatus[row.original.status]} />,
    },
  ]

  const table = (rows: PaymentRequest[]) => (
    <DataTable
      data={rows}
      columns={columns}
      caption="Your requests"
      searchPlaceholder="Search requests"
      searchText={(r) => `${r.purpose} ${recipientName(state, r.destination)}`}
      onRowClick={(r) => router.push(href(`requests/${r.id}`))}
      empty={
        <EmptyState
          compact
          icon={<Send />}
          title="No requests here"
          description="Requests you send will appear here with their status."
        />
      }
      renderMobile={(r) => (
        <div className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-medium">{r.purpose}</span>
            <span className="truncate text-xs text-subtle">
              {formatDate(r.createdAt)} · {recipientName(state, r.destination)}
            </span>
          </span>
          <span className="flex flex-col items-end gap-1">
            <Amount value={r.amount} size="sm" />
            <StatusBadge status={requestStatus[r.status]} />
          </span>
        </div>
      )}
    />
  )

  const open = mine.filter((r) => IN_PROGRESS.has(r.status))
  const done = mine.filter((r) => r.status === 'completed')
  const closed = mine.filter((r) => NOT_APPROVED.has(r.status))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Requests"
        description="Everything you asked to spend, and where it stands."
        actions={
          <ButtonLink href={href('requests/new')} size="pill">
            <Plus data-icon="inline-start" /> New request
          </ButtonLink>
        }
      />
      <PageTabs
        tabs={[
          { value: 'all', label: 'All', content: table(mine) },
          { value: 'open', label: 'In progress', count: open.length, content: table(open) },
          { value: 'done', label: 'Completed', content: table(done) },
          { value: 'closed', label: 'Not approved', content: table(closed) },
        ]}
      />
    </div>
  )
}

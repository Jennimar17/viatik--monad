'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { HandCoins, Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { useHref, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { CapitalBar } from '@/components/viatik/finance'
import { PageHeader } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { releaseModelLabel } from '@/domain/labels'
import { agencyName } from '@/domain/queries'
import { agreementCapital } from '@/domain/selectors'
import { agreementStatus } from '@/domain/status'
import type { AgreementStatus, FundingAgreement } from '@/domain/types'
import { formatDate } from '@/lib/format'

const CLOSED: ReadonlySet<AgreementStatus> = new Set(['completed', 'cancelled', 'expired'])

export default function FundingPage() {
  const { state } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const router = useRouter()
  const agreements = state.agreements.filter((a) => a.portfolioId === portfolioId)

  const nextTranche = (agreement: FundingAgreement) =>
    state.tranches
      .filter((t) => t.agreementId === agreement.id && t.status !== 'released')
      .sort((a, b) => a.index - b.index)[0]

  const columns: ColumnDef<FundingAgreement, unknown>[] = [
    {
      id: 'agreement',
      header: 'Agreement',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={agencyName(state, row.original.agencyId)} size="sm" />
          <span className="flex flex-col">
            <span className="font-medium">{row.original.title}</span>
            <span className="text-xs text-subtle">{agencyName(state, row.original.agencyId)}</span>
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
      id: 'funded',
      header: 'Funded',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={agreementCapital(state, row.original.id).funded} size="sm" />,
    },
    {
      id: 'released',
      header: 'Released',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={agreementCapital(state, row.original.id).released} size="sm" />,
    },
    {
      id: 'remaining',
      header: 'Remaining',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <Amount value={agreementCapital(state, row.original.id).remainingCommitment} size="sm" tone="muted" />
      ),
    },
    {
      id: 'model',
      header: 'Release model',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {releaseModelLabel[row.original.releaseModel].label}
        </span>
      ),
    },
    {
      id: 'next',
      header: 'Next tranche',
      cell: ({ row }) => {
        const next = nextTranche(row.original)
        return (
          <span className="text-sm text-muted-foreground">
            {next
              ? `${next.name}${next.scheduledFor ? ` · ${formatDate(next.scheduledFor)}` : ''}`
              : 'All released'}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={agreementStatus[row.original.status]} />,
    },
  ]

  const table = (rows: FundingAgreement[]) => (
    <DataTable
      data={rows}
      columns={columns}
      caption="Funding agreements"
      searchPlaceholder="Search agreements"
      searchText={(a) => `${a.title} ${agencyName(state, a.agencyId)}`}
      onRowClick={(a) => router.push(href(`funding/${a.id}`))}
      empty={
        <EmptyState
          compact
          icon={<HandCoins />}
          title="No agreements here"
          description="Agreements in this status will appear here."
        />
      }
      renderMobile={(a) => {
        const capital = agreementCapital(state, a.id)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-sm font-medium">{a.title}</span>
                <span className="text-xs text-subtle">{agencyName(state, a.agencyId)}</span>
              </span>
              <StatusBadge status={agreementStatus[a.status]} />
            </div>
            <CapitalBar committed={capital.committed} funded={capital.funded} released={capital.released} />
          </div>
        )
      }}
    />
  )

  const byStatus = (predicate: (status: AgreementStatus) => boolean) =>
    agreements.filter((a) => predicate(a.status))
  const active = byStatus((s) => s === 'active')
  const pending = byStatus((s) => s === 'pending_acceptance')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Funding"
        description="Funding agreements define the commitment, how it is released, and the operating boundaries."
        actions={
          <ButtonLink href={href('funding/new')} size="pill">
            <Plus data-icon="inline-start" /> Create agreement
          </ButtonLink>
        }
      />
      <PageTabs
        tabs={[
          { value: 'all', label: 'All', content: table(agreements) },
          { value: 'active', label: 'Active', count: active.length, content: table(active) },
          { value: 'pending', label: 'Pending acceptance', count: pending.length, content: table(pending) },
          { value: 'paused', label: 'Paused', content: table(byStatus((s) => s === 'paused')) },
          { value: 'closed', label: 'Closed', content: table(byStatus((s) => CLOSED.has(s))) },
        ]}
      />
    </div>
  )
}

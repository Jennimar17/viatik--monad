'use client'

import { Plus, Store } from 'lucide-react'
import * as React from 'react'

import { AddDestinationSheet } from '@/components/app/money-setup'
import { PageTabs } from '@/components/app/page-tabs'
import { providerSummary } from '@/components/app/provider-parts'
import { ProvidersTable } from '@/components/app/provider-table'
import { usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { sum } from '@/domain/money'
import type { PaymentDestination } from '@/domain/types'
import { pluralize } from '@/lib/format'

type Tab = 'current' | 'approved' | 'paused' | 'archived'

export default function ProvidersPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const { can } = usePermissions()
  const canManage = can('send_payment')
  const [tab, setTab] = React.useState<Tab>('current')
  const [adding, setAdding] = React.useState(false)

  const all = state.destinations.filter((d) => d.agencyId === agencyId)
  // Archived providers stay out of the way: only their own tab lists them.
  const current = all.filter((d) => d.status !== 'archived')
  const approved = all.filter((d) => d.status === 'approved')
  const paused = all.filter((d) => d.status === 'paused')
  const archived = all.filter((d) => d.status === 'archived')
  const summaries = all.map((d) => providerSummary(state, d, now))
  const paidThisMonth = summaries.flatMap((s) => s.thisMonth)
  const scheduled = summaries.flatMap((s) => s.scheduled)
  const openBills = summaries.flatMap((s) => s.openBills)

  const addButton = canManage ? (
    <Button size="pill" onClick={() => setAdding(true)}>
      <Plus data-icon="inline-start" /> Add provider
    </Button>
  ) : null

  const table = (providers: PaymentDestination[], title: string, description: string) => (
    <ProvidersTable
      providers={providers}
      empty={<EmptyState compact icon={<Store />} title={title} description={description} />}
    />
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Providers"
        description="The vendors, services and contractors the Agency pays. Pause one to stop payments to it, or archive the ones you no longer use."
        actions={addButton}
      />

      {all.length === 0 ? (
        <EmptyState
          icon={<Store />}
          title="No providers yet"
          description="Add the vendors, services and contractors the Agency pays. Budgets and bills can only pay approved providers."
          action={addButton}
        />
      ) : (
        <>
          <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Providers"
              value={<span className="font-display text-2xl leading-none">{current.length}</span>}
              hint={`${approved.length} approved · ${paused.length} paused`}
            />
            <KpiTile
              label="Paid this month"
              value={sum(paidThisMonth, (p) => p.amount)}
              hint={pluralize(paidThisMonth.length, 'payment')}
              emphasis
            />
            <KpiTile
              label="Scheduled"
              value={sum(scheduled, (p) => p.amount)}
              hint={scheduled.length ? `${scheduled.length} upcoming` : 'Nothing scheduled'}
            />
            <KpiTile
              label="Bills to pay"
              value={sum(openBills, (b) => b.amount)}
              hint={openBills.length ? pluralize(openBills.length, 'bill') : 'Nothing to pay'}
            />
          </HairlineGrid>

          <PageTabs
            value={tab}
            onValueChange={(value) => setTab(value as Tab)}
            tabs={[
              {
                value: 'current',
                label: 'Current',
                count: current.length,
                content: table(
                  current,
                  'Every provider is archived',
                  'Restore one from the Archived tab, or add a new provider.',
                ),
              },
              {
                value: 'approved',
                label: 'Approved',
                count: approved.length,
                content: table(
                  approved,
                  'No approved providers',
                  'Approved providers can be paid from the budgets that allow them.',
                ),
              },
              {
                value: 'paused',
                label: 'Paused',
                count: paused.length,
                content: table(
                  paused,
                  'No paused providers',
                  'Pause a provider to stop new payments to it for a while.',
                ),
              },
              {
                value: 'archived',
                label: 'Archived',
                count: archived.length,
                content: table(
                  archived,
                  'No archived providers',
                  'Archive the providers you no longer use. Their history stays.',
                ),
              },
            ]}
          />
        </>
      )}

      {canManage ? (
        <AddDestinationSheet
          open={adding}
          onOpenChange={setAdding}
          agencyId={agencyId}
          // A new provider is approved: show it where it lands.
          onAdded={() => setTab('current')}
        />
      ) : null}
    </div>
  )
}

'use client'

import { Link2, Plus } from 'lucide-react'

import { BillsTable } from '@/components/app/bills-table'
import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { useHref, useRole } from '@/components/app/role-context'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { sum } from '@/domain/money'
import { billState } from '@/domain/queries'
import { daysUntil, pluralize } from '@/lib/format'

export default function BillsPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const all = state.bills.filter((b) => b.agencyId === agencyId)
  const toPay = all.filter((b) => b.status === 'to_pay')
  const scheduled = all.filter((b) => b.status === 'scheduled')
  const paid = all.filter((b) => b.status === 'paid')
  const reconciled = all.filter((b) => b.status === 'reconciled')
  const overdue = all.filter((b) => billState(b, now) === 'overdue')
  const dueThisWeek = toPay.filter((b) => {
    const days = daysUntil(b.dueDate, now)
    return days >= 0 && days <= 7
  })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Bills"
        description="What the Agency owes vendors and contractors, paid and matched to its evidence."
        actions={
          <>
            <ButtonLink href={href('bills/reconcile')} variant="outline" size="pill">
              <Link2 data-icon="inline-start" /> Reconcile
            </ButtonLink>
            <ButtonLink href={href('bills/new')} size="pill">
              <Plus data-icon="inline-start" /> Add bill
            </ButtonLink>
          </>
        }
      />
      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Due this week"
          value={sum(dueThisWeek, (b) => b.amount)}
          hint={pluralize(dueThisWeek.length, 'bill')}
        />
        <KpiTile
          label="Overdue"
          value={sum(overdue, (b) => b.amount)}
          hint={
            overdue.length
              ? `${pluralize(overdue.length, 'bill')} ${overdue.length === 1 ? 'needs' : 'need'} attention`
              : 'Nothing overdue'
          }
        />
        <KpiTile
          label="Scheduled"
          value={sum(scheduled, (b) => b.amount)}
          hint={`${scheduled.length} scheduled`}
        />
        <KpiTile
          label="Waiting to reconcile"
          value={<span className="font-display text-2xl">{paid.length}</span>}
          hint="Paid, evidence not linked yet"
        />
      </HairlineGrid>
      <PageTabs
        tabs={[
          {
            value: 'to_pay',
            label: 'To pay',
            count: toPay.length,
            content: <BillsTable bills={toPay} emptyTitle="Nothing to pay" />,
          },
          {
            value: 'scheduled',
            label: 'Scheduled',
            count: scheduled.length,
            content: <BillsTable bills={scheduled} emptyTitle="No scheduled bills" />,
          },
          {
            value: 'paid',
            label: 'Paid',
            count: paid.length,
            content: <BillsTable bills={paid} emptyTitle="No bills waiting to reconcile" />,
          },
          {
            value: 'reconciled',
            label: 'Reconciled',
            content: <BillsTable bills={reconciled} emptyTitle="No reconciled bills yet" />,
          },
        ]}
      />
    </div>
  )
}

'use client'

import { ArrowDownLeft } from 'lucide-react'

import { PaymentsTable } from '@/components/app/payments-table'
import { useRole } from '@/components/app/role-context'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { sum } from '@/domain/money'
import { formatDate, pluralize } from '@/lib/format'

export default function MemberPaymentsPage() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const agency = state.agencies.find((a) => a.id === agencyId)
  const received = state.payments.filter(
    (p) => p.agencyId === agencyId && p.recipient.kind === 'member' && p.recipient.userId === userId,
  )
  const completed = received.filter((p) => p.status === 'completed')
  const year = now.slice(0, 4)
  const thisYear = completed.filter((p) => (p.completedAt ?? '').startsWith(year))
  const next = received
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))[0]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payments"
        description={`Money ${agency?.name ?? 'your Agency'} paid to you. Once paid, it is yours; each payment has its receipt.`}
      />

      <HairlineGrid className="grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label="Received this year"
          value={sum(thisYear, (p) => p.amount)}
          hint={pluralize(thisYear.length, 'payment')}
          emphasis
        />
        <KpiTile
          label="Received in total"
          value={sum(completed, (p) => p.amount)}
          hint={pluralize(completed.length, 'payment')}
        />
        <KpiTile
          label="Next expected payment"
          value={
            next ? next.amount : <span className="text-sm text-muted-foreground">Nothing scheduled</span>
          }
          hint={next ? `${next.memo} · ${formatDate(next.scheduledFor)}` : 'Scheduled payouts show here'}
          className="col-span-2 lg:col-span-1"
        />
      </HairlineGrid>

      <PaymentsTable
        payments={received}
        direction="in"
        showBudget={false}
        empty={
          <EmptyState
            compact
            icon={<ArrowDownLeft />}
            title="No payments yet"
            description="Payments from your Agency will appear here with their receipts."
          />
        }
      />
    </div>
  )
}

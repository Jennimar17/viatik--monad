'use client'

import { ChevronDown, ReceiptText, Send, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'

import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { PaymentsTable } from '@/components/app/payments-table'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { sum } from '@/domain/money'
import type { Payment, PaymentType } from '@/domain/types'
import { pluralize } from '@/lib/format'

export default function PaymentsPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const { can } = usePermissions()

  const payments = state.payments.filter((p) => p.agencyId === agencyId)
  const month = now.slice(0, 7)
  const thisMonth = payments.filter(
    (p) => p.status === 'completed' && (p.completedAt ?? '').startsWith(month),
  )
  const scheduled = payments.filter((p) => p.status === 'scheduled')
  const byType = (types: PaymentType[]) => payments.filter((p) => types.includes(p.type))
  const table = (rows: Payment[], what: string) => (
    <PaymentsTable
      payments={rows}
      empty={
        <EmptyState
          compact
          icon={<Send />}
          title={`No ${what} yet`}
          description="Payments appear here with their budget, policy and receipt."
        />
      }
    />
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payments"
        description="Every payment from the Agency, with its budget, policy, and verifiable receipt."
        actions={
          can('send_payment') ? (
            <div className="flex">
              <ButtonLink href={href('payments/new')} size="pill" className="rounded-r-none pr-4">
                <Send data-icon="inline-start" /> Send payment
              </ButtonLink>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="pill"
                      className="rounded-l-none border-l border-primary-foreground/20 px-3"
                      aria-label="More payment options"
                    />
                  }
                >
                  <ChevronDown />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52 p-1.5">
                  {can('pay_member') ? (
                    <DropdownMenuItem
                      className="gap-2 rounded-lg"
                      onClick={() => router.push(href('payments/team'))}
                    >
                      <Users className="size-4" /> Pay team
                    </DropdownMenuItem>
                  ) : null}
                  {can('manage_bills') ? (
                    <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => router.push(href('bills'))}>
                      <ReceiptText className="size-4" /> Pay a bill
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null
        }
      />

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Paid this month"
          value={sum(thisMonth, (p) => p.amount)}
          hint={pluralize(thisMonth.length, 'payment')}
          emphasis
        />
        <KpiTile
          label="Scheduled"
          value={sum(scheduled, (p) => p.amount)}
          hint={`${scheduled.length} upcoming`}
        />
        <KpiTile
          label="Team this month"
          value={sum(
            thisMonth.filter((p) => p.type === 'team' || p.type === 'contractor'),
            (p) => p.amount,
          )}
          hint="People and contractors"
        />
        <KpiTile
          label="Automations this month"
          value={sum(
            thisMonth.filter((p) => p.type === 'automation'),
            (p) => p.amount,
          )}
          hint="AI Agent spending"
        />
      </HairlineGrid>

      <PageTabs
        tabs={[
          { value: 'all', label: 'All', content: table(payments, 'payments') },
          { value: 'team', label: 'Team', content: table(byType(['team', 'contractor']), 'team payments') },
          {
            value: 'vendors',
            label: 'Vendors',
            content: table(byType(['vendor', 'tool']), 'vendor payments'),
          },
          {
            value: 'reimbursements',
            label: 'Reimbursements',
            content: table(byType(['reimbursement']), 'reimbursements'),
          },
          {
            value: 'automation',
            label: 'Automation',
            content: table(byType(['automation']), 'automation payments'),
          },
        ]}
      />
    </div>
  )
}

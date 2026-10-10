'use client'

import { ArrowUpRight, ChevronDown, FilePlus2, ReceiptText, Send, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { OutsidePaymentsTable } from '@/components/app/accountability-parts'
import { AddInvoiceSheet } from '@/components/app/add-invoice-sheet'
import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { PaymentsTable } from '@/components/app/payments-table'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { useTabParam } from '@/components/app/use-tab-param'
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
import { outsidePaymentsWithoutProof } from '@/domain/accountability'
import { sum } from '@/domain/money'
import { isOutsidePayment } from '@/domain/queries'
import type { Payment, PaymentType } from '@/domain/types'
import { pluralize } from '@/lib/format'

const TABS = ['all', 'team', 'vendors', 'reimbursements', 'outside', 'automation'] as const

export default function PaymentsPage() {
  // useSearchParams (the open tab) needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <Payments />
    </React.Suspense>
  )
}

/** Every payment from the Agency, by type; `?tab=outside` opens the payments made outside Viatik. */
function Payments() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const { can } = usePermissions()
  const tabs = useTabParam(TABS, 'all')
  // Kept while the invoice sheet closes, so it does not go blank.
  const [invoiceFor, setInvoiceFor] = React.useState<string | null>(null)
  const [invoiceOpen, setInvoiceOpen] = React.useState(false)

  const payments = state.payments.filter((p) => p.agencyId === agencyId)
  const outside = payments.filter(isOutsidePayment)
  const withoutInvoice = outsidePaymentsWithoutProof(state, agencyId, now)
  const canInvoice = can('pay_outside', { agencyId })
  const canPayOutside =
    canInvoice && state.accounts.some((a) => a.agencyId === agencyId && a.status === 'active')
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
        description="Every payment from the Agency, including those paid outside Viatik, with its budget, policy, and verifiable receipt."
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
                  {canPayOutside ? (
                    <DropdownMenuItem
                      className="gap-2 rounded-lg"
                      onClick={() => router.push(href('accounts/pay-outside'))}
                    >
                      <ArrowUpRight className="size-4" /> Pay outside Viatik
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
        {...tabs}
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
            value: 'outside',
            label: 'Outside Viatik',
            count: withoutInvoice.length,
            content: (
              <OutsidePaymentsTable
                payments={outside}
                now={now}
                action={
                  canInvoice
                    ? (payment) =>
                        payment.proof ? null : (
                          <Button
                            variant="outline"
                            size="pill-sm"
                            onClick={() => {
                              setInvoiceFor(payment.id)
                              setInvoiceOpen(true)
                            }}
                          >
                            <FilePlus2 data-icon="inline-start" /> Add invoice
                            {payment.recipient.kind === 'address' ? (
                              <span className="sr-only"> for “{payment.recipient.payee}”</span>
                            ) : null}
                          </Button>
                        )
                    : undefined
                }
                empty={
                  <EmptyState
                    compact
                    icon={<ArrowUpRight />}
                    title="Nothing paid outside Viatik yet"
                    description="Tools and subscriptions an Agency Admin pays to an address outside Viatik show here, with their invoice."
                    action={
                      canPayOutside ? (
                        <ButtonLink href={href('accounts/pay-outside')} variant="outline" size="pill-sm">
                          <ArrowUpRight data-icon="inline-start" /> Pay outside Viatik
                        </ButtonLink>
                      ) : undefined
                    }
                  />
                }
              />
            ),
          },
          {
            value: 'automation',
            label: 'Automation',
            content: table(byType(['automation']), 'automation payments'),
          },
        ]}
      />

      <AddInvoiceSheet
        paymentId={invoiceFor}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        onClosed={() => setInvoiceFor(null)}
      />
    </div>
  )
}

'use client'

import { CalendarClock, CalendarPlus, FilePlus2, Link2, Plus } from 'lucide-react'
import * as React from 'react'

import { InvoicesPendingList } from '@/components/app/accountability-parts'
import { AddInvoiceSheet } from '@/components/app/add-invoice-sheet'
import { BillsTable } from '@/components/app/bills-table'
import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { isDueNow, MonthlyPayments, NewReminderSheet } from '@/components/app/reminders'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { useOpenParam, useTabParam } from '@/components/app/use-tab-param'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { outsidePaymentsWithoutProof, PROOF_WITHIN_DAYS, remindersDue } from '@/domain/accountability'
import { sum } from '@/domain/money'
import { billState } from '@/domain/queries'
import { daysUntil, pluralize } from '@/lib/format'

export default function BillsPage() {
  // useSearchParams (the open tab, the new monthly payment sheet) needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <Bills />
    </React.Suspense>
  )
}

const TABS = ['to_pay', 'scheduled', 'paid', 'reconciled', 'invoices', 'monthly'] as const

/**
 * What the Agency owes: vendor bills, payments made outside Viatik still
 * waiting for their invoice, and monthly payments. Links open a tab
 * (`?tab=invoices`, `?tab=monthly`) and the new monthly payment sheet (`?new=monthly`).
 */
function Bills() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const tabs = useTabParam(TABS, 'to_pay')
  const [creating, setCreating] = useOpenParam('new', 'monthly')
  // Kept while the invoice sheet closes, so it does not go blank.
  const [invoiceFor, setInvoiceFor] = React.useState<string | null>(null)
  const [invoiceOpen, setInvoiceOpen] = React.useState(false)

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
  const withoutInvoice = outsidePaymentsWithoutProof(state, agencyId, now)
  const lateInvoices = new Set(withoutInvoice.filter((p) => p.overdue).map((p) => p.payment.id))
  const invoicesOverdue = lateInvoices.size
  const monthlyDue = remindersDue(state, agencyId, now).filter((r) => isDueNow(r, now)).length
  const canInvoice = can('pay_outside', { agencyId })
  const canRemind = can('manage_reminders', { agencyId })

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Bills"
        description="What the Agency owes: vendor bills, payments made outside Viatik waiting for their invoice, and monthly payments."
        actions={
          <>
            <ButtonLink href={href('bills/reconcile')} variant="outline" size="pill">
              <Link2 data-icon="inline-start" /> Reconcile
            </ButtonLink>
            {canRemind ? (
              <Button variant="outline" size="pill" onClick={() => setCreating(true)}>
                <CalendarPlus data-icon="inline-start" /> New monthly payment
              </Button>
            ) : null}
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
        {...tabs}
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
          {
            value: 'invoices',
            label: 'Invoices pending',
            count: withoutInvoice.length,
            content: (
              <Panel
                title="Paid outside Viatik, waiting for the invoice"
                description={
                  withoutInvoice.length === 0
                    ? `Add each invoice within ${PROOF_WITHIN_DAYS} days of paying.`
                    : `${pluralize(withoutInvoice.length, 'invoice')} to add${invoicesOverdue > 0 ? `, ${invoicesOverdue} overdue` : ''}. Add each within ${PROOF_WITHIN_DAYS} days of paying.`
                }
              >
                <InvoicesPendingList
                  items={withoutInvoice}
                  now={now}
                  action={
                    canInvoice
                      ? (payment) => (
                          <Button
                            variant={lateInvoices.has(payment.id) ? 'default' : 'outline'}
                            size="pill-sm"
                            onClick={() => {
                              setInvoiceFor(payment.id)
                              setInvoiceOpen(true)
                            }}
                          >
                            <FilePlus2 data-icon="inline-start" /> Add invoice
                          </Button>
                        )
                      : undefined
                  }
                />
              </Panel>
            ),
          },
          {
            value: 'monthly',
            label: 'Monthly',
            count: monthlyDue,
            content: (
              <Panel
                title="Monthly payments"
                description="Tools and subscriptions paid outside Viatik every month. Nothing is paid automatically: use Pay now when one is due."
              >
                <MonthlyPayments
                  agencyId={agencyId}
                  empty={
                    <EmptyState
                      compact
                      icon={<CalendarClock />}
                      title="No monthly payments"
                      description="Add the tools and subscriptions the Agency pays outside Viatik every month. Each one shows here when it is due."
                      action={
                        canRemind ? (
                          <Button variant="outline" size="pill-sm" onClick={() => setCreating(true)}>
                            <CalendarPlus data-icon="inline-start" /> New monthly payment
                          </Button>
                        ) : undefined
                      }
                    />
                  }
                />
              </Panel>
            ),
          },
        ]}
      />

      <AddInvoiceSheet
        paymentId={invoiceFor}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        onClosed={() => setInvoiceFor(null)}
      />
      {canRemind ? (
        <NewReminderSheet
          open={creating}
          onOpenChange={setCreating}
          agencyId={agencyId}
          onCreated={() => tabs.onValueChange('monthly')}
        />
      ) : null}
    </div>
  )
}

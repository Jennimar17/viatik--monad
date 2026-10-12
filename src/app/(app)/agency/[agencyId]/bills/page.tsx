'use client'

import { CalendarClock, CalendarPlus, FilePlus2, Link2, Plus, ScanText, X } from 'lucide-react'
import * as React from 'react'

import { InvoicesPendingList } from '@/components/app/accountability-parts'
import { AddInvoiceSheet } from '@/components/app/add-invoice-sheet'
import { BillsTable } from '@/components/app/bills-table'
import { ButtonLink } from '@/components/app/button-link'
import { KimiReader } from '@/components/app/kimi-reader'
import { PageTabs } from '@/components/app/page-tabs'
import { isDueNow, MonthlyPayments, NewReminderSheet } from '@/components/app/reminders'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { billSchedule, RunDuePaymentsButton, useClock, usePayTiming } from '@/components/app/schedules'
import { useOpenParam, useTabParam } from '@/components/app/use-tab-param'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { EvidenceUploader, type DraftFile } from '@/components/viatik/forms'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import Link from '@/components/viatik/link'
import { useEvidenceFiles, useViatikState } from '@/data/react'
import { useEvidenceReader } from '@/data/use-evidence-reader'
import { outsidePaymentsWithoutProof, PROOF_WITHIN_DAYS, remindersDue } from '@/domain/accountability'
import { sum } from '@/domain/money'
import { billState } from '@/domain/queries'
import { scheduleState } from '@/domain/schedules'
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
  const clock = useClock()
  // Whether due payments run on a timer here: the copy promises only what happens.
  const timing = usePayTiming(clock)
  const tabs = useTabParam(TABS, 'to_pay')
  const [creating, setCreating] = useOpenParam('new', 'monthly')
  // Kept while the invoice sheet closes, so it does not go blank.
  const [invoiceFor, setInvoiceFor] = React.useState<string | null>(null)
  const [invoiceOpen, setInvoiceOpen] = React.useState(false)
  // "Read an invoice": Kimi proposes which payment an uploaded invoice belongs to, and Add invoice
  // opens for it with the file already attached (`invoiceFiles`). The person attaches it themselves.
  const reader = useEvidenceReader()
  const [readingInvoice, setReadingInvoice] = React.useState(false)
  const [invoiceFiles, setInvoiceFiles] = React.useState<DraftFile[] | undefined>(undefined)

  const all = state.bills.filter((b) => b.agencyId === agencyId)
  const toPay = all.filter((b) => b.status === 'to_pay')
  const scheduled = all.filter((b) => b.status === 'scheduled')
  // Scheduled bills whose payment could not be paid when due, or stopped.
  const scheduledAttention = scheduled.filter((b) => {
    const schedule = billSchedule(state, b)
    const shown = schedule ? scheduleState(state, schedule, clock) : undefined
    return shown === 'needs_attention' || shown === 'stopped'
  }).length
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
  const canRead = reader.enabled && canInvoice && withoutInvoice.length > 0

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
          hint={
            scheduledAttention > 0 ? (
              <span className="text-danger">
                {scheduled.length} scheduled · {scheduledAttention}{' '}
                {scheduledAttention === 1 ? 'needs' : 'need'} attention
              </span>
            ) : (
              `${scheduled.length} scheduled`
            )
          }
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
            content: (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-sm text-pretty text-muted-foreground">
                    {timing === 'automatic'
                      ? 'Viatik pays each one within about 10 minutes of its time and marks it paid.'
                      : 'Once each one is due, it is paid when an Agency Admin presses Run due payments, and marked paid.'}{' '}
                    Pause, resume or cancel them on the bill or in{' '}
                    <Link
                      href={href('payments?tab=scheduled')}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      Payments ▸ Scheduled
                    </Link>
                    .
                  </p>
                  <RunDuePaymentsButton agencyId={agencyId} className="shrink-0" />
                </div>
                <BillsTable bills={scheduled} emptyTitle="No scheduled bills" scheduled now={clock} />
              </div>
            ),
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
                action={
                  canRead && !readingInvoice ? (
                    <Button variant="outline" size="pill-sm" onClick={() => setReadingInvoice(true)}>
                      <ScanText data-icon="inline-start" /> Read an invoice
                    </Button>
                  ) : undefined
                }
              >
                {canRead && readingInvoice ? (
                  <ReadInvoice
                    agencyId={agencyId}
                    onClose={() => setReadingInvoice(false)}
                    onFound={(paymentId, file) => {
                      setInvoiceFor(paymentId)
                      setInvoiceFiles([file])
                      setInvoiceOpen(true)
                    }}
                  />
                ) : null}
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
                description={`Tools and subscriptions paid outside Viatik every month. Nothing is paid automatically: ${
                  timing === 'automatic'
                    ? 'Agency Admins are notified on the due day'
                    : 'each one shows here as due on its day'
                }, then use Pay now.`}
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
        initialFiles={invoiceFiles}
        notice={
          invoiceFiles
            ? 'Kimi matched the invoice you read to this payment. Check the payee and amount before you attach it.'
            : undefined
        }
        onClosed={() => {
          // Attached: the invoice that was read found its payment, so its reader closes too.
          if (invoiceFiles && state.payments.find((p) => p.id === invoiceFor)?.proof) setReadingInvoice(false)
          setInvoiceFor(null)
          setInvoiceFiles(undefined)
        }}
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

/**
 * Upload an invoice and let Kimi propose which payment outside Viatik it
 * belongs to; "Add it to this payment" opens Add invoice for that payment
 * with the file already attached, and "Open Add invoice again" reopens it if
 * it was closed without attaching. Nothing is attached without the Admin.
 */
function ReadInvoice({
  agencyId,
  onFound,
  onClose,
}: {
  agencyId: string
  onFound: (paymentId: string, file: DraftFile) => void
  onClose: () => void
}) {
  const evidenceFiles = useEvidenceFiles()
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const file = files[0]

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">Read an invoice</p>
          <p className="text-sm text-pretty text-muted-foreground">
            Add an invoice and Kimi proposes which payment below it belongs to. You check it and attach it.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 shrink-0 rounded-full"
          aria-label="Close Read an invoice"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <EvidenceUploader
        files={files}
        onChange={setFiles}
        onUpload={evidenceFiles.upload}
        maxFiles={1}
        allowLinks={false}
        label="Drop the invoice here or browse"
        hint="One file: PDF, PNG, JPG, WEBP or HEIC, up to 10 MB."
      />
      <KimiReader
        file={file}
        agencyId={agencyId}
        purpose="invoice"
        sample="figma-invoice"
        onSampleFile={(sample) => setFiles([sample])}
        useLabel="Add it to this payment"
        canUse={(proposal) => Boolean(proposal.match)}
        usedText="Add invoice opened for the payment Kimi proposed. Check it there before you attach the file."
        // Closed without attaching: the same reading opens Add invoice again, without a new read.
        againLabel="Open Add invoice again"
        onUse={(proposal) => {
          if (proposal.match && file) onFound(proposal.match.id, file)
        }}
        extra={(proposal) =>
          proposal.readable && !proposal.match ? (
            <p className="text-sm text-pretty text-muted-foreground">
              Kimi did not find which payment this invoice is for. Use Add invoice on the right payment below.
            </p>
          ) : null
        }
      />
    </div>
  )
}

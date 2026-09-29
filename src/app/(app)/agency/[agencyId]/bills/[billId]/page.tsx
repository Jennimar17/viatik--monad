'use client'

import { CalendarClock, FileText, Link2, Send } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { Steps } from '@/components/viatik/operation'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, ZERO } from '@/domain/money'
import { accountName, billState, budgetName, receiptFor, userName } from '@/domain/queries'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import { billStatus } from '@/domain/status'
import { dueLabel, formatDate, formatDateTime, fromDateInput } from '@/lib/format'
import { cn } from '@/lib/utils'

const NO_BUDGET = 'none'

export default function BillDetailPage() {
  const { billId } = useParams<{ billId: string }>()
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const pay = useCommand('payBill')
  const reconcile = useCommand('reconcile')
  const [sheet, setSheet] = React.useState<'pay' | 'reconcile' | null>(null)

  const bill = state.bills.find((b) => b.id === billId && b.agencyId === agencyId)
  // The pay form starts from the bill's own account and budget; closing the sheet restores them.
  const [accountId, setAccountId] = React.useState<string | null>(bill?.accountId ?? null)
  const [budgetId, setBudgetId] = React.useState<string>(bill?.budgetId ?? NO_BUDGET)
  const [when, setWhen] = React.useState<'now' | 'schedule'>('now')
  const [scheduledFor, setScheduledFor] = React.useState('')
  const resetPayForm = () => {
    pay.reset()
    setAccountId(bill?.accountId ?? null)
    setBudgetId(bill?.budgetId ?? NO_BUDGET)
    setWhen('now')
    setScheduledFor('')
  }
  if (!bill) {
    return (
      <ScreenUnavailable
        title="Bill not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const vendor = state.destinations.find((d) => d.id === bill.destinationId)
  const vendorName = vendor?.name ?? 'Vendor'
  const payment = state.payments.find((p) => p.id === bill.paymentId)
  const receipt = receiptFor(state, payment?.receiptId)
  const reconciliation = state.reconciliations.find((r) => r.billId === bill.id)
  const status = billState(bill, now)
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const budgets = state.budgets.filter(
    (b) => b.agencyId === agencyId && b.status === 'active' && b.allowedCategories.includes(bill.category),
  )
  const chosenBudget = budgets.find((b) => b.id === budgetId)
  const available = chosenBudget
    ? budgetUsage(state, chosenBudget, now).available
    : accountId
      ? accountBalance(state, accountId)
      : ZERO
  const payingNow = when === 'now'
  const scheduledIso = fromDateInput(scheduledFor)
  const insufficient = available < bill.amount
  const scheduleError =
    !payingNow && scheduledIso && scheduledIso <= now ? 'Choose a date in the future.' : undefined

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('bills')} className="hover:text-foreground">
            Bills
          </Link>
        }
        title={`${vendorName} · ${bill.number}`}
        meta={
          <>
            <StatusBadge status={billStatus[status]} size="md" />
            <span className={cn('text-sm', status === 'overdue' ? 'text-danger' : 'text-subtle')}>
              {bill.status === 'to_pay' ? dueLabel(bill.dueDate, now) : `Due ${formatDate(bill.dueDate)}`}
            </span>
          </>
        }
        actions={
          bill.status === 'to_pay' ? (
            <Button size="pill" onClick={() => setSheet('pay')}>
              <Send data-icon="inline-start" /> Pay bill
            </Button>
          ) : bill.status === 'paid' ? (
            <Button size="pill" onClick={() => setSheet('reconcile')}>
              <Link2 data-icon="inline-start" /> Reconcile payment
            </Button>
          ) : receipt ? (
            <ButtonLink href={receiptHref(receipt.id)} size="pill">
              View receipt
            </ButtonLink>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Panel title="Document" description="Private to your Agency. Only its fingerprint is recorded.">
          {/* A paper rendition of the uploaded invoice. */}
          <div className="theme-light rounded-xl border border-border bg-background p-6 text-foreground">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-display text-xl font-medium">{vendorName}</p>
                <p className="text-sm text-muted-foreground">Invoice {bill.number}</p>
              </div>
              <FileText className="size-6 text-subtle" aria-hidden="true" />
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-subtle">Billed to</p>
                <p>{state.agencies.find((a) => a.id === agencyId)?.name}</p>
              </div>
              <div className="text-right">
                <p className="text-subtle">Issued · Due</p>
                <p>
                  {formatDate(bill.issueDate)} · {formatDate(bill.dueDate)}
                </p>
              </div>
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <div className="flex justify-between text-sm">
                <span>{categoryLabel[bill.category]}</span>
                <span className="num">{formatUsd(bill.amount)}</span>
              </div>
              <div className="mt-3 flex justify-between border-t border-border pt-3 font-medium">
                <span>Total due</span>
                <span className="num">{formatUsd(bill.amount, { withCode: true })}</span>
              </div>
            </div>
            <p className="mt-6 font-mono text-2xs text-subtle">
              {bill.document.name} · fingerprint {bill.document.sha256.slice(0, 16)}…
            </p>
          </div>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel title="Details">
            <KeyValueList
              items={[
                { label: 'Amount', value: <Amount value={bill.amount} size="sm" /> },
                { label: 'Category', value: categoryLabel[bill.category] },
                { label: 'Account', value: accountName(state, bill.accountId) },
                {
                  label: 'Budget',
                  value: bill.budgetId ? budgetName(state, bill.budgetId) : 'Paid from the account',
                },
                { label: 'Payment destination', value: vendor?.settlementLabel },
                {
                  label: 'Added by',
                  value: `${userName(state, bill.createdBy)} · ${formatDate(bill.createdAt)}`,
                },
                ...(bill.notes ? [{ label: 'Notes', value: bill.notes }] : []),
              ]}
            />
          </Panel>

          <Panel title="Payment and evidence">
            <Steps
              steps={[
                { id: 'added', label: 'Bill added', detail: formatDateTime(bill.createdAt), state: 'done' },
                {
                  id: 'paid',
                  label:
                    bill.status === 'scheduled'
                      ? `Payment scheduled for ${formatDate(bill.scheduledFor ?? bill.dueDate)}`
                      : 'Payment completed',
                  detail: payment?.completedAt
                    ? `${formatDateTime(payment.completedAt)} · ${formatUsd(payment.amount, { withCode: true })}`
                    : undefined,
                  state:
                    payment?.status === 'completed'
                      ? 'done'
                      : bill.status === 'scheduled'
                        ? 'current'
                        : 'upcoming',
                },
                {
                  id: 'reconciled',
                  label: 'Reconciled',
                  detail: reconciliation
                    ? `${userName(state, reconciliation.reconciledBy)} · ${formatDateTime(reconciliation.reconciledAt)}`
                    : 'Bill, payment, and evidence linked',
                  state: reconciliation ? 'done' : 'upcoming',
                },
              ]}
            />
            <ReceiptDetailsButton receipt={receipt} className="mt-5" />
          </Panel>
        </div>
      </div>

      <Panel title="Activity">
        <ActivityList
          state={state}
          records={state.activity.filter(
            (a) => a.entity.id === bill.id || (payment !== undefined && a.entity.id === payment.id),
          )}
          now={now}
        />
      </Panel>

      <ApprovalSheet
        open={sheet === 'pay'}
        onOpenChange={(open) => !open && setSheet(null)}
        onClosed={resetPayForm}
        title="Pay bill"
        description={`${vendorName} · ${bill.number}`}
        summary={{
          what: payingNow
            ? `${vendorName} is paid now and the bill is marked as paid.`
            : `The payment is scheduled and runs on ${scheduledIso ? formatDate(scheduledIso) : 'the chosen date'}.`,
          amount: bill.amount,
          from: chosenBudget
            ? `${accountName(state, chosenBudget.sourceAccountId)} · ${chosenBudget.name}`
            : accountName(state, accountId ?? undefined),
          to: `${vendorName} · ${vendor?.settlementLabel ?? 'Payment destination'}`,
          reversible: 'Cannot be undone once completed. A refund would be a new payment from the vendor.',
          policy: chosenBudget
            ? `${chosenBudget.name}: per-operation limit ${formatUsd(chosenBudget.perOperationLimit, { withCode: true })}, approved destinations only.`
            : 'Agency account payment, authorized by an Agency Admin.',
        }}
        confirmLabel={payingNow ? 'Pay bill' : 'Schedule payment'}
        disabled={!accountId || (payingNow ? insufficient : !scheduledIso || Boolean(scheduleError))}
        phase={pay.phase}
        error={pay.error}
        onConfirm={() =>
          pay.run({
            billId: bill.id,
            accountId: chosenBudget ? chosenBudget.sourceAccountId : (accountId ?? undefined),
            budgetId: chosenBudget ? chosenBudget.id : null,
            scheduledFor: payingNow ? undefined : scheduledIso,
          })
        }
        success={{
          title: payingNow ? 'Payment completed' : 'Payment scheduled',
          body: payingNow
            ? 'The bill is paid. Reconcile it to link the payment and its evidence.'
            : 'We will pay this bill on the scheduled date.',
          actions: payingNow ? (
            <Button size="pill-sm" onClick={() => setSheet('reconcile')}>
              <Link2 data-icon="inline-start" /> Reconcile payment
            </Button>
          ) : undefined,
        }}
      >
        <div className="flex flex-col gap-4">
          <FormField
            label="Pay from budget"
            htmlFor="bill-budget"
            error={
              payingNow && insufficient
                ? `Only ${formatUsd(available, { withCode: true })} available. Choose another source.`
                : undefined
            }
            hint={`${formatUsd(available, { withCode: true })} available`}
          >
            <SimpleSelect
              id="bill-budget"
              value={budgetId}
              onValueChange={setBudgetId}
              options={[
                { value: NO_BUDGET, label: 'No budget, pay from the account' },
                ...budgets.map((b) => ({
                  value: b.id,
                  label: b.name,
                  description: `${formatUsd(budgetUsage(state, b, now).available)} available`,
                })),
              ]}
            />
          </FormField>
          {chosenBudget ? null : (
            <FormField label="Account" htmlFor="bill-account">
              <SimpleSelect
                id="bill-account"
                value={accountId}
                onValueChange={setAccountId}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: `${formatUsd(accountBalance(state, a.id))} available`,
                }))}
              />
            </FormField>
          )}
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="When">
            {(['now', 'schedule'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={when === option}
                onClick={() => setWhen(option)}
                className={cn(
                  'flex h-11 items-center justify-center gap-2 rounded-full border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  when === option
                    ? 'border-mist bg-mist/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {option === 'now' ? (
                  <Send className="size-4" aria-hidden="true" />
                ) : (
                  <CalendarClock className="size-4" aria-hidden="true" />
                )}
                {option === 'now' ? 'Pay now' : 'Schedule'}
              </button>
            ))}
          </div>
          {payingNow ? null : (
            <FormField label="Payment date" htmlFor="bill-date" error={scheduleError}>
              <PillInput
                id="bill-date"
                type="date"
                value={scheduledFor}
                aria-invalid={Boolean(scheduleError) || undefined}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
            </FormField>
          )}
        </div>
      </ApprovalSheet>

      <ApprovalSheet
        open={sheet === 'reconcile'}
        onOpenChange={(open) => !open && setSheet(null)}
        onClosed={reconcile.reset}
        title="Reconcile payment"
        summary={{
          what: `Links ${vendorName} bill ${bill.number}, its payment, and the invoice document into one record with a verifiable receipt.`,
          amount: bill.amount,
          reversible: 'Reconciliations are part of the audit trail and are not deleted.',
          policy: 'Every reconciliation references exactly one canonical payment.',
        }}
        confirmLabel="Reconcile payment"
        disabled={!bill.paymentId}
        phase={reconcile.phase}
        error={reconcile.error}
        onConfirm={() =>
          bill.paymentId && reconcile.run({ agencyId, paymentId: bill.paymentId, billId: bill.id })
        }
        success={{
          title: 'Payment reconciled',
          body: 'The bill, payment, and supporting evidence are now linked.',
          actions: receipt ? (
            <>
              <ButtonLink href={receiptHref(receipt.id)} size="pill-sm">
                View receipt
              </ButtonLink>
              <ReceiptDetailsButton receipt={receipt} />
            </>
          ) : undefined,
        }}
      />
    </div>
  )
}

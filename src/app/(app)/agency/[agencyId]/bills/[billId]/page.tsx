'use client'

import { FileText, Info, Link2, Send } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { OpenFileButton } from '@/components/app/open-file'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import {
  billSchedule,
  firstRunFor,
  paidAtText,
  PAY_NOW,
  resolveWhen,
  ScheduleList,
  useClock,
  usePayTiming,
  useScheduleActionSheet,
  whenText,
  WhenToPayField,
  type WhenChoice,
} from '@/components/app/schedules'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { Steps } from '@/components/viatik/operation'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, ZERO } from '@/domain/money'
import { accountName, billState, budgetName, budgetsForVendor, receiptFor, userName } from '@/domain/queries'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import { scheduleState } from '@/domain/schedules'
import { billStatus, scheduleStatus } from '@/domain/status'
import { dueLabel, formatDate, formatDateTime } from '@/lib/format'
import { formatLocalDate, formatLocalDateTime, fromLocalInputs } from '@/lib/local-time'
import { cn } from '@/lib/utils'

const NO_BUDGET = 'none'

export default function BillDetailPage() {
  const { billId } = useParams<{ billId: string }>()
  const { state, now, mode } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const clock = useClock()
  // Whether due payments run on a timer here: the copy promises only what happens.
  const timing = usePayTiming(clock)
  // Above the scheduled payment's panel, which leaves once it is cancelled: its success stays.
  const scheduleSheet = useScheduleActionSheet(clock)
  const pay = useCommand('payBill')
  const reconcile = useCommand('reconcile')
  const [sheet, setSheet] = React.useState<'pay' | 'reconcile' | null>(null)

  const bill = state.bills.find((b) => b.id === billId && b.agencyId === agencyId)
  // The pay form starts from the bill's own account and budget; closing the sheet restores them.
  const [accountId, setAccountId] = React.useState<string | null>(bill?.accountId ?? null)
  const [budgetId, setBudgetId] = React.useState<string>(bill?.budgetId ?? NO_BUDGET)
  const [when, setWhen] = React.useState<WhenChoice>(PAY_NOW)
  const resolved = resolveWhen(when, clock)
  const scheduling = resolved.scheduled
  const steps = useSigningSteps(pay.phase, {
    prepared: scheduling
      ? "Viatik checks the payment against its source's limits and the ledger's rules, and that the money is there today."
      : "Viatik checks the payment against its source's limits and the ledger's rules.",
    done: scheduling
      ? {
          label: 'Scheduled',
          detail:
            timing === 'automatic'
              ? 'Recorded on Monad. Viatik pays the bill when it is due.'
              : 'Recorded on Monad. The bill is paid once it is due and due payments run.',
        }
      : { label: 'Paid', detail: 'Recorded on Monad, with its receipt.' },
  })
  const resetPayForm = () => {
    pay.reset()
    setAccountId(bill?.accountId ?? null)
    setBudgetId(bill?.budgetId ?? NO_BUDGET)
    setWhen(PAY_NOW)
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
  // Only budgets that can pay this vendor: the others refuse it when it is paid.
  const budgets = vendor
    ? budgetsForVendor(state, agencyId, vendor, bill.category)
    : state.budgets.filter(
        (b) =>
          b.agencyId === agencyId && b.status === 'active' && b.allowedCategories.includes(bill.category),
      )
  const chosenBudget = budgets.find((b) => b.id === budgetId)
  const available = chosenBudget
    ? budgetUsage(state, chosenBudget, now).available
    : accountId
      ? accountBalance(state, accountId)
      : ZERO
  const payingNow = !scheduling
  // The schedule paying it now (status scheduled), and every schedule it ever had, for its activity.
  const schedule = billSchedule(state, bill)
  const scheduleIds = new Set(state.schedules.filter((s) => s.billId === bill.id).map((s) => s.id))
  const shownSchedule = schedule ? scheduleState(state, schedule, clock) : undefined
  const insufficient = available < bill.amount
  // Whether any source could pay it; if none can, point to where money comes from.
  const anyCovers =
    accounts.some((a) => accountBalance(state, a.id) >= bill.amount) ||
    budgets.some((b) => budgetUsage(state, b, now).available >= bill.amount)
  const scheduleError = resolved.scheduled ? resolved.error : undefined
  const demo = mode === 'demo'
  const previously = schedule
    ? formatLocalDateTime(schedule.nextRunAt, { withYear: true, withZone: true })
    : undefined

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
          bill.status === 'to_pay' || bill.status === 'scheduled' ? (
            <Button size="pill" onClick={() => setSheet('pay')}>
              <Send data-icon="inline-start" />{' '}
              {bill.status === 'scheduled' ? 'Pay now or reschedule' : 'Pay bill'}
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
          {bill.document.kind === 'file' ? (
            <OpenFileButton evidence={bill.document} className="mt-3 text-sm font-medium text-foreground">
              Open the original document
            </OpenFileButton>
          ) : null}
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
                { label: 'Payment reference', value: vendor?.settlementLabel || 'Not set' },
                {
                  label: 'Added by',
                  value: `${userName(state, bill.createdBy)} · ${formatLocalDate(bill.createdAt)}`,
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
                      ? `Payment scheduled for ${formatLocalDateTime(schedule?.nextRunAt ?? bill.scheduledFor ?? bill.dueDate)}`
                      : 'Payment completed',
                  detail: payment?.completedAt
                    ? `${formatDateTime(payment.completedAt)} · ${formatUsd(payment.amount, { withCode: true })}${payment.scheduleId ? ' · paid as scheduled' : ''}`
                    : shownSchedule && shownSchedule !== 'scheduled'
                      ? scheduleStatus[shownSchedule].label
                      : bill.status === 'scheduled'
                        ? `${paidAtText(timing)}.`
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

          {schedule ? (
            <Panel
              title="Scheduled payment"
              description={`${paidAtText(timing, 'its time')}, and the bill is marked paid. You can pause or cancel it until then.`}
            >
              <ScheduleList schedules={[schedule]} now={clock} links={false} onAction={scheduleSheet.act} />
            </Panel>
          ) : null}
        </div>
      </div>

      <Panel title="Activity">
        <ActivityList
          state={state}
          records={state.activity.filter(
            (a) =>
              a.entity.id === bill.id ||
              (payment !== undefined && a.entity.id === payment.id) ||
              scheduleIds.has(a.entity.id),
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
            ? `${vendorName} is paid now and the bill is marked as paid.${previously ? ` The payment scheduled for ${previously} is cancelled.` : ''}`
            : `${vendorName} is paid ${whenText(resolved)} and the bill is marked as paid. ${paidAtText(timing)}.${previously ? ` It replaces the payment scheduled for ${previously}.` : ''}`,
          amount: bill.amount,
          from: chosenBudget
            ? `${accountName(state, chosenBudget.sourceAccountId)} · ${chosenBudget.name}`
            : accountName(state, accountId ?? undefined),
          to: vendorName,
          reversible: payingNow
            ? 'Cannot be undone once completed. A refund would be a new payment from the vendor.'
            : 'You, another Agency Admin or the Investor can pause or cancel it until it is paid. Once paid, it cannot be undone.',
          policy: `${
            chosenBudget
              ? `${chosenBudget.name}: per-operation limit ${formatUsd(chosenBudget.perOperationLimit, { withCode: true })}, approved destinations only.`
              : 'Agency account payment, authorized by an Agency Admin.'
          }${payingNow ? '' : ' Checked again when it is paid.'}`,
        }}
        confirmLabel={payingNow ? 'Pay bill' : schedule ? 'Reschedule payment' : 'Schedule payment'}
        // A scheduled payment needs the money there today too: scheduling without it is refused.
        disabled={
          pay.phase === 'idle' && (!accountId || insufficient || (!payingNow && Boolean(scheduleError)))
        }
        phase={pay.phase}
        error={pay.error}
        steps={steps}
        onConfirm={() =>
          pay.run({
            billId: bill.id,
            accountId: chosenBudget ? chosenBudget.sourceAccountId : (accountId ?? undefined),
            budgetId: chosenBudget ? chosenBudget.id : null,
            scheduledFor: firstRunFor(resolved),
          })
        }
        success={{
          title: payingNow ? 'Payment completed' : 'Payment scheduled',
          body: payingNow
            ? 'The bill is paid. Reconcile it to link the payment and its evidence.'
            : `This bill is due to be paid on ${
                schedule
                  ? formatLocalDateTime(schedule.nextRunAt, { withWeekday: true, withZone: true })
                  : 'the scheduled date'
              }. ${paidAtText(timing)}, and the bill is marked paid. Until then you can pause or cancel it here or in Payments ▸ Scheduled.${
                demo ? ' In this demo nothing runs on a timer.' : ''
              }`,
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
              insufficient && anyCovers
                ? `Only ${formatUsd(available, { withCode: true })} available. Choose another source.`
                : undefined
            }
            hint={
              insufficient ? (
                <>
                  No account or budget holds {formatUsd(bill.amount, { withCode: true })} yet. Released
                  funding lands in the Operations account first.{' '}
                  <Link href={href('funding')} className="text-foreground underline-offset-4 hover:underline">
                    Go to Funding
                  </Link>
                </>
              ) : (
                `${formatUsd(available, { withCode: true })} available`
              )
            }
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
          <WhenToPayField
            id="bill-when"
            value={when}
            onChange={setWhen}
            now={clock}
            // A new schedule starts on the bill's due date (at 9:00 on the person's clock) while it is ahead.
            suggested={fromLocalInputs(bill.dueDate.slice(0, 10), '09:00')}
            error={scheduleError}
            disabled={pay.phase !== 'idle'}
          />
          {scheduling && demo ? (
            <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
              This demo is simulated, and nothing runs on a timer: once it is due, press Run due payments in
              Payments ▸ Scheduled.
            </p>
          ) : null}
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
          irreversible: true,
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
      {scheduleSheet.sheet}
    </div>
  )
}

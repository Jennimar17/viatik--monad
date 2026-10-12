'use client'

import { CheckCircle2, FileText, Link2, Send, Sparkles } from 'lucide-react'
import Link from '@/components/viatik/link'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { receiptHref } from '@/components/app/nav'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import { destinationName, receiptFor, recipientName } from '@/domain/queries'
import { daysBetween } from '@/domain/selectors'
import type { Bill, Payment } from '@/domain/types'
import { formatDate } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'
import { cn } from '@/lib/utils'

/** Match score: same vendor and amount, close dates. Deterministic, no AI. */
function score(bill: Bill, payment: Payment) {
  let points = 0
  if (payment.recipient.kind === 'destination' && payment.recipient.destinationId === bill.destinationId)
    points += 50
  if (payment.amount === bill.amount) points += 40
  if (Math.abs(daysBetween(bill.dueDate, payment.completedAt ?? payment.scheduledFor)) <= 20) points += 10
  return points
}

const BEST_MATCH = 90
const SUGGESTED = 50

const optionClass = (selected: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
    selected ? 'border-mist bg-mist/10' : 'border-border hover:bg-muted/40',
  )

export default function ReconcilePage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const reconcile = useCommand('reconcile')
  const [billId, setBillId] = React.useState<string | null>(null)
  const [paymentId, setPaymentId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)
  // The matched pair, kept for the sheet's copy after the bill leaves the list.
  const [matched, setMatched] = React.useState<{ bill: Bill; payment: Payment } | null>(null)

  const reconciledPaymentIds = new Set(state.reconciliations.map((r) => r.paymentId))
  const openBills = state.bills.filter((b) => b.agencyId === agencyId && b.status === 'paid')
  const openPayments = state.payments.filter(
    (p) =>
      p.agencyId === agencyId &&
      p.status === 'completed' &&
      !reconciledPaymentIds.has(p.id) &&
      p.recipient.kind === 'destination' &&
      (p.billId !== undefined || p.type === 'vendor' || p.type === 'tool'),
  )
  const periodBills = state.bills.filter(
    (b) =>
      b.agencyId === agencyId &&
      (b.status === 'paid' || b.status === 'reconciled') &&
      daysBetween(b.issueDate, now) <= 62,
  )
  const reconciledCount = periodBills.filter((b) => b.status === 'reconciled').length
  const progress = periodBills.length ? Math.round((reconciledCount / periodBills.length) * 100) : 100
  const bill = openBills.find((b) => b.id === billId)
  const ranked = (target: Bill) =>
    openPayments.map((p) => ({ payment: p, score: score(target, p) })).sort((a, b) => b.score - a.score)
  const suggestions = bill ? ranked(bill).filter((x) => x.score >= SUGGESTED) : []
  const payment = openPayments.find((p) => p.id === paymentId)
  const sheetPair = matched ?? (bill && payment ? { bill, payment } : null)
  const receipt = receiptFor(state, sheetPair?.payment.receiptId)

  const selectBill = (next: Bill) => {
    setBillId(next.id)
    const best = ranked(next)[0]
    setPaymentId(best && best.score >= BEST_MATCH ? best.payment.id : null)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('bills')} className="hover:text-foreground">
            Bills
          </Link>
        }
        title="Reconciliation"
        description="Link each paid bill to its canonical payment and evidence. Suggestions match vendor, amount, and date."
      />

      <Panel>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              <span className="font-medium">{reconciledCount}</span> of {periodBills.length} bills reconciled
              in the last two months
            </span>
            <span className="text-subtle num">{progress}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-[2px] bg-muted"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Bills reconciled"
          >
            <span className="block h-full bg-sage" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </Panel>

      {openBills.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title="Everything is reconciled"
          description="Paid bills and their payments are all linked to their evidence."
          action={
            <ButtonLink href={href('bills')} variant="outline" size="pill">
              Back to bills
            </ButtonLink>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Paid bills" description="Choose a bill to match.">
            <ul className="flex flex-col gap-2">
              {openBills.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-pressed={billId === b.id}
                    onClick={() => selectBill(b)}
                    className={optionClass(billId === b.id)}
                  >
                    <FileText className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {destinationName(state, b.destinationId)}
                      </span>
                      <span className="text-xs text-subtle">
                        {b.number} · due {formatDate(b.dueDate)}
                      </span>
                    </span>
                    <Amount value={b.amount} size="sm" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel
            title="Payments"
            description={bill ? 'Suggested matches first.' : 'Select a bill to see matching payments.'}
          >
            {bill ? (
              suggestions.length === 0 ? (
                <EmptyState
                  compact
                  title="No matching payment yet"
                  description="Completed payments to this vendor for a similar amount will show here."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {suggestions.map(({ payment: p, score: s }) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-pressed={paymentId === p.id}
                        onClick={() => setPaymentId(p.id)}
                        className={optionClass(paymentId === p.id)}
                      >
                        <Send className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">
                            {recipientName(state, p.recipient)}
                          </span>
                          <span className="truncate text-xs text-subtle">
                            {p.memo} · {formatLocalDate(p.completedAt ?? p.scheduledFor)}
                          </span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <Amount value={p.amount} size="sm" />
                          {s >= BEST_MATCH ? (
                            <span className="flex items-center gap-1 text-2xs text-sage">
                              <Sparkles className="size-3" aria-hidden="true" /> Best match
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <EmptyState
                compact
                title="Select a bill"
                description="Pick a paid bill on the left to see the payments that match it."
              />
            )}
            <Button
              size="pill"
              className="mt-4 w-full"
              disabled={!bill || !payment}
              onClick={() => {
                if (bill && payment) setMatched({ bill, payment })
                setOpen(true)
              }}
            >
              <Link2 data-icon="inline-start" /> Reconcile payment
            </Button>
          </Panel>
        </div>
      )}

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          if (reconcile.phase === 'completed') {
            setBillId(null)
            setPaymentId(null)
          }
          setMatched(null)
          reconcile.reset()
        }}
        title="Reconcile payment"
        summary={{
          what: sheetPair
            ? `Links ${destinationName(state, sheetPair.bill.destinationId)} bill ${sheetPair.bill.number} to its payment and invoice document.`
            : 'Links the bill to its payment and invoice document.',
          amount: sheetPair?.payment.amount,
          reversible: 'Reconciliations stay in the audit trail.',
          policy: 'Every reconciliation references exactly one canonical payment.',
        }}
        confirmLabel="Reconcile payment"
        disabled={!sheetPair}
        phase={reconcile.phase}
        error={reconcile.error}
        onConfirm={() =>
          sheetPair && reconcile.run({ agencyId, paymentId: sheetPair.payment.id, billId: sheetPair.bill.id })
        }
        success={{
          title: 'Payment reconciled',
          body: 'The bill, payment, and supporting evidence are now linked.',
          actions: receipt ? (
            <ButtonLink href={receiptHref(receipt.id)} size="pill-sm">
              View receipt
            </ButtonLink>
          ) : undefined,
        }}
      />
    </div>
  )
}

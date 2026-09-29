'use client'

import { CheckCircle2, CircleAlert } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { FormActions, MoneyInput } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import { categoryLabel, paymentTypeLabel } from '@/domain/labels'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { roleLabel } from '@/domain/permissions'
import { accountName, activeAgreement, receiptFor, userName } from '@/domain/queries'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import type { PaymentType, SpendingCategory } from '@/domain/types'
import { formatDate, fromDateInput } from '@/lib/format'
import { cn } from '@/lib/utils'

const TYPES: PaymentType[] = ['vendor', 'tool', 'contractor', 'team', 'reimbursement']
const TO_MEMBER: ReadonlySet<PaymentType> = new Set(['team', 'contractor', 'reimbursement'])
const defaultCategory: Partial<Record<PaymentType, SpendingCategory>> = {
  team: 'team',
  contractor: 'contractors',
  vendor: 'cloud',
  tool: 'software',
  reimbursement: 'software',
}
const NO_BUDGET = 'none'

type Check = { ok: boolean; text: string }

export default function NewPaymentPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const send = useCommand('sendPayment', { silent: true })
  useBottomBar()

  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const destinations = state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  const people = state.memberships.filter(
    (m) => m.scope.kind === 'agency' && m.scope.agencyId === agencyId && m.status === 'active',
  )
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId && b.status === 'active')
  const agreement = activeAgreement(state, agencyId)

  const [type, setType] = React.useState<PaymentType>('vendor')
  const [recipient, setRecipient] = React.useState<string | null>(null)
  const [accountId, setAccountId] = React.useState<string | null>(
    accounts.find((a) => a.template === 'operations')?.id ?? accounts[0]?.id ?? null,
  )
  const [budgetId, setBudgetId] = React.useState(NO_BUDGET)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [category, setCategory] = React.useState<SpendingCategory>('cloud')
  const [memo, setMemo] = React.useState('')
  const [date, setDate] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [sentId, setSentId] = React.useState<string | null>(null)

  const toMember = TO_MEMBER.has(type)
  const budget = budgets.find((b) => b.id === budgetId)
  const sourceAccountId = budget ? budget.sourceAccountId : accountId
  const available = budget
    ? budgetUsage(state, budget, now).available
    : accountId
      ? accountBalance(state, accountId)
      : ZERO
  const scheduledIso = fromDateInput(date)
  const recipientLabel = recipient
    ? toMember
      ? userName(state, recipient)
      : destinations.find((d) => d.id === recipient)?.name
    : undefined
  const sourceLabel = budget
    ? `${accountName(state, budget.sourceAccountId)} · ${budget.name}`
    : accountName(state, accountId ?? undefined)

  // What the payment is checked against before it is sent.
  const checks: Check[] = []
  if (amount) {
    checks.push({
      ok: amount <= available,
      text:
        amount <= available
          ? `${formatUsd(available, { withCode: true })} available in ${sourceLabel}.`
          : `Only ${formatUsd(available, { withCode: true })} available in ${sourceLabel}.`,
    })
    if (budget) {
      checks.push({
        ok: amount <= budget.perOperationLimit,
        text:
          amount <= budget.perOperationLimit
            ? `Within ${budget.name}’s per-operation limit.`
            : `Exceeds ${budget.name}’s ${formatUsd(budget.perOperationLimit, { withCode: true })} per-operation limit.`,
      })
    }
    if (agreement) {
      const threshold = agreement.spendingPolicy.exceptionThreshold
      checks.push({
        ok: amount <= threshold,
        text:
          amount <= threshold
            ? 'Below the Investor’s exception threshold.'
            : `Above ${formatUsd(threshold, { withCode: true })}: the Investor has to approve it as an exception.`,
      })
    }
  }
  if (budget && recipient && !toMember && budget.allowedDestinationIds.length > 0) {
    const allowed = budget.allowedDestinationIds.includes(recipient)
    checks.push({
      ok: allowed,
      text: allowed
        ? 'Destination approved for this budget.'
        : 'This destination is not approved for this budget.',
    })
  }
  if (budget && !budget.allowedCategories.includes(category)) {
    checks.push({ ok: false, text: `${categoryLabel[category]} is not an approved use of ${budget.name}.` })
  }
  const blocked = checks.some((c) => !c.ok)

  const errors = {
    recipient: recipient ? undefined : toMember ? 'Choose a person.' : 'Choose a payment destination.',
    source: sourceAccountId ? undefined : 'Choose an account.',
    amount: amount ? undefined : 'Enter an amount.',
    memo: memo.trim().length >= 3 ? undefined : 'Say what this payment is for.',
    date: date && scheduledIso && scheduledIso <= now ? 'Choose a date in the future.' : undefined,
  }
  const valid = !Object.values(errors).some(Boolean) && !blocked
  const sent = state.payments.find((p) => p.id === sentId)
  const receipt = receiptFor(state, sent?.receiptId)

  const changeType = (next: PaymentType) => {
    setType(next)
    setRecipient(null)
    setCategory(defaultCategory[next] ?? 'software')
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('payments')} className="hover:text-foreground">
            Payments
          </Link>
        }
        title="Send payment"
        description="Pay a team member, contractor, or approved vendor from an account or budget."
      />

      <Panel title="Who are you paying?">
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment type">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => changeType(t)}
                className={cn(
                  'h-9 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  type === t
                    ? 'border-mist bg-mist/10 text-foreground'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {paymentTypeLabel[t]}
              </button>
            ))}
          </div>
          <FormField
            label={toMember ? 'Team member' : 'Vendor or service'}
            htmlFor="recipient"
            error={touched ? errors.recipient : undefined}
          >
            <SimpleSelect
              id="recipient"
              value={recipient}
              onValueChange={setRecipient}
              invalid={touched && Boolean(errors.recipient)}
              options={
                toMember
                  ? people.map((m) => ({
                      value: m.userId,
                      label: userName(state, m.userId),
                      description: roleLabel[m.role],
                    }))
                  : destinations.map((d) => ({ value: d.id, label: d.name, description: d.settlementLabel }))
              }
              placeholder={toMember ? 'Choose a person' : 'Choose a payment destination'}
            />
          </FormField>
        </div>
      </Panel>

      <Panel title="From where, and how much?">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Budget" htmlFor="budget" hint="Paying from a budget applies its rules.">
              <SimpleSelect
                id="budget"
                value={budgetId}
                onValueChange={setBudgetId}
                options={[
                  { value: NO_BUDGET, label: 'No budget, pay from an account' },
                  ...budgets.map((b) => ({
                    value: b.id,
                    label: b.name,
                    description: `${formatUsd(budgetUsage(state, b, now).available)} available`,
                  })),
                ]}
              />
            </FormField>
            {budget ? null : (
              <FormField label="Account" htmlFor="account" error={touched ? errors.source : undefined}>
                <SimpleSelect
                  id="account"
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
          </div>
          <FormField label="Amount" htmlFor="amount" error={touched ? errors.amount : undefined}>
            <MoneyInput
              id="amount"
              value={amount}
              onChange={setAmount}
              available={available}
              invalid={(touched && Boolean(errors.amount)) || Boolean(amount && amount > available)}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Category" htmlFor="category">
              <SimpleSelect
                id="category"
                value={category}
                onValueChange={(v) => setCategory(v as SpendingCategory)}
                options={(Object.keys(categoryLabel) as SpendingCategory[]).map((c) => ({
                  value: c,
                  label: categoryLabel[c],
                }))}
              />
            </FormField>
            <FormField
              label="Payment date"
              htmlFor="date"
              optional
              error={errors.date}
              hint="Leave empty to pay now."
            >
              <PillInput
                id="date"
                type="date"
                value={date}
                aria-invalid={Boolean(errors.date) || undefined}
                onChange={(e) => setDate(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Memo" htmlFor="memo" error={touched ? errors.memo : undefined}>
            <PillInput
              id="memo"
              value={memo}
              aria-invalid={(touched && Boolean(errors.memo)) || undefined}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="e.g. September contractor payment"
            />
          </FormField>
        </div>
      </Panel>

      {checks.length > 0 ? (
        <Panel title="Policy check" description="Checked again at settlement.">
          <ul className="flex flex-col gap-2">
            {checks.map((c) => (
              <li key={c.text} className="flex items-start gap-2 text-sm text-muted-foreground">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                )}
                <span className="text-pretty">{c.text}</span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('payments'))}>
          Cancel
        </Button>
        <Button
          size="pill-sm"
          disabled={blocked}
          onClick={() => {
            setTouched(true)
            if (valid) setOpen(true)
          }}
        >
          Review payment
        </Button>
      </FormActions>

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          send.reset()
          if (sentId) router.push(href('payments'))
        }}
        title={scheduledIso ? 'Schedule payment' : 'Send payment'}
        summary={{
          what: scheduledIso
            ? `${recipientLabel} is paid on ${formatDate(scheduledIso)}.`
            : `${recipientLabel} is paid now.`,
          amount: amount ?? undefined,
          from: sourceLabel,
          to: recipientLabel,
          reversible: 'Cannot be undone once completed. A refund would be a new payment.',
          policy: budget
            ? `${budget.name}: per-operation limit ${formatUsd(budget.perOperationLimit, { withCode: true })}, approved destinations only.`
            : 'Agency account payment, authorized by an Agency Admin.',
        }}
        confirmLabel={scheduledIso ? 'Schedule payment' : 'Send payment'}
        phase={send.phase}
        error={send.error}
        onConfirm={async () => {
          if (!recipient || !sourceAccountId || !amount) return
          const payment = await send.run({
            agencyId,
            type,
            recipient: toMember
              ? { kind: 'member', userId: recipient }
              : { kind: 'destination', destinationId: recipient },
            accountId: sourceAccountId,
            budgetId: budget?.id,
            amount,
            category,
            memo: memo.trim(),
            scheduledFor: scheduledIso,
          })
          if (payment) setSentId(payment.id)
        }}
        success={{
          title: scheduledIso ? 'Payment scheduled' : 'Payment completed',
          body: scheduledIso
            ? `${formatUsd(amount ?? ZERO, { withCode: true })} goes to ${recipientLabel} on ${formatDate(scheduledIso)}.`
            : `${formatUsd(amount ?? ZERO, { withCode: true })} was paid to ${recipientLabel}. The payment and its receipt are now connected.`,
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

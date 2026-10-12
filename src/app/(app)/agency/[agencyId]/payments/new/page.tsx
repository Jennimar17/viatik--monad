'use client'

import { CheckCircle2, CircleAlert, Info } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect, useChoice } from '@/components/app/form-controls'
import { AddDestinationButton, CreateOperationsAccount, EmptySourceHint } from '@/components/app/money-setup'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import {
  firstRunFor,
  paidAtText,
  PAY_NOW,
  resolveWhen,
  scheduleChoice,
  triedAgainText,
  useClock,
  usePayTiming,
  whenText,
  WhenToPayField,
  type WhenChoice,
} from '@/components/app/schedules'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { FormActions, MoneyInput } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import type { SendPaymentInput } from '@/domain/engine'
import { categoryLabel, paymentTypeLabel, scheduleCadenceLabel } from '@/domain/labels'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { roleLabel } from '@/domain/permissions'
import { accountName, governingAgreement, payablePeople, receiptFor, userName } from '@/domain/queries'
import { isUnscheduledPayment } from '@/domain/schedules'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import type { Id, SpendingCategory, ViatikRecipient, ViatikState } from '@/domain/types'
import { formatLocalDateTime } from '@/lib/local-time'
import { cn } from '@/lib/utils'

/** What an Admin can send here (money for purchases only comes from a Member's request). */
type SendType = SendPaymentInput['type']

const TYPES: SendType[] = ['vendor', 'tool', 'contractor', 'team', 'reimbursement']
const TO_MEMBER: ReadonlySet<SendType> = new Set(['team', 'contractor', 'reimbursement'])
const defaultCategory: Partial<Record<SendType, SpendingCategory>> = {
  team: 'team',
  contractor: 'contractors',
  vendor: 'cloud',
  tool: 'software',
  reimbursement: 'software',
}
const NO_BUDGET = 'none'

type Check = { ok: boolean; text: string }

/** What a payment to schedule again starts with: a cancelled schedule's, or an old never-paid payment's. */
type Draft = {
  type: SendType
  recipient: ViatikRecipient
  accountId: Id
  budgetId?: Id
  amount: Cents
  category: SpendingCategory
  memo: string
  /** A payment saved as scheduled before schedules existed: the new schedule replaces it. */
  replacesPaymentId?: Id
}

/**
 * `?again=<id>`: a scheduled payment of this Agency (cancelled, or stopped) or a payment saved as
 * scheduled before scheduled payments ran automatically (which the new schedule then replaces).
 * Bills are scheduled again from the bill.
 */
function draftFrom(state: ViatikState, agencyId: Id, id: string | null): Draft | undefined {
  if (!id) return undefined
  const legacy = state.payments.find((p) => p.id === id && p.agencyId === agencyId && !p.billId)
  const source = state.schedules.find((s) => s.id === id && s.agencyId === agencyId && !s.billId) ?? legacy
  if (!source) return undefined
  const recipient = source.recipient
  if (recipient.kind === 'address') return undefined
  const type = source.type as SendType
  if (!TYPES.includes(type)) return undefined
  return {
    type,
    recipient,
    accountId: source.sourceAccountId,
    budgetId: source.budgetId,
    amount: source.amount,
    category: source.category,
    memo: source.memo,
    ...(legacy && source === legacy && isUnscheduledPayment(legacy) ? { replacesPaymentId: legacy.id } : {}),
  }
}

export default function NewPaymentPage() {
  // useSearchParams (`?again=`, `?when=schedule`) needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <NewPaymentForQuery />
    </React.Suspense>
  )
}

/** A new query (e.g. "Schedule again" on another payment) starts a fresh form: its fields are prefilled once. */
function NewPaymentForQuery() {
  const params = useSearchParams()
  return <NewPayment key={params.toString()} />
}

/**
 * Send payment: an Agency Admin pays a team member, contractor or approved
 * vendor from an account or a budget, now or scheduled for a date and time on
 * their own clock (or "In 5 minutes"). A scheduled payment is authorized now,
 * needs the money there today, and is paid when due (within about 10 minutes
 * once the timer runs, otherwise when an Agency Admin runs due payments:
 * `usePayTiming`). Links prefill it: `?when=schedule`,
 * `?again=<scheduleId|paymentId>`.
 */
function NewPayment() {
  const { state, now, mode, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const params = useSearchParams()
  const clock = useClock()
  const timing = usePayTiming(clock)
  const send = useCommand('sendPayment', { silent: true })
  const schedule = useCommand('schedulePayment', { silent: true })
  useBottomBar()

  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const destinations = state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  // Everyone in the Agency but you: nobody pays themselves.
  const people = payablePeople(state, agencyId, userId)
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId && b.status === 'active')
  // The agreement whose exception threshold the engine and the contract apply.
  const agreement = governingAgreement(state, agencyId)

  // What the link asked for. A different query remounts the form (NewPaymentForQuery).
  const [draft] = React.useState(() => draftFrom(state, agencyId, params.get('again')))
  // Its payee, while they can still be paid (still in the Agency, or still an approved vendor).
  const draftPayee = draft?.recipient
  const draftRecipient =
    draftPayee?.kind === 'member'
      ? people.some((m) => m.userId === draftPayee.userId)
        ? draftPayee.userId
        : null
      : draftPayee?.kind === 'destination' && destinations.some((d) => d.id === draftPayee.destinationId)
        ? draftPayee.destinationId
        : null

  const [type, setType] = React.useState<SendType>(draft?.type ?? 'vendor')
  const [recipient, setRecipient] = React.useState<string | null>(draftRecipient)
  const [accountId, setAccountId] = useChoice(
    accounts.map((a) => a.id),
    (draft && !draft.budgetId && accounts.some((a) => a.id === draft.accountId)
      ? draft.accountId
      : undefined) ??
      accounts.find((a) => a.template === 'operations')?.id ??
      accounts[0]?.id,
  )
  const [budgetId, setBudgetId] = React.useState(
    draft?.budgetId && budgets.some((b) => b.id === draft.budgetId) ? draft.budgetId : NO_BUDGET,
  )
  const [amount, setAmount] = React.useState<Cents | null>(draft?.amount ?? null)
  const [category, setCategory] = React.useState<SpendingCategory>(draft?.category ?? 'cloud')
  const [memo, setMemo] = React.useState(draft?.memo ?? '')
  const [when, setWhen] = React.useState<WhenChoice>(() =>
    draft || params.get('when') === 'schedule' ? scheduleChoice(clock) : PAY_NOW,
  )
  const [touched, setTouched] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [sent, setSent] = React.useState<{ kind: 'payment' | 'schedule'; id: Id } | null>(null)

  const resolved = resolveWhen(when, clock)
  const scheduling = resolved.scheduled
  // The command the sheet runs: scheduling never falls back to paying now.
  const command = scheduling ? schedule : send
  const steps = useSigningSteps(command.phase, {
    prepared: scheduling
      ? "Viatik checks the payment against its source's limits and the ledger's rules, and that the money is there today."
      : "Viatik checks the payment against its source's limits and the ledger's rules.",
    done: scheduling
      ? {
          label: 'Scheduled',
          detail:
            timing === 'automatic'
              ? 'Recorded on Monad. Viatik pays it when it is due.'
              : 'Recorded on Monad. It is paid once it is due and due payments run.',
        }
      : { label: 'Paid', detail: 'Recorded on Monad, with its receipt.' },
  })

  const toMember = TO_MEMBER.has(type)
  const budget = budgets.find((b) => b.id === budgetId)
  const sourceAccountId = budget ? budget.sourceAccountId : accountId
  const available = budget
    ? budgetUsage(state, budget, now).available
    : accountId
      ? accountBalance(state, accountId)
      : ZERO
  const recipientLabel = recipient
    ? toMember
      ? userName(state, recipient)
      : destinations.find((d) => d.id === recipient)?.name
    : undefined
  const sourceLabel = budget
    ? `${accountName(state, budget.sourceAccountId)} · ${budget.name}`
    : accountName(state, accountId ?? undefined)

  // What the payment is checked against before it is sent (or scheduled: the money must be there today too).
  const checks: Check[] = []
  if (amount) {
    checks.push({
      ok: amount <= available,
      text:
        amount <= available
          ? scheduling
            ? `${formatUsd(available, { withCode: true })} available in ${sourceLabel} today. It must still be there when it is paid.`
            : `${formatUsd(available, { withCode: true })} available in ${sourceLabel}.`
          : scheduling
            ? `Only ${formatUsd(available, { withCode: true })} available in ${sourceLabel}. A scheduled payment needs the money there today.`
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
    when: resolved.scheduled ? resolved.error : undefined,
  }
  const valid = !Object.values(errors).some(Boolean) && !blocked
  const paid = sent?.kind === 'payment' ? state.payments.find((p) => p.id === sent.id) : undefined
  const scheduled = sent?.kind === 'schedule' ? state.schedules.find((s) => s.id === sent.id) : undefined
  // What the sheet finished: its result arrives only after the state reloads, but the phase it
  // shows is `command`'s, so a schedule is never announced as "paid" in between.
  const doneKind =
    sent?.kind ?? (command.phase === 'completed' ? (scheduling ? 'schedule' : 'payment') : undefined)
  const receipt = receiptFor(state, paid?.receiptId)
  const demo = mode === 'demo'
  const usd = formatUsd(amount ?? ZERO, { withCode: true })

  const changeType = (next: SendType) => {
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
        description="Pay a team member, contractor, or approved vendor from an account or budget, now or on a date you choose."
      />

      {draft ? (
        <div className="flex gap-3 rounded-xl border border-info/30 bg-info-soft p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">
            <span className="font-medium text-foreground">Scheduling again</span>: the payee, source, amount
            and memo come from the payment that was not paid. Choose when to pay it and review it.
            {draftRecipient ? '' : ' Its payee is no longer available, so choose who to pay.'}
            {draft.replacesPaymentId
              ? ' Once scheduled, it replaces the old payment in Not scheduled. If you pay it now instead, dismiss the old one there.'
              : ''}
          </p>
        </div>
      ) : null}

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
            <div className="flex flex-col gap-2">
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
                    : destinations.map((d) => ({
                        value: d.id,
                        label: d.name,
                        description: d.settlementLabel,
                      }))
                }
                placeholder={toMember ? 'Choose a person' : 'Choose a payment destination'}
                empty={toMember ? 'No team members yet' : 'No payment destinations yet'}
              />
              {toMember ? null : (
                <AddDestinationButton
                  agencyId={agencyId}
                  onAdded={(destination) => setRecipient(destination.id)}
                />
              )}
            </div>
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
              <FormField
                label="Account"
                htmlFor={accounts.length > 0 ? 'account' : undefined}
                error={touched ? errors.source : undefined}
                hint={
                  accountId && accountBalance(state, accountId) === 0 ? (
                    <EmptySourceHint name={accountName(state, accountId)} fundingHref={href('funding')} />
                  ) : undefined
                }
              >
                {accounts.length === 0 ? (
                  <CreateOperationsAccount
                    agencyId={agencyId}
                    description="Payments come out of an Agency account. Released funding lands there."
                    onCreated={setAccountId}
                  />
                ) : (
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
                )}
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
        </div>
      </Panel>

      <Panel
        title="When?"
        description="Pay now, or schedule it: it is authorized now and paid when it is due."
      >
        <WhenToPayField id="when" value={when} onChange={setWhen} now={clock} error={errors.when} />
      </Panel>

      {checks.length > 0 ? (
        <Panel
          title="Policy check"
          description={scheduling ? 'Checked again when it is paid.' : 'Checked again at settlement.'}
        >
          <ul className="flex flex-col gap-2">
            {checks.map((c) => (
              <li key={c.text} className="flex items-start gap-2 text-sm text-muted-foreground">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                )}
                <span className="text-pretty">
                  <span className="sr-only">{c.ok ? 'Passes: ' : 'Blocks the payment: '}</span>
                  {c.text}
                </span>
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
          {scheduling ? 'Review scheduled payment' : 'Review payment'}
        </Button>
      </FormActions>

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          send.reset()
          schedule.reset()
          if (doneKind) router.push(href(doneKind === 'schedule' ? 'payments?tab=scheduled' : 'payments'))
        }}
        title={scheduling ? 'Schedule payment' : 'Send payment'}
        summary={{
          what: scheduling
            ? `${recipientLabel} is paid ${whenText(resolved)}. ${paidAtText(timing)}.`
            : `${recipientLabel} is paid now.`,
          amount: amount ?? undefined,
          from: sourceLabel,
          to: recipientLabel,
          reversible: scheduling
            ? 'You, another Agency Admin or the Investor can pause or cancel it until it is paid. Once paid, it cannot be undone.'
            : 'Cannot be undone once completed. A refund would be a new payment.',
          policy: `${
            budget
              ? `${budget.name}: per-operation limit ${formatUsd(budget.perOperationLimit, { withCode: true })}, approved destinations only.`
              : 'Agency account payment, authorized by an Agency Admin.'
          }${scheduling ? ' Checked again when it is paid.' : ''}`,
        }}
        confirmLabel={scheduling ? 'Schedule payment' : 'Send payment'}
        disabled={command.phase === 'idle' && !valid}
        phase={command.phase}
        error={command.error}
        steps={steps}
        onConfirm={async () => {
          if (!recipient || !sourceAccountId || !amount) return
          const input = {
            agencyId,
            type,
            recipient: toMember
              ? ({ kind: 'member', userId: recipient } as const)
              : ({ kind: 'destination', destinationId: recipient } as const),
            accountId: sourceAccountId,
            budgetId: budget?.id,
            amount,
            category,
            memo: memo.trim(),
          }
          const firstRunAt = firstRunFor(resolved)
          if (firstRunAt) {
            // "Schedule again" on an old never-paid payment: the new schedule replaces it (if it is still there).
            const replaces = draft?.replacesPaymentId
            const replacing =
              replaces && state.payments.some((p) => p.id === replaces && isUnscheduledPayment(p))
                ? { replacesPaymentId: replaces }
                : {}
            const created = await schedule.run({ ...input, firstRunAt, ...replacing })
            if (created) setSent({ kind: 'schedule', id: created.id })
            return
          }
          const payment = await send.run(input)
          if (payment) setSent({ kind: 'payment', id: payment.id })
        }}
        success={{
          title: doneKind === 'schedule' ? 'Payment scheduled' : 'Payment completed',
          body:
            doneKind === 'schedule' ? (
              <>
                {usd} goes to {recipientLabel} on{' '}
                {scheduled
                  ? formatLocalDateTime(scheduled.nextRunAt, { withWeekday: true, withZone: true })
                  : 'the scheduled date'}
                . {paidAtText(timing)}, if the money is there; it shows in Payments ▸ Scheduled until then.
                {demo ? ' In this demo nothing runs on a timer.' : ''}
              </>
            ) : (
              `${usd} was paid to ${recipientLabel}. The payment and its receipt are now connected.`
            ),
          actions:
            doneKind === 'schedule' ? (
              <ButtonLink href={href('payments?tab=scheduled')} size="pill-sm">
                See scheduled payments
              </ButtonLink>
            ) : receipt ? (
              <>
                <ButtonLink href={receiptHref(receipt.id)} size="pill-sm">
                  View receipt
                </ButtonLink>
                <ReceiptDetailsButton receipt={receipt} />
              </>
            ) : undefined,
        }}
      >
        {scheduling ? (
          <>
            <KeyValueList
              dense
              items={[
                {
                  label: 'When',
                  value: resolved.at
                    ? formatLocalDateTime(resolved.at, { withWeekday: true, withYear: true, withZone: true })
                    : '—',
                  hint: resolved.quick ? 'Counted from when you confirm' : 'Your time zone',
                },
                { label: 'Repeats', value: scheduleCadenceLabel({ intervalSeconds: 0, runs: 1 }) },
                { label: 'Category', value: categoryLabel[category] },
                { label: 'Memo', value: memo.trim() },
              ]}
            />
            <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
              {demo
                ? 'This demo is simulated, and nothing runs on a timer: once it is due, press Run due payments in Payments ▸ Scheduled.'
                : `If the money is not in ${sourceLabel} then, nothing is paid and the Agency Admins are told. ${triedAgainText(timing)}`}
            </p>
          </>
        ) : null}
      </ApprovalSheet>
    </div>
  )
}

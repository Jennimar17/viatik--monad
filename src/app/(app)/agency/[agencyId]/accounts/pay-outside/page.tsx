'use client'

import { CalendarClock, CheckCircle2, CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import {
  AddressConfirm,
  AddressField,
  useAddressEntry,
  type KnownAddress,
} from '@/components/app/address-field'
import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect, useChoice, type Option } from '@/components/app/form-controls'
import { KimiReader, proposalAmount, type EvidenceReadProposal } from '@/components/app/kimi-reader'
import { sameAddress, useOwnAccount } from '@/components/app/member-own-account'
import { CreateOperationsAccount, EmptySourceHint } from '@/components/app/money-setup'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { NewReminderSheet, type ReminderDraft } from '@/components/app/reminders'
import { useHref, usePermissions, useRole, type ScreenTarget } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import {
  EvidenceUploader,
  FormActions,
  MoneyInput,
  pendingUploads,
  toEvidence,
  type DraftFile,
} from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import Link from '@/components/viatik/link'
import { CopyButton } from '@/components/viatik/operation'
import { useCommand, useEvidenceFiles, useLedger, useViatikState } from '@/data/react'
import { paidAt, PROOF_WITHIN_DAYS, remindersDue } from '@/domain/accountability'
import { shortAddress } from '@/domain/address'
import { categoryLabel } from '@/domain/labels'
import { cents, formatUsd, ZERO, type Cents } from '@/domain/money'
import { accountName, exceptionThresholdOf, receiptFor, userName } from '@/domain/queries'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import type { Budget, Reminder, SpendingCategory } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { formatDate } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

const NO_BUDGET = 'none'
const ALL_CATEGORIES = Object.keys(categoryLabel) as SpendingCategory[]
const monthOf = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

type Check = { ok: boolean; text: string }

/** Why a budget cannot pay outside Viatik (the engine refuses it), or undefined when it can. */
function budgetBlock(budget: Budget): string | undefined {
  if (budget.status === 'paused') return 'Paused'
  if (budget.status !== 'active') return 'No longer active'
  if (budget.allowedDestinationIds.length > 0) return 'Only pays its approved vendors'
  return undefined
}

/** The same reason, as a sentence about the budget. */
function budgetBlockText(budget: Budget): string {
  if (budget.status === 'paused') return `${budget.name} is paused. New payments from it are on hold.`
  if (budget.status !== 'active') return `${budget.name} is no longer active.`
  return `${budget.name} only pays its approved vendors. Pay from an account instead.`
}

export default function PayOutsidePage() {
  // useSearchParams needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <PayOutsideForQuery />
    </React.Suspense>
  )
}

/**
 * A new query (e.g. ⌘K ▸ "Pay outside Viatik" while a monthly payment's "Pay now" is open) starts
 * a fresh form: its fields are prefilled once from the link, so they would otherwise keep the old values.
 */
function PayOutsideForQuery() {
  const params = useSearchParams()
  return <PayOutside key={params.toString()} />
}

/**
 * Pay outside Viatik: an Agency Admin pays an address that is not in Viatik
 * (a tool, a subscription) from an Agency account or an open budget. The
 * address is confirmed in full, the same limits as any payment apply, nothing
 * goes above the Investor's exception threshold, and the invoice comes now or
 * within PROOF_WITHIN_DAYS days. Links prefill it: `?from=<accountId>`,
 * `?budget=<budgetId>`, `?reminder=<reminderId>` (a monthly payment's "Pay now").
 */
function PayOutside() {
  const { state, now, userId, mode } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const params = useSearchParams()
  const { can } = usePermissions()
  const { view } = useLedger()
  const evidenceFiles = useEvidenceFiles()
  const own = useOwnAccount()
  const pay = useCommand('payOutside', { silent: true })
  const steps = useSigningSteps(pay.phase, {
    prepared: "Viatik checks the payment against its source's limits and the ledger's rules.",
    done: { label: 'Sent', detail: 'Recorded on Monad and sent to the address.' },
  })
  useBottomBar()

  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const budgets = state.budgets.filter(
    (b) => b.agencyId === agencyId && (b.status === 'active' || b.status === 'paused'),
  )

  // What the link asked for. A different query remounts the form (PayOutsideForQuery).
  const fromParam = accounts.find((a) => a.id === params.get('from'))
  const budgetParam = budgets.find((b) => b.id === params.get('budget'))
  const linkedReminder = state.reminders.find(
    (r) => r.id === params.get('reminder') && r.agencyId === agencyId,
  )
  // Only an active monthly payment can be paid for (the engine refuses the others).
  const reminder = linkedReminder?.status === 'active' ? linkedReminder : undefined
  const reminderDue = remindersDue(state, agencyId, now).find((r) => r.reminder.id === reminder?.id)
  const lastRecipient = reminderDue?.lastPayment?.recipient
  const lastAddress = lastRecipient?.kind === 'address' ? lastRecipient.address : undefined

  // Addresses this Agency paid outside Viatik before, newest first, one per payee and address.
  const previous = React.useMemo(() => {
    const seen = new Set<string>()
    return state.payments
      .filter((p) => p.agencyId === agencyId && p.recipient.kind === 'address' && p.recipient.address)
      .sort((a, b) => Date.parse(paidAt(b)) - Date.parse(paidAt(a)))
      .flatMap((p) => {
        if (p.recipient.kind !== 'address' || !p.recipient.address) return []
        const key = `${p.recipient.payee}|${p.recipient.address.toLowerCase()}`
        if (seen.has(key)) return []
        seen.add(key)
        return [{ key, payee: p.recipient.payee, address: p.recipient.address, paidAt: paidAt(p) }]
      })
  }, [state.payments, agencyId])

  // A team member's saved address or the Admin's own Viatik account are worth a word, never a block.
  const known: KnownAddress[] = [
    {
      address: own.address,
      note: 'This is your own Viatik account. Money sent here stays with you: it does not pay anyone.',
    },
    ...state.payoutAddresses
      .filter((a) => a.userId !== userId)
      .map((a) => ({
        address: a.address,
        note: `This is ${userName(state, a.userId)}’s saved address. To pay a team member, use Pay team.`,
      })),
  ]
  const entry = useAddressEntry({ initial: lastAddress, known })

  const [payee, setPayee] = React.useState(reminder?.payee ?? '')
  const [budgetId, setBudgetId] = React.useState(
    budgetParam && !budgetBlock(budgetParam) ? budgetParam.id : NO_BUDGET,
  )
  const reminderAccount = accounts.find((a) => a.id === reminder?.sourceAccountId)
  const [accountId, setAccountId] = useChoice(
    accounts.map((a) => a.id),
    fromParam?.id ??
      reminderAccount?.id ??
      accounts.find((a) => a.template === 'operations')?.id ??
      accounts[0]?.id,
  )
  const [amount, setAmount] = React.useState<Cents | null>(reminder?.amount ?? null)
  const [memo, setMemo] = React.useState(
    reminder && reminderDue ? `${reminder.title}, ${monthOf.format(new Date(reminderDue.dueAt))}` : '',
  )
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [touched, setTouched] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [sent, setSent] = React.useState<{ paymentId: string; withInvoice: boolean } | null>(null)
  // "Create a monthly payment" from an invoice Kimi read: the usual sheet, filled in (a new draft per click).
  const [reminderDraft, setReminderDraft] = React.useState<ReminderDraft | undefined>(undefined)
  const [reminderOpen, setReminderOpen] = React.useState(false)
  // The monthly payment created that way: this payment is made for it (the first of its payments).
  const [createdReminder, setCreatedReminder] = React.useState<Reminder | null>(null)

  const budget = budgets.find((b) => b.id === budgetId)
  const blockedBudget = budget ? budgetBlock(budget) : undefined
  const categories = budget ? budget.allowedCategories : ALL_CATEGORIES
  const preferred = reminder?.category ?? 'software'
  const [categoryChoice, setCategory] = useChoice(
    categories,
    categories.includes(preferred) ? preferred : categories[0],
  )
  const category = (categoryChoice ?? categories[0]) as SpendingCategory | undefined

  const sourceAccountId = budget ? budget.sourceAccountId : accountId
  const available = budget
    ? budgetUsage(state, budget, now).available
    : accountId
      ? accountBalance(state, accountId)
      : ZERO
  const sourceLabel = budget
    ? `${accountName(state, budget.sourceAccountId)} · ${budget.name}`
    : accountName(state, accountId ?? undefined)
  const threshold = exceptionThresholdOf(state, agencyId)
  const usd = (value: Cents) => formatUsd(value, { withCode: true })

  // What the payment is checked against before it is sent; the ledger checks it again.
  const checks: Check[] = []
  if (budget && blockedBudget) checks.push({ ok: false, text: budgetBlockText(budget) })
  if (amount) {
    checks.push({
      ok: amount <= available,
      text:
        amount <= available
          ? `${usd(available)} available in ${sourceLabel}.`
          : `Only ${usd(available)} available in ${sourceLabel}.`,
    })
    if (budget) {
      checks.push({
        ok: amount <= budget.perOperationLimit,
        text:
          amount <= budget.perOperationLimit
            ? `Within the per-operation limit of ${budget.name}.`
            : `Above the ${usd(budget.perOperationLimit)} per-operation limit of ${budget.name}.`,
      })
    }
    if (threshold !== undefined) {
      checks.push({
        ok: amount <= threshold,
        text:
          amount <= threshold
            ? `Within the Investor’s exception threshold of ${usd(threshold)}.`
            : `Above the Investor’s exception threshold of ${usd(threshold)}. Payments outside Viatik cannot go above it.`,
      })
    }
  }
  const blocked = checks.some((c) => !c.ok)
  const waiting = pendingUploads(files)

  const errors = {
    payee: payee.trim() ? undefined : 'Enter who you are paying.',
    address: entry.error ?? (entry.address ? undefined : 'Enter the address to pay.'),
    confirm:
      entry.address && !entry.confirmed ? 'Confirm the address before you review the payment.' : undefined,
    source: sourceAccountId ? undefined : 'Choose an account.',
    amount: amount ? undefined : 'Enter an amount.',
    category: category ? undefined : 'Choose a category.',
    memo: memo.trim() ? undefined : 'Say what this payment is for.',
  }
  const valid = !Object.values(errors).some(Boolean) && !blocked && !waiting
  const file = files[0]

  const demo = mode === 'demo'
  const monad = view?.settlement === 'monad' ? view : null
  const testLedger = !demo && view?.settlement === 'demo'
  const paused = Boolean(monad && !monad.available)
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)

  // Back where the person came from: the monthly payment, the budget or the account.
  const origin: ScreenTarget | null = linkedReminder
    ? 'bills?tab=monthly'
    : budgetParam
      ? `budgets/${budgetParam.id}`
      : fromParam
        ? `accounts/${fromParam.id}`
        : null
  const canRemind = can('manage_reminders', { agencyId })
  // The one created from Kimi's reading, as it is now, while it can still be paid for (active).
  const newReminder = createdReminder
    ? (state.reminders.find((r) => r.id === createdReminder.id) ?? createdReminder)
    : undefined
  const madeFor = reminder ?? (newReminder?.status === 'active' ? newReminder : undefined)

  // Kimi's reading of the invoice, once the person chose to use it: payee, amount and what it pays.
  // The address is never taken from a document: the person enters and confirms it.
  const applyReading = (proposal: EvidenceReadProposal) => {
    if (proposal.merchant) setPayee(proposal.merchant)
    const read = proposalAmount(proposal)
    if (read !== null) setAmount(read)
    if (!memo.trim() && (proposal.merchant || proposal.date)) {
      const what = proposal.merchant ?? 'Invoice'
      setMemo(`${what}${proposal.date ? `, invoice of ${formatDate(proposal.date)}` : ''}`.slice(0, 500))
    }
  }
  const createReminderFrom = (proposal: EvidenceReadProposal) => {
    const suggested = proposal.reminder
    if (!suggested) return
    setReminderDraft({
      title: suggested.title,
      payee: payee.trim() || suggested.payee,
      amount: amount ?? (suggested.amount !== null ? cents(suggested.amount) : null),
      category: category ?? 'software',
      dayOfMonth: suggested.dayOfMonth,
      sourceAccountId: sourceAccountId ?? undefined,
    })
    setReminderOpen(true)
  }

  const paid = state.payments.find((p) => p.id === sent?.paymentId)
  const receipt = receiptFor(state, paid?.receiptId)
  const paidTo = paid?.recipient.kind === 'address' ? paid.recipient : undefined

  if (!can('pay_outside', { agencyId })) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Pay outside Viatik" />
        <EmptyState
          title="Only Agency Admins pay outside Viatik"
          description="Ask an Agency Admin to make this payment."
        />
      </div>
    )
  }

  const budgetOptions: Option[] = [
    { value: NO_BUDGET, label: 'No budget, pay from an account' },
    ...budgets.map((b) => {
      const reason = budgetBlock(b)
      return {
        value: b.id,
        label: b.name,
        description: reason ?? `${formatUsd(budgetUsage(state, b, now).available)} available`,
        disabled: Boolean(reason),
      }
    }),
  ]
  const paidBefore = previous.find(
    (p) => p.payee === payee.trim() && sameAddress(p.address, entry.typed.trim()),
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('accounts')} className="hover:text-foreground">
            Accounts
          </Link>
        }
        title="Pay outside Viatik"
        description={`Pay an address that is not in Viatik, such as a tool or a subscription. Add its invoice now or within ${PROOF_WITHIN_DAYS} days.`}
      />

      {reminder ? (
        <div className="flex gap-3 rounded-xl border border-info/30 bg-info-soft p-4 text-sm">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">
            <span className="font-medium text-foreground">For the monthly payment “{reminder.title}”</span>
            {reminderDue ? `, due ${formatDate(reminderDue.dueAt)}` : ''}. The payee, amount and category come
            from it.{' '}
            {lastAddress
              ? 'The address is the one you paid last time: check it and confirm it again.'
              : 'It was never paid before, so enter the address.'}
          </p>
        </div>
      ) : linkedReminder ? (
        <div className="flex gap-3 rounded-xl border border-border bg-mist/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">
            “{linkedReminder.title}” is {linkedReminder.status === 'paused' ? 'paused' : 'archived'}, so this
            payment will not count for it.
            {linkedReminder.status === 'paused' ? ' Resume it in Bills ▸ Monthly first if it should.' : ''}
          </p>
        </div>
      ) : null}

      {budgetParam && budgetBlock(budgetParam) ? (
        <div className="flex gap-3 rounded-xl border border-border bg-mist/5 p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">{budgetBlockText(budgetParam)}</p>
        </div>
      ) : null}

      <Panel title="Who are you paying?">
        <div className="flex flex-col gap-5">
          {previous.length > 0 ? (
            <FormField
              label="Someone you paid before"
              htmlFor="paid-before"
              optional
              hint="Fills in the payee and the address. You still confirm the address."
            >
              <SimpleSelect
                id="paid-before"
                value={paidBefore?.key ?? null}
                placeholder="Choose a payee"
                onValueChange={(key) => {
                  const choice = previous.find((p) => p.key === key)
                  if (!choice) return
                  setPayee(choice.payee)
                  entry.setTyped(choice.address)
                }}
                options={previous.map((p) => ({
                  value: p.key,
                  label: p.payee,
                  description: `${shortAddress(p.address)} · last paid ${formatLocalDate(p.paidAt)}`,
                }))}
              />
            </FormField>
          ) : null}
          <FormField label="Payee" htmlFor="payee" error={touched ? errors.payee : undefined}>
            <PillInput
              id="payee"
              value={payee}
              maxLength={120}
              aria-invalid={(touched && Boolean(errors.payee)) || undefined}
              onChange={(event) => setPayee(event.target.value)}
              placeholder="e.g. Anthropic · Claude Teams"
            />
          </FormField>
          <AddressField
            id="payee-address"
            value={entry.typed}
            onChange={entry.setTyped}
            onBlur={entry.touch}
            error={entry.error ?? (touched ? errors.address : undefined)}
            hint={`The payee’s account address on ${network.name}: 0x followed by 40 characters. Copy it from their invoice or billing page.`}
          />
          {entry.address ? (
            <div className="flex flex-col gap-2">
              <AddressConfirm
                id="payee-address-confirm"
                address={entry.address}
                confirmed={entry.confirmed}
                onConfirmedChange={entry.setConfirmed}
                notice={entry.notice}
              />
              {touched && errors.confirm ? (
                <p className="text-sm text-danger" role="alert">
                  {errors.confirm}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="From where, and how much?">
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Budget"
              htmlFor="budget"
              hint={
                budget
                  ? `Paid from ${accountName(state, budget.sourceAccountId)}, under the rules of ${budget.name}.`
                  : 'Paying from a budget applies its rules. Budgets limited to approved vendors cannot pay an address.'
              }
            >
              <SimpleSelect
                id="budget"
                value={budgetId}
                onValueChange={setBudgetId}
                options={budgetOptions}
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
            <FormField
              label="Category"
              htmlFor="category"
              error={touched ? errors.category : undefined}
              hint={budget ? `Only the approved uses of ${budget.name}.` : undefined}
            >
              <SimpleSelect
                id="category"
                value={category ?? null}
                onValueChange={setCategory}
                options={categories.map((c) => ({ value: c, label: categoryLabel[c] }))}
                empty="This budget has no approved uses"
              />
            </FormField>
            <FormField label="What it pays" htmlFor="memo" error={touched ? errors.memo : undefined}>
              <PillInput
                id="memo"
                value={memo}
                maxLength={500}
                aria-invalid={(touched && Boolean(errors.memo)) || undefined}
                onChange={(event) => setMemo(event.target.value)}
                placeholder="e.g. Claude Teams, October seats"
              />
            </FormField>
          </div>
        </div>
      </Panel>

      <Panel
        title="Invoice"
        description={`Optional now. Without it the payment shows as Invoice pending until you add it, within ${PROOF_WITHIN_DAYS} days.`}
      >
        <div className="flex flex-col gap-2">
          <EvidenceUploader
            files={files}
            onChange={setFiles}
            onUpload={evidenceFiles.upload}
            maxFiles={1}
            allowLinks={false}
            label="Drop the invoice here or browse"
            hint="One file: PDF, PNG, JPG, WEBP or HEIC, up to 10 MB. It stays private and is attached once: it cannot be replaced, and a file used for another payment is refused."
          />
          {touched && waiting ? (
            <p className="text-sm text-danger" role="alert">
              {waiting}
            </p>
          ) : null}
          <KimiReader
            className="mt-2"
            file={file}
            agencyId={agencyId}
            purpose="invoice"
            onUse={applyReading}
            // The demo's sample is a new vendor's invoice; none when paying for a monthly payment.
            sample="loomwise-invoice"
            onSampleFile={linkedReminder ? undefined : (sample) => setFiles([sample])}
            extra={(proposal) => (
              <>
                {proposal.match ? (
                  <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    <span>
                      This looks like the invoice of a payment already made: “{proposal.match.label}”. Check{' '}
                      <Link
                        href={href('bills?tab=invoices')}
                        className="font-medium underline underline-offset-4"
                      >
                        Bills ▸ Invoices pending
                      </Link>{' '}
                      before you pay it again.
                    </span>
                  </p>
                ) : null}
                {/* Opened for one, or one was created already (shown below the reader): no second. */}
                {reminder || newReminder ? null : proposal.reminder && canRemind ? (
                  <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex gap-2 text-sm text-pretty text-muted-foreground">
                      <CalendarClock className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
                      Kimi sees a monthly charge. A monthly payment shows it as due in Bills every month.
                    </p>
                    <Button
                      variant="outline"
                      size="pill-sm"
                      className="shrink-0"
                      onClick={() => createReminderFrom(proposal)}
                    >
                      Create a monthly payment
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          />
          {/* Outside the reader so it stays when the file changes: the payment is still made for it. */}
          {!reminder && newReminder ? (
            <p className="mt-1 flex gap-2 rounded-xl border border-border p-4 text-sm text-pretty text-muted-foreground">
              {madeFor ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
              )}
              {madeFor ? (
                <span>
                  <span className="font-medium text-foreground">
                    Linked to monthly payment “{madeFor.title}”
                  </span>
                  . This payment counts for it.
                </span>
              ) : (
                <span>
                  “{newReminder.title}” is {newReminder.status === 'paused' ? 'paused' : 'archived'}, so this
                  payment will not count for it.
                  {newReminder.status === 'paused' ? ' Resume it in Bills ▸ Monthly first if it should.' : ''}
                </span>
              )}
            </p>
          ) : null}
        </div>
      </Panel>

      {checks.length > 0 ? (
        <Panel title="Checks" description="Checked again when it is sent.">
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
        <Button
          variant="ghost"
          size="pill-sm"
          // Back where the person came from (Payments, Overview, the command menu…); a page opened
          // directly falls back to the account, budget or monthly payment it was opened for.
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push(href(origin ?? 'accounts'))
          }
        >
          Cancel
        </Button>
        <Button
          size="pill-sm"
          disabled={blocked || Boolean(waiting)}
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
          pay.reset()
          if (sent) router.push(href(origin ?? 'payments?tab=outside'))
        }}
        title="Pay outside Viatik"
        description={payee.trim() || undefined}
        summary={{
          what: `${usd(amount ?? ZERO)} goes from ${sourceLabel} to ${payee.trim()} at the address below. It leaves Viatik.`,
          amount: amount ?? undefined,
          from: sourceLabel,
          to: entry.address ? `${payee.trim()} · ${shortAddress(entry.address)}` : payee.trim(),
          reversible: 'Cannot be undone once sent. Money sent to a wrong address cannot be recovered.',
          policy: budget
            ? `${budget.name}: per-operation limit ${usd(budget.perOperationLimit)}, no vendor list. Authorized by an Agency Admin, never above the Investor’s exception threshold.`
            : 'Agency account payment outside Viatik, authorized by an Agency Admin. Never above the Investor’s exception threshold.',
        }}
        confirmLabel="Pay outside Viatik"
        disabled={!valid || paused}
        phase={pay.phase}
        error={pay.error}
        steps={steps}
        onConfirm={async () => {
          if (!entry.address || !sourceAccountId || !amount || !category) return
          const payment = await pay.run({
            agencyId,
            source: budget
              ? { kind: 'budget', budgetId: budget.id }
              : { kind: 'account', accountId: sourceAccountId },
            to: entry.address,
            payee: payee.trim(),
            amount,
            category,
            memo: memo.trim(),
            proof: file ? toEvidence(file) : undefined,
            // The monthly payment it was opened for, or the one just created from Kimi's reading.
            reminderId: madeFor?.id,
          })
          if (payment) setSent({ paymentId: payment.id, withInvoice: Boolean(file) })
        }}
        success={{
          title: 'Paid outside Viatik',
          body: (
            <>
              {usd(paid?.amount ?? amount ?? ZERO)} was paid to {paidTo?.payee ?? payee.trim()} at{' '}
              <span className="font-mono break-all">{paidTo?.address ?? entry.address}</span>.{' '}
              {sent?.withInvoice
                ? 'Its invoice is attached.'
                : `Add its invoice within ${PROOF_WITHIN_DAYS} days from Bills ▸ Invoices pending.`}
              {demo ? ' This demo is simulated: nothing was sent to a real address.' : ''}
              {testLedger ? ' Viatik recorded it; this test environment does not send funds yet.' : ''}
            </>
          ),
          actions: receipt ? (
            <>
              <ButtonLink href={receiptHref(receipt.id)} size="pill-sm">
                View receipt
              </ButtonLink>
              <ReceiptDetailsButton receipt={receipt} />
            </>
          ) : undefined,
        }}
      >
        {entry.address ? (
          <div className="flex flex-col gap-1.5 rounded-xl border border-border p-4">
            <span className="text-xs text-subtle">Full address</span>
            <p className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-sm break-all text-foreground">
                {entry.address}
              </span>
              <CopyButton value={entry.address} label="Copy the full address" />
            </p>
          </div>
        ) : null}
        <KeyValueList
          dense
          items={[
            { label: 'Category', value: category ? categoryLabel[category] : '—' },
            { label: 'What it pays', value: memo.trim() },
            {
              label: 'Invoice',
              value: file ? file.name : `Not yet: add it within ${PROOF_WITHIN_DAYS} days`,
            },
            ...(madeFor ? [{ label: 'Monthly payment', value: madeFor.title }] : []),
          ]}
        />
        {demo ? (
          <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
            This demo is simulated: the payment is recorded with a receipt, but nothing is sent to a real
            address.
          </p>
        ) : testLedger ? (
          <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
            Test environment: Viatik records the payment with a receipt, but does not send funds yet.
          </p>
        ) : null}
        {paused ? (
          <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            Payments outside Viatik are paused: Viatik cannot reach {network.name} right now. Try again later.
          </p>
        ) : null}
      </ApprovalSheet>
      {canRemind ? (
        <NewReminderSheet
          open={reminderOpen}
          onOpenChange={setReminderOpen}
          agencyId={agencyId}
          initial={reminderDraft}
          onCreated={(created) => setCreatedReminder(created)}
        />
      ) : null}
    </div>
  )
}

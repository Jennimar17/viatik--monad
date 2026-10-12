'use client'

import {
  BriefcaseBusiness,
  CircleCheck,
  Clock,
  Pencil,
  ReceiptText,
  ShieldX,
  ShoppingBag,
  Wallet,
} from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton, requestRecord } from '@/components/app/receipt-details'
import { PAYS_REQUESTER, requestFollowUp, requestRecipientLabel } from '@/components/app/request-parts'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import {
  ChoiceCard,
  EvidenceUploader,
  FormActions,
  MoneyInput,
  pendingUploads,
  toEvidence,
  type DraftFile,
} from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { PolicyVerdict } from '@/components/viatik/policy'
import { VerifiedDetailsButton } from '@/components/viatik/verified-details-drawer'
import { useCommand, useEvidenceFiles, useViatikState } from '@/data/react'
import { JUSTIFY_WITHIN_DAYS } from '@/domain/accountability'
import { execute, previewPolicy } from '@/domain/engine'
import { newId } from '@/domain/ids'
import { categoryLabel, requestTypeLabel } from '@/domain/labels'
import { formatUsd, min, type Cents } from '@/domain/money'
import { perPaymentCap } from '@/domain/policy'
import { memberBudgets, receiptFor, userName } from '@/domain/queries'
import type { PaymentRequest, RequestType, SpendingCategory } from '@/domain/types'
import { fromDateInput } from '@/lib/format'

type MemberRequestType = Exclude<RequestType, 'automation'>

const TYPES: { value: MemberRequestType; icon: React.ReactNode; description: string }[] = [
  {
    value: 'funds',
    icon: <Wallet />,
    description: `Money into your Viatik balance for an upcoming purchase. Add its receipts within ${JUSTIFY_WITHIN_DAYS} days or return what you do not use.`,
  },
  {
    value: 'reimbursement',
    icon: <ReceiptText />,
    description: 'Paid back into your Viatik balance for something you already bought. Attach its receipt.',
  },
  {
    value: 'work',
    icon: <BriefcaseBusiness />,
    description: 'Paid into your Viatik balance for work you did. An Agency Admin always reviews it.',
  },
  {
    value: 'vendor_payment',
    icon: <ShoppingBag />,
    description: 'Viatik pays an approved vendor or service for you.',
  },
]

const isMemberRequestType = (value: string | null): value is MemberRequestType =>
  TYPES.some((t) => t.value === value)

/** Work is usually paid as team or contractor spending: preferred when the budget allows it. */
const WORK_CATEGORIES: SpendingCategory[] = ['contractors', 'team']

export default function NewRequestPage() {
  // useSearchParams needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <NewRequest />
    </React.Suspense>
  )
}

function NewRequest() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const params = useSearchParams()
  const command = useCommand('requestPayment', { silent: true })
  const evidenceFiles = useEvidenceFiles()
  // One key per submission: retries of the same draft cannot create duplicates.
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => newId('idem'))

  const budgets = memberBudgets(state, agencyId, userId, now).filter((b) => b.budget.status === 'active')
  const [budgetId, setBudgetId] = React.useState<string | null>(
    params.get('budget') ?? budgets[0]?.budget.id ?? null,
  )
  // `?type=reimbursement` opens the form on that type (e.g. from Expenses).
  const [type, setType] = React.useState<MemberRequestType>(() => {
    const asked = params.get('type')
    return isMemberRequestType(asked) ? asked : 'funds'
  })
  const [destinationChoice, setDestinationChoice] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [categoryChoice, setCategoryChoice] = React.useState<SpendingCategory | null>(null)
  const [purpose, setPurpose] = React.useState('')
  const [merchant, setMerchant] = React.useState('')
  const [spentDate, setSpentDate] = React.useState('')
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [created, setCreated] = React.useState<PaymentRequest | null>(null)
  const [touched, setTouched] = React.useState(false)

  const selected = budgets.find((b) => b.budget.id === budgetId)
  const budget = selected?.budget
  // Money for purchases, reimbursements and work pay your own Viatik balance; only vendor payments
  // choose where the money goes (and only those follow the budget's vendor list).
  const paysMe = PAYS_REQUESTER.has(type)
  const reimbursement = type === 'reimbursement'
  const work = type === 'work'
  const destinationOptions = (
    budget && budget.allowedDestinationIds.length > 0
      ? state.destinations.filter(
          (d) => budget.allowedDestinationIds.includes(d.id) && d.status === 'approved',
        )
      : state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  ).map((d) => ({ value: d.id, label: d.name, description: d.settlementLabel }))

  // Switching budgets keeps a choice only when the new budget allows it.
  const allowedCategories = budget?.allowedCategories ?? []
  const category =
    categoryChoice && allowedCategories.includes(categoryChoice)
      ? categoryChoice
      : ((work ? WORK_CATEGORIES.find((c) => allowedCategories.includes(c)) : undefined) ??
        allowedCategories[0] ??
        null)
  const destinationId =
    !paysMe && destinationChoice && destinationOptions.some((d) => d.value === destinationChoice)
      ? destinationChoice
      : null
  const spentAt = fromDateInput(spentDate)

  // The same decision the engine reaches when the request is sent (exception and work rules included).
  const decision =
    budget && amount && category && (paysMe || destinationId)
      ? execute(state, { actor: { kind: 'user', userId }, now }, (tx) =>
          previewPolicy(tx, {
            budgetId: budget.id,
            type,
            amount,
            category,
            destinationId: paysMe ? null : destinationId,
          }),
        ).result
      : null
  // Work goes to an Agency Admin unless the rules already refuse it (above the exception threshold, say).
  const reviewedWork = work && decision?.outcome !== 'rejected'
  const forApproval = reviewedWork || decision?.outcome === 'needs_approval'

  // A request outside the rules is still recorded; the ledger's rejection
  // comes back as a failed operation, so the stored request is the outcome.
  const rejected =
    command.phase === 'failed'
      ? state.requests.find((r) => r.idempotencyKey === idempotencyKey && r.status === 'rejected')
      : undefined
  const result = created ?? rejected ?? null
  // The form's action bar sits at the bottom until a result screen replaces it.
  useBottomBar(budgets.length > 0 && !result)

  // Members cannot add destinations; when there are none, say who can.
  const noDestinations =
    'Your Agency Admin has not approved anywhere to pay from this budget yet. Ask them to add the vendor or service you need.'
  const errors = {
    budget: !budgetId ? 'Choose a budget.' : undefined,
    destination:
      !paysMe && !destinationId
        ? destinationOptions.length === 0
          ? noDestinations
          : 'Choose where the money goes.'
        : undefined,
    amount: !amount ? 'Enter an amount.' : undefined,
    purpose: purpose.trim().length < 3 ? 'Say what this is for.' : undefined,
    merchant: reimbursement && !merchant.trim() ? 'Enter where you bought it.' : undefined,
    spentAt:
      reimbursement && spentDate && (!spentAt || spentAt > now)
        ? 'Pick a date that is not in the future.'
        : undefined,
    files:
      pendingUploads(files) ??
      (reimbursement && !files.some((f) => f.kind === 'file')
        ? 'Attach the receipt of what you paid.'
        : undefined),
  }
  const valid = !Object.values(errors).some(Boolean)
  const busy = command.phase !== 'idle' && command.phase !== 'failed' && command.phase !== 'completed'

  const submit = async () => {
    setTouched(true)
    // Requests that pay you name no destination: the engine pays the requester.
    const target = paysMe ? {} : destinationId ? { destinationId } : null
    if (!valid || !budget || !amount || !category || !target) return
    const next = await command.run({
      agencyId,
      budgetId: budget.id,
      type,
      ...target,
      amount,
      category,
      purpose: purpose.trim(),
      ...(reimbursement ? { merchant: merchant.trim(), spentAt } : {}),
      attachments: files.map(toEvidence),
      idempotencyKey,
    })
    if (next) setCreated(next)
  }

  const editRequest = () => {
    setIdempotencyKey(newId('idem'))
    setCreated(null)
    command.reset()
  }

  if (budgets.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="New request" />
        <EmptyState
          title="No spending access yet"
          description="Your Agency Admin has not assigned a budget to you."
        />
      </div>
    )
  }

  if (result) {
    const admin = state.memberships.find(
      (m) => m.role === 'agency_admin' && m.scope.kind === 'agency' && m.scope.agencyId === agencyId,
    )
    const payment = state.payments.find((p) => p.id === result.paymentId)
    const receipt = receiptFor(state, payment?.receiptId)
    const recipient = requestRecipientLabel(state, result, userId)
    const paidToMe = result.destination.kind === 'member'
    const followUp = requestFollowUp(state, result, userId)
    // The engine's own reason says who decides: a Member's state does not carry the funding agreement.
    // Work is never an exception: above the threshold it is rejected before anyone decides.
    const withInvestor = result.decision.reason?.rule === 'exception_threshold'
    // What the ledger recorded when it was sent; none when it never got there.
    const ledgerRecord = requestRecord(state, result)
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-10">
        {result.status === 'rejected' ? (
          <>
            <PageHeader
              title="Request not sent"
              description="Nothing was paid. The attempt is kept in your request history."
            />
            <PolicyVerdict decision={result.decision} />
            {result.ledger?.outcome === 'rejected' ? (
              <p className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-pretty text-muted-foreground">
                <ShieldX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
                <span>
                  <span className="font-medium text-foreground">Settlement refused it too.</span> Budget rules
                  are enforced when money moves, not only in the app
                  {command.error ? `: ${command.error}` : '.'}
                </span>
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="pill" onClick={editRequest}>
                <Pencil data-icon="inline-start" /> Edit request
              </Button>
              <ButtonLink href={href(`requests/${result.id}`)} variant="outline" size="pill">
                View request
              </ButtonLink>
              {ledgerRecord ? (
                <VerifiedDetailsButton record={ledgerRecord} variant="ghost" size="pill" />
              ) : null}
            </div>
          </>
        ) : result.status === 'needs_approval' ? (
          <>
            <PageHeader
              title="Request sent for approval"
              description={
                withInvestor
                  ? 'It is above the funding agreement’s exception threshold, so the Investor reviews it. You will get a notification when it is decided.'
                  : `${admin ? userName(state, admin.userId) : 'Your Agency Admin'} will review it. You will get a notification when it is decided.`
              }
            />
            <Panel>
              <div className="flex items-center gap-4">
                <Clock className="size-5 text-warning" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{result.purpose}</span>
                  <span className="text-xs text-subtle">{recipient}</span>
                </span>
                <Amount value={result.amount} size="md" />
              </div>
            </Panel>
            <div className="flex flex-wrap gap-2">
              <ButtonLink href={href(`requests/${result.id}`)} size="pill">
                View request
              </ButtonLink>
              <ButtonLink href={href('overview')} variant="outline" size="pill">
                Back to Overview
              </ButtonLink>
              {ledgerRecord ? (
                <VerifiedDetailsButton record={ledgerRecord} variant="ghost" size="pill" />
              ) : null}
            </div>
          </>
        ) : (
          <>
            <PageHeader
              eyebrow={
                <span className="flex items-center gap-1.5 text-success">
                  <CircleCheck className="size-4" aria-hidden="true" /> Approved by policy
                </span>
              }
              title={paidToMe ? 'Added to your Viatik balance' : 'Payment completed'}
              description={
                paidToMe
                  ? (followUp ?? 'Send it to your Viatik account from Payments whenever you need it.')
                  : 'The payment and its supporting evidence are now connected.'
              }
            />
            <Panel>
              <div className="flex items-center gap-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{result.purpose}</span>
                  <span className="text-xs text-subtle">
                    {paidToMe ? 'Into your Viatik balance' : `To ${recipient}`} · approved by policy
                  </span>
                </span>
                <Amount value={result.amount} size="lg" />
              </div>
            </Panel>
            <div className="flex flex-wrap gap-2">
              {receipt ? (
                <ButtonLink href={receiptHref(receipt.id)} size="pill">
                  View receipt
                </ButtonLink>
              ) : null}
              <ReceiptDetailsButton receipt={receipt} size="pill" />
              <Button variant="ghost" size="pill" onClick={() => router.push(href('overview'))}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('requests')} className="hover:text-foreground">
            Requests
          </Link>
        }
        title="New request"
        description="You will see whether it fits your budget rules before you send it."
      />

      <Panel title="What do you need?">
        <div className="flex flex-col gap-6">
          <div role="radiogroup" aria-label="Request type" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {TYPES.map((t) => (
              <ChoiceCard
                key={t.value}
                selected={type === t.value}
                onSelect={() => setType(t.value)}
                title={requestTypeLabel[t.value]}
                description={t.description}
                icon={t.icon}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField
              label="Budget"
              htmlFor="budget"
              error={touched ? errors.budget : undefined}
              hint={
                selected ? `${formatUsd(selected.remaining, { withCode: true })} left this period` : undefined
              }
            >
              <SimpleSelect
                id="budget"
                value={budgetId}
                onValueChange={setBudgetId}
                options={budgets.map((b) => ({
                  value: b.budget.id,
                  label: b.budget.name,
                  description: `${formatUsd(b.remaining)} left`,
                }))}
              />
            </FormField>
            {paysMe ? (
              <FormField
                label="Where it goes"
                hint={
                  reviewedWork
                    ? 'An Agency Admin always reviews it before it is paid.'
                    : work
                      ? undefined
                      : 'Send it to your Viatik account from Payments whenever you need it.'
                }
              >
                <p className="flex h-11 items-center gap-2 rounded-full border border-border bg-input/30 px-5 text-sm">
                  <Wallet className="size-4 shrink-0 text-subtle" aria-hidden="true" />
                  <span className="truncate">Paid into your Viatik balance</span>
                </p>
              </FormField>
            ) : (
              <FormField
                label="Pay to"
                htmlFor="destination"
                error={touched ? errors.destination : undefined}
                hint={
                  destinationOptions.length === 0
                    ? noDestinations
                    : 'Only approved destinations for this budget are listed.'
                }
              >
                <SimpleSelect
                  id="destination"
                  value={destinationId}
                  onValueChange={setDestinationChoice}
                  options={destinationOptions}
                  invalid={touched && Boolean(errors.destination)}
                  placeholder="Choose a vendor or service"
                  empty="No approved destinations yet"
                />
              </FormField>
            )}
          </div>
          {reimbursement ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                label="Merchant"
                htmlFor="merchant"
                error={touched ? errors.merchant : undefined}
                hint="Where you bought it."
              >
                <PillInput
                  id="merchant"
                  value={merchant}
                  maxLength={80}
                  onChange={(e) => setMerchant(e.target.value)}
                  aria-invalid={(touched && Boolean(errors.merchant)) || undefined}
                  placeholder="e.g. Northwind Travel"
                />
              </FormField>
              <FormField
                label="Date paid"
                htmlFor="spent-at"
                optional
                error={errors.spentAt}
                hint="Leave empty if you paid today."
              >
                <PillInput
                  id="spent-at"
                  type="date"
                  value={spentDate}
                  max={now.slice(0, 10)}
                  onChange={(e) => setSpentDate(e.target.value)}
                  aria-invalid={Boolean(errors.spentAt) || undefined}
                />
              </FormField>
            </div>
          ) : null}
          <FormField label="Amount" htmlFor="amount" error={touched ? errors.amount : undefined}>
            <MoneyInput
              id="amount"
              value={amount}
              onChange={setAmount}
              invalid={touched && Boolean(errors.amount)}
              available={
                selected
                  ? min(
                      perPaymentCap(selected.budget, selected.allowance),
                      min(selected.remaining, selected.usage.available),
                    )
                  : undefined
              }
            />
          </FormField>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Category" htmlFor="category">
              <SimpleSelect
                id="category"
                value={category}
                onValueChange={(v) => setCategoryChoice(v as SpendingCategory)}
                options={allowedCategories.map((c) => ({
                  value: c,
                  label: categoryLabel[c],
                }))}
              />
            </FormField>
            <FormField label="Purpose" htmlFor="purpose" error={touched ? errors.purpose : undefined}>
              <Textarea
                id="purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                aria-invalid={(touched && Boolean(errors.purpose)) || undefined}
                placeholder="e.g. Development service for the staging environment"
                className="min-h-11 rounded-2xl"
                rows={1}
              />
            </FormField>
          </div>
        </div>
      </Panel>

      {decision ? (
        <PolicyVerdict decision={decision} />
      ) : (
        <p className="px-1 text-sm text-subtle">
          {paysMe
            ? 'Choose a budget and an amount to check the rules.'
            : 'Choose a budget, destination, and amount to check the rules.'}
        </p>
      )}

      <Panel
        title={reimbursement ? 'Receipt' : 'Supporting information'}
        description={
          reimbursement
            ? 'Required: the receipt of what you paid. It stays private; only its fingerprint is recorded.'
            : work
              ? 'Recommended: attach an invoice or what you delivered to help the review.'
              : type === 'funds'
                ? 'Optional: a quote helps. The receipts come after you buy.'
                : decision?.outcome === 'needs_approval'
                  ? 'Recommended: attach a quote or invoice to speed up approval.'
                  : 'Optional. Receipts can also be added later.'
        }
      >
        <EvidenceUploader
          files={files}
          onChange={setFiles}
          onUpload={evidenceFiles.upload}
          allowLinks={false}
          maxFiles={10}
          label={reimbursement ? 'Attach the receipt' : 'Attach a quote, invoice, or receipt'}
        />
        {touched && errors.files ? (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {errors.files}
          </p>
        ) : null}
      </Panel>

      {command.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={command.phase} error={command.error} />
        </Panel>
      ) : null}

      <FormActions className="bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0">
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('requests'))} disabled={busy}>
          Cancel
        </Button>
        <Button size="pill-sm" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Sending…' : forApproval ? 'Send for approval' : 'Send request'}
        </Button>
      </FormActions>
    </div>
  )
}

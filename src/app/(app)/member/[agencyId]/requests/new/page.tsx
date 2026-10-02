'use client'

import { CircleCheck, Clock, Pencil, ReceiptText, ShieldX, ShoppingBag, Wallet } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
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
  type DraftFile,
} from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { PolicyVerdict } from '@/components/viatik/policy'
import { useCommand, useViatikState } from '@/data/react'
import { execute, previewPolicy } from '@/domain/engine'
import { newId } from '@/domain/ids'
import { categoryLabel, requestTypeLabel } from '@/domain/labels'
import { formatUsd, min, type Cents } from '@/domain/money'
import { memberBudgets, receiptFor, recipientName, userName } from '@/domain/queries'
import type { PaymentRequest, RequestType, SpendingCategory } from '@/domain/types'

type MemberRequestType = Exclude<RequestType, 'automation'>

const TYPES: { value: MemberRequestType; icon: React.ReactNode; description: string }[] = [
  {
    value: 'vendor_payment',
    icon: <ShoppingBag />,
    description: 'Viatik pays an approved vendor or service for you.',
  },
  { value: 'funds', icon: <Wallet />, description: 'Request money for an upcoming purchase.' },
  {
    value: 'reimbursement',
    icon: <ReceiptText />,
    description: 'Get paid back for something you already bought.',
  },
]

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
  // One key per submission: retries of the same draft cannot create duplicates.
  const [idempotencyKey, setIdempotencyKey] = React.useState(() => newId('idem'))

  const budgets = memberBudgets(state, agencyId, userId, now).filter((b) => b.budget.status === 'active')
  const [budgetId, setBudgetId] = React.useState<string | null>(
    params.get('budget') ?? budgets[0]?.budget.id ?? null,
  )
  const [type, setType] = React.useState<MemberRequestType>('vendor_payment')
  const [destinationChoice, setDestinationChoice] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [categoryChoice, setCategoryChoice] = React.useState<SpendingCategory | null>(null)
  const [purpose, setPurpose] = React.useState('')
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [created, setCreated] = React.useState<PaymentRequest | null>(null)
  const [touched, setTouched] = React.useState(false)

  const selected = budgets.find((b) => b.budget.id === budgetId)
  const budget = selected?.budget
  const destinationOptions = (
    budget && budget.allowedDestinationIds.length > 0
      ? state.destinations.filter((d) => budget.allowedDestinationIds.includes(d.id))
      : state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  ).map((d) => ({ value: d.id, label: d.name, description: d.settlementLabel }))

  // Switching budgets keeps a choice only when the new budget allows it.
  const category =
    categoryChoice && budget?.allowedCategories.includes(categoryChoice)
      ? categoryChoice
      : (budget?.allowedCategories[0] ?? null)
  const destinationId =
    destinationChoice && destinationOptions.some((d) => d.value === destinationChoice)
      ? destinationChoice
      : null

  const decision =
    budget && amount && category && destinationId
      ? execute(state, { actor: { kind: 'user', userId }, now }, (tx) =>
          previewPolicy(tx, { budgetId: budget.id, amount, category, destinationId }),
        ).result
      : null

  // A request outside the rules is still recorded; the ledger's rejection
  // comes back as a failed operation, so the stored request is the outcome.
  const rejected =
    command.phase === 'failed'
      ? state.requests.find((r) => r.idempotencyKey === idempotencyKey && r.status === 'rejected')
      : undefined
  const result = created ?? rejected ?? null
  // The form's action bar sits at the bottom until a result screen replaces it.
  useBottomBar(budgets.length > 0 && !result)

  const errors = {
    budget: !budgetId ? 'Choose a budget.' : undefined,
    destination: !destinationId ? 'Choose where the money goes.' : undefined,
    amount: !amount ? 'Enter an amount.' : undefined,
    purpose: purpose.trim().length < 3 ? 'Say what this is for.' : undefined,
  }
  const valid = !Object.values(errors).some(Boolean)
  const busy = command.phase !== 'idle' && command.phase !== 'failed' && command.phase !== 'completed'

  const submit = async () => {
    setTouched(true)
    if (!valid || !budget || !amount || !category || !destinationId) return
    const next = await command.run({
      agencyId,
      budgetId: budget.id,
      type,
      destinationId,
      amount,
      category,
      purpose: purpose.trim(),
      attachments: files,
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
    const recipient = recipientName(state, result.destination)
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6 py-10">
        {result.status === 'rejected' ? (
          <>
            <PageHeader
              title="Request not sent"
              description="Nothing was paid. The attempt is kept in your request history."
            />
            <PolicyVerdict decision={result.decision} />
            <p className="flex items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-sm text-pretty text-muted-foreground">
              <ShieldX className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
              <span>
                <span className="font-medium text-foreground">
                  The settlement contract rejected it as well.
                </span>{' '}
                Budget rules are enforced at settlement, not only in the app
                {command.error ? `: ${command.error}` : '.'}
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="pill" onClick={editRequest}>
                <Pencil data-icon="inline-start" /> Edit request
              </Button>
              <ButtonLink href={href(`requests/${result.id}`)} variant="outline" size="pill">
                View request
              </ButtonLink>
            </div>
          </>
        ) : result.status === 'needs_approval' ? (
          <>
            <PageHeader
              title="Request sent for approval"
              description={`${admin ? userName(state, admin.userId) : 'Your Agency Admin'} will review it. You will get a notification when it is decided.`}
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
              <ButtonLink href={href('home')} variant="outline" size="pill">
                Back to home
              </ButtonLink>
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
              title="Payment completed"
              description="The payment and its supporting evidence are now connected."
            />
            <Panel>
              <div className="flex items-center gap-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{result.purpose}</span>
                  <span className="text-xs text-subtle">To {recipient} · approved by policy</span>
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
              <Button variant="ghost" size="pill" onClick={() => router.push(href('home'))}>
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
          <div role="radiogroup" aria-label="Request type" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <FormField
              label={type === 'reimbursement' ? 'Where you bought it' : 'Pay to'}
              htmlFor="destination"
              error={touched ? errors.destination : undefined}
              hint="Only approved destinations for this budget are listed."
            >
              <SimpleSelect
                id="destination"
                value={destinationId}
                onValueChange={setDestinationChoice}
                options={destinationOptions}
                invalid={touched && Boolean(errors.destination)}
                placeholder="Choose a vendor or service"
              />
            </FormField>
          </div>
          <FormField label="Amount" htmlFor="amount" error={touched ? errors.amount : undefined}>
            <MoneyInput
              id="amount"
              value={amount}
              onChange={setAmount}
              invalid={touched && Boolean(errors.amount)}
              available={selected ? min(selected.remaining, selected.usage.available) : undefined}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Category" htmlFor="category">
              <SimpleSelect
                id="category"
                value={category}
                onValueChange={(v) => setCategoryChoice(v as SpendingCategory)}
                options={(budget?.allowedCategories ?? []).map((c) => ({
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
          Choose a budget, destination, and amount to check the rules.
        </p>
      )}

      <Panel
        title="Supporting information"
        description={
          decision?.outcome === 'needs_approval'
            ? 'Recommended: attach a quote or invoice to speed up approval.'
            : 'Optional. Receipts can also be added later.'
        }
      >
        <EvidenceUploader
          files={files}
          onChange={setFiles}
          allowLinks={false}
          maxFiles={10}
          label="Attach a quote, invoice, or receipt"
        />
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
          {busy ? 'Sending…' : decision?.outcome === 'needs_approval' ? 'Send for approval' : 'Send request'}
        </Button>
      </FormActions>
    </div>
  )
}

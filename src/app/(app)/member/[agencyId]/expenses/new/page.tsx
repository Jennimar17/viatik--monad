'use client'

import { HandCoins, ReceiptText, Wallet } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { KimiReader, proposalAmount, type EvidenceReadProposal } from '@/components/app/kimi-reader'
import { advanceDueText, advanceTitle } from '@/components/app/request-parts'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import {
  EvidenceUploader,
  FormActions,
  MoneyInput,
  pendingUploads,
  toEvidence,
  type DraftFile,
} from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { useCommand, useEvidenceFiles, useViatikState } from '@/data/react'
import { advancesOf, type AdvanceStanding } from '@/domain/accountability'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, type Cents } from '@/domain/money'
import type { SpendingCategory, ViatikState } from '@/domain/types'
import { formatDate, fromDateInput } from '@/lib/format'

const ALL_CATEGORIES = Object.keys(categoryLabel) as SpendingCategory[]

/**
 * The categories the advance's budget accepts (every category when it names none). A budget leaves
 * the Member's view once their spending access ends: then only the advance's own category is sure to
 * be accepted.
 */
function categoriesFor(state: ViatikState, s: AdvanceStanding): SpendingCategory[] {
  const budget = state.budgets.find((b) => b.id === s.payment.budgetId)
  if (!budget) return [s.payment.category]
  return budget.allowedCategories.length > 0 ? budget.allowedCategories : ALL_CATEGORIES
}

export default function NewExpensePage() {
  // useSearchParams needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <NewExpense />
    </React.Suspense>
  )
}

/**
 * A receipt for money the member received for purchases (an advance). Each
 * receipt justifies part of one advance; what is not used goes back to the
 * Agency. Something the member paid themselves is a reimbursement request.
 */
function NewExpense() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const params = useSearchParams()
  const add = useCommand('addExpense', { success: 'Receipt added.' })
  const evidenceFiles = useEvidenceFiles()

  // Only advances with something still to justify take a receipt.
  const open = advancesOf(state, { agencyId, userId }, now).filter((s) => s.pending > 0)
  useBottomBar(open.length > 0)

  // Where the person came from, and goes back to once the receipt is added (or on Cancel):
  // Payments' "To justify" tab, the request page of the money the link named, or Expenses.
  const [back] = React.useState(() => {
    const from = params.get('from')
    if (from === 'payments') return href('payments?tab=justify')
    const requestId = state.payments.find((p) => p.id === params.get('advance'))?.requestId
    if (from === 'request' && requestId) return href(`requests/${requestId}`)
    return href('expenses')
  })

  const [advanceChoice, setAdvanceChoice] = React.useState<string | null>(() => params.get('advance'))
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [merchant, setMerchant] = React.useState('')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [date, setDate] = React.useState(now.slice(0, 10))
  const [categoryChoice, setCategoryChoice] = React.useState<SpendingCategory | null>(null)
  const [touched, setTouched] = React.useState(false)

  // `?advance=` preselects one; otherwise the oldest still open (the first one due).
  const advance = open.find((s) => s.payment.id === advanceChoice) ?? open[open.length - 1]
  const categories = advance ? categoriesFor(state, advance) : []
  // Its budget, when it is still in the Member's view (it leaves once their spending access ends).
  const advanceBudget = advance ? state.budgets.find((b) => b.id === advance.payment.budgetId) : undefined
  // Switching advances keeps the category only when the new advance's budget allows it.
  const category =
    categoryChoice && categories.includes(categoryChoice)
      ? categoryChoice
      : advance && categories.includes(advance.payment.category)
        ? advance.payment.category
        : (categories[0] ?? null)
  const spentAt = fromDateInput(date)
  const pending = advance?.pending
  // What was bought before the money was requested is not what it paid for (the engine refuses it).
  const earliest = advance
    ? (advance.request?.createdAt ?? advance.payment.scheduledFor).slice(0, 10)
    : undefined

  const errors = {
    advance: advance ? undefined : 'Choose the money this receipt is for.',
    merchant: merchant.trim().length > 1 ? undefined : 'Enter where you paid.',
    amount: !amount
      ? 'Enter the amount.'
      : pending !== undefined && amount > pending
        ? `Only ${formatUsd(pending, { withCode: true })} of this money is still to justify. For more, request a reimbursement.`
        : undefined,
    date:
      !spentAt || spentAt > now
        ? 'Pick a date that is not in the future.'
        : earliest && date < earliest
          ? `The receipt is dated before you requested this money on ${formatDate(earliest)}.`
          : undefined,
    receipt:
      pendingUploads(files) ?? (files.some((f) => f.kind === 'file') ? undefined : 'Attach the receipt.'),
  }
  const valid = !Object.values(errors).some(Boolean) && Boolean(category)
  const busy = add.phase !== 'idle' && add.phase !== 'failed' && add.phase !== 'completed'
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  // Kimi's reading, once the person chose to use it: it fills in the fields, never submits.
  const applyReading = (proposal: EvidenceReadProposal) => {
    const match = proposal.match
    if (match?.kind === 'advance' && open.some((s) => s.payment.id === match.id)) setAdvanceChoice(match.id)
    if (proposal.merchant) setMerchant(proposal.merchant)
    const read = proposalAmount(proposal)
    if (read !== null) setAmount(read)
    if (proposal.date) setDate(proposal.date)
  }

  const submit = async () => {
    setTouched(true)
    const receipt = files.find((f) => f.kind === 'file')
    if (!valid || !advance || !amount || !category || !spentAt || !receipt) return
    const expense = await add.run({
      agencyId,
      paymentId: advance.payment.id,
      merchant: merchant.trim(),
      amount,
      category,
      spentAt,
      receipt: toEvidence(receipt),
    })
    if (expense) router.push(back)
  }

  const header = (
    <PageHeader
      eyebrow={
        <Link href={href('expenses')} className="hover:text-foreground">
          Expenses
        </Link>
      }
      title="Add receipt"
      description="Show what you bought with money for purchases. For something you paid yourself, send a reimbursement request."
    />
  )

  if (open.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        {header}
        <EmptyState
          icon={<ReceiptText />}
          title="No money waiting for receipts"
          description="Receipts justify money for purchases you received. Request money before you buy, or ask for a reimbursement for something you already paid."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href={href('requests/new?type=funds')} size="pill-sm">
                <Wallet data-icon="inline-start" /> Request money for purchases
              </ButtonLink>
              <ButtonLink href={href('requests/new?type=reimbursement')} variant="outline" size="pill-sm">
                <HandCoins data-icon="inline-start" /> Request a reimbursement
              </ButtonLink>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      {header}

      <Panel title="Which money is it for?">
        <FormField
          label="Money for purchases"
          htmlFor="expense-advance"
          error={shown('advance')}
          hint={
            advance
              ? `${advanceBudget ? `From ${advanceBudget.name}. ` : ''}${formatUsd(advance.pending, { withCode: true })} still to justify, ${advanceDueText(advance)}.`
              : undefined
          }
        >
          <SimpleSelect
            id="expense-advance"
            value={advance?.payment.id ?? null}
            onValueChange={setAdvanceChoice}
            options={open.map((s) => ({
              value: s.payment.id,
              label: `${advanceTitle(s)} · ${formatUsd(s.pending)} to justify`,
              description: `Received ${formatDate(s.payment.completedAt ?? s.payment.scheduledFor)} · ${formatUsd(s.amount)}`,
            }))}
          />
        </FormField>
      </Panel>

      <Panel title="Receipt" description="Required. It stays private; only its fingerprint is recorded.">
        <EvidenceUploader
          files={files}
          onChange={setFiles}
          onUpload={evidenceFiles.upload}
          maxFiles={1}
          allowLinks={false}
          label="Drop the receipt here or browse"
          hint="PDF, PNG, JPG, WEBP or HEIC, up to 10 MB."
        />
        {shown('receipt') ? (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {shown('receipt')}
          </p>
        ) : null}
        <KimiReader
          className="mt-4"
          file={files[0]}
          agencyId={agencyId}
          purpose="receipt"
          onUse={applyReading}
          onSampleFile={(sample) => setFiles([sample])}
        />
      </Panel>

      <Panel title="What you paid for">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Merchant" htmlFor="expense-merchant" error={shown('merchant')}>
            <PillInput
              id="expense-merchant"
              value={merchant}
              maxLength={80}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Northwind Travel"
              aria-invalid={Boolean(shown('merchant')) || undefined}
            />
          </FormField>
          <FormField label="Date" htmlFor="expense-date" error={shown('date')}>
            <PillInput
              id="expense-date"
              type="date"
              value={date}
              min={earliest}
              max={now.slice(0, 10)}
              onChange={(e) => setDate(e.target.value)}
            />
          </FormField>
          <FormField label="Amount" htmlFor="expense-amount" error={shown('amount')}>
            <MoneyInput
              id="expense-amount"
              value={amount}
              onChange={setAmount}
              available={pending}
              invalid={
                Boolean(shown('amount')) || Boolean(amount && pending !== undefined && amount > pending)
              }
            />
          </FormField>
          <FormField label="Category" htmlFor="expense-category">
            <SimpleSelect
              id="expense-category"
              value={category}
              onValueChange={(value) => setCategoryChoice(value as SpendingCategory)}
              options={categories.map((c) => ({ value: c, label: categoryLabel[c] }))}
            />
          </FormField>
        </div>
      </Panel>

      {add.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={add.phase} error={add.error} />
        </Panel>
      ) : null}

      <FormActions className="bottom-[calc(4rem+env(safe-area-inset-bottom))] md:bottom-0">
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(back)} disabled={busy}>
          Cancel
        </Button>
        <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add receipt'}
        </Button>
      </FormActions>
    </div>
  )
}

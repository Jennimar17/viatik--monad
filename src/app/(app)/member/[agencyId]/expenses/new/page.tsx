'use client'

import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
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
import { categoryLabel } from '@/domain/labels'
import { formatUsd, type Cents } from '@/domain/money'
import { memberBudgets } from '@/domain/queries'
import type { SpendingCategory } from '@/domain/types'
import { formatDate, fromDateInput } from '@/lib/format'

const NO_PAYMENT = 'none'

export default function NewExpensePage() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const add = useCommand('addExpense', { success: 'Expense added.' })
  const evidenceFiles = useEvidenceFiles()
  useBottomBar()

  const budgets = memberBudgets(state, agencyId, userId, now).filter((b) => b.budget.status === 'active')
  const payouts = state.payments
    .filter(
      (p) =>
        p.agencyId === agencyId &&
        p.recipient.kind === 'member' &&
        p.recipient.userId === userId &&
        p.status === 'completed',
    )
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1))
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [merchant, setMerchant] = React.useState('')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [date, setDate] = React.useState(now.slice(0, 10))
  const [budgetId, setBudgetId] = React.useState<string | null>(budgets[0]?.budget.id ?? null)
  const [categoryChoice, setCategoryChoice] = React.useState<SpendingCategory | null>(null)
  const [paymentId, setPaymentId] = React.useState(NO_PAYMENT)
  const [touched, setTouched] = React.useState(false)

  const budget = budgets.find((b) => b.budget.id === budgetId)?.budget
  // Switching budgets keeps the category only when the new budget allows it.
  const category =
    categoryChoice && budget?.allowedCategories.includes(categoryChoice)
      ? categoryChoice
      : (budget?.allowedCategories[0] ?? null)
  const spentAt = fromDateInput(date)
  const errors = {
    merchant: merchant.trim().length > 1 ? undefined : 'Enter where you paid.',
    amount: amount && amount > 0 ? undefined : 'Enter the amount.',
    date: spentAt && spentAt <= now ? undefined : 'Pick a date that is not in the future.',
    budget: budgetId ? undefined : 'Choose a budget.',
    receipt: pendingUploads(files) ?? undefined,
  }
  const valid = !Object.values(errors).some(Boolean) && Boolean(category)
  const busy = add.phase !== 'idle' && add.phase !== 'failed' && add.phase !== 'completed'
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  const submit = async () => {
    setTouched(true)
    if (!valid || !budgetId || !amount || !category || !spentAt) return
    const expense = await add.run({
      agencyId,
      budgetId,
      merchant: merchant.trim(),
      amount,
      category,
      spentAt,
      receipt: files[0] ? toEvidence(files[0]) : undefined,
      paymentId: paymentId === NO_PAYMENT ? undefined : paymentId,
    })
    if (expense) router.push(href('expenses'))
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('expenses')} className="hover:text-foreground">
            Expenses
          </Link>
        }
        title="Add expense"
        description="Record something you paid for, with its receipt. To get the money back, send a reimbursement request."
      />

      {budgets.length === 0 ? (
        <Panel>
          <p className="text-sm text-muted-foreground">
            You need spending access to a budget before recording expenses. Ask your Agency Admin.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="Receipt" description="Optional now; you can attach it later from the list.">
            <EvidenceUploader
              files={files}
              onChange={setFiles}
              onUpload={evidenceFiles.upload}
              maxFiles={1}
              allowLinks={false}
              label="Drop the receipt here or browse"
              hint="PDF, PNG, JPG, WEBP or HEIC, up to 10 MB. It stays private; only its fingerprint is recorded."
            />
            {shown('receipt') ? (
              <p className="mt-3 text-xs text-destructive" role="alert">
                {shown('receipt')}
              </p>
            ) : null}
          </Panel>

          <Panel title="What you paid for">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Merchant" htmlFor="expense-merchant" error={shown('merchant')}>
                <PillInput
                  id="expense-merchant"
                  value={merchant}
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
                  max={now.slice(0, 10)}
                  onChange={(e) => setDate(e.target.value)}
                />
              </FormField>
              <FormField
                label="Amount"
                htmlFor="expense-amount"
                error={shown('amount')}
                className="sm:col-span-2"
              >
                <MoneyInput
                  id="expense-amount"
                  value={amount}
                  onChange={setAmount}
                  invalid={Boolean(shown('amount'))}
                />
              </FormField>
              <FormField label="Budget" htmlFor="expense-budget" error={shown('budget')}>
                <SimpleSelect
                  id="expense-budget"
                  value={budgetId}
                  onValueChange={setBudgetId}
                  options={budgets.map((b) => ({
                    value: b.budget.id,
                    label: b.budget.name,
                    description: `${formatUsd(b.remaining)} left this period`,
                  }))}
                />
              </FormField>
              <FormField label="Category" htmlFor="expense-category">
                <SimpleSelect
                  id="expense-category"
                  value={category}
                  onValueChange={(value) => setCategoryChoice(value as SpendingCategory)}
                  options={(budget?.allowedCategories ?? []).map((c) => ({
                    value: c,
                    label: categoryLabel[c],
                  }))}
                />
              </FormField>
              <FormField
                label="Paid with"
                htmlFor="expense-payment"
                optional
                hint="Link the payout that covered it, if there was one."
                className="sm:col-span-2"
              >
                <SimpleSelect
                  id="expense-payment"
                  value={paymentId}
                  onValueChange={setPaymentId}
                  options={[
                    { value: NO_PAYMENT, label: 'My own money' },
                    ...payouts.map((p) => ({
                      value: p.id,
                      label: `${p.memo} · ${formatUsd(p.amount)}`,
                      description: formatDate(p.completedAt ?? p.scheduledFor),
                    })),
                  ]}
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
            <Button
              variant="ghost"
              size="pill-sm"
              onClick={() => router.push(href('expenses'))}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
              {busy ? 'Adding…' : 'Add expense'}
            </Button>
          </FormActions>
        </>
      )}
    </div>
  )
}

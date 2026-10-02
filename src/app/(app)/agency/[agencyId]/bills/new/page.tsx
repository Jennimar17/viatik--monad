'use client'

import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EvidenceUploader, FormActions, MoneyInput, type DraftFile } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { useCommand, useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import type { Cents } from '@/domain/money'
import type { SpendingCategory } from '@/domain/types'
import { fromDateInput } from '@/lib/format'

const NO_BUDGET = 'none'

export default function NewBillPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const add = useCommand('addBill', { success: 'Bill added.' })
  useBottomBar()

  const destinations = state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [destinationId, setDestinationId] = React.useState<string | null>(null)
  const [number, setNumber] = React.useState('')
  const [issueDate, setIssueDate] = React.useState(now.slice(0, 10))
  const [dueDate, setDueDate] = React.useState('')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [category, setCategory] = React.useState<SpendingCategory>('software')
  const [accountId, setAccountId] = React.useState<string | null>(
    accounts.find((a) => a.template === 'vendors')?.id ?? accounts[0]?.id ?? null,
  )
  const [budgetId, setBudgetId] = React.useState(NO_BUDGET)
  const [notes, setNotes] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  const budgets = state.budgets.filter(
    (b) => b.agencyId === agencyId && b.status === 'active' && b.allowedCategories.includes(category),
  )
  const busy = add.phase !== 'idle' && add.phase !== 'failed' && add.phase !== 'completed'
  const document = files[0]

  const errors = {
    file: document ? undefined : 'Upload the bill.',
    destination: destinationId ? undefined : 'Choose the vendor.',
    number: number.trim() ? undefined : 'Enter the bill number.',
    dueDate: !dueDate
      ? 'Enter the due date.'
      : dueDate < issueDate
        ? 'The due date cannot be before the issue date.'
        : undefined,
    amount: amount ? undefined : 'Enter the amount.',
    account: accountId ? undefined : 'Choose the account that pays it.',
  }
  const valid = !Object.values(errors).some(Boolean)

  const chooseVendor = (id: string) => {
    setDestinationId(id)
    const vendor = destinations.find((d) => d.id === id)
    if (vendor) setCategory(vendor.category)
  }

  const submit = async () => {
    setTouched(true)
    const issue = fromDateInput(issueDate)
    const due = fromDateInput(dueDate)
    if (!valid || !document || !destinationId || !amount || !accountId || !issue || !due) return
    const bill = await add.run({
      agencyId,
      destinationId,
      number: number.trim(),
      issueDate: issue,
      dueDate: due,
      amount,
      category,
      accountId,
      budgetId: budgetId === NO_BUDGET ? undefined : budgetId,
      document,
      notes: notes.trim() || undefined,
    })
    if (bill) router.push(href(`bills/${bill.id}`))
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('bills')} className="hover:text-foreground">
            Bills
          </Link>
        }
        title="Add bill"
        description="Upload the bill and confirm its details. You can pay it now or later."
      />

      <Panel
        title="Bill document"
        description="Stays private to your Agency. Only its fingerprint is kept in the verified record."
      >
        <EvidenceUploader
          files={files}
          onChange={setFiles}
          maxFiles={1}
          allowLinks={false}
          label="Drop the bill here or browse"
        />
        {touched && errors.file ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {errors.file}
          </p>
        ) : null}
      </Panel>

      <Panel title="Details">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField
            label="Vendor"
            htmlFor="vendor"
            error={touched ? errors.destination : undefined}
            hint="Only approved payment destinations can be paid."
          >
            <SimpleSelect
              id="vendor"
              value={destinationId}
              onValueChange={chooseVendor}
              invalid={touched && Boolean(errors.destination)}
              options={destinations.map((d) => ({
                value: d.id,
                label: d.name,
                description: d.settlementLabel,
              }))}
              placeholder="Choose a vendor"
            />
          </FormField>
          <FormField label="Bill number" htmlFor="number" error={touched ? errors.number : undefined}>
            <PillInput
              id="number"
              value={number}
              aria-invalid={(touched && Boolean(errors.number)) || undefined}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="e.g. INV-2041"
            />
          </FormField>
          <FormField label="Issue date" htmlFor="issue">
            <PillInput
              id="issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </FormField>
          <FormField label="Due date" htmlFor="due" error={touched ? errors.dueDate : undefined}>
            <PillInput
              id="due"
              type="date"
              value={dueDate}
              aria-invalid={(touched && Boolean(errors.dueDate)) || undefined}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </FormField>
          <FormField
            label="Amount"
            htmlFor="amount"
            error={touched ? errors.amount : undefined}
            className="sm:col-span-2"
          >
            <MoneyInput
              id="amount"
              value={amount}
              onChange={setAmount}
              invalid={touched && Boolean(errors.amount)}
            />
          </FormField>
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
          <FormField label="Account" htmlFor="account" error={touched ? errors.account : undefined}>
            <SimpleSelect
              id="account"
              value={accountId}
              onValueChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name }))}
            />
          </FormField>
          <FormField
            label="Budget"
            htmlFor="budget"
            optional
            className="sm:col-span-2"
            hint="Budgets that allow this category. Paying from a budget applies its rules."
          >
            <SimpleSelect
              id="budget"
              value={budgetId}
              onValueChange={setBudgetId}
              options={[
                { value: NO_BUDGET, label: 'No budget' },
                ...budgets.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </FormField>
          <FormField label="Notes" htmlFor="notes" optional className="sm:col-span-2">
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-20 rounded-xl"
            />
          </FormField>
        </div>
      </Panel>

      {add.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={add.phase} error={add.error} />
        </Panel>
      ) : null}

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('bills'))} disabled={busy}>
          Cancel
        </Button>
        <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Adding…' : 'Add bill'}
        </Button>
      </FormActions>
    </div>
  )
}

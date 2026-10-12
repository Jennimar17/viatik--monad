'use client'

import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect, useChoice } from '@/components/app/form-controls'
import { AddDestinationButton, CreateOperationsAccount } from '@/components/app/money-setup'
import { providerKindLine } from '@/components/app/provider-parts'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
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
import { accountName, budgetsForVendor, defaultBillAccount } from '@/domain/queries'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import type { PaymentDestination, SpendingCategory } from '@/domain/types'
import { fromDateInput } from '@/lib/format'

const NO_BUDGET = 'none'

export default function NewBillPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const add = useCommand('addBill', { success: 'Bill added.' })
  const evidenceFiles = useEvidenceFiles()
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
  // Never an empty account by default: Vendors or Operations while it holds money, else the fullest.
  const [accountId, setAccountId] = useChoice(
    accounts.map((a) => a.id),
    defaultBillAccount(state, agencyId)?.id,
  )
  const [budgetId, setBudgetId] = React.useState(NO_BUDGET)
  const [notes, setNotes] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  // Once the vendor is chosen, only the budgets that can pay it; before, those that allow the category.
  const selectedVendor = destinations.find((d) => d.id === destinationId)
  const budgets = selectedVendor
    ? budgetsForVendor(state, agencyId, selectedVendor, category)
    : state.budgets.filter(
        (b) => b.agencyId === agencyId && b.status === 'active' && b.allowedCategories.includes(category),
      )
  const budget = budgets.find((b) => b.id === budgetId)
  // A bill paid from a budget comes out of the budget's own account.
  const sourceAccountId = budget ? budget.sourceAccountId : accountId
  const busy = add.phase !== 'idle' && add.phase !== 'failed' && add.phase !== 'completed'
  const document = files[0]

  const errors = {
    file: document ? (pendingUploads(files) ?? undefined) : 'Upload the bill.',
    destination: destinationId ? undefined : 'Choose the vendor.',
    number: number.trim() ? undefined : 'Enter the bill number.',
    dueDate: !dueDate
      ? 'Enter the due date.'
      : dueDate < issueDate
        ? 'The due date cannot be before the issue date.'
        : undefined,
    amount: amount ? undefined : 'Enter the amount.',
    account: sourceAccountId ? undefined : 'Choose the account that pays it.',
  }
  const valid = !Object.values(errors).some(Boolean)

  // The bill takes the vendor's category, whether picked from the list or just added, and the
  // budget that pays that vendor when exactly one can (with several, the Admin chooses).
  const selectVendor = (vendor: PaymentDestination) => {
    setDestinationId(vendor.id)
    setCategory(vendor.category)
    const fits = budgetsForVendor(state, agencyId, vendor, vendor.category)
    setBudgetId((fits.length === 1 ? fits[0]?.id : undefined) ?? NO_BUDGET)
  }
  const chooseVendor = (id: string) => {
    const vendor = destinations.find((d) => d.id === id)
    if (vendor) selectVendor(vendor)
  }

  const submit = async () => {
    setTouched(true)
    const issue = fromDateInput(issueDate)
    const due = fromDateInput(dueDate)
    if (!valid || !document || !destinationId || !amount || !sourceAccountId || !issue || !due) return
    const bill = await add.run({
      agencyId,
      destinationId,
      number: number.trim(),
      issueDate: issue,
      dueDate: due,
      amount,
      category,
      accountId: sourceAccountId,
      budgetId: budget?.id,
      document: toEvidence(document),
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
          onUpload={evidenceFiles.upload}
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
            <div className="flex flex-col gap-2">
              <SimpleSelect
                id="vendor"
                value={destinationId}
                onValueChange={chooseVendor}
                invalid={touched && Boolean(errors.destination)}
                options={destinations.map((d) => ({
                  value: d.id,
                  label: d.name,
                  description: providerKindLine(d),
                }))}
                placeholder="Choose a vendor"
                empty="No vendors yet"
              />
              <AddDestinationButton agencyId={agencyId} onAdded={selectVendor} label="Add a vendor" />
            </div>
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
          {budget ? null : (
            <FormField
              label="Account"
              htmlFor={accounts.length > 0 ? 'account' : undefined}
              error={touched ? errors.account : undefined}
            >
              {accounts.length === 0 ? (
                <CreateOperationsAccount
                  agencyId={agencyId}
                  description="Bills are paid from an Agency account."
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
          <FormField
            label="Budget"
            htmlFor="budget"
            optional
            className="sm:col-span-2"
            hint={
              budget
                ? `Paid from ${accountName(state, budget.sourceAccountId)}, under ${budget.name}’s rules.`
                : selectedVendor
                  ? 'Budgets that can pay this vendor. Paying from a budget applies its rules.'
                  : 'Budgets that allow this category. Paying from a budget applies its rules.'
            }
          >
            <SimpleSelect
              id="budget"
              value={budget ? budget.id : NO_BUDGET}
              onValueChange={setBudgetId}
              options={[
                { value: NO_BUDGET, label: 'No budget' },
                ...budgets.map((b) => ({
                  value: b.id,
                  label: b.name,
                  description: `${formatUsd(budgetUsage(state, b, now).available)} available`,
                })),
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

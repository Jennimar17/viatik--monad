'use client'

import { Plus } from 'lucide-react'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import Link from '@/components/viatik/link'
import { useCommand } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import type { PaymentDestination, SpendingCategory } from '@/domain/types'

/**
 * What an Agency needs before money can move: an account to hold it and
 * approved destinations to pay. Forms offer these in place, so a new Agency
 * never reaches a form it cannot finish.
 */

export const destinationKindLabel: Record<PaymentDestination['kind'], string> = {
  vendor: 'Vendor',
  service: 'Service',
  contractor: 'Contractor',
}

const KIND_OPTIONS = (Object.keys(destinationKindLabel) as PaymentDestination['kind'][]).map((kind) => ({
  value: kind,
  label: destinationKindLabel[kind],
}))

const CATEGORY_OPTIONS = (Object.keys(categoryLabel) as SpendingCategory[]).map((category) => ({
  value: category,
  label: categoryLabel[category],
}))

/** Shown where a form needs an Agency account and there is none yet: opens the Operations account. */
export function CreateOperationsAccount({
  agencyId,
  description,
  onCreated,
}: {
  agencyId: string
  /** Why this form needs an account, in one sentence. */
  description: string
  onCreated: (accountId: string) => void
}) {
  // Idempotent: if the account appeared meanwhile, the existing one is returned and selected.
  const create = useCommand('openOperationsAccount', { success: 'Operations account ready.' })
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium text-foreground">No account yet</p>
        <p className="text-xs text-pretty text-muted-foreground">{description}</p>
      </div>
      <Button
        size="pill-sm"
        variant="outline"
        className="shrink-0"
        disabled={create.isPending}
        onClick={async () => {
          const account = await create.run({ agencyId })
          if (account) onCreated(account.id)
        }}
      >
        {create.isPending ? 'Creating…' : 'Create Operations account'}
      </Button>
    </div>
  )
}

/** Next to a source account that holds no money yet: where money comes from. */
export function EmptySourceHint({
  name,
  fundingHref,
}: {
  name: string
  fundingHref: React.ComponentProps<typeof Link>['href']
}) {
  return (
    <>
      {name} has no money yet. Released funding lands in the Operations account first.{' '}
      <Link href={fundingHref} className="text-foreground underline-offset-4 hover:underline">
        Go to Funding
      </Link>
    </>
  )
}

/** A text button that adds an approved payment destination without leaving the form. */
export function AddDestinationButton({
  agencyId,
  onAdded,
  label = 'Add a payment destination',
}: {
  agencyId: string
  onAdded?: (destination: PaymentDestination) => void
  label?: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-fit items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Plus className="size-3.5" aria-hidden="true" /> {label}
      </button>
      <AddDestinationSheet open={open} onOpenChange={setOpen} agencyId={agencyId} onAdded={onAdded} />
    </>
  )
}

export function AddDestinationSheet({
  open,
  onOpenChange,
  agencyId,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencyId: string
  /** Runs once the destination exists, e.g. to select it in the form underneath. */
  onAdded?: (destination: PaymentDestination) => void
}) {
  const add = useCommand('addDestination')
  const [name, setName] = React.useState('')
  const [kind, setKind] = React.useState<PaymentDestination['kind']>('vendor')
  const [category, setCategory] = React.useState<SpendingCategory>('software')
  const [settlement, setSettlement] = React.useState('')
  const [website, setWebsite] = React.useState('')
  const trimmed = name.trim()

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setName('')
        setKind('vendor')
        setCategory('software')
        setSettlement('')
        setWebsite('')
        add.reset()
      }}
      title="Add payment destination"
      summary={{
        what: `${trimmed || 'This destination'} becomes an approved place the Agency can pay. Budgets can still restrict who pays it.`,
        reversible: 'You can leave it out of any budget’s allowed destinations.',
        policy: 'Payments can only go to approved destinations; settlement enforces it, not only the app.',
      }}
      confirmLabel="Add destination"
      disabled={trimmed.length < 2 || settlement.trim().length < 3}
      phase={add.phase}
      error={add.error}
      onConfirm={async () => {
        const destination = await add.run({
          agencyId,
          name: trimmed,
          kind,
          category,
          settlementLabel: settlement.trim(),
          website: website.trim() || undefined,
        })
        if (destination) onAdded?.(destination)
      }}
      success={{ title: 'Destination added', body: `${trimmed} can now be paid from budgets that allow it.` }}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Name" htmlFor="dest-name">
          <PillInput id="dest-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Type" htmlFor="dest-kind">
            <SimpleSelect
              id="dest-kind"
              value={kind}
              onValueChange={(value) => setKind(value as PaymentDestination['kind'])}
              options={KIND_OPTIONS}
            />
          </FormField>
          <FormField label="Category" htmlFor="dest-category">
            <SimpleSelect
              id="dest-category"
              value={category}
              onValueChange={(value) => setCategory(value as SpendingCategory)}
              options={CATEGORY_OPTIONS}
            />
          </FormField>
        </div>
        <FormField
          label="Settlement method"
          htmlFor="dest-settlement"
          hint="A generic label, e.g. “USDC account •• 9f3a” or “Card on file •• 1107”."
        >
          <PillInput
            id="dest-settlement"
            value={settlement}
            onChange={(e) => setSettlement(e.target.value)}
          />
        </FormField>
        <FormField label="Website" htmlFor="dest-website" optional>
          <PillInput
            id="dest-website"
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://"
          />
        </FormField>
      </div>
    </ApprovalSheet>
  )
}

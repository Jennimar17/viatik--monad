'use client'

import { TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { useCommand } from '@/data/react'
import { formatUsd, type Cents } from '@/domain/money'
import type { PaymentDestination, SpendingCategory } from '@/domain/types'
import { pluralize } from '@/lib/format'

import { providerCategoryOptions, providerKindOptions, type ProviderStatus } from './provider-parts'

// ─── Status: pause, resume, archive, restore ─────────────────────────────────

export type ProviderStatusAction = 'pause' | 'resume' | 'archive' | 'restore'

const targetStatus: Record<ProviderStatusAction, 'approved' | 'paused' | 'archived'> = {
  pause: 'paused',
  resume: 'approved',
  archive: 'archived',
  restore: 'approved',
}

export const providerActionLabel: Record<ProviderStatusAction, string> = {
  pause: 'Pause provider',
  resume: 'Resume provider',
  archive: 'Archive provider',
  restore: 'Restore provider',
}

/** What can happen next to a provider in each status. */
export function providerStatusActions(status: ProviderStatus): ProviderStatusAction[] {
  if (status === 'paused') return ['resume', 'archive']
  if (status === 'archived') return ['restore']
  // Pausing then resuming would approve it without a review: it can only be archived.
  if (status === 'pending_review') return ['archive']
  return ['pause', 'archive']
}

const REFUSED_POLICY = 'Viatik checks the provider’s status before every new payment, bill and request.'
const BUDGET_POLICY = 'Budgets and their limits still decide who can pay it and how much.'

function statusCopy(action: ProviderStatusAction, name: string) {
  switch (action) {
    case 'pause':
      return {
        what: `New payments, bill payments and requests to ${name} are refused while it is paused, including those from automations. Its history stays as it is.`,
        reversible: 'You can resume it at any time.',
        policy: REFUSED_POLICY,
        success: { title: 'Provider paused', body: `${name} cannot be paid until you resume it.` },
      }
    case 'resume':
      return {
        what: `${name} can be paid again from the budgets that allow it.`,
        reversible: 'You can pause it again at any time.',
        policy: BUDGET_POLICY,
        success: { title: 'Provider resumed', body: `${name} can be paid again.` },
      }
    case 'archive':
      return {
        what: `${name} moves to the Archived tab of Providers and cannot be paid. Its payments, bills and receipts stay in the history.`,
        reversible: 'You can restore it from the Archived tab at any time.',
        policy: REFUSED_POLICY,
        success: {
          title: 'Provider archived',
          body: `${name} is in the Archived tab. Restore it to pay it again.`,
        },
      }
    case 'restore':
      return {
        what: `${name} returns to the current providers and can be paid again from the budgets that allow it.`,
        reversible: 'You can archive it again at any time.',
        policy: BUDGET_POLICY,
        success: { title: 'Provider restored', body: `${name} can be paid again.` },
      }
  }
}

/**
 * Confirms a status change. `action` is fixed by the caller when the sheet
 * opens, so the copy does not flip once the change lands.
 */
export function ProviderStatusSheet({
  open,
  onOpenChange,
  provider,
  action,
  openBills,
  pendingRequests = 0,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: PaymentDestination
  action: ProviderStatusAction
  /** Bills still to pay to this provider: they wait while it is paused or archived. */
  openBills?: { count: number; total: Cents }
  /** Requests to pay this provider that were sent before and still wait for a decision. */
  pendingRequests?: number
}) {
  const change = useCommand('setDestinationStatus')
  const copy = statusCopy(action, provider.name)
  const stopping = action === 'pause' || action === 'archive'
  const warn =
    'flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty'

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={change.reset}
      title={providerActionLabel[action]}
      description={provider.name}
      summary={{ what: copy.what, reversible: copy.reversible, policy: copy.policy }}
      confirmLabel={providerActionLabel[action]}
      confirmVariant={stopping ? 'destructive' : 'default'}
      phase={change.phase}
      error={change.error}
      onConfirm={() => change.run({ destinationId: provider.id, status: targetStatus[action] })}
      success={copy.success}
    >
      {stopping && ((openBills && openBills.count > 0) || pendingRequests > 0) ? (
        <div className="flex flex-col gap-3">
          {openBills && openBills.count > 0 ? (
            <div className={warn}>
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                {pluralize(openBills.count, 'bill')} to pay for {provider.name} (
                {formatUsd(openBills.total, { withCode: true })}) cannot be paid until you{' '}
                {action === 'pause' ? 'resume' : 'restore'} it.
              </span>
            </div>
          ) : null}
          {pendingRequests > 0 ? (
            <div className={warn}>
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                {pluralize(pendingRequests, 'request')} to pay {provider.name}{' '}
                {pendingRequests === 1 ? 'is' : 'are'} still waiting for a decision. Decline the ones that
                should not be paid.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </ApprovalSheet>
  )
}

// ─── Edit details ────────────────────────────────────────────────────────────

type Draft = {
  name: string
  kind: PaymentDestination['kind']
  category: SpendingCategory
  settlementLabel: string
  website: string
}

const draftOf = (provider: PaymentDestination): Draft => ({
  name: provider.name,
  kind: provider.kind,
  category: provider.category,
  settlementLabel: provider.settlementLabel,
  website: provider.website ?? '',
})

/** The same fields as adding a payment destination, starting from the provider's current details. */
export function ProviderEditSheet({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: PaymentDestination
}) {
  const update = useCommand('updateDestination')
  // Untouched, the form follows the provider; the first edit starts a draft, closing drops it.
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const value = draft ?? draftOf(provider)
  const edit = (patch: Partial<Draft>) => setDraft({ ...value, ...patch })

  const name = value.name.trim()
  const settlement = value.settlementLabel.trim()
  const website = value.website.trim()
  const changes = {
    ...(name !== provider.name ? { name } : {}),
    ...(value.kind !== provider.kind ? { kind: value.kind } : {}),
    ...(value.category !== provider.category ? { category: value.category } : {}),
    ...(settlement !== provider.settlementLabel ? { settlementLabel: settlement } : {}),
    // An empty website clears it.
    ...(website !== (provider.website ?? '') ? { website } : {}),
  }
  const changed = Object.keys(changes).length > 0
  const errors = {
    name: name.length < 2 ? 'Enter at least 2 characters.' : undefined,
    settlement: settlement.length < 3 ? 'Enter at least 3 characters.' : undefined,
  }

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setDraft(null)
        update.reset()
      }}
      title="Edit provider"
      description={provider.name}
      summary={{
        what: `Saves the new details of ${name || provider.name}. Budgets, automations and bills that use it keep working with it.`,
        reversible: 'You can edit these details again at any time.',
        policy: 'Only Agency Admins can change a provider. Every change is recorded in Activity.',
      }}
      confirmLabel="Save changes"
      disabled={!changed || Boolean(errors.name) || Boolean(errors.settlement)}
      phase={update.phase}
      error={update.error}
      onConfirm={() => update.run({ destinationId: provider.id, ...changes })}
      success={{ title: 'Provider updated', body: `${name || provider.name} has its new details.` }}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Name" htmlFor="provider-name" error={draft ? errors.name : undefined}>
          <PillInput
            id="provider-name"
            value={value.name}
            maxLength={80}
            onChange={(e) => edit({ name: e.target.value })}
            aria-invalid={draft && errors.name ? true : undefined}
          />
        </FormField>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Type" htmlFor="provider-kind">
            <SimpleSelect
              id="provider-kind"
              value={value.kind}
              onValueChange={(kind) => edit({ kind: kind as PaymentDestination['kind'] })}
              options={providerKindOptions}
            />
          </FormField>
          <FormField label="Category" htmlFor="provider-category">
            <SimpleSelect
              id="provider-category"
              value={value.category}
              onValueChange={(category) => edit({ category: category as SpendingCategory })}
              options={providerCategoryOptions}
            />
          </FormField>
        </div>
        <FormField
          label="Settlement method"
          htmlFor="provider-settlement"
          hint="A generic label, e.g. “USDC account •• 9f3a” or “Card on file •• 1107”."
          error={draft ? errors.settlement : undefined}
        >
          <PillInput
            id="provider-settlement"
            value={value.settlementLabel}
            maxLength={80}
            onChange={(e) => edit({ settlementLabel: e.target.value })}
            aria-invalid={draft && errors.settlement ? true : undefined}
          />
        </FormField>
        <FormField
          label="Website"
          htmlFor="provider-website"
          optional
          hint={provider.website ? 'Leave it empty to remove the website.' : undefined}
        >
          <PillInput
            id="provider-website"
            type="url"
            value={value.website}
            maxLength={300}
            onChange={(e) => edit({ website: e.target.value })}
            placeholder="https://"
          />
        </FormField>
      </div>
    </ApprovalSheet>
  )
}

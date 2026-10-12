'use client'

import { ArrowDown } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { FormActions, MoneyInput } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { accountBalance } from '@/domain/selectors'

export default function TransferPage() {
  // useSearchParams needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <Transfer />
    </React.Suspense>
  )
}

function Transfer() {
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const params = useSearchParams()
  const transfer = useCommand('transferFunds')
  const steps = useSigningSteps(transfer.phase, {
    prepared: "Viatik checks the transfer against the account's balance and the ledger's rules.",
    done: { label: 'Recorded on Monad', detail: 'Moved between the Agency’s accounts.' },
  })
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const [fromId, setFromId] = React.useState<string | null>(
    params.get('from') ?? accounts.find((a) => a.template === 'operations')?.id ?? accounts[0]?.id ?? null,
  )
  const [toChoice, setToChoice] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [note, setNote] = React.useState('')
  const [open, setOpen] = React.useState(false)
  useBottomBar(accounts.length > 1)

  // The destination never equals the source; default to the People account.
  const toId =
    toChoice && toChoice !== fromId
      ? toChoice
      : (accounts.find((a) => a.id !== fromId && a.template === 'people')?.id ??
        accounts.find((a) => a.id !== fromId)?.id ??
        null)
  const from = accounts.find((a) => a.id === fromId)
  const to = accounts.find((a) => a.id === toId)
  const available = from ? accountBalance(state, from.id) : ZERO
  // With no money in any account, say where it comes from instead of an error.
  const nothingToMove = accounts.every((a) => accountBalance(state, a.id) === 0)
  const elsewhere = accounts.some((a) => a.id !== fromId && accountBalance(state, a.id) > 0)
  const error =
    !nothingToMove && amount !== null && amount > available
      ? `${from?.name ?? 'The source account'} has ${formatUsd(available, { withCode: true })} available.${elsewhere ? ' Choose another source account.' : ''}`
      : undefined
  const options = accounts.map((a) => ({
    value: a.id,
    label: a.name,
    description: `${formatUsd(accountBalance(state, a.id))} available`,
  }))

  if (accounts.length < 2) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Transfer funds" />
        <EmptyState
          title="Nothing to transfer between"
          description="Transfers move money between two accounts of the Agency. Create a second account first."
          action={
            <ButtonLink href={href('accounts/new')} size="pill">
              Create account
            </ButtonLink>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('accounts')} className="hover:text-foreground">
            Accounts
          </Link>
        }
        title="Transfer funds"
        description="Move money between the Agency’s own accounts."
      />

      <Panel>
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <FormField label="From" htmlFor="from">
              <SimpleSelect id="from" value={fromId} onValueChange={setFromId} options={options} />
            </FormField>
            <span
              className="mx-auto flex size-9 items-center justify-center rounded-full border border-border text-subtle sm:mb-1"
              aria-hidden="true"
            >
              <ArrowDown className="size-4 sm:-rotate-90" />
            </span>
            <FormField label="To" htmlFor="to">
              <SimpleSelect
                id="to"
                value={toId}
                onValueChange={setToChoice}
                options={options.filter((o) => o.value !== fromId)}
              />
            </FormField>
          </div>
          <FormField
            label="Amount"
            htmlFor="amount"
            error={error}
            hint={
              nothingToMove ? (
                <>
                  No account holds money yet. Released funding lands in the Operations account first.{' '}
                  <Link href={href('funding')} className="text-foreground underline-offset-4 hover:underline">
                    Go to Funding
                  </Link>
                </>
              ) : undefined
            }
          >
            <MoneyInput
              id="amount"
              value={amount}
              onChange={setAmount}
              available={available}
              invalid={Boolean(error)}
            />
          </FormField>
          <FormField label="Note" htmlFor="note" optional>
            <PillInput
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Fund October contractor payments"
            />
          </FormField>
        </div>
      </Panel>

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('accounts'))}>
          Cancel
        </Button>
        <Button
          size="pill-sm"
          disabled={!amount || !from || !to || Boolean(error) || amount > available}
          onClick={() => setOpen(true)}
        >
          Review transfer
        </Button>
      </FormActions>

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={transfer.reset}
        title="Transfer funds"
        summary={{
          what: `Money moves from ${from?.name} to ${to?.name}. It stays inside the Agency.`,
          amount: amount ?? undefined,
          from: from?.name,
          to: to?.name,
          reversible: 'You can transfer it back at any time.',
          policy: 'Transfers can only move money between accounts of the same Agency.',
        }}
        confirmLabel="Transfer funds"
        phase={transfer.phase}
        error={transfer.error}
        steps={steps}
        onConfirm={() =>
          amount &&
          from &&
          to &&
          transfer.run({
            agencyId,
            fromAccountId: from.id,
            toAccountId: to.id,
            amount,
            note: note.trim() || undefined,
          })
        }
        success={{
          title: 'Transfer completed',
          body: `${formatUsd(amount ?? ZERO, { withCode: true })} is now in ${to?.name}.`,
          actions: to ? (
            <ButtonLink href={href(`accounts/${to.id}`)} size="pill-sm">
              View {to.name}
            </ButtonLink>
          ) : undefined,
        }}
      />
    </div>
  )
}

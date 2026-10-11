'use client'

import { TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect, useChoice } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { usePermissions, useRole } from '@/components/app/role-context'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { useCommand, useLedger, useViatikState } from '@/data/react'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { activeOperationsAccount, governingAgreement, receiptFor } from '@/domain/queries'
import { accountBalance } from '@/domain/selectors'
import type { Id } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'

/**
 * Return to Investor: an Agency Admin sends money from an Agency account back
 * to the Investor's Portfolio Vault (`returnToInvestor`). It counts as Returned
 * in the funding agreement that governs the Agency and cannot be undone: the
 * Agency only gets the money back if the Investor funds it again.
 *
 * With `accountId` the account is fixed (the account page); without it the
 * person picks one of the Agency's active accounts (the Accounts page).
 */
export function ReturnToInvestorSheet({
  open,
  onOpenChange,
  agencyId,
  accountId: fixedId,
  onClosed,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencyId: Id
  /** The account to return from; omit it to let the person choose. */
  accountId?: Id
  /** Runs once the sheet has closed, after its own reset. */
  onClosed?: () => void
}) {
  const { state } = useViatikState()
  const { portfolioId } = useRole()
  const { can } = usePermissions()
  const { view } = useLedger()
  const giveBack = useCommand('returnToInvestor')
  const steps = useSigningSteps(giveBack.phase, {
    prepared: "Viatik checks the return against the account's balance and the ledger's rules.",
    done: { label: 'Returned', detail: 'Recorded on Monad and back in the Portfolio Vault.' },
  })
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [note, setNote] = React.useState('')
  const [receiptId, setReceiptId] = React.useState<string | null>(null)

  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  // Money that comes back from the Agency usually sits where released funding landed.
  const operations = activeOperationsAccount(state, agencyId)
  const richest = [...accounts].sort((a, b) => accountBalance(state, b.id) - accountBalance(state, a.id))[0]
  const [chosenId, setChosenId] = useChoice(
    accounts.map((a) => a.id),
    operations && accountBalance(state, operations.id) > 0 ? operations.id : (richest?.id ?? operations?.id),
  )
  const account = fixedId
    ? state.accounts.find((a) => a.id === fixedId && a.agencyId === agencyId)
    : accounts.find((a) => a.id === chosenId)
  const frozen = account?.status === 'frozen'
  const balance = account ? accountBalance(state, account.id) : ZERO
  const over = amount !== null && amount > balance
  const portfolioName = state.portfolios.find((p) => p.id === portfolioId)?.name ?? 'the Investor'
  const vaultLabel = `${state.portfolios.find((p) => p.id === portfolioId)?.name ?? 'Portfolio'} · Portfolio Vault`
  const agreement = governingAgreement(state, agencyId)
  const receipt = receiptFor(state, receiptId ?? undefined)
  const monad = view?.settlement === 'monad' ? view : null
  const paused = Boolean(monad && !monad.available)
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const locked = giveBack.isPending
  const amountText = amount ? formatUsd(amount, { withCode: true }) : 'The amount you enter'

  if (!can('return_capital', { agencyId })) return null

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        giveBack.reset()
        setAmount(null)
        setNote('')
        setReceiptId(null)
        onClosed?.()
      }}
      title="Return to Investor"
      description={account ? `From ${account.name}` : 'From an Agency account'}
      summary={{
        what: `${amountText} leaves ${account?.name ?? 'the Agency account'} and goes back to ${portfolioName}’s Portfolio Vault.`,
        amount: amount ?? undefined,
        from: account?.name ?? 'Agency account',
        to: vaultLabel,
        reversible: 'Cannot be undone. The Agency only gets it back if the Investor funds it again.',
        policy: `Capital return · from an Agency account to its Portfolio Vault.${agreement ? ` Counted as Returned in “${agreement.title}”.` : ''}`,
      }}
      confirmLabel="Return to Investor"
      disabled={!account || frozen || !amount || amount <= 0 || over || paused}
      phase={giveBack.phase}
      error={giveBack.error}
      steps={steps}
      onConfirm={async () => {
        if (!account || !amount) return
        const result = await giveBack.run({
          agencyId,
          accountId: account.id,
          amount,
          note: note.trim() || undefined,
        })
        if (result) setReceiptId(result.id)
      }}
      success={{
        title: 'Returned to the Investor',
        body: `${formatUsd(amount ?? ZERO, { withCode: true })} is back in ${portfolioName}’s Portfolio Vault.${agreement ? ` It counts as Returned in “${agreement.title}”.` : ''} The Investor was notified.`,
        actions: receipt ? (
          <>
            <ButtonLink href={receiptHref(receipt.id)} variant="outline" size="pill-sm">
              View receipt
            </ButtonLink>
            <ReceiptDetailsButton receipt={receipt} />
          </>
        ) : undefined,
      }}
    >
      <div className="flex flex-col gap-5">
        {fixedId ? null : (
          <FormField label="From" htmlFor="return-account">
            <SimpleSelect
              id="return-account"
              value={chosenId}
              onValueChange={(value) => {
                setChosenId(value)
                setAmount(null)
              }}
              disabled={locked}
              options={accounts.map((a) => ({
                value: a.id,
                label: a.name,
                description: `${formatUsd(accountBalance(state, a.id))} available`,
              }))}
              empty="No active Agency account"
            />
          </FormField>
        )}

        {frozen && account ? (
          <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            {account.name} is frozen: it cannot move money until it is active again.
          </p>
        ) : (
          <FormField
            label="Amount"
            htmlFor="return-amount"
            error={
              over && account
                ? `${account.name} has ${formatUsd(balance, { withCode: true })} available.`
                : undefined
            }
            hint={account && balance === 0 ? `${account.name} has nothing to return.` : undefined}
          >
            <MoneyInput
              id="return-amount"
              value={amount}
              onChange={setAmount}
              available={account ? balance : undefined}
              invalid={over}
              disabled={locked || !account || balance === 0}
            />
            {balance > 0 ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto w-fit px-5 py-0"
                disabled={locked || amount === balance}
                onClick={() => setAmount(balance)}
              >
                Return everything
              </Button>
            ) : null}
          </FormField>
        )}

        <FormField
          label="Note"
          htmlFor="return-note"
          optional
          hint="Why it goes back. The Investor sees it on the receipt."
        >
          <PillInput
            id="return-note"
            value={note}
            maxLength={300}
            disabled={locked || frozen}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Unused Q3 budget"
          />
        </FormField>

        <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          This cannot be undone. The money is the Investor’s again, and the Agency gets it back only if the
          Investor funds it again.
        </p>

        {paused ? (
          <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            Returns are paused: Viatik cannot reach {network.name} right now. Try again later.
          </p>
        ) : null}
      </div>
    </ApprovalSheet>
  )
}

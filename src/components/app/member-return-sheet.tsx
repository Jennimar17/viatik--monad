'use client'

import * as React from 'react'

import { FormField } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'

/**
 * "Return unused funds": the Member sends money they no longer need back to the
 * Agency's Operations account, up to what they hold. Ends with the receipt.
 */
export function MemberReturnSheet({
  open,
  onOpenChange,
  agencyId,
  agencyName,
  held,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencyId: string
  agencyName: string
  /** What the person holds in this Agency: the most they can return. */
  held: Cents
}) {
  const { state } = useViatikState()
  const giveBack = useCommand('returnUnusedFunds')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [receiptId, setReceiptId] = React.useState<string | null>(null)

  const operations = state.accounts.find((a) => a.agencyId === agencyId && a.template === 'operations')
  const operationsName = operations?.name ?? 'Operations'
  const overHeld = Boolean(amount && amount > held)
  const receipt = receiptFor(state, receiptId ?? undefined)

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        giveBack.reset()
        setAmount(null)
        setReceiptId(null)
      }}
      title="Return unused funds"
      summary={{
        what: `The amount goes back to ${agencyName}’s ${operationsName} account and becomes available to the Agency again.`,
        amount: amount ?? undefined,
        from: 'You',
        to: `${agencyName} · ${operationsName}`,
        reversible: 'Cannot be undone. Your Agency can pay you again if needed.',
        policy: `You can return up to ${formatUsd(held, { withCode: true })}, what you received from this Agency. The return gets a receipt in the verified record.`,
      }}
      confirmLabel="Return funds"
      disabled={!amount || overHeld}
      phase={giveBack.phase}
      error={giveBack.error}
      onConfirm={async () => {
        if (!amount) return
        const result = await giveBack.run({ agencyId, amount })
        if (result) setReceiptId(result.id)
      }}
      success={{
        title: 'Funds returned',
        body: `${formatUsd(amount ?? ZERO, { withCode: true })} is back with ${agencyName}.`,
        actions: <ReceiptDetailsButton receipt={receipt} />,
      }}
    >
      <FormField
        label="Amount"
        htmlFor="return-amount"
        error={overHeld ? `You can return up to ${formatUsd(held, { withCode: true })}.` : undefined}
      >
        <MoneyInput
          id="return-amount"
          value={amount}
          onChange={setAmount}
          available={held}
          invalid={overHeld}
        />
      </FormField>
    </ApprovalSheet>
  )
}

'use client'

import * as React from 'react'

import { FormField, SimpleSelect, type Option } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { advanceDueText, advanceTitle } from '@/components/app/request-parts'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { useCommand, useViatikState } from '@/data/react'
import { advancesOf, otherMoneyReturnable, returnableFor } from '@/domain/accountability'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import type { Id } from '@/domain/types'
import { formatDate } from '@/lib/format'

/** The select value for money that is not one of the person's open money for purchases. */
const OTHER = 'other'

/**
 * "Return unused funds": the Member sends money they no longer need back to the
 * Agency's Operations account. With money for purchases still open, they say
 * what they are returning: one of those (the oldest by default), which the
 * return settles, or "Other money", which is only what their Viatik balance
 * holds beyond what those still have pending. Ends with the receipt.
 */
export function MemberReturnSheet({
  open,
  onOpenChange,
  agencyId,
  agencyName,
  advanceId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencyId: string
  agencyName: string
  /** Money for purchases to preselect (e.g. "Return the rest" on its request); the oldest open one otherwise. */
  advanceId?: Id
}) {
  const { state, now, userId } = useViatikState()
  const giveBack = useCommand('returnUnusedFunds')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [choice, setChoice] = React.useState<string | null>(null)
  const [receiptId, setReceiptId] = React.useState<string | null>(null)

  const operations = state.accounts.find((a) => a.agencyId === agencyId && a.template === 'operations')
  const operationsName = operations?.name ?? 'Operations'
  const receipt = receiptFor(state, receiptId ?? undefined)

  // Money for purchases with something still to justify or return, newest first.
  const openAdvances = advancesOf(state, { agencyId, userId }, now).filter((s) => s.pending > 0)
  const oldest = openAdvances[openAdvances.length - 1]
  // "Other money" is what the Viatik balance holds beyond what that money for purchases still has
  // pending: unused money for purchases goes back against the payment it came from.
  const otherCap = otherMoneyReturnable(state, { agencyId, userId }, now)
  const wanted = choice ?? advanceId ?? null
  // The oldest open money for purchases (the first one due) is the default. It also takes over from a
  // choice that is no longer open (settled meanwhile), or from "Other money" once nothing is left in it.
  const advance =
    openAdvances.find((s) => s.payment.id === wanted) ??
    (wanted === OTHER && otherCap > 0 ? undefined : oldest)
  // Money for purchases goes back only from what is still pending and still in the Viatik balance.
  const cap = advance ? returnableFor(state, advance) : otherCap
  const overCap = Boolean(amount && amount > cap)
  const capText = formatUsd(cap, { withCode: true })

  const options: Option[] = [
    ...openAdvances.map((s) => ({
      value: s.payment.id,
      label: `${advanceTitle(s)} · ${formatUsd(s.pending)} pending`,
      description: `Received ${formatDate(s.payment.completedAt ?? s.payment.scheduledFor)}`,
    })),
    {
      value: OTHER,
      label: 'Other money',
      // Nothing beyond what is pending: the return has to name the money for purchases it settles.
      description:
        otherCap > 0
          ? `Up to ${formatUsd(otherCap)} from your Viatik balance`
          : 'Choose which money for purchases you are returning.',
      disabled: otherCap <= 0,
    },
  ]

  const choiceHint = advance
    ? `${formatUsd(advance.pending, { withCode: true })} still to justify or return, ${advanceDueText(advance)}.${
        cap < advance.pending
          ? ` Only ${capText} is still in your Viatik balance: add receipts for the rest.`
          : ''
      }`
    : 'What your Viatik balance holds beyond the money for purchases you still have pending.'

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        giveBack.reset()
        setAmount(null)
        setChoice(null)
        setReceiptId(null)
      }}
      title="Return unused funds"
      summary={{
        what: `The amount goes back to ${agencyName}’s ${operationsName} account and becomes available to the Agency again.`,
        amount: amount ?? undefined,
        from: 'You',
        to: `${agencyName} · ${operationsName}`,
        reversible: 'Cannot be undone. Your Agency can pay you again if needed.',
        policy: advance
          ? `You can return up to ${capText} of “${advanceTitle(advance)}”: what is still pending and still in your Viatik balance. The return settles that money and gets a receipt in the verified record.`
          : oldest
            ? `You can return up to ${capText}: what your Viatik balance holds beyond the money for purchases you still have pending. The return gets a receipt in the verified record.`
            : `You can return up to ${capText}, what you received from this Agency. The return gets a receipt in the verified record.`,
      }}
      confirmLabel="Return funds"
      disabled={!amount || overCap}
      phase={giveBack.phase}
      error={giveBack.error}
      onConfirm={async () => {
        if (!amount) return
        const result = await giveBack.run({
          agencyId,
          amount,
          // Money for purchases names the payment it settles.
          ...(advance ? { paymentId: advance.payment.id } : {}),
        })
        if (result) setReceiptId(result.id)
      }}
      success={{
        title: 'Funds returned',
        body: `${formatUsd(amount ?? ZERO, { withCode: true })} is back with ${agencyName}.`,
        actions: <ReceiptDetailsButton receipt={receipt} />,
      }}
    >
      <div className="flex flex-col gap-4">
        {openAdvances.length > 0 ? (
          <FormField label="What are you returning?" htmlFor="return-choice" hint={choiceHint}>
            <SimpleSelect
              id="return-choice"
              value={advance?.payment.id ?? OTHER}
              onValueChange={setChoice}
              options={options}
              disabled={giveBack.isPending}
            />
          </FormField>
        ) : null}
        <FormField
          label="Amount"
          htmlFor="return-amount"
          error={overCap ? `You can return up to ${capText}.` : undefined}
        >
          <MoneyInput
            id="return-amount"
            value={amount}
            onChange={setAmount}
            available={cap}
            invalid={overCap}
          />
        </FormField>
      </div>
    </ApprovalSheet>
  )
}

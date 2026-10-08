'use client'

import { Undo2 } from 'lucide-react'
import * as React from 'react'

import { FormField } from '@/components/app/form-controls'
import { MemberViatikAccount } from '@/components/app/member-viatik-account'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { usePermissions, useRole } from '@/components/app/role-context'
import { SettingsPage } from '@/components/app/settings-page'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { Panel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import { memberHeld } from '@/domain/engine/operations'
import { cents, clampToZero, formatUsd, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'

export default function ProfilePage() {
  const { state, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const { can } = usePermissions()
  // Sending out and returning both take the person's own balance: the engine authorizes `receive_payout`.
  const canMoveOwn = can('receive_payout', { ownerUserId: userId })
  const agency = state.agencies.find((a) => a.id === agencyId)
  const agencyName = agency?.name ?? 'your Agency'
  const [returnOpen, setReturnOpen] = React.useState(false)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [returnReceiptId, setReturnReceiptId] = React.useState<string | null>(null)
  const giveBack = useCommand('returnUnusedFunds')

  // What the person still holds from this Agency: paid to them, minus what they returned or sent out.
  const held = clampToZero(cents(memberHeld(state, agencyId, userId)))
  const operations = state.accounts.find((a) => a.agencyId === agencyId && a.template === 'operations')
  const overHeld = Boolean(amount && amount > held)
  const returnReceipt = receiptFor(state, returnReceiptId ?? undefined)

  return (
    <SettingsPage
      title="Profile"
      leading={
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <MemberViatikAccount
            agencyId={agencyId}
            agencyName={agencyName}
            held={held}
            canSend={canMoveOwn}
            className="lg:col-span-2"
          />
          <Panel
            title="Return unused funds"
            description={`Send money you no longer need back to ${agencyName}.`}
            className="lg:self-start"
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {held > 0
                  ? `You hold ${formatUsd(held, { withCode: true })} received from ${agencyName}.`
                  : `Nothing to return: ${agencyName} has not paid you yet, or you already sent or returned everything.`}
              </p>
              {canMoveOwn ? (
                <Button
                  variant="outline"
                  size="pill-sm"
                  className="w-fit"
                  disabled={held <= 0}
                  onClick={() => setReturnOpen(true)}
                >
                  <Undo2 data-icon="inline-start" /> Return unused funds
                </Button>
              ) : null}
            </div>
          </Panel>
        </div>
      }
    >
      <ApprovalSheet
        open={returnOpen}
        onOpenChange={setReturnOpen}
        onClosed={() => {
          giveBack.reset()
          setAmount(null)
          setReturnReceiptId(null)
        }}
        title="Return unused funds"
        summary={{
          what: `The amount goes back to ${agencyName}’s ${operations?.name ?? 'Operations'} account and becomes available to the Agency again.`,
          amount: amount ?? undefined,
          from: 'You',
          to: `${agencyName} · ${operations?.name ?? 'Operations'}`,
          reversible: 'Cannot be undone. Your Agency can pay you again if needed.',
          policy: `You can return up to ${formatUsd(held, { withCode: true })}, what you received from this Agency. The return gets a receipt in the verified record.`,
        }}
        confirmLabel="Return funds"
        disabled={!amount || overHeld}
        phase={giveBack.phase}
        error={giveBack.error}
        onConfirm={async () => {
          if (!amount) return
          const receipt = await giveBack.run({ agencyId, amount })
          if (receipt) setReturnReceiptId(receipt.id)
        }}
        success={{
          title: 'Funds returned',
          body: `${formatUsd(amount ?? ZERO, { withCode: true })} is back with ${agencyName}.`,
          actions: <ReceiptDetailsButton receipt={returnReceipt} />,
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
    </SettingsPage>
  )
}

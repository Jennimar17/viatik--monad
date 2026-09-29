'use client'

import { Undo2, Wallet } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useRole } from '@/components/app/role-context'
import { SettingsPage } from '@/components/app/settings-page'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { Panel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import { cents, clampToZero, formatUsd, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'

type PayoutMethod = 'viatik' | 'usdc'

// Payouts settle in USDC: to the person's own Viatik account by default, or to
// an external USDC account they name. Local rails are not offered for now.
const METHOD_OPTIONS: { value: PayoutMethod; label: string }[] = [
  { value: 'viatik', label: 'Viatik account' },
  { value: 'usdc', label: 'External USDC account' },
]

type PayoutDestination = { method: PayoutMethod; label: string }

const DEFAULT_DESTINATION: PayoutDestination = { method: 'viatik', label: 'Viatik account •• 2291' }

const isMethod = (value: unknown): value is PayoutMethod =>
  METHOD_OPTIONS.some((option) => option.value === value)

/**
 * Where the Agency pays this person. There is no server side for it yet, so
 * it lives on the device like the other preferences; the accounts phase moves
 * it to the person's verified payout account.
 */
function usePayoutDestination(userId: string) {
  const key = `viatik:payout-destination:${userId}`
  const [destination, setDestination] = React.useState<PayoutDestination>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      const stored = raw ? (JSON.parse(raw) as Partial<PayoutDestination>) : null
      // Older saved choices (e.g. a bank account) fall back to the default.
      return stored && isMethod(stored.method) && stored.label
        ? { method: stored.method, label: stored.label }
        : DEFAULT_DESTINATION
    } catch {
      return DEFAULT_DESTINATION
    }
  })
  const save = React.useCallback(
    (next: PayoutDestination) => {
      setDestination(next)
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Storage unavailable: the choice lasts for this visit only.
      }
    },
    [key],
  )
  return [destination, save] as const
}

export default function ProfilePage() {
  const { state, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const agency = state.agencies.find((a) => a.id === agencyId)
  const agencyName = agency?.name ?? 'your Agency'
  const [destination, saveDestination] = usePayoutDestination(userId)
  const [destinationOpen, setDestinationOpen] = React.useState(false)
  const [method, setMethod] = React.useState<PayoutMethod>(destination.method)
  const [label, setLabel] = React.useState(destination.label)
  const [returnOpen, setReturnOpen] = React.useState(false)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [returnReceiptId, setReturnReceiptId] = React.useState<string | null>(null)
  const giveBack = useCommand('returnUnusedFunds')

  // What the person still holds from this Agency: paid to them, minus what they sent back.
  const held = clampToZero(
    cents(
      state.movements.reduce((total, m) => {
        if (m.agencyId !== agencyId) return total
        const toMe =
          m.to.kind === 'recipient' && m.to.recipient.kind === 'member' && m.to.recipient.userId === userId
        const fromMe =
          m.from.kind === 'recipient' &&
          m.from.recipient.kind === 'member' &&
          m.from.recipient.userId === userId
        return total + (toMe ? m.amount : 0) - (fromMe ? m.amount : 0)
      }, 0),
    ),
  )
  const operations = state.accounts.find((a) => a.agencyId === agencyId && a.template === 'operations')
  const overHeld = Boolean(amount && amount > held)
  const returnReceipt = receiptFor(state, returnReceiptId ?? undefined)

  return (
    <SettingsPage
      title="Profile"
      leading={
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Payment destination" description={`Where ${agencyName} sends your payments.`}>
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-subtle">
                <Wallet className="size-5" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{destination.label}</span>
                <span className="text-xs text-subtle">
                  {METHOD_OPTIONS.find((m) => m.value === destination.method)?.label} · default for payouts
                </span>
              </span>
              <Button
                variant="outline"
                size="pill-sm"
                onClick={() => {
                  setMethod(destination.method)
                  setLabel(destination.label)
                  setDestinationOpen(true)
                }}
              >
                Change
              </Button>
            </div>
          </Panel>
          <Panel
            title="Return unused funds"
            description={`Send money you no longer need back to ${agencyName}.`}
          >
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {held > 0
                  ? `You hold ${formatUsd(held, { withCode: true })} received from ${agencyName}.`
                  : `Nothing to return: ${agencyName} has not paid you yet, or you returned everything.`}
              </p>
              <Button
                variant="outline"
                size="pill-sm"
                className="w-fit"
                disabled={held <= 0}
                onClick={() => setReturnOpen(true)}
              >
                <Undo2 data-icon="inline-start" /> Return unused funds
              </Button>
            </div>
          </Panel>
        </div>
      }
    >
      <ApprovalSheet
        open={destinationOpen}
        onOpenChange={setDestinationOpen}
        title="Change payment destination"
        summary={{
          what: `Future payments from ${agencyName} go to ${label.trim() || 'the new destination'}.`,
          reversible: 'You can change it again at any time.',
          policy: 'Your Agency Admin sees the new destination before the next payment.',
        }}
        confirmLabel="Save destination"
        disabled={label.trim().length < 3}
        phase="idle"
        onConfirm={() => {
          saveDestination({ method, label: label.trim() })
          setDestinationOpen(false)
          toast.success('Payment destination saved.')
        }}
      >
        <div className="flex flex-col gap-4">
          <FormField label="Settlement method" htmlFor="payout-method">
            <SimpleSelect
              id="payout-method"
              value={method}
              onValueChange={(value) => setMethod(value as PayoutMethod)}
              options={METHOD_OPTIONS}
            />
          </FormField>
          <FormField label="Label" htmlFor="payout-label" hint="Only the last digits are shown in Viatik.">
            <PillInput id="payout-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
        </div>
      </ApprovalSheet>

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

'use client'

import * as React from 'react'

import { FormField, SimpleSelect, type Option } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { CopyButton } from '@/components/viatik/operation'
import { useCommand, useViatikState } from '@/data/react'
import { shortAddress } from '@/domain/address'
import { formatUsd, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'

import { sameAddress, type OwnAccount } from './member-own-account'
import { useSavedAddresses } from './member-saved-addresses'

/** The select value for the person's own account; saved addresses use their id. */
const OWN = 'own'

type Destination = Option & { address: string }

type Sent = { amount: Cents; label: string; address: string }

/**
 * "Send to my account": the person takes money out of their Viatik balance in
 * one Agency, to their own account (the default) or an address they saved. The
 * full address is on screen before anything is sent; a saved address also needs
 * an explicit "the address is correct". Ends with the receipt.
 */
export function MemberWithdrawSheet({
  open,
  onOpenChange,
  agencyId,
  agencyName,
  held,
  own,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencyId: string
  agencyName: string
  /** The person's balance with this Agency: the most they can send. */
  held: Cents
  own: OwnAccount
}) {
  const { state } = useViatikState()
  const saved = useSavedAddresses()
  const send = useCommand('withdrawBalance')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [picked, setPicked] = React.useState<string | null>(null)
  // The address the person confirmed: a confirmation never carries over to another destination.
  const [confirmedFor, setConfirmedFor] = React.useState<string | null>(null)
  const [receiptId, setReceiptId] = React.useState<string | null>(null)
  // What went out, for the success message once the balance has changed.
  const [sent, setSent] = React.useState<Sent | null>(null)

  const destinations: Destination[] = [
    ...(own.address
      ? [{ value: OWN, label: 'My account', description: shortAddress(own.address), address: own.address }]
      : []),
    ...saved.map((a) => ({
      value: a.id,
      label: a.label,
      description: shortAddress(a.address),
      address: a.address,
    })),
  ]
  // Until the person picks, the default is their own account; a saved address removed meanwhile falls back too.
  const destination = destinations.find((d) => d.value === picked) ?? destinations[0]
  const toOwn = destination?.value === OWN
  const needsConfirmation = Boolean(destination && !toOwn)
  const confirmed = Boolean(destination && sameAddress(confirmedFor, destination.address))
  const overHeld = Boolean(amount && amount > held)
  const locked = send.isPending
  const receipt = receiptFor(state, receiptId ?? undefined)
  const amountText = amount ? formatUsd(amount, { withCode: true }) : 'The amount'
  const where = destination ? (toOwn ? 'your account' : destination.label) : 'the address you choose'

  const what =
    own.settlement === 'monad'
      ? `${amountText} leaves your Viatik balance with ${agencyName} and arrives at ${where} within seconds.`
      : own.settlement === 'test'
        ? `${amountText} leaves your Viatik balance with ${agencyName}. This test environment records it; nothing reaches ${where} yet.`
        : `${amountText} leaves your Viatik balance with ${agencyName}. This demo simulates it: nothing is sent to ${where}.`

  // Told from what was actually sent: the form underneath may already show the new balance.
  const sentText = formatUsd(sent?.amount ?? amount ?? held, { withCode: true })
  const sentTo = sent?.label ?? where
  const done =
    own.settlement === 'monad'
      ? `${sentText} was sent to ${sentTo}.`
      : own.settlement === 'test'
        ? `${sentText} left your Viatik balance. This test environment recorded it; nothing was sent to ${sentTo}.`
        : `${sentText} left your Viatik balance. In this demo nothing was sent to ${sentTo}.`

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        send.reset()
        setPicked(null)
        setConfirmedFor(null)
        setReceiptId(null)
        setSent(null)
        // After a failure the same amount stays, so trying again is one click.
        if (receiptId) setAmount(null)
      }}
      title="Send to my account"
      description={`From your balance with ${agencyName}`}
      summary={{
        what,
        amount: amount ?? undefined,
        from: 'Your Viatik balance',
        to: destination ? `${destination.label} · ${shortAddress(destination.address)}` : 'Choose where',
        reversible: 'Cannot be undone. Money sent to a wrong address cannot be recovered.',
        policy: `You can send up to ${formatUsd(held, { withCode: true })}, your balance with ${agencyName}. A withdrawal only takes your own balance and gets a receipt in the verified record.`,
      }}
      confirmLabel="Send funds"
      disabled={
        !amount ||
        amount <= 0 ||
        overHeld ||
        !destination ||
        (needsConfirmation && !confirmed) ||
        own.paused ||
        own.loading ||
        own.failed
      }
      phase={send.phase}
      error={send.error}
      onConfirm={async () => {
        if (!amount || !destination) return
        const result = await send.run({ agencyId, amount, to: destination.address })
        if (result) {
          setReceiptId(result.id)
          setSent({ amount, label: toOwn ? 'your account' : destination.label, address: destination.address })
        }
      }}
      success={{
        title: own.settlement === 'monad' ? 'Funds sent' : 'Withdrawal recorded',
        body: (
          <>
            {done}
            {sent ? (
              <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">
                {sent.address}
              </span>
            ) : null}
          </>
        ),
        actions: <ReceiptDetailsButton receipt={receipt} />,
      }}
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="Send to"
          htmlFor="withdraw-destination"
          hint={saved.length === 0 ? 'Save another account you own to choose it here.' : undefined}
        >
          <SimpleSelect
            id="withdraw-destination"
            value={destination?.value ?? null}
            onValueChange={(value) => {
              setPicked(value)
              setConfirmedFor(null)
            }}
            options={destinations}
            empty="Your account is still being created"
            disabled={locked}
          />
        </FormField>

        {destination ? (
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/40 p-3">
            <span className="text-xs text-subtle">
              {toOwn ? 'Your account address, in full' : `${destination.label}, in full`}
            </span>
            <span className="flex items-start gap-2">
              <span className="min-w-0 flex-1 font-mono text-sm break-all text-foreground">
                {destination.address}
              </span>
              <CopyButton value={destination.address} label="Copy the full address" />
            </span>
            {own.settlement === 'simulated' ? (
              <span className="text-xs text-pretty text-subtle">
                {toOwn
                  ? 'A placeholder address for this demo. Nothing is sent to it.'
                  : 'In this demo nothing is sent to this address.'}
              </span>
            ) : null}
          </div>
        ) : null}

        <FormField
          label="Amount"
          htmlFor="withdraw-amount"
          error={overHeld ? `You can send up to ${formatUsd(held, { withCode: true })}.` : undefined}
        >
          <MoneyInput
            id="withdraw-amount"
            value={amount}
            onChange={setAmount}
            available={held}
            invalid={overHeld}
            disabled={locked}
          />
        </FormField>
        <Button
          variant="ghost"
          size="pill-sm"
          className="-mt-2 w-fit"
          disabled={locked || held <= 0 || amount === held}
          onClick={() => setAmount(held)}
        >
          Send my whole balance
        </Button>

        {needsConfirmation ? (
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-3">
            <Checkbox
              id="withdraw-confirm-address"
              checked={confirmed}
              disabled={locked}
              onCheckedChange={(value) => setConfirmedFor(value && destination ? destination.address : null)}
              className="mt-0.5"
            />
            <Label
              htmlFor="withdraw-confirm-address"
              className="text-sm leading-snug font-normal text-pretty text-foreground"
            >
              I confirm this address is correct
            </Label>
          </div>
        ) : null}
      </div>
    </ApprovalSheet>
  )
}

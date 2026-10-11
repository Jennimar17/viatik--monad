'use client'

import { Info, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { FormField, PillInput } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { CopyButton, type OperationPhase, type Step } from '@/components/viatik/operation'
import { useCommand, useLedger, useViatikState } from '@/data/react'
import { parseAddress, shortAddress } from '@/domain/address'
import { pseudoAddress } from '@/domain/ids'
import { formatUsd, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import { vaultBalance } from '@/domain/selectors'
import type { Vault } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

type Destination = 'own' | 'other'

/** 0x and 40 hexadecimal characters: the shape of an address, before its checksum is checked. */
const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/

/** How far a withdrawal got: 0 preparing, 1 signing, 2 confirming, 3 done. */
const STAGE: Partial<Record<OperationPhase, number>> = {
  idle: 0,
  preparing: 0,
  waiting_for_confirmation: 1,
  processing: 2,
  completed: 3,
}

/** Prepared → Approved → Sent, for a withdrawal the person signs on Monad. A failure marks the step it reached. */
function withdrawSteps(phase: OperationPhase, reached: number): Step[] {
  const stage = STAGE[phase]
  const stateAt = (index: number): Step['state'] => {
    if (stage === undefined) {
      const failedAt = Math.min(reached, 2)
      return index < failedAt ? 'done' : index === failedAt ? 'failed' : 'upcoming'
    }
    if (phase === 'idle') return 'upcoming'
    return stage > index ? 'done' : stage === index ? 'current' : 'upcoming'
  }
  return [
    {
      id: 'prepared',
      label: 'Prepared',
      detail: "Viatik checks the withdrawal against the ledger's rules.",
      state: stateAt(0),
    },
    {
      id: 'approved',
      label: 'Approved',
      detail: 'Your Viatik account signs it. Viatik pays the network fee.',
      state: stateAt(1),
    },
    {
      id: 'sent',
      label: 'Sent',
      detail: 'Recorded on Monad and sent to the address.',
      state: stateAt(2),
    },
  ]
}

/** One destination choice, as a selectable card. */
function DestinationOption({
  checked,
  disabled,
  onSelect,
  title,
  detail,
}: {
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  title: string
  detail: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'border-mist bg-mist/10' : 'border-border hover:bg-muted',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-primary bg-primary' : 'border-input',
        )}
        aria-hidden="true"
      >
        {checked ? <span className="size-1.5 rounded-full bg-primary-foreground" /> : null}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-pretty text-subtle">{detail}</span>
      </span>
    </button>
  )
}

/**
 * The Investor takes money out of the Portfolio Vault: to their Viatik account
 * (their embedded account, where Add funds starts) by default, or to another
 * address they confirm in full. Funding vaults never
 * appear here: committed capital follows its tranches and returns.
 */
export function InvestorWithdrawSheet({
  vault,
  open,
  onOpenChange,
}: {
  vault: Vault
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, mode, userId } = useViatikState()
  const session = useSession()
  const { view } = useLedger()
  const withdraw = useCommand('withdrawFunds')
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const demo = mode === 'demo'
  const monad = view?.settlement === 'monad' ? view : null
  // Test environment for a real account: Viatik records it, nothing is sent on Monad.
  const testLedger = !demo && view?.settlement === 'demo'
  const paused = Boolean(monad && !monad.available)

  // The demo has no real Viatik account: a stand-in address, explained as simulated.
  const ownAddress = parseAddress(demo ? pseudoAddress(userId) : (session.account?.address ?? ''))

  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [choice, setChoice] = React.useState<Destination>('own')
  const [typed, setTyped] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [confirmed, setConfirmed] = React.useState(false)
  // What was sent, for the success screen after the balances refresh.
  const [sent, setSent] = React.useState<{
    receiptId: string
    amount: Cents
    to: string
    own: boolean
  } | null>(null)
  // The last stage the withdrawal reached, kept when it fails.
  const [reached, setReached] = React.useState(0)
  const stage = STAGE[withdraw.phase]
  if (stage !== undefined && stage !== reached) setReached(stage)
  // While the withdrawal runs, what it was confirmed with cannot change.
  const locked = withdraw.isPending

  // Without a Viatik account address yet, only another address can be named.
  const destination: Destination = ownAddress ? choice : 'other'
  const available = vaultBalance(state, vault.id)
  const over = Boolean(amount && amount > available)

  const parsed = parseAddress(typed)
  // Viatik's own contracts would swallow the funds: never a destination.
  const contracts = monad
    ? [monad.contract, monad.token].flatMap((address) => (address ? [address.toLowerCase()] : []))
    : []
  const isContract = Boolean(parsed && contracts.includes(parsed.toLowerCase()))
  const addressError =
    destination !== 'other' || typed.trim() === ''
      ? undefined
      : isContract
        ? 'This is a Viatik contract, not an account. Enter the address of an account.'
        : parsed || !(touched || typed.trim().length >= 42)
          ? undefined
          : ADDRESS_SHAPE.test(typed.trim())
            ? 'This address does not check out: a character may be wrong. Copy it again from the account.'
            : 'Enter a valid account address: 0x followed by 40 characters.'
  const otherAddress = parsed && !isContract ? parsed : null
  const target = destination === 'own' ? ownAddress : otherAddress
  const ready =
    Boolean(amount && amount > 0) &&
    !over &&
    Boolean(target) &&
    (destination === 'own' || confirmed) &&
    !paused

  const toLabel =
    destination === 'own'
      ? ownAddress
        ? `Your Viatik account · ${shortAddress(ownAddress)}`
        : 'Your Viatik account'
      : otherAddress
        ? shortAddress(otherAddress)
        : 'Another address'
  const receipt = receiptFor(state, sent?.receiptId)

  const reset = () => {
    withdraw.reset()
    setAmount(null)
    setChoice('own')
    setTyped('')
    setTouched(false)
    setConfirmed(false)
    setSent(null)
  }

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={reset}
      title="Withdraw funds"
      description={`From ${vault.name}`}
      summary={{
        what:
          destination === 'own'
            ? `Funds leave ${vault.name} and go to your Viatik account.`
            : `Funds leave ${vault.name} and go to the address you enter below.`,
        amount: amount ?? undefined,
        from: vault.name,
        to: toLabel,
        reversible: 'Cannot be undone once it is sent. Funds sent to a wrong address cannot be recovered.',
        policy:
          'Only the Portfolio Vault can be withdrawn. Capital committed to an Agency follows its tranches and returns.',
      }}
      confirmLabel="Withdraw"
      disabled={!ready}
      phase={withdraw.phase}
      error={withdraw.error}
      onConfirm={async () => {
        if (!amount || !target) return
        const own = destination === 'own'
        const result = await withdraw.run({ portfolioId: vault.portfolioId, amount, to: target })
        if (result) setSent({ receiptId: result.id, amount, to: target, own })
      }}
      success={{
        title: monad ? 'Funds withdrawn' : 'Withdrawal recorded',
        body: sent ? (
          <>
            {formatUsd(sent.amount, { withCode: true })} left {vault.name} for{' '}
            {sent.own ? 'your Viatik account' : shortAddress(sent.to)}.{' '}
            {demo
              ? 'This demo is simulated: nothing was sent to a real address.'
              : testLedger
                ? 'Viatik recorded it; this test environment does not send funds yet.'
                : sent.own
                  ? 'It is in your Viatik account now.'
                  : 'It is at that address now.'}
            {sent.own && demo ? null : (
              <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">{sent.to}</span>
            )}
          </>
        ) : (
          'The withdrawal is complete.'
        ),
        actions: <ReceiptDetailsButton receipt={receipt} />,
      }}
      steps={monad ? withdrawSteps(withdraw.phase, reached) : undefined}
    >
      <div className="flex flex-col gap-5">
        <FormField
          label="Amount"
          htmlFor="withdraw-amount"
          error={
            over ? `${vault.name} has ${formatUsd(available, { withCode: true })} available.` : undefined
          }
        >
          <MoneyInput
            id="withdraw-amount"
            value={amount}
            onChange={setAmount}
            available={available}
            invalid={over}
            disabled={locked}
          />
          {available > 0 ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto w-fit px-5 py-0"
              disabled={locked || amount === available}
              onClick={() => setAmount(available)}
            >
              Withdraw everything
            </Button>
          ) : null}
        </FormField>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" id="withdraw-destination">
            Send to
          </span>
          <div className="flex flex-col gap-2" role="radiogroup" aria-labelledby="withdraw-destination">
            <DestinationOption
              checked={destination === 'own'}
              disabled={locked || !ownAddress}
              onSelect={() => setChoice('own')}
              title="My Viatik account"
              detail={
                ownAddress ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="font-mono">{shortAddress(ownAddress)}</span>
                    {demo ? ' · a placeholder address for this demo' : ''}
                  </span>
                ) : (
                  'Your Viatik account is still being set up.'
                )
              }
            />
            <DestinationOption
              checked={destination === 'other'}
              disabled={locked}
              onSelect={() => setChoice('other')}
              title="Another address"
              detail={`An account you control on ${network.name}.`}
            />
          </div>
          {destination === 'own' && ownAddress && !demo ? (
            <p className="flex items-center gap-1 text-xs text-subtle">
              <span className="min-w-0 font-mono break-all">{ownAddress}</span>
              <CopyButton value={ownAddress} label="Copy your Viatik account address" />
            </p>
          ) : null}
        </div>

        {destination === 'other' ? (
          <FormField
            label="Address"
            htmlFor="withdraw-address"
            error={addressError}
            hint={`0x followed by 40 characters. Only an account on ${network.name}.`}
          >
            <PillInput
              id="withdraw-address"
              value={typed}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
              disabled={locked}
              aria-invalid={Boolean(addressError) || undefined}
              className="font-mono text-sm"
              onChange={(event) => {
                setTyped(event.target.value)
                setConfirmed(false)
              }}
              onBlur={() => setTouched(true)}
            />
          </FormField>
        ) : null}

        {destination === 'other' && otherAddress ? (
          <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
            <p className="flex gap-2 text-sm text-pretty text-foreground">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              The funds go to this address. Check every character: a withdrawal to a wrong address cannot be
              recovered.
            </p>
            <p className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm break-all text-foreground">
              {otherAddress}
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id="withdraw-confirm-address"
                checked={confirmed}
                disabled={locked}
                onCheckedChange={(value) => setConfirmed(Boolean(value))}
                className="mt-0.5"
              />
              <Label
                htmlFor="withdraw-confirm-address"
                className="text-sm leading-snug font-medium text-pretty text-foreground"
              >
                I confirm this address is correct
              </Label>
            </div>
          </div>
        ) : null}

        {demo ? (
          <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
            This demo is simulated: the withdrawal is recorded with a receipt, but nothing is sent to a real
            address.
          </p>
        ) : testLedger ? (
          <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
            Test environment: Viatik records the withdrawal with a receipt, but does not send funds yet.
          </p>
        ) : null}

        {paused ? (
          <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            Withdrawals are paused: Viatik cannot reach {network.name} right now. Try again later.
          </p>
        ) : null}
      </div>
    </ApprovalSheet>
  )
}

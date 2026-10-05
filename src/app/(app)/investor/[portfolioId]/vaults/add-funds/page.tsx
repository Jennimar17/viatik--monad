'use client'

import { ExternalLink, TriangleAlert } from 'lucide-react'
import Link from '@/components/viatik/link'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { CopyButton, type OperationPhase, type Step } from '@/components/viatik/operation'
import { QrCode } from '@/components/viatik/qr-code'
import { Spinner } from '@/components/ui/spinner'
import { useCommand, useLedger, useViatikState } from '@/data/react'
import { MAX_DEPOSIT } from '@/domain/engine/funding'
import { pseudoAddress } from '@/domain/ids'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import { vaultBalance } from '@/domain/selectors'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { shortHash } from '@/lib/format'

/** How far an operation got: 0 preparing, 1 signing (or seen), 2 confirming, 3 done. */
const STAGE: Partial<Record<OperationPhase | 'idle', number>> = {
  idle: 0,
  preparing: 0,
  waiting_for_confirmation: 1,
  processing: 2,
  completed: 3,
}

/**
 * Waiting for deposit → Received → Credited in the demo; Prepared → Approved →
 * Recorded on Monad for a deposit the person signs. Driven by the operation
 * lifecycle; a failure marks the step it had reached.
 */
function depositSteps(
  phase: OperationPhase | 'idle',
  onMonad: boolean,
  reached: number,
  /** The demo shows a deposit address: the vault watches for a transfer before anything is confirmed. */
  watching: boolean,
): Step[] {
  const stage = STAGE[phase]
  const stateAt = (index: number): Step['state'] => {
    if (stage === undefined) {
      const failedAt = Math.min(reached, 2)
      return index < failedAt ? 'done' : index === failedAt ? 'failed' : 'upcoming'
    }
    // A deposit the person confirms starts then, not when the sheet opens.
    if (phase === 'idle' && !watching) return 'upcoming'
    return stage > index ? 'done' : stage === index ? 'current' : 'upcoming'
  }
  if (onMonad) {
    return [
      {
        id: 'prepared',
        label: 'Prepared',
        detail: "Viatik checks the deposit against the ledger's rules.",
        state: stateAt(0),
      },
      {
        id: 'approved',
        label: 'Approved',
        detail: 'Your account signs it. Viatik pays the network fee.',
        state: stateAt(1),
      },
      {
        id: 'recorded',
        label: 'Recorded on Monad',
        detail: 'Credited to the vault and available to fund agreements.',
        state: stateAt(2),
      },
    ]
  }
  return [
    {
      id: 'waiting',
      label: 'Waiting for deposit',
      detail: 'The vault watches for the transfer.',
      state: stateAt(0),
    },
    {
      id: 'received',
      label: 'Received',
      detail: 'The transfer was seen and is being confirmed.',
      state: stateAt(1),
    },
    { id: 'credited', label: 'Credited', detail: 'Available to fund agreements.', state: stateAt(2) },
  ]
}

export default function AddFundsPage() {
  const { state, mode } = useViatikState()
  const { portfolioId } = useRole()
  const ledger = useLedger()
  // The demo shows deposit instructions to a stand-in address. A real account deposits on Monad
  // when its workspace settles there (TestUSD minted into the vault, signed by the person); on the
  // demo ledger it only credits test funds, and no address is shown, so nobody sends USDC to an
  // address that does not exist.
  const onchainDeposits = mode === 'demo'
  const monad = !onchainDeposits && ledger.view?.settlement === 'monad' ? ledger.view : null
  const loadingLedger = !onchainDeposits && !ledger.view && ledger.isLoading
  // Where the deposit settles is not known (the ledger status failed to load): no form, so the copy,
  // the receipt and the steps never describe the wrong ledger.
  const unknownLedger = !onchainDeposits && !ledger.view && !ledger.isLoading
  // Settles on Monad, but this deployment cannot reach it: deposits would be refused.
  const unavailable = Boolean(monad && !monad.available)
  const href = useHref()
  const add = useCommand('addFunds')
  // The last stage the deposit reached, kept when it fails.
  const [reached, setReached] = React.useState(0)
  const stage = STAGE[add.phase]
  if (stage !== undefined && stage !== reached) setReached(stage)
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [open, setOpen] = React.useState(false)
  const [receiptId, setReceiptId] = React.useState<string | null>(null)

  const vault = state.vaults.find((v) => v.portfolioId === portfolioId && v.kind === 'portfolio')
  const portfolio = state.portfolios.find((p) => p.id === portfolioId)
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const address = pseudoAddress(`deposit:${portfolioId}`)
  const balance = vault ? vaultBalance(state, vault.id) : ZERO
  const receipt = receiptFor(state, receiptId ?? undefined)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('vaults')} className="hover:text-foreground">
            Vaults
          </Link>
        }
        title="Add funds"
        description={`Move capital into ${vault?.name ?? 'your Portfolio Vault'}. It stays available until you fund an agreement.`}
      />

      <Panel>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">Available now</span>
          <Amount value={balance} size="lg" />
        </div>
      </Panel>

      {loadingLedger ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading deposit options…
          </p>
        </Panel>
      ) : unknownLedger ? (
        <Panel>
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-pretty text-muted-foreground">
              Deposit options could not be loaded. Nothing was changed.
            </p>
            <Button variant="outline" size="pill-sm" onClick={ledger.retry}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : monad ? (
        <Panel
          title={`Deposit on ${network.name}`}
          description="Test deposits mint TestUSD, the testnet stand-in for USDC, straight into your Portfolio Vault."
        >
          <KeyValueList
            items={[
              { label: 'Asset', value: 'TestUSD (6 decimals, no value)' },
              { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
              {
                label: 'Vault contract',
                value: monad.contract ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    <a
                      href={`${network.explorer}/address/${monad.contract}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                    >
                      {shortHash(monad.contract, 10, 6)}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                    <CopyButton value={monad.contract} label="Copy vault contract address" />
                  </span>
                ) : (
                  'Not configured'
                ),
              },
              { label: 'Per deposit', value: `Up to ${formatUsd(MAX_DEPOSIT, { withCode: true })}` },
              { label: 'Network fee', value: 'Paid by Viatik' },
            ]}
          />
          <p className="mt-3 text-sm text-pretty text-muted-foreground">
            You approve each deposit with your account. Nothing is sent from outside Viatik, so there is no
            address to send to.
          </p>
          {unavailable ? (
            <p className="mt-3 flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              Deposits are paused: Viatik cannot reach {network.name} right now. Try again later.
            </p>
          ) : null}
        </Panel>
      ) : onchainDeposits ? (
        <Panel title="Deposit instructions" description="One of the few places where network details matter.">
          <div className="flex flex-col gap-6 sm:flex-row">
            <QrCode value={address} label="Deposit address as a QR code" />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <KeyValueList
                items={[
                  { label: 'Asset', value: 'USDC' },
                  { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
                  {
                    label: 'Deposit address',
                    value: (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {address.slice(0, 12)}…{address.slice(-8)}
                        <CopyButton value={address} label="Copy deposit address" />
                      </span>
                    ),
                  },
                ]}
              />
              <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                Only send USDC on {network.name}. Funds sent on another network will not arrive.
              </p>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title="Deposits">
          <p className="text-sm text-pretty text-muted-foreground">
            USDC deposits on {network.name} open once settlement on Monad is switched on for your workspace.
            Until then, credit a test deposit below to fund agreements and try every flow.
          </p>
        </Panel>
      )}

      {loadingLedger || unknownLedger ? null : (
        <Panel
          title={monad ? 'Deposit' : onchainDeposits ? 'Demo deposit' : 'Test deposit'}
          description={
            monad
              ? 'Choose the amount. It is credited once Monad records it.'
              : onchainDeposits
                ? 'This demo settles on a simulated ledger, so you can credit a test deposit instead of sending USDC.'
                : 'Credits test funds to your Portfolio Vault. No real money moves.'
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <FormField label="Amount" htmlFor="deposit-amount" className="flex-1">
              <MoneyInput id="deposit-amount" value={amount} onChange={setAmount} />
            </FormField>
            <Button
              size="pill"
              disabled={!amount || amount <= 0 || unavailable}
              onClick={() => setOpen(true)}
            >
              {monad ? 'Deposit' : 'Add test funds'}
            </Button>
          </div>
        </Panel>
      )}

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          add.reset()
          setReceiptId(null)
          if (receiptId) setAmount(null)
        }}
        title="Add funds"
        description={vault?.name}
        summary={{
          what: `The deposit is credited to ${vault?.name ?? 'the Portfolio Vault'} once it is confirmed.`,
          amount: amount ?? undefined,
          from: monad
            ? `TestUSD minted on ${network.name}`
            : `${portfolio?.organization ?? 'Your organization'} · USDC`,
          to: vault?.name ?? 'Portfolio Vault',
          reversible:
            'Cannot be undone once it is credited. Funds stay in the Portfolio Vault until you fund an agreement.',
          policy: 'Deposits become available to fund agreements as soon as they are credited.',
        }}
        confirmLabel={monad ? 'Deposit' : 'Add test funds'}
        disabled={unavailable}
        phase={add.phase}
        error={add.error}
        onConfirm={async () => {
          if (!amount) return
          const result = await add.run({
            portfolioId,
            amount,
            // Product language: the receipt's Verified details carry the network.
            source: monad
              ? `${portfolio?.organization ?? 'Investor'} · Test deposit`
              : `${portfolio?.organization ?? 'Investor'} · USDC deposit`,
          })
          if (result) setReceiptId(result.id)
        }}
        success={{
          title: 'Funds credited',
          body: `${formatUsd(amount ?? ZERO, { withCode: true })} is now available in ${vault?.name ?? 'the Portfolio Vault'}.`,
          actions: (
            <>
              <ButtonLink href={href('funding')} size="pill-sm">
                Fund an agreement
              </ButtonLink>
              <ReceiptDetailsButton receipt={receipt} />
            </>
          ),
        }}
        steps={depositSteps(add.phase, Boolean(monad), reached, onchainDeposits)}
      />
    </div>
  )
}

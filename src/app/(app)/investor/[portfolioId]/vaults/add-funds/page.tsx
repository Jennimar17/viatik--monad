'use client'

import { Building, Coins, TriangleAlert } from 'lucide-react'
import Link from '@/components/viatik/link'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { ChoiceCard, MoneyInput } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { CopyButton, Steps, type OperationPhase, type Step } from '@/components/viatik/operation'
import { QrCode } from '@/components/viatik/qr-code'
import { useCommand, useViatikState } from '@/data/react'
import { pseudoAddress } from '@/domain/ids'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import { vaultBalance } from '@/domain/selectors'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'

/** Waiting for deposit → Received → Credited, driven by the operation lifecycle. */
function depositSteps(phase: OperationPhase | 'idle'): Step[] {
  const stage =
    phase === 'idle' || phase === 'preparing'
      ? 0
      : phase === 'waiting_for_confirmation'
        ? 1
        : phase === 'processing'
          ? 2
          : phase === 'completed'
            ? 3
            : -1
  const stateAt = (index: number): Step['state'] =>
    stage === -1
      ? index === 0
        ? 'failed'
        : 'upcoming'
      : stage > index
        ? 'done'
        : stage === index
          ? 'current'
          : 'upcoming'
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
  const { state } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const add = useCommand('addFunds')
  const [method, setMethod] = React.useState<'usdc' | 'bank'>('usdc')
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

      <div role="radiogroup" aria-label="Funding source" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChoiceCard
          selected={method === 'usdc'}
          onSelect={() => setMethod('usdc')}
          title="USDC on Monad"
          description="Send USDC from an exchange or another account on Monad."
          icon={<Coins />}
        />
        <ChoiceCard
          selected={method === 'bank'}
          onSelect={() => setMethod('bank')}
          title="Bank transfer"
          description="Local bank rails are a future integration."
          icon={<Building />}
          disabled
        />
      </div>

      {method === 'usdc' ? (
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
      ) : null}

      <Panel
        title="Demo deposit"
        description="This demo settles on a simulated ledger, so you can credit a test deposit instead of sending USDC."
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <FormField label="Amount" htmlFor="deposit-amount" className="flex-1">
            <MoneyInput id="deposit-amount" value={amount} onChange={setAmount} />
          </FormField>
          <Button size="pill" disabled={!amount || amount <= 0} onClick={() => setOpen(true)}>
            Add test funds
          </Button>
        </div>
      </Panel>

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
          from: `${portfolio?.organization ?? 'Your organization'} · USDC`,
          to: vault?.name ?? 'Portfolio Vault',
          reversible: 'Uncommitted funds can be withdrawn from the Portfolio Vault.',
          policy: 'Deposits become available to fund agreements as soon as they are credited.',
        }}
        confirmLabel="Add test funds"
        phase={add.phase}
        error={add.error}
        onConfirm={async () => {
          if (!amount) return
          const result = await add.run({
            portfolioId,
            amount,
            source: `${portfolio?.organization ?? 'Investor'} · USDC deposit`,
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
      >
        <Steps steps={depositSteps(add.phase)} />
      </ApprovalSheet>
    </div>
  )
}

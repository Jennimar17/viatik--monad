'use client'

import { Coins, ExternalLink, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField } from '@/components/app/form-controls'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { KeyValueList, Panel } from '@/components/viatik/layout'
import { CopyButton, Steps, type OperationPhase, type Step } from '@/components/viatik/operation'
import { QrCode } from '@/components/viatik/qr-code'
import type { LedgerView } from '@/data'
import { useCommand, useViatikState } from '@/data/react'
import { useWalletActions } from '@/data/use-wallet'
import { shortAddress } from '@/domain/address'
import { MAX_DEPOSIT } from '@/domain/engine/funding'
import { cents, formatUsd, min, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import type { Vault } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { shortHash } from '@/lib/format'

type MonadView = Extract<LedgerView, { settlement: 'monad' }>

/** How far a deposit got: 0 preparing, 1 signing, 2 confirming, 3 done. */
const STAGE: Partial<Record<OperationPhase, number>> = {
  idle: 0,
  preparing: 0,
  waiting_for_confirmation: 1,
  processing: 2,
  completed: 3,
}

const RUNNING: ReadonlySet<OperationPhase> = new Set(['preparing', 'waiting_for_confirmation', 'processing'])

/** The one-time permission inside the deposit sheet, when the deposit needs it. */
type AllowState = { needed: boolean; status: 'idle' | 'running' | 'done' | 'failed'; error?: string }

const NO_ALLOW: AllowState = { needed: false, status: 'idle' }

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Nothing was changed.'

/** Prepared → Approved → Recorded on Monad, driven by the deposit's lifecycle; a failure marks the step it reached. */
function depositSteps(phase: OperationPhase, reached: number): Step[] {
  const stage = STAGE[phase]
  const stateAt = (index: number): Step['state'] => {
    if (stage === undefined) {
      const failedAt = Math.min(reached, 2)
      return index < failedAt ? 'done' : index === failedAt ? 'failed' : 'upcoming'
    }
    // The deposit starts when the person confirms, not when the sheet opens.
    if (phase === 'idle') return 'upcoming'
    return stage > index ? 'done' : stage === index ? 'current' : 'upcoming'
  }
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

/**
 * Adding funds with a real account on Monad: test funds sit in the person's own
 * account (minted with "Get test funds" or sent from another account to its
 * address), are allowed once, and then deposited into the Portfolio Vault.
 */
export function InvestorAccountFunding({
  portfolioId,
  vault,
  organization,
  monad,
}: {
  portfolioId: string
  vault: Vault | undefined
  organization: string | undefined
  monad: MonadView
}) {
  const { state } = useViatikState()
  const href = useHref()
  const wallet = useWalletActions()
  const add = useCommand('addFunds')
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const account = wallet.account?.available ? wallet.account : null
  // Settles on Monad, but this deployment cannot reach it: every step would be refused.
  const unavailable = !monad.available
  const vaultName = vault?.name ?? 'your Portfolio Vault'

  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [open, setOpen] = React.useState(false)
  const [receiptId, setReceiptId] = React.useState<string | null>(null)
  // A deposit was credited during this visit: the last step shows as done.
  const [deposited, setDeposited] = React.useState(false)
  const [fundsError, setFundsError] = React.useState<string | null>(null)
  const [allow, setAllow] = React.useState<AllowState>(NO_ALLOW)
  // Between the permission landing and the deposit starting, the sheet stays busy.
  const [submitting, setSubmitting] = React.useState(false)
  // The last stage the deposit reached, kept when it fails.
  const [reached, setReached] = React.useState(0)
  const stage = STAGE[add.phase]
  if (stage !== undefined && stage !== reached) setReached(stage)

  const held = account ? cents(Math.trunc(account.balance)) : ZERO
  const testFunds = account ? cents(Math.trunc(account.testFunds)) : ZERO
  const allowance = account?.allowance ?? 0
  // Without an amount yet, "allowed" means the one approval without a limit was given.
  const allowed = allowance >= (amount && amount > 0 ? amount : MAX_DEPOSIT)
  const gettingFunds = wallet.step === 'getting_funds'
  const depositing = RUNNING.has(add.phase)
  const overMax = Boolean(amount && amount > MAX_DEPOSIT)
  const overHeld = Boolean(account && amount && amount > held)
  const amountError = overMax
    ? `A single deposit can be up to ${formatUsd(MAX_DEPOSIT, { withCode: true })}. Split it into several deposits.`
    : overHeld
      ? `Your account holds ${formatUsd(held, { withCode: true })} of test funds. Get test funds or enter a smaller amount.`
      : undefined
  const canDeposit = Boolean(
    account && wallet.ready && amount && amount > 0 && !amountError && !unavailable && !gettingFunds,
  )
  const receipt = receiptFor(state, receiptId ?? undefined)

  const getFunds = async () => {
    setFundsError(null)
    try {
      await wallet.getTestFunds()
    } catch (error) {
      setFundsError(messageOf(error))
    }
  }

  const progress: Step[] = [
    {
      id: 'funds',
      label: 'Get test funds',
      detail:
        held > 0
          ? `Your account holds ${formatUsd(held, { withCode: true })} of test funds.`
          : `Adds ${formatUsd(testFunds, { withCode: true })} of test funds to your account. No real money.`,
      state: gettingFunds ? 'current' : fundsError ? 'failed' : held > 0 || deposited ? 'done' : 'upcoming',
    },
    {
      id: 'allow',
      label: 'Allow deposits once',
      detail: allowed
        ? 'Done. Later deposits skip this step.'
        : 'Lets Viatik take test funds from your account when you deposit. Asked with your first deposit.',
      state: wallet.step === 'allowing' ? 'current' : allowed ? 'done' : 'upcoming',
    },
    {
      id: 'deposit',
      label: 'Deposit',
      detail: deposited
        ? `Credited to ${vaultName}. Deposit again whenever you need to.`
        : `Moves test funds from your account into ${vaultName}.`,
      state: depositing ? 'current' : deposited ? 'done' : 'upcoming',
    },
  ]

  const allowStep: Step = {
    id: 'allow',
    label: 'Allow deposits from your account',
    detail: 'Asked once. Your account signs it and Viatik pays the network fee.',
    state:
      allow.status === 'running'
        ? 'current'
        : allow.status === 'failed'
          ? 'failed'
          : allow.status === 'done'
            ? 'done'
            : 'upcoming',
  }
  // The deposit itself: not started while the permission is asked (or was refused), and a retry
  // starts from the last attempt's phase until the new one reports.
  const depositPhase: OperationPhase =
    allow.status === 'running' || allow.status === 'failed'
      ? 'idle'
      : submitting && (add.phase === 'idle' || add.phase === 'failed')
        ? 'preparing'
        : add.phase
  const sheetPhase: OperationPhase =
    allow.status === 'failed' ? 'failed' : allow.status === 'running' ? 'preparing' : depositPhase
  // The deposit's own answer only while the sheet shows the deposit's own phase (not a retry starting).
  const sheetError =
    allow.status === 'failed' ? allow.error : depositPhase === add.phase ? add.error : undefined

  return (
    <>
      <Panel
        title="Your account"
        description="Test funds wait in your own account until you deposit them into your Portfolio Vault."
      >
        {wallet.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Loading your account…
          </p>
        ) : !account ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-pretty text-muted-foreground">
              {unavailable
                ? `Your account cannot be read while Viatik cannot reach ${network.name}. Try again later.`
                : wallet.isError
                  ? 'Your account could not be loaded. Nothing was changed.'
                  : 'Your account is still being set up. This takes a moment after you sign in.'}
            </p>
            <Button variant="outline" size="pill-sm" onClick={() => void wallet.refresh()}>
              Try again
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-6 sm:flex-row">
            <QrCode value={account.address} label="Your account address as a QR code" />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Test funds in your account</span>
                <Amount value={held} size="lg" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">Account address</span>
                <span className="flex items-start gap-1">
                  <span className="min-w-0 font-mono text-xs break-all text-foreground">
                    {account.address}
                  </span>
                  <CopyButton value={account.address} label="Copy account address" className="-mt-1" />
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  size="pill-sm"
                  disabled={gettingFunds || !wallet.ready || unavailable}
                  onClick={() => void getFunds()}
                >
                  {gettingFunds ? (
                    <>
                      <Spinner data-icon="inline-start" /> Getting test funds…
                    </>
                  ) : !wallet.ready ? (
                    'Preparing your account…'
                  ) : (
                    <>
                      <Coins data-icon="inline-start" /> Get test funds
                    </>
                  )}
                </Button>
                <span className="text-xs text-subtle">
                  Adds {formatUsd(testFunds, { withCode: true })} each time.
                </span>
              </div>
              {fundsError ? (
                <p className="text-sm text-pretty text-danger" role="alert">
                  {fundsError}
                </p>
              ) : null}
              <p className="text-xs text-pretty text-subtle">
                You can also send test funds to this address from another account: TestUSD on {network.name},
                the testnet stand-in for USDC, with no real value.
              </p>
            </div>
          </div>
        )}
      </Panel>

      <Panel title="Deposit" description={`Move test funds from your account into ${vaultName}.`}>
        <div className="flex flex-col gap-6">
          <Steps steps={progress} />
          <div className="flex flex-col gap-4 border-t border-border pt-5">
            <FormField label="Amount" htmlFor="deposit-amount" error={amountError}>
              <MoneyInput
                id="deposit-amount"
                value={amount}
                onChange={setAmount}
                invalid={Boolean(amountError)}
                available={account ? min(held, MAX_DEPOSIT) : undefined}
                disabled={!account}
              />
            </FormField>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                size="pill"
                disabled={!canDeposit}
                onClick={() => {
                  setAllow({ needed: Boolean(amount && allowance < amount), status: 'idle' })
                  setOpen(true)
                }}
              >
                Deposit
              </Button>
              {account && !allowed && amount && amount > 0 && !amountError ? (
                <span className="text-xs text-pretty text-subtle">
                  This first deposit also asks you to allow deposits from your account, once.
                </span>
              ) : null}
            </div>
            {unavailable ? (
              <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                Deposits are paused: Viatik cannot reach {network.name} right now. Try again later.
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel title="Deposit details" description="For reference. Amounts in Viatik are shown in USD.">
        <KeyValueList
          dense
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
        <p className="mt-3 text-xs text-pretty text-subtle">
          Send test funds only to your account address above. Funds sent to the vault contract directly are
          not credited: deposits go through this page.
        </p>
      </Panel>

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          add.reset()
          setAllow(NO_ALLOW)
          setSubmitting(false)
          setReceiptId(null)
          if (receiptId) setAmount(null)
        }}
        title="Add funds"
        description={vault?.name}
        summary={{
          what: `Test funds move from your account into ${vaultName}. They are credited once Monad records the deposit.`,
          amount: amount ?? undefined,
          from: account ? `Your account · ${shortAddress(account.address)}` : 'Your account',
          to: vault?.name ?? 'Portfolio Vault',
          reversible:
            'Cannot be undone once it is credited. What stays in the Portfolio Vault can be withdrawn to an account.',
          policy: 'Deposits become available to fund agreements as soon as they are credited.',
        }}
        confirmLabel={allow.needed && allow.status !== 'done' ? 'Allow and deposit' : 'Deposit'}
        disabled={!canDeposit}
        phase={sheetPhase}
        error={sheetError}
        onConfirm={async () => {
          if (!amount || !account) return
          setSubmitting(true)
          try {
            if (allowance < amount) {
              setAllow({ needed: true, status: 'running' })
              try {
                await wallet.ensureAllowance(amount)
                setAllow({ needed: true, status: 'done' })
              } catch (error) {
                setAllow({ needed: true, status: 'failed', error: messageOf(error) })
                return
              }
            } else if (allow.status === 'failed') {
              // Allowed in the meantime (another tab, or the answer arrived late).
              setAllow({ needed: true, status: 'done' })
            }
            const result = await add.run({
              portfolioId,
              amount,
              // Product language: the receipt's Verified details carry the network.
              source: `${organization ?? 'Investor'} · Test deposit`,
            })
            if (result) {
              setReceiptId(result.id)
              setDeposited(true)
            }
            // The account's test funds changed (or the read was stale when it failed).
            void wallet.refresh()
          } finally {
            setSubmitting(false)
          }
        }}
        success={{
          title: 'Funds credited',
          body: `${formatUsd(amount ?? ZERO, { withCode: true })} is now available in ${vaultName}.`,
          actions: (
            <>
              <ButtonLink href={href('funding')} size="pill-sm">
                Fund an agreement
              </ButtonLink>
              <ReceiptDetailsButton receipt={receipt} />
            </>
          ),
        }}
        steps={[...(allow.needed ? [allowStep] : []), ...depositSteps(depositPhase, reached)]}
      />
    </>
  )
}

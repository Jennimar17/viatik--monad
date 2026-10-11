'use client'

import {
  ChevronDown,
  CircleCheck,
  Coins,
  ExternalLink,
  Info,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import * as React from 'react'

import { AccountAddressCard } from '@/components/app/account-address-card'
import { BalanceCheckNote } from '@/components/app/balance-check'
import { ButtonLink } from '@/components/app/button-link'
import { FormField } from '@/components/app/form-controls'
import { useOwnAccount, type OwnAccount } from '@/components/app/member-own-account'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref } from '@/components/app/role-context'
import { signingSteps, useReachedStage } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KpiTile } from '@/components/viatik/finance'
import { MoneyInput } from '@/components/viatik/forms'
import { HairlineGrid, KeyValueList, Panel } from '@/components/viatik/layout'
import { CopyButton, type OperationPhase, type Step } from '@/components/viatik/operation'
import type { LedgerView } from '@/data'
import { useCommand, useLedger, useViatikState } from '@/data/react'
import { useWalletActions } from '@/data/use-wallet'
import { parseAddress, shortAddress } from '@/domain/address'
import { MAX_DEPOSIT } from '@/domain/engine/funding'
import { cents, formatUsd, min, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import { vaultBalance } from '@/domain/selectors'
import type { Vault } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { shortHash } from '@/lib/format'

type MonadView = Extract<LedgerView, { settlement: 'monad' }>

/** Where a transfer settles: the demo's simulated ledger, a test ledger without Monad, or Monad. */
type Settlement = OwnAccount['settlement']

/** While Add funds is open, the Viatik account is read again this often: TestUSD sent to it shows up by itself. */
const POLL_EVERY_MS = 15_000

const RUNNING: ReadonlySet<OperationPhase> = new Set(['preparing', 'waiting_for_confirmation', 'processing'])

/** The one-time authorization inside the transfer sheet, when the transfer needs it. */
type AllowState = { needed: boolean; status: 'idle' | 'running' | 'done' | 'failed'; error?: string }

const NO_ALLOW: AllowState = { needed: false, status: 'idle' }

const usd = (value: Cents) => formatUsd(value, { withCode: true })

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Something went wrong. Nothing was changed.'

/**
 * Add funds, the same three cards in every mode, under two balances (the
 * Investor's Viatik account and the Portfolio Vault):
 *
 * 1. Add funds: the Viatik account's address and QR code, to send TestUSD from any account.
 * 2. Get test funds: mints TestUSD into the Viatik account.
 * 3. Transfer to Portfolio: moves it into the Portfolio Vault, after a one-time
 *    authorization asked with the first transfer.
 *
 * With a real account on Monad every step is real and signed by the person
 * (Viatik sponsors the network fee). The demo shows a placeholder address and
 * credits test funds on Transfer; the test ledger (a real account whose
 * workspace does not settle on Monad yet) credits test funds too. Getting test
 * funds and the authorization are for real accounts on Monad only.
 *
 * One `useWalletActions` instance drives every card: its `step` is local state.
 * The Viatik account balance is a raw read of Monad: it is never added to the
 * Portfolio's capital.
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
  /** The ledger view when the workspace settles on Monad with a real account; null in the demo and on the test ledger. */
  monad: MonadView | null
}) {
  const { state } = useViatikState()
  const href = useHref()
  const { checks } = useLedger()
  const own = useOwnAccount()
  const wallet = useWalletActions({ refetchInterval: monad ? POLL_EVERY_MS : false })
  const add = useCommand('addFunds')
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const settlement: Settlement = monad ? 'monad' : own.settlement === 'simulated' ? 'simulated' : 'test'
  // Only a real account on Monad has TestUSD to read, mint and transfer.
  const account = monad && wallet.account?.available ? wallet.account : null
  // Settles on Monad, but this deployment cannot reach it: every step would be refused.
  const unavailable = Boolean(monad && !monad.available)
  const vaultName = vault?.name ?? 'your Portfolio Vault'

  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [open, setOpen] = React.useState(false)
  const [receiptId, setReceiptId] = React.useState<string | null>(null)
  const [fundsError, setFundsError] = React.useState<string | null>(null)
  // What the last press of "Get test funds" added, for the note under the button.
  const [fundsAdded, setFundsAdded] = React.useState<Cents | null>(null)
  const [refreshing, setRefreshing] = React.useState(false)
  const [allow, setAllow] = React.useState<AllowState>(NO_ALLOW)
  // Between the authorization landing and the transfer starting, the sheet stays busy.
  const [submitting, setSubmitting] = React.useState(false)
  // The last stage the transfer reached, kept when it fails.
  const reached = useReachedStage(add.phase)

  const held = account ? cents(Math.trunc(account.balance)) : ZERO
  const testFunds = account ? cents(Math.trunc(account.testFunds)) : ZERO
  // Compared with the amount, never assumed: an unlimited authorization reads as a very large
  // number, and an older limited one (or none) as less than the transfer.
  const allowance = account?.allowance ?? 0
  // Without an amount yet, "allowed" means the authorization without a limit was given.
  const allowed = allowance >= (amount && amount > 0 ? amount : MAX_DEPOSIT)
  const gettingFunds = wallet.step === 'getting_funds'
  const transferring = RUNNING.has(add.phase)
  const most = account ? min(held, MAX_DEPOSIT) : MAX_DEPOSIT
  const overMax = Boolean(amount && amount > MAX_DEPOSIT)
  const overHeld = Boolean(account && amount && amount > held)
  const amountError = overMax
    ? `A single transfer can be up to ${usd(MAX_DEPOSIT)}. Split it into several transfers.`
    : overHeld
      ? `Your Viatik account holds ${usd(held)} of TestUSD. Get test funds or enter a smaller amount.`
      : undefined
  const canTransfer =
    Boolean(vault && amount && amount > 0 && !amountError) &&
    (monad ? Boolean(account && wallet.ready && !unavailable && !gettingFunds) : true)
  const receipt = receiptFor(state, receiptId ?? undefined)

  const getFunds = async () => {
    setFundsError(null)
    setFundsAdded(null)
    try {
      await wallet.getTestFunds()
      setFundsAdded(testFunds)
    } catch (error) {
      setFundsError(messageOf(error))
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await wallet.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  const allowStep: Step = {
    id: 'allow',
    label: 'Authorize transfers once',
    detail: 'Your Viatik account signs it once. Viatik pays the network fee.',
    state:
      allow.status === 'running'
        ? 'current'
        : allow.status === 'failed'
          ? 'failed'
          : allow.status === 'done'
            ? 'done'
            : 'upcoming',
  }
  // The transfer itself: not started while the authorization is asked (or was refused), and a
  // retry starts from the last attempt's phase until the new one reports.
  const transferPhase: OperationPhase =
    allow.status === 'running' || allow.status === 'failed'
      ? 'idle'
      : submitting && (add.phase === 'idle' || add.phase === 'failed')
        ? 'preparing'
        : add.phase
  const sheetPhase: OperationPhase =
    allow.status === 'failed' ? 'failed' : allow.status === 'running' ? 'preparing' : transferPhase
  // The transfer's own answer only while the sheet shows the transfer's own phase (not a retry starting).
  const sheetError =
    allow.status === 'failed' ? allow.error : transferPhase === add.phase ? add.error : undefined

  // The address shown is the one Monad is read for, so what arrives there shows in the balance.
  const shownOwn: OwnAccount = account
    ? { ...own, address: parseAddress(account.address) ?? own.address }
    : own

  return (
    <>
      <HairlineGrid className="grid-cols-1 sm:grid-cols-2">
        <KpiTile
          label="Your Viatik account"
          value={
            settlement !== 'monad' ? (
              <span className="text-sm text-muted-foreground">
                {settlement === 'simulated' ? 'Simulated in this demo' : 'Not available yet'}
              </span>
            ) : wallet.isLoading ? (
              <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <Spinner /> Reading your Viatik account…
              </span>
            ) : account ? (
              held
            ) : (
              <span className="text-sm text-muted-foreground">
                {unavailable
                  ? 'Cannot be read right now'
                  : wallet.isError
                    ? 'Could not be read'
                    : 'Being set up'}
              </span>
            )
          }
          hint={
            settlement === 'simulated' ? (
              'The demo has no real account: transfers below credit test funds.'
            ) : settlement === 'test' ? (
              `Test environment: settlement on ${network.name} is not switched on, so transfers below credit test funds.`
            ) : account || wallet.isLoading ? (
              'TestUSD ready to transfer'
            ) : (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {unavailable
                  ? `Viatik cannot reach ${network.name}. Try again later.`
                  : wallet.isError
                    ? 'Nothing was changed.'
                    : 'Your Viatik account is created a moment after you sign in.'}
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  disabled={refreshing}
                  onClick={() => void refresh()}
                >
                  Try again
                </Button>
              </span>
            )
          }
        />
        <KpiTile
          label="Portfolio Vault"
          value={vault ? vaultBalance(state, vault.id) : ZERO}
          hint={
            <span className="flex flex-col gap-1">
              Available to fund agreements
              {vault ? <BalanceCheckNote check={checks?.check(vault.id)} /> : null}
            </span>
          }
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <AccountAddressCard
          className="lg:col-span-3"
          own={shownOwn}
          title="Add funds"
          description={
            settlement === 'simulated'
              ? 'Simulated in this demo: there is no real Viatik account, so do not send funds to this address.'
              : settlement === 'test'
                ? 'Your Viatik account, for reference: this test environment does not take funds from it yet.'
                : `Send TestUSD on ${network.name} from any account to your Viatik account, then transfer it to your Portfolio Vault below.`
          }
          qr={settlement === 'monad' ? 'shown' : 'none'}
          qrLabel="Your Viatik account address as a QR code"
          addressLabel="Your Viatik account address"
          settlementNotes={{
            monad: `Only TestUSD on ${network.name}: other tokens or networks do not show up. Viatik checks for new funds every ${POLL_EVERY_MS / 1000} seconds while this page is open.`,
          }}
          actions={
            account ? (
              <Button variant="ghost" size="pill-sm" disabled={refreshing} onClick={() => void refresh()}>
                {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
                Refresh
              </Button>
            ) : null
          }
        />

        <Panel
          className="lg:col-span-2"
          title="Get test funds"
          description={
            account
              ? `Adds ${formatUsd(testFunds)} of TestUSD to your Viatik account. No real value.`
              : 'Adds TestUSD to your Viatik account. No real value.'
          }
        >
          <div className="flex flex-col items-start gap-3">
            <Button
              variant="outline"
              size="pill"
              disabled={!account || gettingFunds || !wallet.ready || unavailable}
              aria-describedby={settlement === 'monad' ? undefined : 'test-funds-note'}
              onClick={() => void getFunds()}
            >
              {gettingFunds ? (
                <>
                  <Spinner data-icon="inline-start" /> Getting test funds…
                </>
              ) : account && !wallet.ready ? (
                'Preparing your Viatik account…'
              ) : (
                <>
                  <Coins data-icon="inline-start" /> Get test funds
                </>
              )}
            </Button>
            {settlement === 'monad' ? (
              <p className="text-xs text-pretty text-subtle">
                Testnet only. Press again whenever you need more. Viatik pays the network fee.
              </p>
            ) : (
              <p id="test-funds-note" className="flex gap-2 text-sm text-pretty text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
                {settlement === 'simulated'
                  ? 'Real accounts only. In this demo, Transfer to Portfolio below credits test funds directly.'
                  : `Available once settlement on ${network.name} is switched on for your workspace. Until then, Transfer to Portfolio below credits test funds directly.`}
              </p>
            )}
            {fundsError ? (
              <p className="text-sm text-pretty text-danger" role="alert">
                {fundsError}
              </p>
            ) : fundsAdded !== null && !gettingFunds ? (
              <p className="flex gap-2 text-sm text-pretty text-foreground" role="status">
                <CircleCheck className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden="true" />
                Added {usd(fundsAdded)} to your Viatik account. Transfer it to your Portfolio below.
              </p>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel
        title="Transfer to Portfolio"
        description={
          settlement === 'monad'
            ? `Moves TestUSD from your Viatik account into ${vaultName}, where it can fund agreements.`
            : `Credits test funds to ${vaultName}, where they can fund agreements.`
        }
      >
        <div className="flex flex-col gap-4">
          <FormField
            label="Amount"
            htmlFor="transfer-amount"
            error={amountError}
            hint={`Up to ${usd(MAX_DEPOSIT)} per transfer.`}
          >
            <MoneyInput
              id="transfer-amount"
              value={amount}
              onChange={setAmount}
              invalid={Boolean(amountError)}
              available={account ? most : undefined}
              disabled={settlement === 'monad' ? !account || transferring : transferring}
            />
            {account && held > 0 ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto w-fit px-5 py-0"
                disabled={transferring || amount === most}
                onClick={() => setAmount(most)}
              >
                {held > MAX_DEPOSIT ? `Transfer ${formatUsd(MAX_DEPOSIT)}, the most at once` : 'Transfer all'}
              </Button>
            ) : null}
          </FormField>

          {settlement === 'monad' ? (
            <p className="flex gap-2 text-sm text-pretty text-muted-foreground">
              {allowed ? (
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden="true" />
              ) : (
                <KeyRound className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
              )}
              {allowed
                ? 'Authorized: transfers are not asked again.'
                : 'Authorized once: asked with your first transfer, then never again. Your Viatik account signs it and Viatik pays the network fee.'}
            </p>
          ) : (
            <p className="flex gap-2 text-sm text-pretty text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
              {settlement === 'simulated'
                ? 'Demo: this credits test funds directly, nothing leaves a real account. The one-time authorization is for real accounts only.'
                : `Test environment: this credits test funds directly. Nothing moves on ${network.name} yet.`}
            </p>
          )}

          <Button
            size="pill"
            className="w-full sm:w-fit"
            disabled={!canTransfer}
            onClick={() => {
              setAllow({ needed: Boolean(monad && amount && allowance < amount), status: 'idle' })
              setOpen(true)
            }}
          >
            Transfer to Portfolio
          </Button>

          {unavailable ? (
            <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              Transfers are paused: Viatik cannot reach {network.name} right now. Try again later.
            </p>
          ) : null}
        </div>
      </Panel>

      <NetworkDetails settlement={settlement} monad={monad} account={shownOwn.address} />

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
        title="Transfer to Portfolio"
        description={vault?.name}
        summary={
          settlement === 'monad'
            ? {
                what: `TestUSD moves from your Viatik account into ${vaultName}. It is credited once Monad records the transfer.`,
                amount: amount ?? undefined,
                from: account
                  ? `Your Viatik account · ${shortAddress(account.address)}`
                  : 'Your Viatik account',
                to: vault?.name ?? 'Portfolio Vault',
                reversible:
                  'Cannot be undone once it is credited. What stays in the Portfolio Vault can be withdrawn to your Viatik account.',
                policy: 'Transfers are available to fund agreements as soon as they are credited.',
              }
            : {
                what:
                  settlement === 'simulated'
                    ? `Test funds are credited to ${vaultName}. This demo is simulated: nothing leaves a real account.`
                    : `Test funds are credited to ${vaultName}. Test environment: Viatik records it, nothing moves on ${network.name} yet.`,
                amount: amount ?? undefined,
                from: settlement === 'simulated' ? 'Test funds · demo' : 'Test funds',
                to: vault?.name ?? 'Portfolio Vault',
                reversible:
                  'Cannot be undone once it is credited. What stays in the Portfolio Vault can be withdrawn.',
                policy: 'Transfers are available to fund agreements as soon as they are credited.',
              }
        }
        confirmLabel={allow.needed && allow.status !== 'done' ? 'Authorize and transfer' : 'Transfer'}
        disabled={!canTransfer}
        phase={sheetPhase}
        error={sheetError}
        onConfirm={async () => {
          if (!amount) return
          if (!monad) {
            const result = await add.run({
              portfolioId,
              amount,
              source: `${organization ?? 'Investor'} · Test funds`,
            })
            if (result) setReceiptId(result.id)
            return
          }
          if (!account) return
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
              // Authorized in the meantime (another tab, or the answer arrived late).
              setAllow({ needed: true, status: 'done' })
            }
            const result = await add.run({
              portfolioId,
              amount,
              // Product language: the receipt's Verified details carry the network.
              source: `${organization ?? 'Investor'} · Viatik account`,
            })
            if (result) setReceiptId(result.id)
            // The Viatik account's TestUSD changed (or the read was stale when it failed).
            void wallet.refresh()
          } finally {
            setSubmitting(false)
          }
        }}
        success={{
          title: 'Funds credited',
          body:
            settlement === 'monad'
              ? `${usd(amount ?? ZERO)} is now available in ${vaultName}.`
              : `${usd(amount ?? ZERO)} of test funds is now available in ${vaultName}.`,
          actions: (
            <>
              <ButtonLink href={href('funding')} size="pill-sm">
                Fund an agreement
              </ButtonLink>
              <ReceiptDetailsButton receipt={receipt} />
            </>
          ),
        }}
        steps={
          monad
            ? [
                ...(allow.needed ? [allowStep] : []),
                ...signingSteps(transferPhase, reached, {
                  prepared: "Viatik checks the transfer against the ledger's rules.",
                  approved: 'Your Viatik account signs it. Viatik pays the network fee.',
                  done: {
                    label: 'Recorded on Monad',
                    detail: 'Credited to the Portfolio Vault and available to fund agreements.',
                  },
                }),
              ]
            : undefined
        }
      />
    </>
  )
}

/** An address on the explorer, shortened, with a copy button. */
function ExplorerAddress({ address, label }: { address: string; label: string }) {
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs">
      <a
        href={`${network.explorer}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        title={address}
        className="inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {shortHash(address, 10, 6)}
        <ExternalLink className="size-3" aria-hidden="true" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <CopyButton value={address} label={`Copy the ${label} address`} />
    </span>
  )
}

/** "Network details", closed by default: what a sender needs to know, and the contracts involved. */
function NetworkDetails({
  settlement,
  monad,
  account,
}: {
  settlement: Settlement
  monad: MonadView | null
  account: string | null
}) {
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const items = [
    { label: 'Asset', value: 'TestUSD (6 decimals, no value)' },
    ...(monad
      ? [
          {
            label: 'Token contract',
            hint: 'Import it in another account to see and send TestUSD.',
            value: monad.token ? (
              <ExplorerAddress address={monad.token} label="token contract" />
            ) : (
              'Not configured'
            ),
          },
        ]
      : []),
    { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
    ...(monad
      ? [
          {
            label: 'Your Viatik account',
            value: account ? <ExplorerAddress address={account} label="Viatik account" /> : 'Being set up',
          },
          {
            label: 'Ledger contract',
            value: monad.contract ? (
              <ExplorerAddress address={monad.contract} label="ledger contract" />
            ) : (
              'Not configured'
            ),
          },
        ]
      : [
          {
            label: 'Settlement',
            value:
              settlement === 'simulated'
                ? `Simulated in this demo: nothing is sent on ${network.name}`
                : `Test environment: Viatik records transfers; settlement on ${network.name} is not switched on yet`,
          },
        ]),
    { label: 'Per transfer', value: `Up to ${usd(MAX_DEPOSIT)}` },
    ...(monad ? [{ label: 'Network fee', value: 'Paid by Viatik' }] : []),
  ]
  return (
    <Collapsible className="flex flex-col gap-3">
      <CollapsibleTrigger className="group inline-flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        Network details
        <ChevronDown
          className="size-4 transition-transform group-data-[panel-open]:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Panel description="For reference. Amounts in Viatik are shown in USD; TestUSD stands in for USDC one to one.">
          <KeyValueList dense items={items} />
          {monad ? (
            <p className="mt-3 text-xs text-pretty text-subtle">
              Send TestUSD only to your Viatik account address. Funds sent to the ledger contract directly are
              not credited: transfers go through this page.
            </p>
          ) : null}
        </Panel>
      </CollapsibleContent>
    </Collapsible>
  )
}

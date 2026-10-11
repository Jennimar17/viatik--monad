'use client'

import { ArrowUpRight, ChevronDown, Info, QrCode as QrIcon, TriangleAlert } from 'lucide-react'
import type * as React from 'react'

import type { OwnAccount, WithdrawalSettlement } from '@/components/app/member-own-account'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { Amount } from '@/components/viatik/amount'
import { Panel } from '@/components/viatik/layout'
import { CopyButton } from '@/components/viatik/operation'
import { QrCode } from '@/components/viatik/qr-code'
import { useLedgerAccount } from '@/data/react'
import { cents, type Cents } from '@/domain/money'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'

/**
 * The signed-in person's own Viatik account (their embedded account): its
 * address in full with a copy button, a QR code of the plain address, an
 * explorer link and, optionally, what it holds. Used by the Investor's Add
 * funds, the Member's Payments ▸ Addresses and the Admin's Settings ▸ Viatik
 * account. Source the account from
 * `useOwnAccount()` for every role, so the demo shows the same placeholder
 * address everywhere (and never a QR code for it).
 */

/** One "what this account holds" line, in whichever state its read is. */
export type AccountBalanceLine = {
  /** e.g. "TestUSD in this account". */
  label: string
  status: 'loading' | 'ready' | 'unavailable' | 'error'
  /** Set when `status` is 'ready'. */
  value?: Cents
  /** Offered when the read failed. */
  onRetry?: () => void
}

/**
 * What the person's Viatik account holds on Monad, read live (it can fail or
 * be unavailable while Monad cannot be reached). Undefined outside Monad: the
 * demo and the test ledger have no such balance, so the card shows no line.
 * Investor Add funds already reads it through `useWalletActions()`: build the
 * line from that read instead of calling this a second time.
 */
export function useAccountBalanceLine(
  own: OwnAccount,
  label = 'TestUSD in this account',
): AccountBalanceLine | undefined {
  const { account, isLoading, isError, refetch } = useLedgerAccount()
  if (own.settlement !== 'monad' || !own.address) return undefined
  if (isLoading) return { label, status: 'loading' }
  if (isError) return { label, status: 'error', onRetry: () => void refetch() }
  if (!account?.available) return { label, status: 'unavailable' }
  return { label, status: 'ready', value: cents(Math.trunc(account.balance)) }
}

/** What happens to money sent to this address, per settlement (the default line under the address). */
function defaultSettlementNote(settlement: WithdrawalSettlement, network: string): string {
  if (settlement === 'simulated') return 'Demo: a placeholder address. Nothing arrives.'
  if (settlement === 'test')
    return 'Test environment: this address is real, but Viatik does not move funds to or from it yet.'
  return `Only TestUSD on ${network}. Other tokens or networks do not show up in Viatik.`
}

export function AccountAddressCard({
  own,
  title = 'Your Viatik account',
  description,
  qr = 'shown',
  qrLabel = 'Your Viatik account address as a QR code',
  addressLabel = 'Address',
  settlementNotes,
  balance,
  explorer = true,
  note,
  actions,
  className,
}: {
  /** From `useOwnAccount()`. */
  own: OwnAccount
  title?: React.ReactNode
  description?: React.ReactNode
  /**
   * 'shown' next to the address (Add funds), 'collapsed' behind "Show QR code"
   * (Member Addresses) or 'none'. Never rendered for the demo's placeholder address.
   */
  qr?: 'shown' | 'collapsed' | 'none'
  /** The QR code's accessible name. */
  qrLabel?: string
  /** The label above the full address. */
  addressLabel?: string
  /**
   * Replaces the line under the address for a settlement. Defaults: demo "Demo: a
   * placeholder address. Nothing arrives."; test environment "this address is real,
   * but Viatik does not move funds to or from it yet"; Monad "Only TestUSD on {network}…".
   */
  settlementNotes?: Partial<Record<WithdrawalSettlement, React.ReactNode>>
  /** What the account holds; see `useAccountBalanceLine`. Omit for no line. */
  balance?: AccountBalanceLine
  /** A "View on explorer" link, only for a real account on Monad. */
  explorer?: boolean
  /** A sentence under the address, e.g. what money sent here does (or does not) do. */
  note?: React.ReactNode
  /** Buttons at the bottom, e.g. a Refresh button. */
  actions?: React.ReactNode
  className?: string
}) {
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  const address = own.address
  // The demo's placeholder is not a real account: no QR code anyone could scan and pay.
  const scannable = Boolean(address && own.settlement !== 'simulated' && qr !== 'none')
  const qrCode = address ? <QrCode value={address} label={qrLabel} className="size-36 sm:size-40" /> : null
  const explorerUrl =
    explorer && address && own.settlement === 'monad' ? `${network.explorer}/address/${address}` : null

  return (
    <Panel title={title} description={description} className={className}>
      {own.loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner /> Loading your Viatik account…
        </p>
      ) : !address ? (
        // It appears here by itself once it exists: nothing to retry.
        <p className="flex items-center gap-2 text-sm text-pretty text-muted-foreground" role="status">
          <Spinner /> Your Viatik account is still being created. This takes a moment after you sign in.
        </p>
      ) : (
        <div className="flex flex-col gap-6 sm:flex-row">
          {scannable && qr === 'shown' ? qrCode : null}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">{addressLabel}</span>
              <span className="flex items-start gap-1">
                <span className="min-w-0 font-mono text-sm break-all text-foreground">{address}</span>
                <CopyButton value={address} label="Copy your Viatik account address" className="-mt-0.5" />
              </span>
            </div>

            {balance ? <BalanceLine line={balance} /> : null}

            {own.failed ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-pretty text-subtle">
                How this account settles could not be loaded.
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={own.retry}>
                  Try again
                </Button>
              </p>
            ) : (
              <p className="flex gap-2 text-xs text-pretty text-subtle">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {settlementNotes?.[own.settlement] ?? defaultSettlementNote(own.settlement, network.name)}
                </span>
              </p>
            )}

            {own.paused ? (
              <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                Viatik cannot reach {network.name} right now. What this account holds may be out of date.
              </p>
            ) : null}

            {note ? <div className="text-sm text-pretty text-muted-foreground">{note}</div> : null}

            {explorerUrl || (scannable && qr === 'collapsed') || actions ? (
              <Collapsible className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  {explorerUrl ? (
                    <a
                      href={explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      View on explorer
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  ) : null}
                  {scannable && qr === 'collapsed' ? (
                    <CollapsibleTrigger className="group inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                      <QrIcon className="size-4" aria-hidden="true" />
                      <span className="group-data-[panel-open]:hidden">Show QR code</span>
                      <span className="hidden group-data-[panel-open]:inline">Hide QR code</span>
                      <ChevronDown
                        className="size-4 transition-transform group-data-[panel-open]:rotate-180"
                        aria-hidden="true"
                      />
                    </CollapsibleTrigger>
                  ) : null}
                  {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
                </div>
                {scannable && qr === 'collapsed' ? <CollapsibleContent>{qrCode}</CollapsibleContent> : null}
              </Collapsible>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  )
}

function BalanceLine({ line }: { line: AccountBalanceLine }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{line.label}</span>
      {line.status === 'ready' && line.value !== undefined ? (
        <Amount value={line.value} size="lg" />
      ) : line.status === 'loading' ? (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner /> Reading the balance…
        </span>
      ) : line.status === 'unavailable' ? (
        <span className="text-sm text-pretty text-muted-foreground">Not available right now.</span>
      ) : (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          The balance could not be read.
          {line.onRetry ? (
            <Button variant="link" size="sm" className="h-auto p-0" onClick={line.onRetry}>
              Try again
            </Button>
          ) : null}
        </span>
      )}
    </div>
  )
}

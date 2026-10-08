'use client'

import { ArrowUpRight, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Amount } from '@/components/viatik/amount'
import { Panel, SectionLabel } from '@/components/viatik/layout'
import type { Cents } from '@/domain/money'

import { MemberBalanceMovements } from './member-balance-movements'
import { useOwnAccount, type OwnAccount } from './member-own-account'
import { MemberSavedAddresses, useSavedAddresses } from './member-saved-addresses'
import { MemberWithdrawSheet } from './member-withdraw-sheet'

/** One line under the balance: how sending settles here, or why it cannot right now. */
function SettlementNote({ own }: { own: OwnAccount }) {
  if (own.loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Checking how sending works here…
      </p>
    )
  }
  if (own.failed) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-pretty text-muted-foreground">
          Sending options could not be loaded. Nothing was changed.
        </p>
        <Button variant="outline" size="pill-sm" onClick={own.retry}>
          Try again
        </Button>
      </div>
    )
  }
  if (own.paused) {
    return (
      <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        Sending is paused: Viatik cannot reach the network right now. Your balance is safe. Try again later.
      </p>
    )
  }
  return (
    <p className="text-xs text-pretty text-subtle">
      {own.settlement === 'monad'
        ? 'What you send arrives within seconds, settled on Monad. Viatik pays the network fee.'
        : own.settlement === 'test'
          ? 'Test environment: Viatik records what you send, but nothing reaches the address yet.'
          : 'Demo: sending is simulated with a placeholder address. Nothing leaves Viatik.'}
    </p>
  )
}

/**
 * The Member's Viatik account in one Agency: what the Agency paid them and they
 * still hold, how it moved, where they can send it (their own account by default,
 * or an address they saved), and "Send to my account".
 */
export function MemberViatikAccount({
  agencyId,
  agencyName,
  held,
  canSend,
  className,
}: {
  agencyId: string
  agencyName: string
  /** What the person holds in this Agency (`memberHeld`), never below zero. */
  held: Cents
  /** May take their own balance out (`receive_payout`); without it there is no send button. */
  canSend: boolean
  className?: string
}) {
  const own = useOwnAccount()
  const saved = useSavedAddresses()
  const [sendOpen, setSendOpen] = React.useState(false)
  // Nowhere to send yet: the account is still being created and nothing is saved.
  const nowhere = !own.address && saved.length === 0
  const blocked = own.loading || own.failed || own.paused

  return (
    <Panel
      title="Viatik account"
      description={`What ${agencyName} paid you and you have not sent or returned yet.`}
      className={className}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-sm text-muted-foreground">Your balance with {agencyName}</span>
              <Amount value={held} size="xl" />
            </div>
            {canSend ? (
              <Button
                size="pill"
                className="w-full sm:w-auto"
                disabled={held <= 0 || nowhere || blocked}
                onClick={() => setSendOpen(true)}
              >
                <ArrowUpRight data-icon="inline-start" /> Send to my account
              </Button>
            ) : null}
          </div>
          {held <= 0 && !blocked ? (
            <p className="text-xs text-pretty text-subtle">
              Nothing to send yet: {agencyName} has not paid you, or you already sent or returned everything.
            </p>
          ) : (
            <SettlementNote own={own} />
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 border-t border-border pt-5 md:grid-cols-2">
          <section aria-labelledby="member-account-movements" className="flex min-w-0 flex-col gap-2">
            <SectionLabel id="member-account-movements">Recent movements</SectionLabel>
            <MemberBalanceMovements agencyId={agencyId} agencyName={agencyName} ownAddress={own.address} />
          </section>
          <section aria-labelledby="member-account-addresses" className="flex min-w-0 flex-col gap-2">
            <SectionLabel id="member-account-addresses">Where you can send it</SectionLabel>
            <MemberSavedAddresses own={own} />
          </section>
        </div>
      </div>

      <MemberWithdrawSheet
        open={sendOpen && canSend}
        onOpenChange={setSendOpen}
        agencyId={agencyId}
        agencyName={agencyName}
        held={held}
        own={own}
      />
    </Panel>
  )
}

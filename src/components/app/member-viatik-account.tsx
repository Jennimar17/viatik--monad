'use client'

import { TriangleAlert } from 'lucide-react'

import { usePermissions } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useViatikState } from '@/data/react'
import { cents, clampToZero, type Cents } from '@/domain/money'
import { memberHeld } from '@/domain/selectors'

import { useOwnAccount, type OwnAccount } from './member-own-account'
import { useSavedAddresses } from './member-saved-addresses'

export type MemberViatikAccount = {
  /** What the Agency paid the person and they have not sent or returned yet, never below zero. */
  held: Cents
  /** The person's own account, and how sending settles here. */
  own: OwnAccount
  /** May take their own balance out (`receive_payout`): without it there is no send or return button. */
  canMove: boolean
  /** Still loading, failed, or paused: nothing can be sent right now. */
  blocked: boolean
  /** Nowhere to send yet: their own account is still being created and nothing is saved. */
  nowhere: boolean
  /** "Send to my account" can open now: something to send, somewhere to send it, and the network ready. */
  canSendNow: boolean
}

/**
 * The Member's Viatik account in one Agency, as Payments and Overview show it:
 * the balance they hold, their own account, and whether they can send it now.
 */
export function useMemberViatikAccount(agencyId: string): MemberViatikAccount {
  const { state, userId } = useViatikState()
  const { can } = usePermissions()
  const own = useOwnAccount()
  const saved = useSavedAddresses()
  const held = clampToZero(cents(memberHeld(state, agencyId, userId)))
  // Sending out and returning both take the person's own balance: the engine authorizes `receive_payout`.
  const canMove = can('receive_payout', { ownerUserId: userId })
  const blocked = own.loading || own.failed || own.paused
  // Nowhere to send yet: the account is still being created and nothing is saved.
  const nowhere = !own.address && saved.length === 0
  return { held, own, canMove, blocked, nowhere, canSendNow: canMove && held > 0 && !nowhere && !blocked }
}

/**
 * One line under the balance: how sending settles here, why it cannot right
 * now, or that there is nothing to send yet.
 */
export function SettlementNote({
  account,
  agencyName,
}: {
  account: MemberViatikAccount
  agencyName: string
}) {
  const { own, held, blocked, nowhere } = account
  if (held <= 0 && !blocked) {
    return (
      <p className="text-xs text-pretty text-subtle">
        Nothing to send yet: {agencyName} has not paid you, or you already sent or returned everything.
      </p>
    )
  }
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
  if (nowhere) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Your Viatik account is being created. You can send to it in a moment.
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

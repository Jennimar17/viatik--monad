'use client'

import { ArrowDownLeft, ArrowUpRight, Undo2, type LucideIcon } from 'lucide-react'
import * as React from 'react'

import { useReceiptDrawer } from '@/components/app/receipt-details'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { useViatikState } from '@/data/react'
import { shortAddress } from '@/domain/address'
import { cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import type { Location, Movement, ViatikState } from '@/domain/types'
import { formatLocalDate } from '@/lib/local-time'

import { sameAddress } from './member-own-account'

/** How many movements show before "Show all". */
const RECENT = 5

const isMine = (location: Location, userId: string) =>
  location.kind === 'recipient' &&
  location.recipient.kind === 'member' &&
  location.recipient.userId === userId

type Line = {
  movement: Movement
  incoming: boolean
  icon: LucideIcon
  title: string
  detail: string
}

/** One movement of the person's balance, told from their side. */
function describe(
  state: ViatikState,
  movement: Movement,
  context: { userId: string; agencyName: string; ownAddress: string | null },
): Line {
  const { userId, agencyName, ownAddress } = context
  if (isMine(movement.to, userId)) {
    const payment =
      movement.kind === 'payment' ? state.payments.find((p) => p.id === movement.refId) : undefined
    return {
      movement,
      incoming: true,
      icon: ArrowDownLeft,
      title: payment?.memo || 'Payment received',
      detail: `Paid by ${agencyName}`,
    }
  }
  if (movement.kind === 'withdrawal' && movement.to.kind === 'external') {
    // Only the owner of a withdrawal sees its full address; anyone else gets the short label.
    const address = movement.to.address
    const saved = address
      ? state.payoutAddresses.find((a) => a.userId === userId && sameAddress(a.address, address))
      : undefined
    return {
      movement,
      incoming: false,
      icon: ArrowUpRight,
      title: sameAddress(address, ownAddress)
        ? 'Sent to my Viatik account'
        : saved
          ? `Sent to ${saved.label}`
          : 'Sent to an address',
      detail: address ? shortAddress(address) : movement.to.label,
    }
  }
  if (movement.kind === 'transfer') {
    // A return of money for purchases names what it was for; other money names where it went.
    const settles = movement.settlesPaymentId
      ? state.payments.find((p) => p.id === movement.settlesPaymentId)
      : undefined
    const purpose = settles
      ? (state.requests.find((r) => r.id === settles.requestId)?.purpose ?? settles.memo)
      : undefined
    return {
      movement,
      incoming: false,
      icon: Undo2,
      title: `Returned to ${agencyName}`,
      detail: purpose
        ? `Unused from “${purpose}”`
        : (receiptFor(state, movement.receiptId)?.toLabel ?? 'Unused funds'),
    }
  }
  return {
    movement,
    incoming: false,
    icon: ArrowUpRight,
    title: 'Sent from your balance',
    detail: agencyName,
  }
}

/**
 * What moved in and out of the person's Viatik balance in one Agency: payments
 * received, funds returned, money sent to an account. Each row opens its receipt.
 */
export function MemberBalanceMovements({
  agencyId,
  agencyName,
  ownAddress,
}: {
  agencyId: string
  agencyName: string
  ownAddress: string | null
}) {
  const { state, userId } = useViatikState()
  const receipts = useReceiptDrawer()
  const [showAll, setShowAll] = React.useState(false)

  const lines = React.useMemo(
    () =>
      state.movements
        .filter((m) => m.agencyId === agencyId && (isMine(m.to, userId) || isMine(m.from, userId)))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map((m) => describe(state, m, { userId, agencyName, ownAddress })),
    [state, agencyId, userId, agencyName, ownAddress],
  )

  if (lines.length === 0) {
    return (
      <EmptyState
        compact
        title="No movements yet"
        description={`Payments from ${agencyName} and what you send or return show here.`}
      />
    )
  }

  const shown = showAll ? lines : lines.slice(0, RECENT)

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {shown.map((line) => {
          const { movement, incoming, icon: Icon } = line
          const receipt = receiptFor(state, movement.receiptId)
          const content = (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium underline-offset-4 group-hover:underline">
                  {line.title}
                </span>
                <span className="truncate text-xs text-subtle">
                  {line.detail} · {formatLocalDate(movement.createdAt, { withYear: false })}
                </span>
              </span>
              <Amount
                value={cents(incoming ? movement.amount : -movement.amount)}
                size="sm"
                signed
                tone={incoming ? 'positive' : 'default'}
              />
              {receipt ? <span className="sr-only">, view receipt</span> : null}
            </>
          )
          return (
            <li key={movement.id} className="border-t border-border first:border-t-0">
              {receipt ? (
                <button
                  type="button"
                  onClick={() => receipts.show(receipt)}
                  className="group flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-3 py-3">{content}</div>
              )}
            </li>
          )
        })}
      </ul>
      {lines.length > RECENT ? (
        <Button
          variant="ghost"
          size="pill-sm"
          className="mt-1 w-fit"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? 'Show fewer' : `Show all ${lines.length}`}
        </Button>
      ) : null}
      {receipts.drawer}
    </div>
  )
}

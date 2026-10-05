import type { ViatikState } from '@/domain/types'
import { ledgerSnapshot } from '@/ledger/snapshot'

import type { LedgerLocationKind, LedgerView } from './api-contract'

/** A balance as a screen shows it, against what Monad held at the last read. */
export type BalanceCheck = { status: 'verified'; block: number | null } | { status: 'pending' }

/** A balance the app and Monad's last read disagree on (`chain` null: not read yet). */
export type LedgerDifference =
  | { kind: LedgerLocationKind; id: string; app: number; chain: number | null }
  | { kind: 'member'; agencyId: string; userId: string; app: number; chain: number | null }

export type LedgerChecks = {
  /** Null for a balance that does not live on the ledger (the Yield Vault, for one). */
  check: (locationId: string) => BalanceCheck | null
  differences: LedgerDifference[]
  /** How many balances were compared. */
  compared: number
}

/**
 * Compares what this person's screens show (the projection of their state)
 * with Monad's balances at the last read. Null when their workspaces settle
 * on the demo ledger. The server reads the same scoped state; it leaves out
 * other Members' balances where the person sees only their own records, so
 * Members are compared as the view lists them.
 */
export function ledgerChecks(state: ViatikState, view: LedgerView | undefined): LedgerChecks | null {
  if (view?.settlement !== 'monad') return null
  const snapshot = ledgerSnapshot(state)
  const onChain = new Map(view.locations.map((location) => [location.id, location]))
  const block = view.balances?.block ?? null

  const checks = new Map<string, BalanceCheck>()
  const differences: LedgerDifference[] = []
  for (const [id, place] of snapshot.places) {
    const location = onChain.get(id)
    const chain = location?.chain ?? null
    const matches = chain === place.balance && !location?.inexact
    checks.set(id, matches ? { status: 'verified', block } : { status: 'pending' })
    if (!matches) differences.push({ kind: place.kind, id, app: place.balance, chain })
  }
  for (const member of view.members) {
    const app = snapshot.members.get(`${member.agencyId}|${member.userId}`) ?? 0
    if (member.chain === app && !member.inexact) continue
    differences.push({
      kind: 'member',
      agencyId: member.agencyId,
      userId: member.userId,
      app,
      chain: member.chain,
    })
  }
  return {
    check: (locationId) => checks.get(locationId) ?? null,
    differences,
    compared: checks.size + view.members.length,
  }
}

'use client'

import * as React from 'react'
import type { Address } from 'viem'

import { useLedger, useViatikState } from '@/data/react'
import { parseAddress } from '@/domain/address'
import { pseudoAddress } from '@/domain/ids'
import { useSession } from '@/lib/session'

/** How money sent out of a Viatik balance settles for the signed-in person. */
export type WithdrawalSettlement =
  /** The demo: a simulated ledger and a placeholder address. Nothing leaves Viatik. */
  | 'simulated'
  /** A real account whose workspace does not settle on Monad yet: Viatik records it, nothing is sent. */
  | 'test'
  /** A real account on Monad: the money arrives at the address. */
  | 'monad'

export type OwnAccount = {
  /**
   * Where "my account" points: the person's own account, or a placeholder in the demo.
   * Null for a moment after a first sign-in, while the account is being created.
   */
  address: Address | null
  settlement: WithdrawalSettlement
  /** Settles on Monad, but this deployment cannot reach it right now. */
  paused: boolean
  /** Still finding out how this workspace settles. */
  loading: boolean
  /** How this workspace settles could not be loaded: nothing should be sent until it is. */
  failed: boolean
  retry: () => void
}

/** The person's own account, and how a withdrawal to it (or to a saved address) settles. */
export function useOwnAccount(): OwnAccount {
  const { mode, userId } = useViatikState()
  const { account } = useSession()
  const ledger = useLedger()
  const { view, isLoading, retry } = ledger
  const accountAddress = account?.address ?? null

  return React.useMemo<OwnAccount>(() => {
    if (mode !== 'account') {
      return {
        address: parseAddress(pseudoAddress(userId)),
        settlement: 'simulated',
        paused: false,
        loading: false,
        failed: false,
        retry,
      }
    }
    return {
      address: accountAddress ? parseAddress(accountAddress) : null,
      settlement: view?.settlement === 'monad' ? 'monad' : 'test',
      paused: view?.settlement === 'monad' && !view.available,
      loading: !view && isLoading,
      failed: !view && !isLoading,
      retry,
    }
  }, [mode, userId, accountAddress, view, isLoading, retry])
}

/** Addresses compare without their checksum casing. */
export const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b && a.toLowerCase() === b.toLowerCase())

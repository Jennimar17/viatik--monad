'use client'

import * as React from 'react'
import { encodeFunctionData, maxUint256 } from 'viem'

import type { LedgerAccount } from '@/data/api-contract'
import { DataSourceError } from '@/data/data-source'
import { useLedgerAccount } from '@/data/react'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { useSession } from '@/lib/session'
import { testUsdAbi } from '@/web3/abi/test-usd'

/** What the wallet is doing right now, for the screen to say it. */
export type WalletStep = 'idle' | 'getting_funds' | 'allowing'

/** How long to wait for a sent transaction to show up in the account's balances. */
const VISIBLE_WITHIN_MS = 30_000
const POLL_EVERY_MS = 1_500

type Available = Extract<LedgerAccount, { available: true }>

/**
 * The person's own account on Monad, for adding funds with real tokens: it holds
 * TestUSD and lets the ledger move it. Both actions are sponsored transactions the
 * person signs in the browser (no wallet UI), and each one waits until Monad shows
 * its effect, so the deposit that follows is simulated against the new balance.
 * Only with a real account: in the demo `ready` is false and nothing is sent.
 */
export function useWalletActions() {
  const { sendCall } = useSession()
  const { account, isLoading, isError, refetch } = useLedgerAccount()
  const [step, setStep] = React.useState<WalletStep>('idle')
  const available = account?.available ? account : null

  /** Asks again until `done` holds for the account, or gives up. */
  const waitFor = React.useCallback(
    async (done: (read: Available) => boolean): Promise<Available> => {
      const deadline = Date.now() + VISIBLE_WITHIN_MS
      while (Date.now() < deadline) {
        const { data } = await refetch()
        if (data?.available && done(data)) return data
        await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS))
      }
      throw new DataSourceError(
        'Your transaction was sent but Monad has not shown it yet. Refresh in a moment.',
        'still_processing',
        true,
      )
    },
    [refetch],
  )

  const send = React.useCallback(
    async (target: Available, data: `0x${string}`) => {
      if (!sendCall) throw new DataSourceError('Sign in with your account to continue.', 'unauthenticated')
      const { chainId } = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
      return sendCall({ to: target.token, data, chainId, from: target.address, expiresAt: null })
    },
    [sendCall],
  )

  /** Mints the test amount (`testFunds`) of TestUSD to the person's own account. */
  const getTestFunds = React.useCallback(async () => {
    if (!available) throw new DataSourceError('Your account is still being set up.', 'account_not_ready', true)
    setStep('getting_funds')
    try {
      const before = available.balance
      await send(
        available,
        encodeFunctionData({
          abi: testUsdAbi,
          functionName: 'mint',
          args: [available.address, BigInt(available.testFunds) * BigInt(10_000)],
        }),
      )
      return await waitFor((read) => read.balance >= before + available.testFunds)
    } finally {
      setStep('idle')
    }
  }, [available, send, waitFor])

  /**
   * Lets the ledger move the person's TestUSD, once and without a limit, when what it
   * may move today is less than `amount` (cents). The ledger only ever pulls from the
   * person who deposits, in that same deposit, so one approval is enough.
   */
  const ensureAllowance = React.useCallback(
    async (amount: number) => {
      if (!available) throw new DataSourceError('Your account is still being set up.', 'account_not_ready', true)
      if (available.allowance >= amount) return available
      setStep('allowing')
      try {
        await send(
          available,
          encodeFunctionData({ abi: testUsdAbi, functionName: 'approve', args: [available.ledger, maxUint256] }),
        )
        return await waitFor((read) => read.allowance >= amount)
      } finally {
        setStep('idle')
      }
    },
    [available, send, waitFor],
  )

  return {
    /** The person's account as Monad sees it; undefined while loading, `available: false` without one. */
    account,
    isLoading,
    isError,
    /** A real account with a wallet on a configured ledger: the actions can run. */
    ready: Boolean(available && sendCall),
    step,
    getTestFunds,
    ensureAllowance,
    refresh: refetch,
  }
}

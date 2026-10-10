'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { apiFetch } from './api'
import { ApiDataSource } from './api-data-source'
import { DataSourceError, getDataSource } from './index'
import type { KeeperDone, KeeperRunAnswer } from './keeper'
import { MockDataSource } from './mock-data-source'
import { STATE_KEY, useViatik } from './react'

/**
 * "Run due payments" for an Agency Admin (`send_payment` in the Agency): the
 * keeper's pass for that Agency now, instead of waiting for the timer. It pays
 * the Agency's due scheduled payments (on Monad with real accounts, on the
 * demo ledger otherwise) and tells due monthly reminders. The answer says how
 * many runs were paid, could not be paid, or were left for the next pass;
 * `busy` when another pass was running (nothing done, try again shortly). The
 * state is read again afterwards. Errors (no permission, `cooldown` within 30
 * seconds of the last press, or 15 of one that failed) come back as
 * `DataSourceError`.
 */
export function useRunDuePayments(agencyId: string) {
  const { userId, mode, credentials } = useViatik()
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async (): Promise<KeeperRunAnswer> => {
      if (!userId || !mode) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
      const source = getDataSource(mode)
      if (source instanceof MockDataSource) return source.runDuePayments(userId, agencyId)
      if (source instanceof ApiDataSource) {
        return apiFetch<KeeperRunAnswer>('/v1/keeper/run-now', {
          method: 'POST',
          body: { agencyId },
          credentials: await credentials(),
          expectedUserId: userId,
        })
      }
      throw new DataSourceError('Running due payments is not available here.', 'not_supported')
    },
    networkMode: 'always',
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATE_KEY }),
  })
  const { mutateAsync, reset } = mutation
  const run = React.useCallback(async (): Promise<KeeperRunAnswer | undefined> => {
    try {
      return await mutateAsync()
    } catch {
      return undefined
    }
  }, [mutateAsync])
  return {
    run,
    /** The last answer, once it ran. */
    answer: mutation.data,
    isPending: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : undefined,
    reset,
  }
}

/** A one-line summary of a pass for a toast: "Paid 1 scheduled payment. 1 needs attention." */
export function keeperSummary(answer: KeeperRunAnswer): string {
  if (answer.status === 'busy') return 'Due payments are already running. Try again in a moment.'
  const done: KeeperDone = answer
  const parts: string[] = []
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  if (done.paid > 0) parts.push(`Paid ${plural(done.paid, 'scheduled payment', 'scheduled payments')}.`)
  if (done.failed > 0) parts.push(`${plural(done.failed, 'payment needs', 'payments need')} attention.`)
  if (done.waiting > 0)
    parts.push(`${plural(done.waiting, 'payment is', 'payments are')} still being processed.`)
  if (done.reminders > 0)
    parts.push(`${plural(done.reminders, 'monthly payment is', 'monthly payments are')} due.`)
  return parts.length > 0 ? parts.join(' ') : 'Nothing is due right now.'
}

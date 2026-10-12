import type { QueryClient } from '@tanstack/react-query'

/** Prefix of every Viatik state query; invalidate it to reload what screens show. */
export const STATE_KEY = ['viatik', 'state'] as const

/** Prefix of the ledger view queries. Under `STATE_KEY`, so whatever reloads the state reloads them too. */
export const LEDGER_KEY = [...STATE_KEY, 'ledger'] as const

/** Prefix of the signed-in person's Viatik account reads (`useLedgerAccount`); not under `STATE_KEY`. */
export const LEDGER_ACCOUNT_KEY = ['ledger-account'] as const

/**
 * What a command refreshes once it settles. The returned promise waits only for the Viatik state
 * (`[...STATE_KEY, mode, userId]`), so a receipt the command returns is already in it. The two
 * Monad reads refresh in the background: TanStack waits for `onSettled` before `mutateAsync`
 * resolves, and a live account read can take seconds, fail and retry, and its retry pauses while
 * the tab is hidden.
 */
export function refreshAfterCommand(queryClient: QueryClient): Promise<void> {
  void queryClient.invalidateQueries({ queryKey: LEDGER_ACCOUNT_KEY })
  void queryClient.invalidateQueries({ queryKey: LEDGER_KEY })
  return queryClient.invalidateQueries({
    queryKey: STATE_KEY,
    predicate: (query) => query.queryKey[2] !== LEDGER_KEY[2],
  })
}

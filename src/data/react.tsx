'use client'

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'

import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import { newId } from '@/domain/ids'
import { subjectFor } from '@/domain/permissions'
import type { Evidence, Membership, User, ViatikState } from '@/domain/types'

import { canonical } from './canonical'
import { ledgerChecks } from './ledger-check'
import {
  DataSourceError,
  getDataSource,
  type CredentialsProvider,
  type LedgerView,
  type OperationPhase,
  type SendCall,
  type SessionMode,
  type SessionProfile,
  type UploadedFile,
  UNSETTLED_CODES,
} from './index'

type ViatikContextValue = {
  state: ViatikState | undefined
  isLoading: boolean
  /** Nothing could be loaded. A failed refresh keeps showing the last data and retries on its own. */
  isError: boolean
  refetch: () => void
  userId: string | null
  /** Demo person or real account; null while nobody is signed in. */
  mode: SessionMode | null
  user: User | undefined
  memberships: Membership[]
  /** Frozen per data load so derived numbers are stable during a render. */
  now: string
  /** Tokens for the API; unused by the demo. */
  credentials: CredentialsProvider
  /** Signs what Viatik prepared on Monad; only a real account has it. */
  sendCall: SendCall | undefined
}

const ViatikContext = React.createContext<ViatikContextValue | null>(null)

/** Prefix of every Viatik state query; invalidate it to reload what screens show. */
export const STATE_KEY = ['viatik', 'state'] as const

/** Prefix of the ledger view queries. Under `STATE_KEY`, so whatever reloads the state reloads them too. */
export const LEDGER_KEY = [...STATE_KEY, 'ledger'] as const

const DEMO_LEDGER: LedgerView = { settlement: 'demo' }

/** One query cache for the product: the session and the Viatik state both live in it. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Loads everything the signed-in user may see and shares it with every screen.
 * Shared server data is polled (an unchanged state costs a 304), so what
 * other people do shows up without reloading; the demo data only changes
 * on this device.
 */
export function ViatikProvider({
  userId,
  mode,
  profile,
  credentials,
  sendCall,
  onUnauthenticated,
  children,
}: {
  userId: string | null
  mode: SessionMode | null
  /** A real account's verified profile, so the data knows the person on their first visit. */
  profile: SessionProfile | null
  credentials: CredentialsProvider
  sendCall?: SendCall
  /** The server no longer accepts the session (expired or revoked). */
  onUnauthenticated: () => void
  children: React.ReactNode
}) {
  const shared = mode !== null && getDataSource(mode).kind === 'api'
  const query = useQuery({
    queryKey: [...STATE_KEY, mode, userId],
    queryFn: () => getDataSource(mode as SessionMode).load(userId as string, { profile, credentials }),
    enabled: Boolean(userId && mode),
    staleTime: shared ? 5_000 : 60_000,
    refetchInterval: shared ? 15_000 : false,
    refetchOnWindowFocus: shared,
    // A poll that changes nothing must not re-render every screen.
    notifyOnChangeProps: ['data', 'isLoading', 'isLoadingError', 'error'],
  })

  const [mountedAt] = React.useState(() => new Date().toISOString())
  const now = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : mountedAt
  // A refresh that fails (a blip while polling) must not replace the screen,
  // and with it a form in progress, by an error.
  const { data: state, isLoading, isLoadingError: isError, refetch } = query

  const unauthenticated = query.error instanceof DataSourceError && query.error.code === 'unauthenticated'
  React.useEffect(() => {
    if (unauthenticated) onUnauthenticated()
  }, [unauthenticated, onUnauthenticated])

  // Operations signed on this device but not confirmed (the page reloaded, or the tab closed after
  // signing): confirm them once the person's data is in, then refresh what screens show.
  const queryClient = useQueryClient()

  // Someone's operation changed the state (a poll brought it): Monad's balances were read again
  // right after it, so the balance checks reload too. An unchanged poll keeps the same object.
  const shownState = React.useRef(state)
  React.useEffect(() => {
    if (shownState.current === state) return
    shownState.current = state
    void queryClient.invalidateQueries({ queryKey: LEDGER_KEY })
  }, [state, queryClient])
  const loaded = Boolean(query.data)
  const resumedFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!loaded || !userId || !mode || resumedFor.current === userId) return
    resumedFor.current = userId
    const source = getDataSource(mode)
    const open = source.openOperations?.(userId) ?? []
    if (open.length === 0) return
    void (async () => {
      for (const operation of open) {
        const outcome = await source.resume?.(operation, { credentials, sendCall })
        if (outcome?.status === 'confirmed') toast.success('An operation you started earlier is confirmed.')
        else if (outcome?.status === 'failed') toast.error(outcome.message)
        else if (outcome?.firstTime) toast(outcome.message)
      }
      await queryClient.invalidateQueries({ queryKey: STATE_KEY })
    })()
  }, [loaded, userId, mode, credentials, sendCall, queryClient])

  const value = React.useMemo<ViatikContextValue>(
    () => ({
      state,
      isLoading,
      isError,
      refetch: () => void refetch(),
      userId,
      mode,
      user: state?.users.find((u) => u.id === userId),
      memberships: state?.memberships.filter((m) => m.userId === userId && m.status === 'active') ?? [],
      now,
      credentials,
      sendCall,
    }),
    [state, isLoading, isError, refetch, userId, mode, now, credentials, sendCall],
  )

  return <ViatikContext.Provider value={value}>{children}</ViatikContext.Provider>
}

export function useViatik() {
  const context = React.useContext(ViatikContext)
  if (!context) throw new Error('useViatik must be used inside ViatikProvider')
  return context
}

/** Loaded state. Screens render only after their layout confirmed the data exists. */
export function useViatikState() {
  const context = useViatik()
  if (!context.state || !context.userId) throw new Error('Viatik state is not loaded yet')
  return { ...context, state: context.state, userId: context.userId }
}

/** The signed-in person as a permissions subject, for `can()` checks. */
export function useSubject() {
  const { state, userId } = useViatikState()
  return React.useMemo(() => subjectFor(state, userId), [state, userId])
}

/**
 * Runs a domain command through the data source and tracks the human
 * operation lifecycle (Preparing → Waiting for confirmation → Processing →
 * Completed). On Monad those are real: the request, the signature, Monad
 * confirming. Refreshes everything the user sees afterwards, including a
 * rejection the ledger recorded.
 */
export function useCommand<N extends CommandName>(
  name: N,
  options: { success?: string | ((result: CommandResult<N>) => string); silent?: boolean } = {},
) {
  const { userId, mode, credentials, sendCall } = useViatik()
  const queryClient = useQueryClient()
  const [phase, setPhase] = React.useState<OperationPhase | 'idle'>('idle')
  // A failed attempt may still have happened on the server (the answer got
  // lost). Trying the same operation again reuses its key, so the server
  // answers it again instead of applying it twice; different details or a
  // finished operation get a new key.
  const attempt = React.useRef<{ key: string; input: string } | null>(null)

  const mutation = useMutation({
    mutationFn: (input: CommandInput<N>) => {
      if (!userId || !mode) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
      const fingerprint = `${mode}:${userId}:${canonical(input)}`
      if (attempt.current?.input !== fingerprint) {
        // After a reload, the same command with the same input, still open on this device, keeps its key.
        const open = getDataSource(mode)
          .openOperations?.(userId)
          .find((operation) => operation.name === name && operation.fingerprint === fingerprint)
        attempt.current = { key: open?.key ?? newId('op'), input: fingerprint }
      }
      return getDataSource(mode).dispatch(userId, name, input, {
        onPhase: setPhase,
        credentials,
        sendCall,
        idempotencyKey: attempt.current.key,
        fingerprint,
      })
    },
    // Offline, the request fails right away and says so, instead of waiting
    // silently and sending every click once the connection is back.
    networkMode: 'always',
    onSuccess: (result) => {
      attempt.current = null
      if (!options.silent && options.success) {
        toast.success(typeof options.success === 'function' ? options.success(result) : options.success)
      }
    },
    onError: (error) => {
      // The key survives every failure: trying the same operation again can never apply it twice.
      if (options.silent) return
      const message = error instanceof Error ? error.message : 'Something went wrong.'
      if (error instanceof DataSourceError && UNSETTLED_CODES.has(error.code)) toast(message)
      else toast.error(message)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATE_KEY }),
  })

  const { mutateAsync, reset: resetMutation } = mutation
  const run = React.useCallback(
    async (input: CommandInput<N>): Promise<CommandResult<N> | undefined> => {
      try {
        return await mutateAsync(input)
      } catch {
        return undefined
      }
    },
    [mutateAsync],
  )

  const reset = React.useCallback(() => {
    resetMutation()
    // The key survives: closing a sheet after an unclear failure and trying
    // the same operation again must still be recognized as a retry.
    setPhase('idle')
  }, [resetMutation])

  return {
    run,
    phase,
    error: mutation.error instanceof Error ? mutation.error.message : undefined,
    isPending: mutation.isPending,
    reset,
  }
}

/**
 * Where the signed-in person's workspaces settle and Monad's balances for
 * them, compared with what the screens show (`checks`, null on the demo
 * ledger). `refresh` reads Monad again.
 */
export function useLedger() {
  const { state, userId, mode, credentials } = useViatik()
  const queryClient = useQueryClient()
  // While a balance is pending (someone's operation landed and its read is on the way, or the
  // read failed), ask again every few seconds; the server reads Monad again when its last read is
  // for an older state.
  const [pending, setPending] = React.useState(false)
  const query = useQuery({
    queryKey: [...LEDGER_KEY, mode, userId],
    queryFn: () => {
      const source = getDataSource(mode as SessionMode)
      return source.ledger ? source.ledger(userId as string, { credentials }) : DEMO_LEDGER
    },
    enabled: Boolean(userId && mode),
    staleTime: 10_000,
    refetchInterval: pending ? 15_000 : false,
  })
  const refresh = useMutation({
    mutationFn: () => {
      if (!userId || !mode) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
      const source = getDataSource(mode)
      return source.ledger
        ? source.ledger(userId, { credentials, refresh: true })
        : Promise.resolve(DEMO_LEDGER)
    },
    networkMode: 'always',
    onSuccess: (view) => queryClient.setQueryData([...LEDGER_KEY, mode, userId], view),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Monad could not be read.'),
  })
  const view = query.data
  const checks = React.useMemo(() => (state ? ledgerChecks(state, view) : null), [state, view])
  const somethingPending = Boolean(checks && checks.differences.length > 0)
  if (somethingPending !== pending) setPending(somethingPending)
  const { refetch } = query
  return {
    view,
    checks,
    isLoading: query.isLoading,
    isError: query.isError,
    retry: React.useCallback(() => void refetch(), [refetch]),
    refresh: refresh.mutate,
    refreshing: refresh.isPending,
  }
}

/**
 * Evidence files for the signed-in person: `upload` stores a file privately
 * and returns what a command attaches; `canOpen` says whether a file has a
 * copy to show; `open` shows it in a new tab.
 */
export function useEvidenceFiles() {
  const { userId, mode, credentials } = useViatik()

  const upload = React.useCallback(
    async (file: File): Promise<UploadedFile> => {
      if (!mode) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
      try {
        return await getDataSource(mode).uploadEvidence(file, { credentials })
      } catch (error) {
        if (error instanceof DataSourceError) throw error
        throw new DataSourceError(`${file.name} could not be uploaded. Try again.`, 'upload_failed')
      }
    },
    [mode, credentials],
  )

  const canOpen = React.useCallback(
    (evidence: Evidence) => (mode ? getDataSource(mode).canOpenEvidence(evidence) : false),
    [mode],
  )

  const open = React.useCallback(
    async (evidenceId: string) => {
      if (!mode || !userId) return
      // Open the tab while the click still counts as the person's own action
      // (popup blockers), then point it at the file once the link arrives.
      const tab = window.open('', '_blank')
      try {
        const url = await getDataSource(mode).evidenceLink(userId, evidenceId, { credentials })
        if (tab) {
          tab.opener = null
          tab.location.href = url
        } else {
          // Blocked: offer the link instead of leaving the page the person is on.
          toast('Your browser blocked the new tab.', {
            action: { label: 'Open file', onClick: () => window.open(url, '_blank', 'noopener') },
          })
        }
      } catch (error) {
        tab?.close()
        toast.error(error instanceof Error ? error.message : 'This file could not be opened.')
      }
    },
    [mode, userId, credentials],
  )

  return { upload, canOpen, open }
}

/** Restores the seeded demo state for everyone on this device. */
export function useResetDemo() {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await getDataSource('demo').reset?.()
    await queryClient.invalidateQueries({ queryKey: STATE_KEY })
  }, [queryClient])
}

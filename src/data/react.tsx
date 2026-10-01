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
import { subjectFor } from '@/domain/permissions'
import type { Membership, User, ViatikState } from '@/domain/types'

import {
  DataSourceError,
  getDataSource,
  type OperationPhase,
  type SessionMode,
  type SessionProfile,
} from './index'

type ViatikContextValue = {
  state: ViatikState | undefined
  isLoading: boolean
  isError: boolean
  refetch: () => void
  userId: string | null
  /** Demo person or real account; null while nobody is signed in. */
  mode: SessionMode | null
  user: User | undefined
  memberships: Membership[]
  /** Frozen per data load so derived numbers are stable during a render. */
  now: string
}

const ViatikContext = React.createContext<ViatikContextValue | null>(null)

/** Prefix of every Viatik state query; invalidate it to reload what screens show. */
export const STATE_KEY = ['viatik', 'state'] as const

/** One query cache for the product: the session and the Viatik state both live in it. */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Loads everything the signed-in user may see and shares it with every screen. */
export function ViatikProvider({
  userId,
  mode,
  profile,
  children,
}: {
  userId: string | null
  mode: SessionMode | null
  /** A real account's verified profile, so the data knows the person on their first visit. */
  profile: SessionProfile | null
  children: React.ReactNode
}) {
  const query = useQuery({
    queryKey: [...STATE_KEY, mode, userId],
    queryFn: () => getDataSource(mode as SessionMode).load(userId as string, { profile }),
    enabled: Boolean(userId && mode),
    staleTime: 60_000,
  })

  const [mountedAt] = React.useState(() => new Date().toISOString())
  const now = query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : mountedAt
  const { data: state, isLoading, isError, refetch } = query

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
    }),
    [state, isLoading, isError, refetch, userId, mode, now],
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
 * Completed). Refreshes everything the user sees afterwards, including a
 * rejection the ledger recorded.
 */
export function useCommand<N extends CommandName>(
  name: N,
  options: { success?: string | ((result: CommandResult<N>) => string); silent?: boolean } = {},
) {
  const { userId, mode } = useViatik()
  const queryClient = useQueryClient()
  const [phase, setPhase] = React.useState<OperationPhase | 'idle'>('idle')

  const mutation = useMutation({
    mutationFn: (input: CommandInput<N>) => {
      if (!userId || !mode) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
      return getDataSource(mode).dispatch(userId, name, input, { onPhase: setPhase })
    },
    onSuccess: (result) => {
      if (!options.silent && options.success) {
        toast.success(typeof options.success === 'function' ? options.success(result) : options.success)
      }
    },
    onError: (error) => {
      if (!options.silent) toast.error(error instanceof Error ? error.message : 'Something went wrong.')
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

/** Restores the seeded demo state for everyone on this device. */
export function useResetDemo() {
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    await getDataSource('demo').reset?.()
    await queryClient.invalidateQueries({ queryKey: STATE_KEY })
  }, [queryClient])
}

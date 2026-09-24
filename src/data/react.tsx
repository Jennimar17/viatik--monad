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

import { getDataSource, type OperationPhase } from './index'

type ViatikContextValue = {
  state: ViatikState | undefined
  isLoading: boolean
  isError: boolean
  refetch: () => void
  userId: string | null
  user: User | undefined
  memberships: Membership[]
  /** Frozen per data load so derived numbers are stable during a render. */
  now: string
}

const ViatikContext = React.createContext<ViatikContextValue | null>(null)

const STATE_KEY = ['viatik', 'state'] as const

/** Loads everything the signed-in user may see and shares it with every screen. */
function ViatikProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const query = useQuery({
    queryKey: [...STATE_KEY, userId],
    queryFn: () => getDataSource().load(userId as string),
    enabled: Boolean(userId),
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
      user: state?.users.find((u) => u.id === userId),
      memberships: state?.memberships.filter((m) => m.userId === userId && m.status === 'active') ?? [],
      now,
    }),
    [state, isLoading, isError, refetch, userId, now],
  )

  return <ViatikContext.Provider value={value}>{children}</ViatikContext.Provider>
}

/** Query client plus the Viatik state for `userId` (null while nobody is signed in). */
export function DataProvider({ userId, children }: { userId: string | null; children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <ViatikProvider userId={userId}>{children}</ViatikProvider>
    </QueryClientProvider>
  )
}

export function useViatik() {
  const context = React.useContext(ViatikContext)
  if (!context) throw new Error('useViatik must be used inside DataProvider')
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
  const { userId } = useViatik()
  const queryClient = useQueryClient()
  const [phase, setPhase] = React.useState<OperationPhase | 'idle'>('idle')

  const mutation = useMutation({
    mutationFn: (input: CommandInput<N>) =>
      getDataSource().dispatch(userId as string, name, input, { onPhase: setPhase }),
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
    await getDataSource().reset?.()
    await queryClient.invalidateQueries({ queryKey: STATE_KEY })
  }, [queryClient])
}

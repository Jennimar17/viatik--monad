'use client'

import { useIdentityToken, useLogin, usePrivy, type User as PrivyUser } from '@privy-io/react-auth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { apiFetch, type ApiCredentials } from '@/data/api'
import type { SessionResponse } from '@/data/api-contract'
import { DataSourceError, type SessionMode } from '@/data/data-source'

import { accountsEnabled } from './privy'

export type SignInMethod = 'email' | 'google' | 'passkey'

export type SignInOptions = {
  /** Prefills the email step, e.g. with the address an invitation was sent to. */
  email?: string
}

/** What the server verified about a real account. */
export type AccountProfile = {
  email: string | null
  name: string | null
  /** Embedded account address, once Privy has created it. */
  address: `0x${string}` | null
}

type SessionContextValue = {
  /** 'demo' for the demo people, 'account' for a verified real account; null while unknown or signed out. */
  mode: SessionMode | null
  /** undefined while resolving, null when signed out. */
  userId: string | null | undefined
  /** The real account behind the session; null in the demo. */
  account: AccountProfile | null
  /** Real sign-in is configured for this deployment. */
  accountsEnabled: boolean
  /** Privy has restored any previous session; sign-in buttons wait for it. */
  accountsReady: boolean
  /** The account could not be resolved; product-language message. */
  error: string | null
  retry: () => void
  /** Become one of the demo people. Takes priority over a real account on this device. */
  enterDemo: (userId: string) => void
  /** Opens Privy's sign-in, or switches back to the real account if it is already signed in. */
  signIn: (method?: SignInMethod, options?: SignInOptions) => void
  signOut: () => Promise<void>
  /** Tokens for API requests; empty in the demo. */
  credentials: () => Promise<ApiCredentials>
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

const NO_CREDENTIALS: ApiCredentials = { accessToken: null }
const SESSION_KEY = ['session'] as const

// ─── Demo person ─────────────────────────────────────────────────────────────
// Lives in localStorage so it survives reloads and syncs across tabs; falls
// back to memory when storage is unavailable.

const STORAGE_KEY = 'viatik:session-user'
const listeners = new Set<() => void>()
let memoryFallback: string | null = null

function readDemoUser(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return memoryFallback
  }
}

function writeDemoUser(userId: string | null) {
  try {
    if (userId) window.localStorage.setItem(STORAGE_KEY, userId)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    memoryFallback = userId
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/** undefined until storage is read (server render and first paint). */
function useDemoUser() {
  return React.useSyncExternalStore<string | null | undefined>(subscribe, readDemoUser, () => undefined)
}

/** Switches the demo person from outside the provider (the design screens index). */
export function setDemoSession(userId: string) {
  writeDemoUser(userId)
}

// ─── Demo only (no Privy app configured) ─────────────────────────────────────

function DemoSessionProvider({ children }: { children: React.ReactNode }) {
  const demoUserId = useDemoUser()
  const value = React.useMemo<SessionContextValue>(
    () => ({
      mode: demoUserId ? 'demo' : null,
      userId: demoUserId,
      account: null,
      accountsEnabled: false,
      accountsReady: true,
      error: null,
      retry: () => {},
      enterDemo: writeDemoUser,
      signIn: () => {},
      signOut: async () => writeDemoUser(null),
      credentials: async () => NO_CREDENTIALS,
    }),
    [demoUserId],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

// ─── Real accounts (Privy) ───────────────────────────────────────────────────

/** The person's Privy embedded account on Ethereum-compatible chains, if it exists yet. */
function embeddedAddress(user: PrivyUser | null): string | null {
  for (const account of user?.linkedAccounts ?? []) {
    if (
      account.type === 'wallet' &&
      account.walletClientType === 'privy' &&
      account.chainType === 'ethereum'
    ) {
      return account.address
    }
  }
  return null
}

const isUnauthenticated = (error: unknown) =>
  error instanceof DataSourceError && error.code === 'unauthenticated'

function AccountSessionProvider({ children }: { children: React.ReactNode }) {
  const demoUserId = useDemoUser()
  const queryClient = useQueryClient()
  const { ready, authenticated, user, logout, getAccessToken } = usePrivy()
  const { identityToken } = useIdentityToken()
  const { login } = useLogin({
    // Also runs on every page load for a restored session (wasAlreadyAuthenticated);
    // only a fresh sign-in replaces the demo person on this device.
    onComplete: ({ wasAlreadyAuthenticated }) => {
      if (!wasAlreadyAuthenticated) writeDemoUser(null)
    },
  })

  const privyId = ready && authenticated ? (user?.id ?? null) : null

  const session = useQuery({
    queryKey: [...SESSION_KEY, privyId],
    queryFn: async () =>
      apiFetch<SessionResponse>('/v1/session', {
        method: 'POST',
        credentials: { accessToken: await getAccessToken(), identityToken },
      }),
    enabled: Boolean(privyId) && demoUserId === null,
    // Fetched once per person; only `refetch` (retry, new wallet) asks again,
    // never a broad invalidation elsewhere in the product.
    staleTime: 'static',
    retry: (failures, error) => !isUnauthenticated(error) && failures < 2,
  })
  const { data, refetch } = session

  // Privy creates the embedded account right after the first sign-in, so the
  // address appears a moment after the session resolved: ask again to record
  // it. A failed refetch keeps the current session, so nobody is signed out.
  // Depends on primitives only: an answer that still lacks the address does not ask again.
  const wallet = embeddedAddress(user)
  const resolved = Boolean(data)
  const recordedAddress = data?.address ?? null
  React.useEffect(() => {
    if (wallet && resolved && recordedAddress?.toLowerCase() !== wallet.toLowerCase()) void refetch()
  }, [wallet, resolved, recordedAddress, refetch])

  // The server rejected the token (expired or revoked): end the Privy session
  // and forget the rejected answer, so the next sign-in starts clean.
  const rejected = isUnauthenticated(session.error)
  React.useEffect(() => {
    if (rejected) void logout().finally(() => queryClient.removeQueries({ queryKey: SESSION_KEY }))
  }, [rejected, logout, queryClient])

  const accountActive = demoUserId === null && Boolean(privyId) && Boolean(data)
  const account = React.useMemo<AccountProfile | null>(
    () => (accountActive && data ? { email: data.email, name: data.name, address: data.address } : null),
    [accountActive, data],
  )

  let mode: SessionMode | null = null
  let userId: string | null | undefined
  if (demoUserId === undefined) userId = undefined
  else if (demoUserId) {
    mode = 'demo'
    userId = demoUserId
  } else if (!ready) userId = undefined
  else if (!authenticated) userId = null
  else if (accountActive && data) {
    mode = 'account'
    userId = data.userId
  } else if (session.isError) userId = null
  else userId = undefined

  const error =
    demoUserId === null && session.isError && !rejected && session.error instanceof Error
      ? session.error.message
      : null

  const failed = session.isError
  const signIn = React.useCallback(
    (method?: SignInMethod, options: SignInOptions = {}) => {
      if (authenticated) {
        // Already signed in to a real account: leave the demo person and use
        // it, asking the server again if it could not resolve the account.
        writeDemoUser(null)
        if (failed) void refetch()
        return
      }
      login({
        ...(method ? { loginMethods: [method] } : {}),
        ...(options.email ? { prefill: { type: 'email' as const, value: options.email } } : {}),
      })
    },
    [authenticated, failed, login, refetch],
  )

  const signOut = React.useCallback(async () => {
    // Privy first: while it signs out the demo person (if any) keeps priority,
    // so the session never passes through the real account on the way out.
    if (authenticated) await logout()
    writeDemoUser(null)
    queryClient.removeQueries({ queryKey: SESSION_KEY })
  }, [authenticated, logout, queryClient])

  const credentials = React.useCallback(
    async (): Promise<ApiCredentials> =>
      mode === 'account' ? { accessToken: await getAccessToken(), identityToken } : NO_CREDENTIALS,
    [mode, getAccessToken, identityToken],
  )

  const value = React.useMemo<SessionContextValue>(
    () => ({
      mode,
      userId,
      account,
      accountsEnabled: true,
      accountsReady: ready,
      error,
      retry: () => void refetch(),
      enterDemo: writeDemoUser,
      signIn,
      signOut,
      credentials,
    }),
    [mode, userId, account, ready, error, refetch, signIn, signOut, credentials],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/**
 * Who is using the product. The demo people need no sign-in; real people sign
 * in with Privy and the server resolves their account from the verified token.
 * The client never asserts its own identity to the API.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return accountsEnabled ? (
    <AccountSessionProvider>{children}</AccountSessionProvider>
  ) : (
    <DemoSessionProvider>{children}</DemoSessionProvider>
  )
}

export function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}

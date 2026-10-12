'use client'

import {
  useIdentityToken,
  useLogin,
  usePrivy,
  useSendTransaction,
  useUser,
  useWallets,
  type User as PrivyUser,
} from '@privy-io/react-auth'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'

import { apiFetch, type ApiCredentials } from '@/data/api'
import type { SessionResponse } from '@/data/api-contract'
import { DataSourceError, type SendCall, type SessionMode } from '@/data/data-source'
import { translateLedgerError } from '@/ledger/errors'

import { markLoadStep } from './load-marks'
import { accountsEnabled } from './privy'
import { TimeoutError, withTimeout } from './timeout'

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
  /** In the demo, only leaves the demo person: a real account on this device stays signed in. */
  signOut: () => Promise<void>
  /** Tokens for API requests; empty in the demo. */
  credentials: () => Promise<ApiCredentials>
  /** Signs what Viatik prepared on Monad with the person's account (sponsored gas); absent in the demo. */
  sendCall?: SendCall
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

const NO_CREDENTIALS: ApiCredentials = { accessToken: null }
/** How long a signature may take before Viatik looks for the transaction on Monad instead. */
const SIGN_TIMEOUT_MS = 60_000
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
  const { refreshUser } = useUser()
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
  const { data, refetch, dataUpdatedAt, errorUpdatedAt } = session

  // The server creates the embedded account while resolving the session.
  // `wallet` is what this browser's Privy user knows; `recordedAddress` what
  // the server answered. Effects depend on primitives only, so an answer that
  // repeats the same values never asks again.
  const wallet = embeddedAddress(user)
  const resolved = Boolean(data)
  const recordedAddress = data?.address ?? null

  // The first load's steps on the browser's timeline: Privy restored, then the server answered.
  React.useEffect(() => {
    if (ready) markLoadStep('privy-ready')
  }, [ready])
  React.useEffect(() => {
    if (resolved) markLoadStep('session')
  }, [resolved])

  // Created on the server: refresh this browser's Privy user so signing
  // (sponsored settlement) can see the account. Up to three attempts per
  // address, a few seconds apart; each finished attempt re-runs the check.
  const [refreshRound, setRefreshRound] = React.useState(0)
  const refreshAttempts = React.useRef({ address: null as string | null, count: 0 })
  React.useEffect(() => {
    if (!recordedAddress || wallet?.toLowerCase() === recordedAddress.toLowerCase()) return
    const attempts = refreshAttempts.current
    if (attempts.address !== recordedAddress) {
      attempts.address = recordedAddress
      attempts.count = 0
    }
    if (attempts.count >= 3) return
    attempts.count += 1
    const timer = setTimeout(
      () => void refreshUser().finally(() => setRefreshRound((round) => round + 1)),
      attempts.count === 1 ? 0 : 3000,
    )
    return () => clearTimeout(timer)
  }, [recordedAddress, wallet, refreshUser, refreshRound])

  // The account could not be created yet (Privy briefly unavailable): ask the
  // server again a few seconds apart, three times per person, also after a
  // failed attempt.
  const creationAttempts = React.useRef({ privyId: null as string | null, count: 0 })
  React.useEffect(() => {
    if (!resolved || recordedAddress) return
    if (creationAttempts.current.privyId !== privyId) creationAttempts.current = { privyId, count: 0 }
    if (creationAttempts.current.count >= 3) return
    const timer = setTimeout(() => {
      creationAttempts.current.count += 1
      void refetch()
    }, 4000)
    return () => clearTimeout(timer)
  }, [resolved, recordedAddress, privyId, dataUpdatedAt, errorUpdatedAt, refetch])

  // An account this browser knows but the server has not recorded: ask again.
  // A failed refetch keeps the current session, so nobody is signed out.
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
    // In the demo only the demo person leaves: a real account signed in on
    // this device stays signed in, and the session switches back to it.
    if (demoUserId) {
      writeDemoUser(null)
      return
    }
    // A real account: Privy first, then forget the server's answer, so it is not asked again on the way out.
    if (authenticated) await logout()
    writeDemoUser(null)
    queryClient.removeQueries({ queryKey: SESSION_KEY })
  }, [demoUserId, authenticated, logout, queryClient])

  const credentials = React.useCallback(
    async (): Promise<ApiCredentials> =>
      mode === 'account' ? { accessToken: await getAccessToken(), identityToken } : NO_CREDENTIALS,
    [mode, getAccessToken, identityToken],
  )

  // Signing: the same call as the sponsorship check, for exactly what the server prepared.
  const { sendTransaction } = useSendTransaction()
  const { ready: walletsReady, wallets } = useWallets()
  const accountAddress = account?.address ?? null
  const sendCall = React.useCallback<SendCall>(
    async (call) => {
      // Only the account it was prepared for signs, and only while it is the one signed in here.
      if (!accountAddress || accountAddress.toLowerCase() !== call.from.toLowerCase()) {
        throw new DataSourceError(
          'You switched accounts in another tab. Reload the page to continue.',
          'session_changed',
          true,
        )
      }
      const signable =
        walletsReady &&
        wallets.some(
          (wallet) =>
            wallet.walletClientType === 'privy' && wallet.address.toLowerCase() === call.from.toLowerCase(),
        )
      if (!signable) {
        throw new DataSourceError(
          'Your account is still being set up. Try again in a moment.',
          'account_not_ready',
          true,
        )
      }
      try {
        const { hash } = await withTimeout(
          sendTransaction(
            { to: call.to, data: call.data, chainId: call.chainId },
            { sponsor: true, address: call.from, uiOptions: { showWalletUIs: false } },
          ),
          SIGN_TIMEOUT_MS,
        )
        return hash
      } catch (error) {
        // Unknown whether it went out: Viatik looks for it on Monad.
        if (error instanceof TimeoutError) {
          throw new DataSourceError(
            'Your signature is taking longer than usual. Checking Monad…',
            'signing_timeout',
          )
        }
        const failure = translateLedgerError(error)
        // "Nothing was sent" only when Privy refused before sending: the sponsor's own simulation
        // reverted (something changed since it was prepared), its rate limit, or a wallet that could
        // not sign at all. Anything else (a lost answer, a timeout, a 5xx) may have gone out.
        if (/execution reverted/i.test(failure.raw)) {
          throw new DataSourceError(
            'This can no longer go through as prepared. Refresh and try again. Nothing was moved.',
            'reverted',
            true,
          )
        }
        if (/too many requests|not supported|unable to connect|rejected|cancel|mfa/i.test(failure.raw)) {
          throw new DataSourceError(failure.message, failure.code, true)
        }
        throw new DataSourceError(
          'We could not confirm your signature yet. Checking Monad…',
          'signing_unclear',
        )
      }
    },
    [accountAddress, walletsReady, wallets, sendTransaction],
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
      sendCall: mode === 'account' ? sendCall : undefined,
    }),
    [mode, userId, account, ready, error, refetch, signIn, signOut, credentials, sendCall],
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

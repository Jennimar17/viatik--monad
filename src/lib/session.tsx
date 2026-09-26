'use client'

import * as React from 'react'

const STORAGE_KEY = 'viatik:session-user'

type SessionContextValue = {
  /** undefined while reading storage, null when signed out. */
  userId: string | null | undefined
  signIn: (userId: string) => void
  signOut: () => void
}

const SessionContext = React.createContext<SessionContextValue | null>(null)

// The demo session lives in localStorage so it survives reloads and syncs
// across tabs. When storage is unavailable it falls back to memory.
const listeners = new Set<() => void>()
let memoryFallback: string | null = null

function readSession(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return memoryFallback
  }
}

function writeSession(userId: string | null) {
  try {
    if (userId) window.localStorage.setItem(STORAGE_KEY, userId)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    memoryFallback = userId
  }
  for (const listener of listeners) listener()
}

/** Switches the demo session from outside the provider (the design screens index). */
export function setDemoSession(userId: string) {
  writeSession(userId)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/**
 * Demo session. The accounts phase replaces it with Privy: people sign in
 * with email, Google or a passkey, and the server derives their account from
 * the verified token. The client never asserts its own identity.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const userId = React.useSyncExternalStore<string | null | undefined>(
    subscribe,
    readSession,
    () => undefined,
  )

  const value = React.useMemo<SessionContextValue>(
    () => ({
      userId,
      signIn: (next) => writeSession(next),
      signOut: () => writeSession(null),
    }),
    [userId],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside SessionProvider')
  return context
}

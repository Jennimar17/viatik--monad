'use client'

import type * as React from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryProvider, ViatikProvider } from '@/data/react'
import { ViatikPrivyProvider } from '@/lib/privy'
import { SessionProvider, useSession } from '@/lib/session'

function SessionData({ children }: { children: React.ReactNode }) {
  const { userId, mode, account, credentials, sendCall, signOut } = useSession()
  return (
    <ViatikProvider
      userId={userId ?? null}
      mode={mode}
      profile={account}
      credentials={credentials}
      sendCall={sendCall}
      onUnauthenticated={signOut}
    >
      {children}
    </ViatikProvider>
  )
}

/** Accounts, session, data, tooltips and toasts for every product screen (not the landing). */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ViatikPrivyProvider>
        <SessionProvider>
          <SessionData>
            <TooltipProvider delay={300}>
              {children}
              {/* In the demo, its pill shares the corner: `--toast-clearance` lifts toasts above it. */}
              <Toaster
                position="bottom-right"
                offset={{ bottom: 'max(24px, var(--toast-clearance, 0px))', right: 24 }}
                mobileOffset={{ bottom: 'max(88px, var(--toast-clearance, 0px))' }}
              />
            </TooltipProvider>
          </SessionData>
        </SessionProvider>
      </ViatikPrivyProvider>
    </QueryProvider>
  )
}

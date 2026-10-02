'use client'

import type * as React from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QueryProvider, ViatikProvider } from '@/data/react'
import { ViatikPrivyProvider } from '@/lib/privy'
import { SessionProvider, useSession } from '@/lib/session'

function SessionData({ children }: { children: React.ReactNode }) {
  const { userId, mode, account, credentials, signOut } = useSession()
  return (
    <ViatikProvider
      userId={userId ?? null}
      mode={mode}
      profile={account}
      credentials={credentials}
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
              <Toaster
                position="bottom-right"
                offset={{ bottom: 24, right: 24 }}
                mobileOffset={{ bottom: 88 }}
              />
            </TooltipProvider>
          </SessionData>
        </SessionProvider>
      </ViatikPrivyProvider>
    </QueryProvider>
  )
}

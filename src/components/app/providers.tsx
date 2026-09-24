'use client'

import type * as React from 'react'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DataProvider } from '@/data/react'
import { SessionProvider, useSession } from '@/lib/session'

function SessionData({ children }: { children: React.ReactNode }) {
  const { userId } = useSession()
  return <DataProvider userId={userId ?? null}>{children}</DataProvider>
}

/** Session, data, tooltips and toasts for every product screen (not the landing). */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SessionData>
        <TooltipProvider delay={300}>
          {children}
          <Toaster position="bottom-right" offset={{ bottom: 24, right: 24 }} mobileOffset={{ bottom: 88 }} />
        </TooltipProvider>
      </SessionData>
    </SessionProvider>
  )
}

'use client'

import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/viatik/feedback'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { useViatik } from '@/data/react'
import type { Role } from '@/domain/types'
import { useSession } from '@/lib/session'

import { roleHome } from '../nav'
import { resolveScope, RoleProvider } from '../role-context'
import { AppShell } from './app-shell'
import { ShellSkeleton } from './shell-skeleton'

/**
 * Guards a role area. The scope comes from the URL and must match an active
 * membership; otherwise nothing from that workspace is rendered.
 */
export function RoleGate({ role, children }: { role: Role; children: React.ReactNode }) {
  const params = useParams<{ portfolioId?: string; agencyId?: string }>()
  const scopeId = (role === 'investor' ? params.portfolioId : params.agencyId) ?? ''
  const router = useRouter()
  const { userId } = useSession()
  const { state, isLoading, isError, refetch, memberships } = useViatik()

  // Signed out → sign-in. Signed in but in no workspace yet (a new account) → onboarding.
  const homeless = Boolean(state) && memberships.length === 0
  React.useEffect(() => {
    if (userId === null) router.replace('/sign-in')
    else if (homeless) router.replace('/welcome')
  }, [userId, homeless, router])

  if (userId === undefined || userId === null || isLoading || (!state && !isError) || homeless) {
    return <ShellSkeleton />
  }
  if (isError || !state) {
    return (
      <main className="mx-auto max-w-lg px-4 py-24">
        <ErrorState titleAs="h1" onRetry={refetch} />
      </main>
    )
  }

  const membership = memberships.find(
    (m) =>
      m.role === role &&
      ((m.scope.kind === 'portfolio' && m.scope.portfolioId === scopeId) ||
        (m.scope.kind === 'agency' && m.scope.agencyId === scopeId)),
  )
  const scope = membership
    ? resolveScope(membership, (agencyId) => state.agencies.find((a) => a.id === agencyId)?.portfolioId)
    : null

  if (!scope) {
    const home = memberships[0]
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
        <ViatikLogo href="" />
        <h1 className="font-display text-2xl font-medium">This workspace is not available</h1>
        <p className="text-sm text-pretty text-muted-foreground">
          You do not have access to it with your current account, or your access was removed.
        </p>
        <Button size="pill" onClick={() => router.replace(home ? roleHome(home) : '/sign-in')}>
          {home ? 'Go to my workspace' : 'Sign in'}
        </Button>
      </main>
    )
  }

  return (
    <RoleProvider value={scope}>
      <AppShell>{children}</AppShell>
    </RoleProvider>
  )
}

'use client'

import type { Route } from 'next'
import * as React from 'react'

import { useSubject, useViatikState } from '@/data/react'
import { can, canView, type Capability, type PermissionContext } from '@/domain/permissions'
import type { Membership, Role } from '@/domain/types'

import { basePath } from './nav'

export type RoleScope = {
  role: Role
  /** Portfolio id for Investors, Agency id for Admins and Members. */
  scopeId: string
  membership: Membership
  base: string
  portfolioId: string
  agencyId?: string
}

const RoleContext = React.createContext<RoleScope | null>(null)

export function RoleProvider({ value, children }: { value: RoleScope; children: React.ReactNode }) {
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole(): RoleScope {
  const context = React.useContext(RoleContext)
  if (!context) throw new Error('useRole must be used inside a role layout')
  return context
}

/** Link builder scoped to the current role, e.g. href('budgets/new'). */
export function useHref() {
  const { base } = useRole()
  return React.useCallback(
    (path = ''): Route => (path ? `${base}/${path.replace(/^\//, '')}` : base) as Route,
    [base],
  )
}

/**
 * Permission checks bound to the current scope. Screens use these to decide
 * what to render; the engine re-checks every command.
 */
export function usePermissions() {
  const subject = useSubject()
  const { state } = useViatikState()
  const role = useRole()
  return React.useMemo(() => {
    const scope: PermissionContext = role.agencyId
      ? { agencyId: role.agencyId, agencies: state.agencies }
      : { portfolioId: role.portfolioId }
    return {
      can: (capability: Capability, extra: PermissionContext = {}) =>
        can(subject, capability, { ...scope, ...extra }),
      canView: (capability: Capability) => canView(subject, capability, scope),
    }
  }, [subject, state.agencies, role])
}

export function resolveScope(
  membership: Membership,
  portfolioOfAgency: (agencyId: string) => string | undefined,
): RoleScope | null {
  if (membership.scope.kind === 'portfolio') {
    return {
      role: 'investor',
      scopeId: membership.scope.portfolioId,
      membership,
      base: basePath('investor', membership.scope.portfolioId),
      portfolioId: membership.scope.portfolioId,
    }
  }
  const portfolioId = portfolioOfAgency(membership.scope.agencyId)
  if (!portfolioId) return null
  return {
    role: membership.role,
    scopeId: membership.scope.agencyId,
    membership,
    base: basePath(membership.role, membership.scope.agencyId),
    portfolioId,
    agencyId: membership.scope.agencyId,
  }
}

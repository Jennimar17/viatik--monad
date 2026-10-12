'use client'

import { AgentAvatar, PersonAvatar } from '@/components/viatik/people'
import { roleLabel } from '@/domain/permissions'
import { holderName } from '@/domain/queries'
import type { AllowanceHolder, Id, ViatikState } from '@/domain/types'

/** Select values for allowance holders: "member:<userId>" or "agent:<agentId>". */
export type HolderKey = `member:${string}` | `agent:${string}`

export function holderKey(holder: AllowanceHolder): HolderKey {
  return holder.kind === 'member' ? `member:${holder.userId}` : `agent:${holder.agentId}`
}

export function holderFromKey(key: string): AllowanceHolder {
  const [kind, id = ''] = key.split(':')
  return kind === 'agent' ? { kind: 'ai_agent', agentId: id } : { kind: 'member', userId: id }
}

/** People and AI Agents of an Agency who do not hold one of `taken` yet, as select options. */
export function holderOptions(state: ViatikState, agencyId: Id, taken: AllowanceHolder[]) {
  const takenKeys = new Set(taken.map(holderKey))
  const people = state.memberships
    .filter((m) => m.scope.kind === 'agency' && m.scope.agencyId === agencyId && m.status === 'active')
    .map((m) => ({
      value: holderKey({ kind: 'member', userId: m.userId }),
      label: `${holderName(state, { kind: 'member', userId: m.userId })} · ${roleLabel[m.role]}`,
    }))
  const agents = state.agents
    .filter((a) => a.agencyId === agencyId)
    .map((a) => ({ value: holderKey({ kind: 'ai_agent', agentId: a.id }), label: `${a.name} · AI Agent` }))
  return [...people, ...agents].filter((option) => !takenKeys.has(option.value as HolderKey))
}

/** A person's role in an Agency (an allowance can be held by an Admin too), for lists of holders. */
export function personRoleLabel(state: ViatikState, agencyId: Id, userId: Id): string {
  const membership = state.memberships.find(
    (m) =>
      m.userId === userId &&
      m.status === 'active' &&
      m.scope.kind === 'agency' &&
      m.scope.agencyId === agencyId,
  )
  return membership ? roleLabel[membership.role] : 'No longer in the Agency'
}

export function HolderAvatar({
  state,
  holder,
  size = 'sm',
  className,
}: {
  state: ViatikState
  holder: AllowanceHolder
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  return holder.kind === 'member' ? (
    <PersonAvatar name={holderName(state, holder)} size={size} className={className} />
  ) : (
    <AgentAvatar size={size} className={className} />
  )
}

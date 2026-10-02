import { newId } from '../ids'
import type { Cents } from '../money'
import type { AiAgent, Id, ISODate, Invitation, MembershipScope, Role } from '../types'
import { DomainError, requirePositive, requireText, usdText, type Tx } from './core'
import { assignAllowance } from './operations'

// ─── Team ────────────────────────────────────────────────────────────────────

const sameScope = (a: MembershipScope, b: MembershipScope) =>
  a.kind === 'portfolio'
    ? b.kind === 'portfolio' && a.portfolioId === b.portfolioId
    : b.kind === 'agency' && a.agencyId === b.agencyId

export function invite(
  tx: Tx,
  input: { name: string; email: string; role: Role; scope: { agencyId: Id } | { portfolioId: Id } },
): Invitation {
  const scope =
    'agencyId' in input.scope
      ? ({ kind: 'agency', agencyId: input.scope.agencyId } as const)
      : ({ kind: 'portfolio', portfolioId: input.scope.portfolioId } as const)
  tx.authorize(
    'manage_team',
    scope.kind === 'agency' ? { agencyId: scope.agencyId } : { portfolioId: scope.portfolioId },
  )
  if (scope.kind === 'portfolio' && input.role !== 'investor')
    throw new DomainError('validation', 'Portfolio invitations are for Investors.')
  if (scope.kind === 'agency' && input.role === 'investor')
    throw new DomainError('validation', 'Agencies invite Agency Admins and Members.')
  const email = requireText(input.email, 'Email', 120).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new DomainError('validation', 'Enter a valid email address.')
  const invitation: Invitation = {
    id: newId('inv'),
    code: newId('join').replace('join_', ''),
    email,
    name: requireText(input.name, 'Name', 80),
    role: input.role,
    scope,
    invitedBy: tx.userId,
    createdAt: tx.now,
    status: 'pending',
  }
  tx.state.invitations.push(invitation)
  const portfolioId = scope.kind === 'portfolio' ? scope.portfolioId : tx.portfolioOfAgency(scope.agencyId)
  tx.activity(
    'member_invited',
    `Invited ${invitation.name} as ${input.role === 'agency_admin' ? 'Agency Admin' : input.role === 'member' ? 'Member' : 'Investor'}`,
    { kind: 'invitation', id: invitation.id },
    {
      portfolioId,
      agencyId: scope.kind === 'agency' ? scope.agencyId : undefined,
    },
  )
  return invitation
}

export function acceptInvitation(tx: Tx, input: { code: string }) {
  const invitation = tx.state.invitations.find((i) => i.code === input.code)
  if (!invitation) throw new DomainError('not_found', 'This invitation link is not valid.')
  if (invitation.status !== 'pending')
    throw new DomainError('invalid_state', 'This invitation was already used.')
  const userId = tx.userId
  // Invitations belong to an email address. Someone already known must have
  // signed in with that exact email; an account without an email (a passkey
  // alone) cannot prove it and cannot accept.
  const existing = tx.state.users.find((u) => u.id === userId)
  if (existing && existing.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) {
    throw new DomainError(
      'forbidden',
      `This invitation is for ${invitation.email}. Sign in with that email to accept it.`,
    )
  }
  const alreadyMember = tx.state.memberships.some(
    (m) => m.userId === userId && m.status === 'active' && sameScope(m.scope, invitation.scope),
  )
  if (alreadyMember) throw new DomainError('invalid_state', 'You already belong to this workspace.')
  // First sign-in of an invited person: their profile comes from the invitation.
  if (!existing) {
    tx.state.users.push({
      id: userId,
      name: invitation.name,
      email: invitation.email,
      title:
        invitation.role === 'investor'
          ? 'Investor'
          : invitation.role === 'agency_admin'
            ? 'Agency Admin'
            : 'Team member',
      timeZone: 'UTC',
      locale: 'en-US',
      createdAt: tx.now,
    })
  } else if (!existing.name.trim()) {
    // A real account without a verified name takes the one its inviter wrote.
    existing.name = invitation.name
  }
  invitation.status = 'accepted'
  tx.state.memberships.push({
    id: newId('mem'),
    userId,
    role: invitation.role,
    scope: invitation.scope,
    status: 'active',
    invitedBy: invitation.invitedBy,
    createdAt: tx.now,
  })
  const portfolioId =
    invitation.scope.kind === 'portfolio'
      ? invitation.scope.portfolioId
      : tx.portfolioOfAgency(invitation.scope.agencyId)
  tx.activity(
    'member_joined',
    `${tx.nameOf(userId)} joined`,
    { kind: 'user', id: userId },
    {
      portfolioId,
      agencyId: invitation.scope.kind === 'agency' ? invitation.scope.agencyId : undefined,
    },
  )
  return invitation
}

export function cancelInvitation(tx: Tx, input: { invitationId: Id }) {
  const invitation = tx.find('invitations', input.invitationId, 'Invitation')
  tx.authorize(
    'manage_team',
    invitation.scope.kind === 'agency'
      ? { agencyId: invitation.scope.agencyId }
      : { portfolioId: invitation.scope.portfolioId },
  )
  invitation.status = 'expired'
  return invitation
}

/**
 * Removing someone takes effect immediately: the membership is revoked, their
 * allowances stop, and their pending requests are cancelled.
 */
export function revokeMembership(tx: Tx, input: { membershipId: Id }) {
  const membership = tx.find('memberships', input.membershipId, 'Membership')
  tx.authorize(
    'manage_team',
    membership.scope.kind === 'agency'
      ? { agencyId: membership.scope.agencyId }
      : { portfolioId: membership.scope.portfolioId },
  )
  if (membership.userId === tx.userId)
    throw new DomainError('forbidden', 'You cannot remove your own access.')
  membership.status = 'revoked'
  membership.revokedAt = tx.now
  if (membership.scope.kind === 'agency') {
    const agencyId = membership.scope.agencyId
    const budgetIds = new Set(tx.state.budgets.filter((b) => b.agencyId === agencyId).map((b) => b.id))
    for (const allowance of tx.state.allowances) {
      if (
        budgetIds.has(allowance.budgetId) &&
        allowance.holder.kind === 'member' &&
        allowance.holder.userId === membership.userId &&
        allowance.status === 'active'
      ) {
        allowance.status = 'revoked'
        allowance.revokedAt = tx.now
      }
    }
    for (const request of tx.state.requests) {
      if (
        request.agencyId === agencyId &&
        request.status === 'needs_approval' &&
        request.requester.kind === 'user' &&
        request.requester.userId === membership.userId
      ) {
        request.status = 'cancelled'
      }
    }
    tx.activity(
      'allowance_revoked',
      `Removed ${tx.nameOf(membership.userId)} from the Agency`,
      { kind: 'user', id: membership.userId },
      {
        portfolioId: tx.portfolioOfAgency(agencyId),
        agencyId,
        subjectUserId: membership.userId,
      },
    )
  }
  return membership
}

// ─── Automations ─────────────────────────────────────────────────────────────

export type CreateAgentInput = {
  agencyId: Id
  name: string
  purpose: string
  budgetId: Id
  dailyCap: Cents
  perOperationMax: Cents
  allowedDestinationIds: Id[]
  workingBalanceLimit: Cents
  expiresAt: ISODate
}

export function createAgent(tx: Tx, input: CreateAgentInput): AiAgent {
  tx.authorize('configure_ai_agent', { agencyId: input.agencyId })
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  if (budget.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The budget belongs to another Agency.')
  requirePositive(input.dailyCap, 'Daily cap')
  requirePositive(input.perOperationMax, 'Per-operation maximum')
  if (input.perOperationMax > input.dailyCap)
    throw new DomainError('validation', 'The per-operation maximum cannot be higher than the daily cap.')
  if (input.allowedDestinationIds.length === 0)
    throw new DomainError('validation', 'Choose at least one allowed provider.')
  const agent: AiAgent = {
    id: newId('agent'),
    agencyId: input.agencyId,
    name: requireText(input.name, 'Name', 60),
    purpose: requireText(input.purpose, 'Purpose', 300),
    budgetId: budget.id,
    dailyCap: input.dailyCap,
    perOperationMax: input.perOperationMax,
    allowedDestinationIds: input.allowedDestinationIds,
    workingBalanceLimit: input.workingBalanceLimit,
    expiresAt: input.expiresAt,
    status: 'active',
    managedBy: tx.userId,
    createdAt: tx.now,
  }
  tx.state.agents.push(agent)
  const monthlyLimit = Math.min(budget.periodLimit, input.dailyCap * 31) as Cents
  assignAllowance(tx, {
    budgetId: budget.id,
    holder: { kind: 'ai_agent', agentId: agent.id },
    periodLimit: monthlyLimit,
    perOperationLimit: input.perOperationMax,
  })
  tx.activity(
    'agent_created',
    `Set up the ${agent.name} automation with a ${usdText(agent.dailyCap)} daily cap`,
    { kind: 'agent', id: agent.id },
    {
      portfolioId: tx.portfolioOfAgency(input.agencyId),
      agencyId: input.agencyId,
    },
  )
  return agent
}

export function updateAgentPolicy(
  tx: Tx,
  input: { agentId: Id } & Partial<
    Pick<
      AiAgent,
      | 'dailyCap'
      | 'perOperationMax'
      | 'allowedDestinationIds'
      | 'expiresAt'
      | 'workingBalanceLimit'
      | 'purpose'
    >
  >,
) {
  const agent = tx.find('agents', input.agentId, 'Automation')
  tx.authorize('configure_ai_agent', { agencyId: agent.agencyId })
  const { agentId: _agentId, ...changes } = input
  const next = { ...agent, ...changes }
  if (next.perOperationMax > next.dailyCap)
    throw new DomainError('validation', 'The per-operation maximum cannot be higher than the daily cap.')
  Object.assign(agent, changes)
  const allowance = tx.state.allowances.find(
    (a) => a.holder.kind === 'ai_agent' && a.holder.agentId === agent.id && a.status === 'active',
  )
  if (allowance) allowance.perOperationLimit = agent.perOperationMax
  tx.activity(
    'agent_created',
    `Updated the ${agent.name} policy`,
    { kind: 'agent', id: agent.id },
    {
      portfolioId: tx.portfolioOfAgency(agent.agencyId),
      agencyId: agent.agencyId,
    },
  )
  return agent
}

/** Emergency pause: the automation stops creating holds immediately. */
export function setAgentPaused(tx: Tx, input: { agentId: Id; paused: boolean }) {
  const agent = tx.find('agents', input.agentId, 'Automation')
  tx.authorize('configure_ai_agent', { agencyId: agent.agencyId })
  agent.status = input.paused ? 'paused' : 'active'
  agent.pausedAt = input.paused ? tx.now : undefined
  tx.activity(
    input.paused ? 'agent_paused' : 'agent_resumed',
    input.paused ? `Paused the ${agent.name} automation` : `Resumed the ${agent.name} automation`,
    { kind: 'agent', id: agent.id },
    {
      portfolioId: tx.portfolioOfAgency(agent.agencyId),
      agencyId: agent.agencyId,
    },
  )
  return agent
}

// ─── Notifications ───────────────────────────────────────────────────────────

export function markNotificationsRead(tx: Tx, input: { ids?: Id[] }) {
  const userId = tx.userId
  for (const notification of tx.state.notifications) {
    if (notification.userId !== userId || notification.readAt) continue
    if (!input.ids || input.ids.includes(notification.id)) notification.readAt = tx.now
  }
}

export function updateProfile(
  tx: Tx,
  input: { name?: string; title?: string; timeZone?: string; locale?: string },
) {
  const user = tx.find('users', tx.userId, 'User')
  if (input.name !== undefined) user.name = requireText(input.name, 'Name', 80)
  if (input.title !== undefined) user.title = input.title.trim()
  if (input.timeZone) user.timeZone = input.timeZone
  if (input.locale) user.locale = input.locale
  return user
}

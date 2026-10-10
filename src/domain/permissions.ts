import type { Actor, Agency, Id, Membership, Role, ViatikState } from './types'

/**
 * Role matrix from the product spec ("Permission rules"). The UI never renders
 * what a subject cannot use, so navigation and actions are derived from here.
 *
 * Access levels:
 * - full:            may perform the action.
 * - view:            may see the data, not act on it.
 * - exception_only:  may act only on operations flagged as exceptions.
 * - policy_limits:   may define boundaries (Investor on budgets / AI Agents).
 * - own_only:        may act/see only on their own records.
 * - none:            not rendered at all.
 */
export type Access = 'full' | 'view' | 'exception_only' | 'policy_limits' | 'own_only' | 'none'

export type Capability =
  | 'view_portfolio'
  | 'create_agency'
  | 'create_agreement'
  | 'fund_agreement'
  | 'withdraw_funds'
  | 'release_tranche'
  | 'request_tranche'
  | 'submit_milestone_evidence'
  | 'create_account'
  | 'transfer_funds'
  | 'create_budget'
  | 'assign_allowance'
  | 'request_payment'
  | 'approve_payment'
  | 'pay_member'
  | 'send_payment'
  | 'receive_payout'
  | 'upload_receipt'
  | 'manage_bills'
  | 'reconcile_bill'
  | 'configure_ai_agent'
  | 'freeze_agreement'
  | 'pause_budget'
  | 'manage_team'
  | 'view_treasury'
  | 'view_verified_details'
  | 'view_reports'
  | 'manage_settings'
  /** Pay outside Viatik (a tool, a subscription) from an account or an open budget. */
  | 'pay_outside'
  /** Return capital from an agency account to the Investor's Portfolio Vault. */
  | 'return_capital'
  /** Monthly reminders for things paid outside Viatik. */
  | 'manage_reminders'
  /**
   * Pause, resume or cancel a scheduled payment. The Investor may too (the ledger lets the
   * portfolio's Investor stop one); creating one is `send_payment` / `pay_member`.
   */
  | 'manage_schedules'

export const PERMISSIONS: Record<Capability, Record<Role, Access>> = {
  view_portfolio: { investor: 'full', agency_admin: 'none', member: 'none' },
  create_agency: { investor: 'full', agency_admin: 'none', member: 'none' },
  create_agreement: { investor: 'full', agency_admin: 'none', member: 'none' },
  fund_agreement: { investor: 'full', agency_admin: 'none', member: 'none' },
  // Only the Portfolio Vault can be withdrawn, and only by the Investor who funds it.
  withdraw_funds: { investor: 'full', agency_admin: 'none', member: 'none' },
  release_tranche: { investor: 'full', agency_admin: 'none', member: 'none' },
  request_tranche: { investor: 'view', agency_admin: 'full', member: 'none' },
  submit_milestone_evidence: { investor: 'view', agency_admin: 'full', member: 'none' },
  // Spec: "Optional" for the Investor — disabled by default to keep operations with the Agency.
  create_account: { investor: 'view', agency_admin: 'full', member: 'none' },
  transfer_funds: { investor: 'view', agency_admin: 'full', member: 'none' },
  create_budget: { investor: 'policy_limits', agency_admin: 'full', member: 'none' },
  assign_allowance: { investor: 'view', agency_admin: 'full', member: 'none' },
  request_payment: { investor: 'none', agency_admin: 'full', member: 'full' },
  approve_payment: { investor: 'exception_only', agency_admin: 'full', member: 'none' },
  pay_member: { investor: 'none', agency_admin: 'full', member: 'none' },
  send_payment: { investor: 'none', agency_admin: 'full', member: 'none' },
  receive_payout: { investor: 'none', agency_admin: 'own_only', member: 'own_only' },
  upload_receipt: { investor: 'view', agency_admin: 'full', member: 'own_only' },
  manage_bills: { investor: 'view', agency_admin: 'full', member: 'none' },
  reconcile_bill: { investor: 'view', agency_admin: 'full', member: 'none' },
  configure_ai_agent: { investor: 'policy_limits', agency_admin: 'full', member: 'none' },
  freeze_agreement: { investor: 'full', agency_admin: 'none', member: 'none' },
  pause_budget: { investor: 'full', agency_admin: 'full', member: 'none' },
  manage_team: { investor: 'full', agency_admin: 'full', member: 'none' },
  view_treasury: { investor: 'view', agency_admin: 'full', member: 'none' },
  view_verified_details: { investor: 'full', agency_admin: 'full', member: 'own_only' },
  view_reports: { investor: 'full', agency_admin: 'full', member: 'none' },
  manage_settings: { investor: 'full', agency_admin: 'full', member: 'own_only' },
  pay_outside: { investor: 'view', agency_admin: 'full', member: 'none' },
  return_capital: { investor: 'view', agency_admin: 'full', member: 'none' },
  manage_reminders: { investor: 'view', agency_admin: 'full', member: 'none' },
  manage_schedules: { investor: 'full', agency_admin: 'full', member: 'none' },
}

/** Capabilities an AI Agent may exercise. Everything else is denied. */
const AGENT_CAPABILITIES: ReadonlySet<Capability> = new Set(['request_payment'])

export type Subject = { actor: Actor; memberships: Membership[] }

export type PermissionContext = {
  /** The agency the action targets. Required for agency-scoped capabilities. */
  agencyId?: Id
  /** The portfolio the action targets. */
  portfolioId?: Id
  /** Who created the operation being acted on — blocks self-approval. */
  createdBy?: Actor
  /** Owner of a personal record (payout, receipt, expense). */
  ownerUserId?: Id
  /** Operation exceeds the agreement's exception threshold. */
  isException?: boolean
  /**
   * The action only sets boundaries (e.g. the agreement's spending policy or
   * an AI Agent's caps). `policy_limits` access allows these and nothing else.
   */
  limitsOnly?: boolean
  /** Agencies are looked up to resolve which portfolio owns them. */
  agencies?: Pick<Agency, 'id' | 'portfolioId'>[]
}

export type RoleInScope = { role: Role; membership: Membership }

/**
 * Resolves the subject's role for the target scope. Enforces cross-Agency
 * isolation: an Agency role never leaks into another Agency, and an Investor
 * only reaches agencies inside their own portfolio.
 */
export function resolveRole(subject: Subject, context: PermissionContext): RoleInScope | null {
  const active = subject.memberships.filter((m) => m.status === 'active')

  if (context.agencyId) {
    const agencyMembership = active.find(
      (m) => m.scope.kind === 'agency' && m.scope.agencyId === context.agencyId,
    )
    if (agencyMembership) return { role: agencyMembership.role, membership: agencyMembership }

    const agency = context.agencies?.find((a) => a.id === context.agencyId)
    if (agency) {
      const investor = active.find(
        (m) =>
          m.role === 'investor' && m.scope.kind === 'portfolio' && m.scope.portfolioId === agency.portfolioId,
      )
      if (investor) return { role: 'investor', membership: investor }
    }
    return null
  }

  if (context.portfolioId) {
    const investor = active.find(
      (m) =>
        m.role === 'investor' && m.scope.kind === 'portfolio' && m.scope.portfolioId === context.portfolioId,
    )
    return investor ? { role: 'investor', membership: investor } : null
  }

  return null
}

function sameActor(a: Actor | undefined, b: Actor): boolean {
  if (!a) return false
  if (a.kind === 'user' && b.kind === 'user') return a.userId === b.userId
  if (a.kind === 'ai_agent' && b.kind === 'ai_agent') return a.agentId === b.agentId
  return false
}

export type Decision = { allowed: boolean; access: Access; reason?: DenialReason }

export type DenialReason =
  | 'no_scope'
  | 'role_forbidden'
  | 'view_only'
  | 'limits_only'
  | 'self_approval'
  | 'not_exception'
  | 'not_owner'

const APPROVAL_CAPABILITIES: ReadonlySet<Capability> = new Set(['approve_payment', 'release_tranche'])

/** Can the subject perform the action? */
export function decide(subject: Subject, capability: Capability, context: PermissionContext = {}): Decision {
  // Nobody approves their own request — checked before anything else.
  if (APPROVAL_CAPABILITIES.has(capability) && sameActor(context.createdBy, subject.actor)) {
    return { allowed: false, access: 'none', reason: 'self_approval' }
  }

  if (subject.actor.kind === 'ai_agent') {
    const allowed = AGENT_CAPABILITIES.has(capability)
    return { allowed, access: allowed ? 'full' : 'none', reason: allowed ? undefined : 'role_forbidden' }
  }
  if (subject.actor.kind === 'system') return { allowed: true, access: 'full' }

  const scoped = resolveRole(subject, context)
  if (!scoped) return { allowed: false, access: 'none', reason: 'no_scope' }

  const access = PERMISSIONS[capability][scoped.role]
  switch (access) {
    case 'full':
      return { allowed: true, access }
    case 'exception_only':
      return context.isException
        ? { allowed: true, access }
        : { allowed: false, access, reason: 'not_exception' }
    case 'policy_limits':
      // Investors set boundaries; creating and operating budgets or agents stays with the Agency.
      return context.limitsOnly
        ? { allowed: true, access }
        : { allowed: false, access, reason: 'limits_only' }
    case 'own_only': {
      const userId = subject.actor.userId
      const ownsIt = context.ownerUserId === undefined || context.ownerUserId === userId
      return ownsIt ? { allowed: true, access } : { allowed: false, access, reason: 'not_owner' }
    }
    case 'view':
      return { allowed: false, access, reason: 'view_only' }
    case 'none':
      return { allowed: false, access, reason: 'role_forbidden' }
  }
}

export function can(subject: Subject, capability: Capability, context?: PermissionContext): boolean {
  return decide(subject, capability, context).allowed
}

/** Can the subject at least see this area? Used to decide what to render. */
export function canView(subject: Subject, capability: Capability, context: PermissionContext = {}): boolean {
  if (subject.actor.kind !== 'user') return false
  const scoped = resolveRole(subject, context)
  if (!scoped) return false
  return PERMISSIONS[capability][scoped.role] !== 'none'
}

export function subjectFor(state: Pick<ViatikState, 'memberships'>, userId: Id): Subject {
  return {
    actor: { kind: 'user', userId },
    memberships: state.memberships.filter((m) => m.userId === userId),
  }
}

export const roleLabel: Record<Role, string> = {
  investor: 'Investor',
  agency_admin: 'Agency Admin',
  member: 'Member',
}

export const roleDescription: Record<Role, string> = {
  investor: 'Sets funding boundaries, releases tranches, and reviews exceptions across the portfolio.',
  agency_admin: 'Operates the Agency: turns released capital into accounts, budgets, and payments.',
  member: 'Spends within assigned limits, requests funds, and uploads receipts.',
}

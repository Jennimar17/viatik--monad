import type { Id, ViatikState } from './types'

/**
 * Returns only the records a user may see. Used by the API before anything
 * leaves the server, and by the demo data source so the prototype behaves the
 * same way:
 * - Investors see their portfolio and every Agency in it.
 * - Agency Admins see their Agency, plus the agreement terms that fund it.
 * - Members see the budgets assigned to them and their personal records —
 *   never the Agency's full treasury.
 */
export function scopeStateForUser(state: ViatikState, userId: Id): ViatikState {
  const memberships = state.memberships.filter((m) => m.userId === userId && m.status === 'active')
  const portfolioIds = new Set(
    memberships
      .filter((m) => m.scope.kind === 'portfolio')
      .map((m) => (m.scope as { portfolioId: Id }).portfolioId),
  )
  const adminAgencyIds = new Set(
    memberships
      .filter((m) => m.role === 'agency_admin' && m.scope.kind === 'agency')
      .map((m) => (m.scope as { agencyId: Id }).agencyId),
  )
  const memberAgencyIds = new Set(
    memberships
      .filter((m) => m.role === 'member' && m.scope.kind === 'agency')
      .map((m) => (m.scope as { agencyId: Id }).agencyId),
  )

  const investorAgencyIds = new Set(
    state.agencies.filter((a) => portfolioIds.has(a.portfolioId)).map((a) => a.id),
  )
  const fullAgencyIds = new Set([...investorAgencyIds, ...adminAgencyIds])
  const anyAgencyIds = new Set([...fullAgencyIds, ...memberAgencyIds])

  const agencies = state.agencies.filter((a) => anyAgencyIds.has(a.id))
  const visiblePortfolioIds = new Set([...portfolioIds, ...agencies.map((a) => a.portfolioId)])

  // Member-only agencies: restrict to assigned budgets and personal records.
  const memberOnly = (agencyId: Id | undefined) =>
    agencyId !== undefined && memberAgencyIds.has(agencyId) && !fullAgencyIds.has(agencyId)
  const assignedBudgetIds = new Set(
    state.allowances
      .filter((a) => a.holder.kind === 'member' && a.holder.userId === userId && a.status === 'active')
      .map((a) => a.budgetId),
  )
  const budgets = state.budgets.filter(
    (b) => fullAgencyIds.has(b.agencyId) || (memberOnly(b.agencyId) && assignedBudgetIds.has(b.id)),
  )
  const budgetIds = new Set(budgets.map((b) => b.id))

  const isPersonalPayment = (p: ViatikState['payments'][number]) =>
    (p.recipient.kind === 'member' && p.recipient.userId === userId) ||
    (p.createdBy.kind === 'user' && p.createdBy.userId === userId)

  const payments = state.payments.filter(
    (p) => fullAgencyIds.has(p.agencyId) || (memberOnly(p.agencyId) && isPersonalPayment(p)),
  )
  const paymentIds = new Set(payments.map((p) => p.id))
  const requests = state.requests.filter(
    (r) =>
      fullAgencyIds.has(r.agencyId) ||
      (memberOnly(r.agencyId) && r.requester.kind === 'user' && r.requester.userId === userId),
  )
  const agreements = state.agreements.filter(
    (a) => visiblePortfolioIds.has(a.portfolioId) && fullAgencyIds.has(a.agencyId),
  )
  const agreementIds = new Set(agreements.map((a) => a.id))

  const accounts = state.accounts.filter((a) => fullAgencyIds.has(a.agencyId))
  const vaults = state.vaults.filter(
    (v) => portfolioIds.has(v.portfolioId) || (v.agencyId !== undefined && adminAgencyIds.has(v.agencyId)),
  )

  const movementVisible = (m: ViatikState['movements'][number]) => {
    if (m.agencyId && fullAgencyIds.has(m.agencyId)) return true
    if (portfolioIds.has(m.portfolioId)) return true
    if (m.agencyId && memberOnly(m.agencyId)) {
      if (m.refId && paymentIds.has(m.refId)) return true
      // Money the Member received or sent back themselves (e.g. returning unused funds).
      const mine = (end: typeof m.from) =>
        end.kind === 'recipient' && end.recipient.kind === 'member' && end.recipient.userId === userId
      if (mine(m.from) || mine(m.to)) return true
      if (m.from.kind === 'budget' && budgetIds.has(m.from.budgetId)) return true
      if (m.to.kind === 'budget' && budgetIds.has(m.to.budgetId)) return true
    }
    return false
  }
  const movements = state.movements.filter(movementVisible)
  const receiptIds = new Set(movements.map((m) => m.receiptId).filter(Boolean) as Id[])

  const agencyUserIds = new Set(
    state.memberships
      .filter(
        (m) =>
          (m.scope.kind === 'agency' && fullAgencyIds.has(m.scope.agencyId)) ||
          (m.scope.kind === 'portfolio' && visiblePortfolioIds.has(m.scope.portfolioId)),
      )
      .map((m) => m.userId),
  )
  agencyUserIds.add(userId)

  return {
    ...state,
    users: state.users.filter((u) => agencyUserIds.has(u.id)),
    memberships: state.memberships.filter(
      (m) =>
        m.userId === userId ||
        (m.scope.kind === 'agency' && fullAgencyIds.has(m.scope.agencyId)) ||
        (m.scope.kind === 'portfolio' && portfolioIds.has(m.scope.portfolioId)),
    ),
    invitations: state.invitations.filter(
      (i) =>
        (i.scope.kind === 'agency' && fullAgencyIds.has(i.scope.agencyId)) ||
        (i.scope.kind === 'portfolio' && portfolioIds.has(i.scope.portfolioId)),
    ),
    portfolios: state.portfolios.filter((p) => visiblePortfolioIds.has(p.id)),
    agencies,
    agreements,
    tranches: state.tranches.filter((t) => agreementIds.has(t.agreementId)),
    milestones: state.milestones.filter((m) => agreementIds.has(m.agreementId)),
    vaults,
    accounts,
    budgets,
    allowances: state.allowances.filter(
      (a) =>
        budgetIds.has(a.budgetId) &&
        (!memberOnly(budgets.find((b) => b.id === a.budgetId)?.agencyId) ||
          (a.holder.kind === 'member' && a.holder.userId === userId)),
    ),
    destinations: state.destinations.filter((d) => anyAgencyIds.has(d.agencyId)),
    requests,
    payments,
    bills: state.bills.filter((b) => fullAgencyIds.has(b.agencyId)),
    expenses: state.expenses.filter((e) => fullAgencyIds.has(e.agencyId) || e.userId === userId),
    reconciliations: state.reconciliations.filter((r) => fullAgencyIds.has(r.agencyId)),
    receipts: state.receipts.filter(
      (r) =>
        receiptIds.has(r.id) ||
        (r.agencyId !== undefined && fullAgencyIds.has(r.agencyId)) ||
        (!r.agencyId && portfolioIds.has(r.portfolioId)),
    ),
    movements,
    agents: state.agents.filter((a) => fullAgencyIds.has(a.agencyId)),
    agentDecisions: state.agentDecisions.filter((d) =>
      state.agents.some((a) => a.id === d.agentId && fullAgencyIds.has(a.agencyId)),
    ),
    activity: state.activity.filter(
      (a) =>
        (a.agencyId !== undefined && fullAgencyIds.has(a.agencyId)) ||
        (!a.agencyId && portfolioIds.has(a.portfolioId)) ||
        (a.agencyId !== undefined &&
          memberOnly(a.agencyId) &&
          (a.subjectUserId === userId || (a.actor.kind === 'user' && a.actor.userId === userId))),
    ),
    notifications: state.notifications.filter((n) => n.userId === userId),
  }
}

/** Accounts a record belongs to must be visible before linking to them. */
export function isVisible<T extends { id: Id }>(list: T[], id: Id | undefined): boolean {
  return id !== undefined && list.some((item) => item.id === id)
}

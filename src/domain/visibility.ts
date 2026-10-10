import { governingAgreement } from './queries'
import type { Agency, Id, Receipt, ViatikState } from './types'

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

  // Member-only agencies: restrict to assigned budgets and personal records.
  const memberOnly = (agencyId: Id | undefined) =>
    agencyId !== undefined && memberAgencyIds.has(agencyId) && !fullAgencyIds.has(agencyId)

  // A Member never sees the agreements, yet their requests follow the governing agreement's
  // exception threshold: their Agency carries it, so what they preview is what the server decides.
  // Everyone else reads it from the agreement itself.
  const agencies = state.agencies
    .filter((a) => anyAgencyIds.has(a.id))
    .map((a): Agency => {
      const agency: Agency = { ...a }
      delete agency.exceptionThreshold
      const threshold = memberOnly(a.id)
        ? governingAgreement(state, a.id)?.spendingPolicy.exceptionThreshold
        : undefined
      if (threshold !== undefined) agency.exceptionThreshold = threshold
      return agency
    })
  const visiblePortfolioIds = new Set([...portfolioIds, ...agencies.map((a) => a.portfolioId)])
  const assignedBudgetIds = new Set(
    state.allowances
      .filter((a) => a.holder.kind === 'member' && a.holder.userId === userId && a.status === 'active')
      .map((a) => a.budgetId),
  )
  const budgets = state.budgets.filter(
    (b) => fullAgencyIds.has(b.agencyId) || (memberOnly(b.agencyId) && assignedBudgetIds.has(b.id)),
  )
  const budgetIds = new Set(budgets.map((b) => b.id))

  // Payments made outside Viatik are the Agency's, never personal: Members see none of them.
  const isPersonalPayment = (p: ViatikState['payments'][number]) =>
    p.recipient.kind !== 'address' &&
    ((p.recipient.kind === 'member' && p.recipient.userId === userId) ||
      (p.createdBy.kind === 'user' && p.createdBy.userId === userId))

  // Where an outside payment went is for the Agency's Admins and its Investors only.
  const payments = state.payments
    .filter((p) => fullAgencyIds.has(p.agencyId) || (memberOnly(p.agencyId) && isPersonalPayment(p)))
    .map((p) =>
      p.recipient.kind === 'address' && p.recipient.address && !fullAgencyIds.has(p.agencyId)
        ? { ...p, recipient: { kind: 'address' as const, payee: p.recipient.payee } }
        : p,
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
  // Who sees the whole address money went to; everyone else sees only the label.
  // - An outside payment: the Agency's Admins and its Investors (a Member who holds the budget sees the payee).
  // - A withdrawal: its owner only (the Investor from their Portfolio Vault, a person from their balance).
  const seesAddress = (m: ViatikState['movements'][number]) => {
    if (m.kind === 'payment') return m.agencyId !== undefined && fullAgencyIds.has(m.agencyId)
    if (m.from.kind === 'vault') return portfolioIds.has(m.portfolioId)
    return (
      m.from.kind === 'recipient' && m.from.recipient.kind === 'member' && m.from.recipient.userId === userId
    )
  }
  const movements = state.movements
    .filter(movementVisible)
    .map((m) =>
      m.to.kind === 'external' && m.to.address && !seesAddress(m)
        ? { ...m, to: { kind: 'external' as const, label: m.to.label } }
        : m,
    )
  const receiptIds = new Set(movements.map((m) => m.receiptId).filter(Boolean) as Id[])
  // An outside payment's receipt names its payee and a short address: a Member who holds the
  // budget it came from sees the payee only. Its verified details still point to the public
  // ledger event, which shows the full address: an accepted limit of paying on a public chain
  // (Agency Admins see a Member's withdrawal transaction the same way).
  const payeeOf = (receipt: Receipt): string => {
    const recipient = state.payments.find((p) => p.id === receipt.operationId)?.recipient
    if (recipient?.kind === 'address') return recipient.payee
    const to = state.movements.find((m) => m.receiptId === receipt.id)?.to
    return to?.kind === 'external' ? to.label : 'Paid outside Viatik'
  }
  const scopeReceipt = (receipt: Receipt): Receipt =>
    receipt.kind === 'outside_payment' &&
    !(receipt.agencyId !== undefined && fullAgencyIds.has(receipt.agencyId))
      ? { ...receipt, toLabel: payeeOf(receipt) }
      : receipt

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
  const adminVisibleUserIds = new Set(
    state.memberships
      .filter(
        (m) => m.status === 'active' && m.scope.kind === 'agency' && adminAgencyIds.has(m.scope.agencyId),
      )
      .map((m) => m.userId),
  )

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
    receipts: state.receipts
      .filter(
        (r) =>
          // Budget allocations name the Agency's accounts, which a Member does not see.
          (receiptIds.has(r.id) && !(r.kind === 'allocation' && memberOnly(r.agencyId))) ||
          (r.agencyId !== undefined && fullAgencyIds.has(r.agencyId)) ||
          (!r.agencyId && portfolioIds.has(r.portfolioId)),
      )
      .map(scopeReceipt),
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
    // Saved addresses: your own, and those of the people in the agencies you administer.
    payoutAddresses: state.payoutAddresses.filter(
      (a) => a.userId === userId || adminVisibleUserIds.has(a.userId),
    ),
    // Monthly reminders are the Agency's own to-dos: its Admins and Investors see them.
    reminders: state.reminders.filter((r) => fullAgencyIds.has(r.agencyId)),
  }
}

/** Accounts a record belongs to must be visible before linking to them. */
export function isVisible<T extends { id: Id }>(list: T[], id: Id | undefined): boolean {
  return id !== undefined && list.some((item) => item.id === id)
}

import { governingAgreement } from './queries'
import { isCreatorActive, isOpenSchedule } from './schedules'
import type { Agency, Id, Location, Movement, Receipt, User, ViatikState } from './types'

/**
 * Returns only the records a user may see. Used by the API before anything
 * leaves the server, and by the demo data source so the prototype behaves the
 * same way:
 * - Investors see their portfolio and every Agency in it.
 * - Agency Admins see their Agency, plus the agreement terms that fund it.
 * - Members see the budgets assigned to them and their personal records —
 *   never the Agency's full treasury. What a budget they hold paid another
 *   person shows as paid to "Team member", never who it was or its receipt.
 *   They read their Agency Admins' names, never the other Members'.
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
  // A payment saved as scheduled before schedules existed was never paid (`isUnscheduledPayment`):
  // its Admins see it, to schedule it again; the person it was meant for is not shown a to-do.
  const isPersonalPayment = (p: ViatikState['payments'][number]) =>
    p.recipient.kind !== 'address' &&
    !(p.status === 'action_required' && !p.completedAt) &&
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

  const isPerson = (end: Location, which: (personId: Id) => boolean) =>
    end.kind === 'recipient' && end.recipient.kind === 'member' && which(end.recipient.userId)
  const isMine = (end: Location) => isPerson(end, (personId) => personId === userId)
  const isSomeoneElse = (end: Location) => isPerson(end, (personId) => personId !== userId)
  // The viewer's own money: what they received or sent back themselves, or a payment of theirs.
  const ownMovement = (m: Movement) =>
    isMine(m.from) || isMine(m.to) || (m.refId !== undefined && paymentIds.has(m.refId))

  const movementVisible = (m: Movement) => {
    if (m.agencyId && fullAgencyIds.has(m.agencyId)) return true
    if (portfolioIds.has(m.portfolioId)) return true
    if (m.agencyId && memberOnly(m.agencyId)) {
      if (ownMovement(m)) return true
      if (m.from.kind === 'budget' && budgetIds.has(m.from.budgetId)) return true
      if (m.to.kind === 'budget' && budgetIds.has(m.to.budgetId)) return true
    }
    return false
  }
  // What a budget a Member holds paid (or got back from) another person: the Member sees the
  // budget's side and the amount, so its balance and usage add up, but never who the other
  // person was. Only the fields below are kept: no receipt, no link to that person's payment.
  const teamMember: Location = { kind: 'external', label: 'Team member' }
  const withoutOtherPeople = (m: Movement): Movement => {
    if (!m.agencyId || !memberOnly(m.agencyId) || ownMovement(m)) return m
    if (!isSomeoneElse(m.from) && !isSomeoneElse(m.to)) return m
    const hidden: Movement = {
      id: m.id,
      kind: m.kind,
      amount: m.amount,
      from: isSomeoneElse(m.from) ? teamMember : m.from,
      to: isSomeoneElse(m.to) ? teamMember : m.to,
      portfolioId: m.portfolioId,
      agencyId: m.agencyId,
      createdAt: m.createdAt,
    }
    if (m.agreementId) hidden.agreementId = m.agreementId
    return hidden
  }
  // Who sees the whole address money went to; everyone else sees only the label.
  // - An outside payment: the Agency's Admins and its Investors (a Member who holds the budget sees the payee).
  // - A withdrawal: its owner only (the Investor from their Portfolio Vault, a person from their balance).
  const seesAddress = (m: Movement) => {
    if (m.kind === 'payment') return m.agencyId !== undefined && fullAgencyIds.has(m.agencyId)
    if (m.from.kind === 'vault') return portfolioIds.has(m.portfolioId)
    return (
      m.from.kind === 'recipient' && m.from.recipient.kind === 'member' && m.from.recipient.userId === userId
    )
  }
  const movements = state.movements
    .filter(movementVisible)
    .map(withoutOtherPeople)
    .map((m) =>
      m.to.kind === 'external' && m.to.address && !seesAddress(m)
        ? { ...m, to: { kind: 'external' as const, label: m.to.label } }
        : m,
    )
  // From the movements as the viewer sees them: another person's receipt is never sent.
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

  // Portfolios the viewer works in, as its Investor or as an Admin of one of its Agencies: their
  // people are seen in full. A Member only reaches a portfolio through their Agency.
  const fullPortfolioIds = new Set([
    ...portfolioIds,
    ...state.agencies.filter((a) => adminAgencyIds.has(a.id)).map((a) => a.portfolioId),
  ])
  const agencyUserIds = new Set(
    state.memberships
      .filter(
        (m) =>
          (m.scope.kind === 'agency' && fullAgencyIds.has(m.scope.agencyId)) ||
          (m.scope.kind === 'portfolio' && fullPortfolioIds.has(m.scope.portfolioId)),
      )
      .map((m) => m.userId),
  )
  agencyUserIds.add(userId)
  // A Member reads their Agency Admins' names ("Approved by Maya Chen"), nothing else about them,
  // and nothing of the other Members.
  // The same for the Investors of a portfolio a Member only reaches through their Agency.
  const memberAdminIds = new Set(
    state.memberships
      .filter(
        (m) =>
          m.status === 'active' &&
          ((m.role === 'agency_admin' && m.scope.kind === 'agency' && memberOnly(m.scope.agencyId)) ||
            (m.scope.kind === 'portfolio' &&
              visiblePortfolioIds.has(m.scope.portfolioId) &&
              !fullPortfolioIds.has(m.scope.portfolioId))),
      )
      .map((m) => m.userId),
  )
  const nameOnly = (u: User): User => ({
    id: u.id,
    name: u.name,
    title: u.title,
    email: '',
    timeZone: '',
    locale: '',
    createdAt: '',
  })
  const users = state.users.flatMap((u) =>
    agencyUserIds.has(u.id) ? [u] : memberAdminIds.has(u.id) ? [nameOnly(u)] : [],
  )
  const adminVisibleUserIds = new Set(
    state.memberships
      .filter(
        (m) => m.status === 'active' && m.scope.kind === 'agency' && adminAgencyIds.has(m.scope.agencyId),
      )
      .map((m) => m.userId),
  )

  return {
    ...state,
    users,
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
    // Scheduled payments: the Agency's Admins and Investors see them all; a Member sees those that
    // pay them, without why a run could not be paid (it quotes the Agency's balances). A Member cannot
    // tell whether the Admin who authorized one still holds the role (they see no one else's
    // memberships), so one that stopped for that reason (`scheduleState` 'stopped': it will never be
    // paid) is left out for them rather than shown as their next payment.
    schedules: (state.schedules ?? []).flatMap((s) => {
      if (fullAgencyIds.has(s.agencyId)) return [s]
      if (memberOnly(s.agencyId) && s.recipient.kind === 'member' && s.recipient.userId === userId) {
        if (isOpenSchedule(s) && isCreatorActive(state, s) !== true) return []
        const mine = { ...s }
        delete mine.failure
        return [mine]
      }
      return []
    }),
    // When the keeper last ran, and what it did in the agencies the viewer runs or funds.
    keeper: state.keeper && {
      ...(state.keeper.lastAutomaticAt ? { lastAutomaticAt: state.keeper.lastAutomaticAt } : {}),
      agencies: Object.fromEntries(
        Object.entries(state.keeper.agencies ?? {}).filter(([agencyId]) => fullAgencyIds.has(agencyId)),
      ),
    },
  }
}

/** Accounts a record belongs to must be visible before linking to them. */
export function isVisible<T extends { id: Id }>(list: T[], id: Id | undefined): boolean {
  return id !== undefined && list.some((item) => item.id === id)
}

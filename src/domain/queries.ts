import { cents, clampToZero, sum, type Cents } from './money'
import { budgetUsage, committedAt } from './selectors'
import type {
  Actor,
  AgreementStatus,
  AllowanceHolder,
  Bill,
  Evidence,
  FundingAgreement,
  Id,
  Payment,
  PaymentRecipient,
  PaymentRequest,
  RequestDestination,
  Vault,
  ViatikState,
} from './types'

/**
 * Small read helpers shared by screens. Financial math lives in selectors.ts
 * so the API computes identical numbers.
 */

/** A person's name; someone who never gave one shows the start of their email. */
export const userName = (state: ViatikState, id: Id | undefined) => {
  const user = state.users.find((u) => u.id === id)
  if (!user) return 'Former teammate'
  return user.name.trim() || user.email.split('@')[0] || 'Someone'
}
export const agencyName = (state: ViatikState, id: Id | undefined) =>
  state.agencies.find((a) => a.id === id)?.name ?? 'Agency'
export const budgetName = (state: ViatikState, id: Id | undefined) =>
  state.budgets.find((b) => b.id === id)?.name ?? 'Budget'
export const accountName = (state: ViatikState, id: Id | undefined) =>
  state.accounts.find((a) => a.id === id)?.name ?? 'Account'
export const destinationName = (state: ViatikState, id: Id | undefined) =>
  state.destinations.find((d) => d.id === id)?.name ?? 'Payment destination'

/** A piece of evidence by id, wherever it is attached (milestones, bills, expenses, requests). */
export function findEvidence(state: ViatikState, evidenceId: Id): Evidence | undefined {
  for (const milestone of state.milestones) {
    const found = milestone.evidence.find((e) => e.id === evidenceId)
    if (found) return found
  }
  for (const bill of state.bills) if (bill.document.id === evidenceId) return bill.document
  for (const expense of state.expenses) if (expense.receipt?.id === evidenceId) return expense.receipt
  for (const request of state.requests) {
    const found = request.attachments.find((e) => e.id === evidenceId)
    if (found) return found
  }
  for (const payment of state.payments) if (payment.proof?.id === evidenceId) return payment.proof
  return undefined
}

/** The account released funding and returned money land in by default: the Agency's active Operations account. */
export function activeOperationsAccount(state: ViatikState, agencyId: Id) {
  return state.accounts.find(
    (a) => a.agencyId === agencyId && a.template === 'operations' && a.status === 'active',
  )
}

export function actorName(state: ViatikState, actor: Actor): string {
  if (actor.kind === 'user') return userName(state, actor.userId)
  if (actor.kind === 'ai_agent') return state.agents.find((a) => a.id === actor.agentId)?.name ?? 'Automation'
  return 'Viatik'
}

export function holderName(state: ViatikState, holder: AllowanceHolder): string {
  return holder.kind === 'member'
    ? userName(state, holder.userId)
    : (state.agents.find((a) => a.id === holder.agentId)?.name ?? 'AI Agent')
}

export function recipientName(state: ViatikState, recipient: PaymentRecipient | RequestDestination): string {
  if (recipient.kind === 'address') return recipient.payee
  return recipient.kind === 'member'
    ? userName(state, recipient.userId)
    : destinationName(state, recipient.destinationId)
}

/** A payment an Agency Admin made outside Viatik, to an address. */
export const isOutsidePayment = (payment: Payment): boolean => payment.recipient.kind === 'address'

/** A Portfolio's main vault: where deposits land and returned capital goes back. */
export function portfolioVaultOf(state: ViatikState, portfolioId: Id): Vault | undefined {
  return state.vaults.find((v) => v.portfolioId === portfolioId && v.kind === 'portfolio')
}

export function activeAgreement(state: ViatikState, agencyId: Id): FundingAgreement | undefined {
  return (
    state.agreements.find((a) => a.agencyId === agencyId && a.status === 'active') ??
    state.agreements.find((a) => a.agencyId === agencyId && a.status !== 'cancelled')
  )
}

/**
 * Every agreement of an Agency that is still in play (not cancelled): the ones waiting for the
 * Agency's acceptance first, then active, paused and the rest. Screens that show an Agency's
 * funding list all of them; `activeAgreement` is for the places that need exactly one.
 */
export function agreementsOf(state: ViatikState, agencyId: Id): FundingAgreement[] {
  const rank = (a: FundingAgreement) =>
    a.status === 'pending_acceptance' ? 0 : a.status === 'active' ? 1 : a.status === 'paused' ? 2 : 3
  return state.agreements
    .filter((a) => a.agencyId === agencyId && a.status !== 'cancelled')
    .sort((a, b) => rank(a) - rank(b))
}

/**
 * The agreement whose spending policy governs an Agency's payments: the
 * active one, or one the Investor paused (a pause must not lift its rules).
 */
export function governingAgreement(state: ViatikState, agencyId: Id): FundingAgreement | undefined {
  return state.agreements.find(
    (a) => a.agencyId === agencyId && (a.status === 'active' || a.status === 'paused'),
  )
}

/**
 * The exception threshold that governs an Agency's payments: its governing
 * agreement's. A Member's scoped state has no agreements, so the Agency carries
 * the threshold there (`scopeStateForUser`) and their previews reach the same
 * decision as the server. Undefined when no agreement governs the Agency.
 */
export function exceptionThresholdOf(state: ViatikState, agencyId: Id): Cents | undefined {
  return (
    governingAgreement(state, agencyId)?.spendingPolicy.exceptionThreshold ??
    state.agencies.find((a) => a.id === agencyId)?.exceptionThreshold
  )
}

/**
 * The agreement an Agency's Settings name: the one shown to Admins and Investors, or, in a
 * Member's scoped state (which has no agreements), the title and status the Agency carries.
 */
export function agencyAgreementSummary(
  state: ViatikState,
  agencyId: Id,
): { title: string; status: AgreementStatus } | undefined {
  const agreement = activeAgreement(state, agencyId)
  if (agreement) return { title: agreement.title, status: agreement.status }
  return state.agencies.find((a) => a.id === agencyId)?.fundingAgreement
}

/**
 * How many people are active in an Agency. A Member's scoped state holds only their own
 * membership, so the Agency carries the count there; everyone else counts the memberships.
 */
export function agencyTeamSize(state: ViatikState, agencyId: Id): number {
  return (
    state.agencies.find((a) => a.id === agencyId)?.teamSize ??
    state.memberships.filter(
      (m) => m.status === 'active' && m.scope.kind === 'agency' && m.scope.agencyId === agencyId,
    ).length
  )
}

/** The request is above its agreement's exception threshold (whatever its type). */
export function aboveExceptionThreshold(state: ViatikState, request: PaymentRequest): boolean {
  const threshold = exceptionThresholdOf(state, request.agencyId)
  return threshold !== undefined && request.amount > threshold
}

/**
 * Above the agreement's exception threshold → the Investor decides. Never for
 * payment for work: an Agency Admin always decides it (above the threshold it
 * cannot be paid, even if the threshold was lowered after it was sent).
 */
export function isException(state: ViatikState, request: PaymentRequest): boolean {
  return request.type !== 'work' && aboveExceptionThreshold(state, request)
}

export function investorApprovals(state: ViatikState, portfolioId: Id) {
  const agreementIds = new Set(state.agreements.filter((a) => a.portfolioId === portfolioId).map((a) => a.id))
  const tranches = state.tranches.filter(
    (t) => agreementIds.has(t.agreementId) && (t.status === 'under_review' || t.status === 'requested'),
  )
  const agencyIds = new Set(state.agencies.filter((a) => a.portfolioId === portfolioId).map((a) => a.id))
  const exceptions = state.requests.filter(
    (r) => agencyIds.has(r.agencyId) && r.status === 'needs_approval' && isException(state, r),
  )
  return { tranches, exceptions, total: tranches.length + exceptions.length }
}

export function adminApprovals(state: ViatikState, agencyId: Id) {
  const pending = state.requests.filter((r) => r.agencyId === agencyId && r.status === 'needs_approval')
  return {
    mine: pending.filter((r) => !isException(state, r)),
    withInvestor: pending.filter((r) => isException(state, r)),
  }
}

export function billState(bill: Bill, now: string): Bill['status'] | 'overdue' {
  if ((bill.status === 'to_pay' || bill.status === 'scheduled') && bill.dueDate < now) return 'overdue'
  return bill.status
}

export function openBills(state: ViatikState, agencyId: Id, now: string) {
  return state.bills.filter(
    (b) =>
      b.agencyId === agencyId &&
      (b.status === 'to_pay' || b.status === 'scheduled' || billState(b, now) === 'overdue'),
  )
}

export function memberBudgets(state: ViatikState, agencyId: Id, userId: Id, now: string) {
  return state.allowances
    .filter((a) => a.holder.kind === 'member' && a.holder.userId === userId && a.status === 'active')
    .map((allowance) => {
      const budget = state.budgets.find((b) => b.id === allowance.budgetId && b.agencyId === agencyId)
      if (!budget) return null
      const usage = budgetUsage(state, budget, now)
      const window = usage.window
      const used = sum(
        state.requests.filter(
          (r) =>
            r.budgetId === budget.id &&
            r.requester.kind === 'user' &&
            r.requester.userId === userId &&
            (r.status === 'completed' || r.status === 'approved' || r.status === 'processing') &&
            committedAt(r) >= window.start &&
            committedAt(r) < window.end,
        ),
        (r) => r.amount,
      )
      return { allowance, budget, usage, used, remaining: clampToZero(cents(allowance.periodLimit - used)) }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

export function unreadCount(state: ViatikState, userId: Id) {
  return state.notifications.filter((n) => n.userId === userId && !n.readAt).length
}

export function receiptFor(state: ViatikState, receiptId: Id | undefined) {
  return receiptId ? state.receipts.find((r) => r.id === receiptId) : undefined
}

import { cents, clampToZero, sum } from './money'
import { budgetUsage } from './selectors'
import type {
  Actor,
  AllowanceHolder,
  Bill,
  Evidence,
  FundingAgreement,
  Id,
  PaymentRecipient,
  PaymentRequest,
  RequestDestination,
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
  return undefined
}

/** The account released funding and returned money land in by default: the Agency's active Operations account. */
export function activeOperationsAccount(state: ViatikState, agencyId: Id) {
  return state.accounts.find((a) => a.agencyId === agencyId && a.template === 'operations' && a.status === 'active')
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
  return recipient.kind === 'member'
    ? userName(state, recipient.userId)
    : destinationName(state, recipient.destinationId)
}

export function activeAgreement(state: ViatikState, agencyId: Id): FundingAgreement | undefined {
  return (
    state.agreements.find((a) => a.agencyId === agencyId && a.status === 'active') ??
    state.agreements.find((a) => a.agencyId === agencyId && a.status !== 'cancelled')
  )
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

/** Above the agreement's exception threshold → the Investor decides. */
export function isException(state: ViatikState, request: PaymentRequest): boolean {
  const agreement = governingAgreement(state, request.agencyId)
  return agreement ? request.amount > agreement.spendingPolicy.exceptionThreshold : false
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
            r.createdAt >= window.start &&
            r.createdAt < window.end,
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

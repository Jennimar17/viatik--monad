import { newId, pseudoSha256 } from '../ids'
import { cents, sum, type Cents } from '../money'
import { evaluatePolicy } from '../policy'
import {
  accountBalance,
  agentSpentToday,
  budgetBalance,
  budgetUsage,
  holderSpentInPeriod,
} from '../selectors'
import { assertTransition, canTransitionRequest } from '../status'
import type {
  Account,
  AccountTemplate,
  AllowanceHolder,
  Bill,
  Budget,
  BudgetPeriod,
  BudgetTemplate,
  Evidence,
  Expense,
  Id,
  ISODate,
  Payment,
  PaymentRecipient,
  PaymentRequest,
  PaymentType,
  PolicyDecision,
  RequestType,
  SpendingAllowance,
  SpendingCategory,
} from '../types'
import { DomainError, requirePositive, requireText, usdText, type Tx } from './core'
import type { EvidenceDraft } from './funding'

// ─── Accounts ────────────────────────────────────────────────────────────────

export function createAccount(
  tx: Tx,
  input: {
    agencyId: Id
    template: AccountTemplate
    name: string
    purpose: string
    initialFunding?: { fromAccountId: Id; amount: Cents }
  },
): Account {
  tx.authorize('create_account', { agencyId: input.agencyId })
  const account: Account = {
    id: newId('acct'),
    agencyId: input.agencyId,
    template: input.template,
    name: requireText(input.name, 'Account name', 60),
    purpose: input.purpose.trim(),
    status: 'active',
    createdAt: tx.now,
  }
  tx.state.accounts.push(account)
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  tx.activity(
    'account_created',
    `Created the ${account.name} account`,
    { kind: 'account', id: account.id },
    { portfolioId, agencyId: input.agencyId },
  )
  if (input.initialFunding && input.initialFunding.amount > 0) {
    transferFunds(tx, {
      agencyId: input.agencyId,
      fromAccountId: input.initialFunding.fromAccountId,
      toAccountId: account.id,
      amount: input.initialFunding.amount,
    })
  }
  return account
}

export function transferFunds(
  tx: Tx,
  input: { agencyId: Id; fromAccountId: Id; toAccountId: Id; amount: Cents; note?: string },
) {
  tx.authorize('transfer_funds', { agencyId: input.agencyId })
  requirePositive(input.amount)
  if (input.fromAccountId === input.toAccountId)
    throw new DomainError('validation', 'Choose two different accounts.')
  const from = tx.find('accounts', input.fromAccountId, 'Source account')
  const to = tx.find('accounts', input.toAccountId, 'Destination account')
  if (from.agencyId !== input.agencyId || to.agencyId !== input.agencyId) {
    throw new DomainError('forbidden', 'Both accounts must belong to this Agency.')
  }
  const available = accountBalance(tx.state, from.id)
  if (available < input.amount)
    throw new DomainError('insufficient_funds', `${from.name} has ${usdText(available)} available.`)
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const operationId = newId('xfer')
  const receipt = tx.receipt({
    kind: 'transfer',
    amount: input.amount,
    fromLabel: from.name,
    toLabel: to.name,
    description: input.note?.trim() || `Transfer from ${from.name} to ${to.name}`,
    policyLabel: 'Transfers stay inside the Agency · Agency Admin authorization',
    operationId,
    portfolioId,
    agencyId: input.agencyId,
  })
  tx.move(
    'transfer',
    input.amount,
    { kind: 'account', accountId: from.id },
    { kind: 'account', accountId: to.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      refId: operationId,
      receiptId: receipt.id,
    },
  )
  tx.activity(
    'funds_transferred',
    `Moved ${usdText(input.amount)} from ${from.name} to ${to.name}`,
    { kind: 'account', id: to.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      amount: input.amount,
    },
  )
  return receipt
}

// ─── Budgets and allowances ──────────────────────────────────────────────────

export type AllowanceDraft = { holder: AllowanceHolder; periodLimit: Cents; perOperationLimit?: Cents }

export type CreateBudgetInput = {
  agencyId: Id
  sourceAccountId: Id
  name: string
  purpose: string
  template: BudgetTemplate
  period: BudgetPeriod
  allocation: Cents
  perOperationLimit: Cents
  periodLimit: Cents
  approvalThreshold: Cents
  allowedCategories: SpendingCategory[]
  allowedDestinationIds: Id[]
  expiresAt?: ISODate
  allowances: AllowanceDraft[]
}

export function createBudget(tx: Tx, input: CreateBudgetInput): Budget {
  tx.authorize('create_budget', { agencyId: input.agencyId })
  const source = tx.find('accounts', input.sourceAccountId, 'Source account')
  if (source.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The source account belongs to another Agency.')
  requirePositive(input.allocation, 'Budget amount')
  requirePositive(input.perOperationLimit, 'Per-operation limit')
  requirePositive(input.periodLimit, 'Period limit')
  if (input.perOperationLimit > input.periodLimit)
    throw new DomainError('validation', 'The per-operation limit cannot be higher than the period limit.')
  if (input.allowedCategories.length === 0)
    throw new DomainError('validation', 'Choose at least one approved use.')
  const available = accountBalance(tx.state, source.id)
  if (available < input.allocation)
    throw new DomainError('insufficient_funds', `${source.name} has ${usdText(available)} available.`)

  const budget: Budget = {
    id: newId('bud'),
    agencyId: input.agencyId,
    sourceAccountId: source.id,
    name: requireText(input.name, 'Budget name', 60),
    purpose: input.purpose.trim(),
    template: input.template,
    period: input.period,
    perOperationLimit: input.perOperationLimit,
    periodLimit: input.periodLimit,
    approvalThreshold: input.approvalThreshold,
    allowedCategories: input.allowedCategories,
    allowedDestinationIds: input.allowedDestinationIds,
    expiresAt: input.expiresAt,
    status: 'active',
    createdBy: tx.userId,
    createdAt: tx.now,
  }
  tx.state.budgets.push(budget)
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  tx.move(
    'allocate',
    input.allocation,
    { kind: 'account', accountId: source.id },
    { kind: 'budget', budgetId: budget.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      refId: budget.id,
    },
  )
  tx.activity(
    'budget_created',
    `Created the ${budget.name} budget with ${usdText(input.allocation)}`,
    { kind: 'budget', id: budget.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      amount: input.allocation,
    },
  )
  for (const draft of input.allowances) assignAllowance(tx, { budgetId: budget.id, ...draft })
  return budget
}

export function allocateToBudget(
  tx: Tx,
  input: { budgetId: Id; amount: Cents; direction: 'allocate' | 'return' },
) {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  tx.authorize('create_budget', { agencyId: budget.agencyId })
  requirePositive(input.amount)
  const portfolioId = tx.portfolioOfAgency(budget.agencyId)
  if (input.direction === 'allocate') {
    const available = accountBalance(tx.state, budget.sourceAccountId)
    if (available < input.amount)
      throw new DomainError('insufficient_funds', `The source account has ${usdText(available)} available.`)
    tx.move(
      'allocate',
      input.amount,
      { kind: 'account', accountId: budget.sourceAccountId },
      { kind: 'budget', budgetId: budget.id },
      {
        portfolioId,
        agencyId: budget.agencyId,
        refId: budget.id,
      },
    )
  } else {
    const usage = budgetUsage(tx.state, budget, tx.now)
    if (usage.available < input.amount)
      throw new DomainError('insufficient_funds', `Only ${usdText(usage.available)} is free to return.`)
    tx.move(
      'deallocate',
      input.amount,
      { kind: 'budget', budgetId: budget.id },
      { kind: 'account', accountId: budget.sourceAccountId },
      {
        portfolioId,
        agencyId: budget.agencyId,
        refId: budget.id,
      },
    )
  }
  tx.activity(
    'funds_transferred',
    input.direction === 'allocate'
      ? `Added ${usdText(input.amount)} to ${budget.name}`
      : `Returned ${usdText(input.amount)} from ${budget.name}`,
    { kind: 'budget', id: budget.id },
    {
      portfolioId,
      agencyId: budget.agencyId,
      amount: input.amount,
    },
  )
  return budget
}

export function updateBudgetRules(
  tx: Tx,
  input: { budgetId: Id } & Partial<
    Pick<
      Budget,
      | 'perOperationLimit'
      | 'periodLimit'
      | 'approvalThreshold'
      | 'allowedCategories'
      | 'allowedDestinationIds'
      | 'expiresAt'
      | 'name'
      | 'purpose'
    >
  >,
) {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  tx.authorize('create_budget', { agencyId: budget.agencyId })
  const { budgetId: _budgetId, ...changes } = input
  const next = { ...budget, ...changes }
  if (next.perOperationLimit > next.periodLimit)
    throw new DomainError('validation', 'The per-operation limit cannot be higher than the period limit.')
  Object.assign(budget, changes)
  tx.activity(
    'budget_created',
    `Updated the rules of ${budget.name}`,
    { kind: 'budget', id: budget.id },
    {
      portfolioId: tx.portfolioOfAgency(budget.agencyId),
      agencyId: budget.agencyId,
    },
  )
  return budget
}

export function setBudgetPaused(tx: Tx, input: { budgetId: Id; paused: boolean }) {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  tx.authorize('pause_budget', { agencyId: budget.agencyId })
  if (input.paused && budget.status !== 'active')
    throw new DomainError('invalid_state', 'Only active budgets can be paused.')
  if (!input.paused && budget.status !== 'paused')
    throw new DomainError('invalid_state', 'This budget is not paused.')
  budget.status = input.paused ? 'paused' : 'active'
  budget.pausedAt = input.paused ? tx.now : undefined
  const portfolioId = tx.portfolioOfAgency(budget.agencyId)
  tx.activity(
    input.paused ? 'budget_paused' : 'budget_resumed',
    input.paused ? `Paused the ${budget.name} budget` : `Resumed the ${budget.name} budget`,
    { kind: 'budget', id: budget.id },
    {
      portfolioId,
      agencyId: budget.agencyId,
    },
  )
  const holders = tx.state.allowances
    .filter((a) => a.budgetId === budget.id && a.status === 'active' && a.holder.kind === 'member')
    .map((a) => (a.holder as { userId: Id }).userId)
  tx.notify(
    holders,
    input.paused ? 'Budget paused' : 'Budget resumed',
    input.paused ? `New requests on ${budget.name} are on hold.` : `You can spend from ${budget.name} again.`,
    `/member/${budget.agencyId}/budget/${budget.id}`,
  )
  return budget
}

export function assignAllowance(tx: Tx, input: { budgetId: Id } & AllowanceDraft): SpendingAllowance {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  tx.authorize('assign_allowance', { agencyId: budget.agencyId })
  requirePositive(input.periodLimit, 'Allowance')
  if (input.periodLimit > budget.periodLimit) {
    throw new DomainError(
      'validation',
      `An allowance cannot exceed the budget's ${usdText(budget.periodLimit)} period limit.`,
    )
  }
  if (input.holder.kind === 'member') {
    const holder = input.holder
    const isMember = tx.state.memberships.some(
      (m) =>
        m.userId === holder.userId &&
        m.status === 'active' &&
        m.scope.kind === 'agency' &&
        m.scope.agencyId === budget.agencyId,
    )
    if (!isMember) throw new DomainError('forbidden', 'Allowances can only go to people in this Agency.')
  }
  const existing = tx.state.allowances.find(
    (a) =>
      a.budgetId === budget.id &&
      a.status === 'active' &&
      (a.holder.kind === 'member' && input.holder.kind === 'member'
        ? a.holder.userId === input.holder.userId
        : a.holder.kind === 'ai_agent' &&
          input.holder.kind === 'ai_agent' &&
          a.holder.agentId === input.holder.agentId),
  )
  if (existing) {
    existing.periodLimit = input.periodLimit
    existing.perOperationLimit = input.perOperationLimit
    return existing
  }
  const allowance: SpendingAllowance = {
    id: newId('alw'),
    budgetId: budget.id,
    holder: input.holder,
    periodLimit: input.periodLimit,
    perOperationLimit: input.perOperationLimit,
    status: 'active',
    createdAt: tx.now,
  }
  tx.state.allowances.push(allowance)
  const holderName =
    input.holder.kind === 'member'
      ? tx.nameOf(input.holder.userId)
      : (tx.state.agents.find((a) => a.id === (input.holder as { agentId: Id }).agentId)?.name ??
        'Automation')
  const portfolioId = tx.portfolioOfAgency(budget.agencyId)
  tx.activity(
    'allowance_assigned',
    `Gave ${holderName} a ${usdText(input.periodLimit)} allowance on ${budget.name}`,
    { kind: 'budget', id: budget.id },
    {
      portfolioId,
      agencyId: budget.agencyId,
      subjectUserId: input.holder.kind === 'member' ? input.holder.userId : undefined,
    },
  )
  if (input.holder.kind === 'member') {
    tx.notify(
      [input.holder.userId],
      'New spending access',
      `You can now spend up to ${usdText(input.periodLimit)} from ${budget.name}.`,
      `/member/${budget.agencyId}/budget/${budget.id}`,
    )
  }
  return allowance
}

/** Revocation is immediate: open requests on this allowance are cancelled too. */
export function revokeAllowance(tx: Tx, input: { allowanceId: Id }) {
  const allowance = tx.find('allowances', input.allowanceId, 'Allowance')
  const budget = tx.find('budgets', allowance.budgetId, 'Budget')
  tx.authorize('assign_allowance', { agencyId: budget.agencyId })
  if (allowance.status === 'revoked') return allowance
  allowance.status = 'revoked'
  allowance.revokedAt = tx.now
  for (const request of tx.state.requests) {
    if (request.budgetId !== budget.id || request.status !== 'needs_approval') continue
    const sameHolder =
      (allowance.holder.kind === 'member' &&
        request.requester.kind === 'user' &&
        request.requester.userId === allowance.holder.userId) ||
      (allowance.holder.kind === 'ai_agent' &&
        request.requester.kind === 'ai_agent' &&
        request.requester.agentId === allowance.holder.agentId)
    if (sameHolder) request.status = 'cancelled'
  }
  tx.activity(
    'allowance_revoked',
    `Revoked spending access on ${budget.name}`,
    { kind: 'budget', id: budget.id },
    {
      portfolioId: tx.portfolioOfAgency(budget.agencyId),
      agencyId: budget.agencyId,
      subjectUserId: allowance.holder.kind === 'member' ? allowance.holder.userId : undefined,
    },
  )
  return allowance
}

// ─── Payment requests (Members and AI Agents) ────────────────────────────────

export type RequestPaymentInput = {
  agencyId: Id
  budgetId: Id
  type: RequestType
  destinationId: Id
  amount: Cents
  category: SpendingCategory
  purpose: string
  attachments?: EvidenceDraft[]
  idempotencyKey: string
}

/** The same evaluation the UI shows live, computed against current state. */
export function previewPolicy(
  tx: Tx,
  input: Pick<RequestPaymentInput, 'budgetId' | 'amount' | 'category' | 'destinationId'>,
): PolicyDecision {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  const actor = tx.actor
  const holder: AllowanceHolder | null =
    actor.kind === 'user'
      ? { kind: 'member', userId: actor.userId }
      : actor.kind === 'ai_agent'
        ? { kind: 'ai_agent', agentId: actor.agentId }
        : null
  const allowance =
    holder &&
    (tx.state.allowances.find(
      (a) =>
        a.budgetId === budget.id &&
        a.status === 'active' &&
        (holder.kind === 'member'
          ? a.holder.kind === 'member' && a.holder.userId === holder.userId
          : a.holder.kind === 'ai_agent' && a.holder.agentId === holder.agentId),
    ) ??
      null)
  const agent =
    actor.kind === 'ai_agent' ? (tx.state.agents.find((a) => a.id === actor.agentId) ?? null) : null
  const usage = budgetUsage(tx.state, budget, tx.now)
  return evaluatePolicy({
    budget,
    allowance: allowance ?? null,
    agent,
    request: { amount: input.amount, category: input.category, destinationId: input.destinationId },
    usage: {
      budgetAvailable: usage.available,
      holderSpentThisPeriod: holder ? holderSpentInPeriod(tx.state, budget, holder, tx.now) : cents(0),
      budgetSpentThisPeriod: usage.committedThisPeriod,
      agentSpentToday: agent ? agentSpentToday(tx.state, agent.id, tx.now) : undefined,
    },
    now: tx.now,
  })
}

export function requestPayment(tx: Tx, input: RequestPaymentInput): PaymentRequest {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  if (budget.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'This budget belongs to another Agency.')
  tx.authorize('request_payment', { agencyId: input.agencyId })
  requirePositive(input.amount)

  const duplicate = tx.state.requests.find((r) => r.idempotencyKey === input.idempotencyKey)
  if (duplicate) return duplicate

  const decision = previewPolicy(tx, input)
  const attachments: Evidence[] = (input.attachments ?? []).map((item) => {
    const id = newId('ev')
    return {
      id,
      ...item,
      sha256: pseudoSha256(`${id}:${item.name}`),
      addedAt: tx.now,
      addedBy: tx.actorKey(),
    }
  })

  const request: PaymentRequest = {
    id: newId('req'),
    agencyId: input.agencyId,
    budgetId: budget.id,
    requester: tx.actor,
    type: input.type,
    destination: { kind: 'destination', destinationId: input.destinationId },
    amount: input.amount,
    category: input.category,
    purpose: requireText(input.purpose, 'Purpose', 200),
    attachments,
    status:
      decision.outcome === 'rejected'
        ? 'rejected'
        : decision.outcome === 'needs_approval'
          ? 'needs_approval'
          : 'approved',
    decision,
    idempotencyKey: input.idempotencyKey,
    createdAt: tx.now,
  }
  tx.state.requests.push(request)

  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const subjectUserId = tx.actor.kind === 'user' ? tx.actor.userId : undefined
  const destinationName =
    tx.state.destinations.find((d) => d.id === input.destinationId)?.name ?? 'a payment destination'

  if (tx.actor.kind === 'ai_agent') {
    tx.state.agentDecisions.unshift({
      id: newId('dec'),
      agentId: tx.actor.agentId,
      destinationId: input.destinationId,
      amount: input.amount,
      outcome: decision.outcome,
      reason: decision.reason?.message ?? 'Within the automation policy.',
      requestId: request.id,
      at: tx.now,
    })
  }

  if (decision.outcome === 'rejected') {
    tx.activity(
      'policy_rejected',
      `Policy rejected a ${usdText(input.amount)} request from ${tx.actorName()}`,
      { kind: 'request', id: request.id },
      {
        portfolioId,
        agencyId: input.agencyId,
        amount: input.amount,
        subjectUserId,
      },
    )
    return request
  }

  tx.activity(
    'payment_requested',
    `${tx.actorName()} requested ${usdText(input.amount)} for ${request.purpose.toLowerCase()}`,
    { kind: 'request', id: request.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      amount: input.amount,
      subjectUserId,
    },
  )

  if (decision.outcome === 'needs_approval') {
    tx.notify(
      tx.holders('agency_admin', { agencyId: input.agencyId }),
      'Request needs approval',
      `${tx.actorName()} requested ${usdText(input.amount)} for ${request.purpose}.`,
      `/agency/${input.agencyId}/approvals`,
    )
    return request
  }

  // Approved by policy: hold, then capture to the destination.
  capture(tx, request, destinationName)
  return request
}

function capture(tx: Tx, request: PaymentRequest, destinationName: string) {
  assertTransition('Request', canTransitionRequest, request.status, 'processing')
  request.status = 'processing'
  const budget = tx.find('budgets', request.budgetId, 'Budget')
  const portfolioId = tx.portfolioOfAgency(request.agencyId)
  const paymentId = newId('pay')
  const recipient: PaymentRecipient =
    request.destination.kind === 'member'
      ? { kind: 'member', userId: request.destination.userId }
      : { kind: 'destination', destinationId: request.destination.destinationId }
  const receipt = tx.receipt({
    kind: 'payment',
    amount: request.amount,
    fromLabel: `${tx.state.accounts.find((a) => a.id === budget.sourceAccountId)?.name ?? 'Account'} · ${budget.name}`,
    toLabel: destinationName,
    description: request.purpose,
    policyLabel: `${budget.name} · per-operation limit ${usdText(budget.perOperationLimit)}`,
    operationId: paymentId,
    portfolioId,
    agencyId: request.agencyId,
    evidenceIds: request.attachments.map((a) => a.id),
  })
  tx.move(
    'payment',
    request.amount,
    { kind: 'budget', budgetId: budget.id },
    { kind: 'recipient', recipient },
    {
      portfolioId,
      agencyId: request.agencyId,
      refId: paymentId,
      receiptId: receipt.id,
    },
  )
  const payment: Payment = {
    id: paymentId,
    agencyId: request.agencyId,
    type:
      request.requester.kind === 'ai_agent'
        ? 'automation'
        : request.type === 'reimbursement'
          ? 'reimbursement'
          : 'tool',
    sourceAccountId: budget.sourceAccountId,
    budgetId: budget.id,
    recipient,
    amount: request.amount,
    category: request.category,
    memo: request.purpose,
    status: 'completed',
    createdBy: request.requester,
    approvedBy: request.approvedBy,
    scheduledFor: tx.now,
    completedAt: tx.now,
    requestId: request.id,
    receiptId: receipt.id,
  }
  tx.state.payments.push(payment)
  request.status = 'completed'
  request.paymentId = paymentId

  const requesterUserId = request.requester.kind === 'user' ? request.requester.userId : undefined
  if (requesterUserId) {
    const expense: Expense = {
      id: newId('exp'),
      agencyId: request.agencyId,
      userId: requesterUserId,
      budgetId: budget.id,
      merchant: destinationName,
      amount: request.amount,
      category: request.category,
      spentAt: tx.now,
      paymentId,
      receipt: request.attachments[0],
      createdAt: tx.now,
    }
    tx.state.expenses.push(expense)
  }
  tx.activity(
    'payment_completed',
    `Paid ${usdText(request.amount)} to ${destinationName}`,
    { kind: 'payment', id: paymentId },
    {
      portfolioId,
      agencyId: request.agencyId,
      amount: request.amount,
      subjectUserId: requesterUserId,
      actor: request.requester,
    },
  )
  if (requesterUserId) {
    tx.notify(
      [requesterUserId],
      'Payment completed',
      `${usdText(request.amount)} to ${destinationName} is complete.`,
      `/member/${request.agencyId}/requests/${request.id}`,
    )
  }
  return { payment, receipt }
}

/** Agency Admin (or Investor, for exceptions) approves a request that needed a decision. */
export function approveRequest(tx: Tx, input: { requestId: Id }) {
  const request = tx.find('requests', input.requestId, 'Request')
  const agreement = tx.state.agreements.find((a) => a.agencyId === request.agencyId && a.status === 'active')
  const isException = agreement ? request.amount > agreement.spendingPolicy.exceptionThreshold : false
  tx.authorize('approve_payment', { agencyId: request.agencyId, createdBy: request.requester, isException })
  const subject = tx.subject()
  const isInvestor = subject.memberships.some((m) => m.role === 'investor' && m.status === 'active')
  if (isException && !isInvestor) {
    throw new DomainError(
      'forbidden',
      'This operation is above the agreement exception threshold. The Investor must approve it.',
    )
  }
  if (request.status !== 'needs_approval')
    throw new DomainError('invalid_state', 'This request does not need a decision.')
  const budget = tx.find('budgets', request.budgetId, 'Budget')
  if (budget.status !== 'active')
    throw new DomainError('invalid_state', 'The budget is paused. Resume it before approving.')
  const available = budgetBalance(tx.state, budget.id)
  if (available < request.amount)
    throw new DomainError('insufficient_funds', `${budget.name} has ${usdText(available)} available.`)

  request.status = 'approved'
  request.approvedBy = tx.userId
  request.decidedAt = tx.now
  const portfolioId = tx.portfolioOfAgency(request.agencyId)
  const requesterName = tx.actorName(request.requester)
  tx.activity(
    'payment_approved',
    `Approved ${requesterName}'s ${usdText(request.amount)} request`,
    { kind: 'request', id: request.id },
    {
      portfolioId,
      agencyId: request.agencyId,
      amount: request.amount,
      subjectUserId: request.requester.kind === 'user' ? request.requester.userId : undefined,
    },
  )
  const destinationName =
    request.destination.kind === 'destination'
      ? (tx.state.destinations.find(
          (d) => d.id === (request.destination as { destinationId: Id }).destinationId,
        )?.name ?? 'Payment destination')
      : tx.nameOf(request.destination.userId)
  return capture(tx, request, destinationName)
}

export function declineRequest(tx: Tx, input: { requestId: Id; reason: string }) {
  const request = tx.find('requests', input.requestId, 'Request')
  const agreement = tx.state.agreements.find((a) => a.agencyId === request.agencyId && a.status === 'active')
  const isException = agreement ? request.amount > agreement.spendingPolicy.exceptionThreshold : false
  tx.authorize('approve_payment', { agencyId: request.agencyId, createdBy: request.requester, isException })
  assertTransition('Request', canTransitionRequest, request.status, 'declined')
  request.status = 'declined'
  request.declinedReason = requireText(input.reason, 'Reason', 300)
  request.decidedAt = tx.now
  const portfolioId = tx.portfolioOfAgency(request.agencyId)
  tx.activity(
    'payment_declined',
    `Declined ${tx.actorName(request.requester)}'s ${usdText(request.amount)} request`,
    { kind: 'request', id: request.id },
    {
      portfolioId,
      agencyId: request.agencyId,
      amount: request.amount,
      subjectUserId: request.requester.kind === 'user' ? request.requester.userId : undefined,
    },
  )
  if (request.requester.kind === 'user') {
    tx.notify(
      [request.requester.userId],
      'Request declined',
      request.declinedReason,
      `/member/${request.agencyId}/requests/${request.id}`,
    )
  }
  return request
}

export function cancelRequest(tx: Tx, input: { requestId: Id }) {
  const request = tx.find('requests', input.requestId, 'Request')
  if (!(request.requester.kind === 'user' && request.requester.userId === tx.userId)) {
    throw new DomainError('forbidden', 'Only the person who made the request can cancel it.')
  }
  assertTransition('Request', canTransitionRequest, request.status, 'cancelled')
  request.status = 'cancelled'
  return request
}

// ─── Agency payments ─────────────────────────────────────────────────────────

export type SendPaymentInput = {
  agencyId: Id
  type: PaymentType
  recipient: PaymentRecipient
  accountId: Id
  budgetId?: Id
  amount: Cents
  category: SpendingCategory
  memo: string
  scheduledFor?: ISODate
  billId?: Id
  batchId?: Id
}

export function sendPayment(tx: Tx, input: SendPaymentInput) {
  tx.authorize(input.recipient.kind === 'member' ? 'pay_member' : 'send_payment', {
    agencyId: input.agencyId,
  })
  requirePositive(input.amount)
  const account = tx.find('accounts', input.accountId, 'Account')
  if (account.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The account belongs to another Agency.')
  const portfolioId = tx.portfolioOfAgency(input.agencyId)

  let budget: Budget | undefined
  if (input.budgetId) {
    budget = tx.find('budgets', input.budgetId, 'Budget')
    if (budget.agencyId !== input.agencyId)
      throw new DomainError('forbidden', 'The budget belongs to another Agency.')
    if (budget.status !== 'active')
      throw new DomainError('policy_rejected', 'This budget is paused. New payments are on hold.')
    if (input.amount > budget.perOperationLimit) {
      throw new DomainError(
        'policy_rejected',
        `The amount exceeds the budget's per-operation limit of ${usdText(budget.perOperationLimit)}.`,
      )
    }
    if (
      input.recipient.kind === 'destination' &&
      budget.allowedDestinationIds.length > 0 &&
      !budget.allowedDestinationIds.includes(input.recipient.destinationId)
    ) {
      throw new DomainError('policy_rejected', 'This payment destination is not approved for this budget.')
    }
  }

  const agreement = tx.state.agreements.find((a) => a.agencyId === input.agencyId && a.status === 'active')
  if (agreement && input.amount > agreement.spendingPolicy.exceptionThreshold) {
    throw new DomainError(
      'limit_exceeded',
      `Payments above ${usdText(agreement.spendingPolicy.exceptionThreshold)} are exceptions and need the Investor's approval.`,
    )
  }

  const recipientName =
    input.recipient.kind === 'member'
      ? tx.nameOf(input.recipient.userId)
      : (tx.state.destinations.find((d) => d.id === (input.recipient as { destinationId: Id }).destinationId)
          ?.name ?? 'Payment destination')

  const scheduled = input.scheduledFor && input.scheduledFor.slice(0, 10) > tx.now.slice(0, 10)
  const payment: Payment = {
    id: newId('pay'),
    agencyId: input.agencyId,
    type: input.type,
    sourceAccountId: account.id,
    budgetId: budget?.id,
    recipient: input.recipient,
    amount: input.amount,
    category: input.category,
    memo: requireText(input.memo, 'Memo', 200),
    status: scheduled ? 'scheduled' : 'completed',
    createdBy: tx.actor,
    scheduledFor: input.scheduledFor ?? tx.now,
    billId: input.billId,
    batchId: input.batchId,
  }

  if (!scheduled) {
    const from = budget
      ? ({ kind: 'budget', budgetId: budget.id } as const)
      : ({ kind: 'account', accountId: account.id } as const)
    const available = budget
      ? budgetUsage(tx.state, budget, tx.now).available
      : accountBalance(tx.state, account.id)
    if (available < input.amount) {
      throw new DomainError(
        'insufficient_funds',
        `${budget ? budget.name : account.name} has ${usdText(available)} available.`,
      )
    }
    const receipt = tx.receipt({
      kind: 'payment',
      amount: input.amount,
      fromLabel: budget ? `${account.name} · ${budget.name}` : account.name,
      toLabel: recipientName,
      description: payment.memo,
      policyLabel: budget
        ? `${budget.name} · per-operation limit ${usdText(budget.perOperationLimit)}`
        : 'Agency account payment · Agency Admin authorization',
      operationId: payment.id,
      portfolioId,
      agencyId: input.agencyId,
    })
    tx.move(
      'payment',
      input.amount,
      from,
      { kind: 'recipient', recipient: input.recipient },
      {
        portfolioId,
        agencyId: input.agencyId,
        refId: payment.id,
        receiptId: receipt.id,
      },
    )
    payment.completedAt = tx.now
    payment.receiptId = receipt.id
  }
  tx.state.payments.push(payment)
  tx.activity(
    'payment_completed',
    scheduled
      ? `Scheduled ${usdText(input.amount)} to ${recipientName}`
      : `Paid ${usdText(input.amount)} to ${recipientName}`,
    { kind: 'payment', id: payment.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      amount: input.amount,
      subjectUserId: input.recipient.kind === 'member' ? input.recipient.userId : undefined,
    },
  )
  if (input.recipient.kind === 'member') {
    tx.notify(
      [input.recipient.userId],
      scheduled ? 'Payment scheduled' : 'Payment received',
      `${usdText(input.amount)} from ${tx.state.agencies.find((a) => a.id === input.agencyId)?.name}: ${payment.memo}.`,
      `/member/${input.agencyId}/payments`,
    )
  }
  return payment
}

export function sendTeamPayments(
  tx: Tx,
  input: { agencyId: Id; accountId: Id; budgetId?: Id; memo: string; items: { userId: Id; amount: Cents }[] },
) {
  if (input.items.length === 0) throw new DomainError('validation', 'Choose at least one team member.')
  const total = sum(input.items, (i) => i.amount)
  const account = tx.find('accounts', input.accountId, 'Account')
  const available = input.budgetId
    ? budgetUsage(tx.state, tx.find('budgets', input.budgetId, 'Budget'), tx.now).available
    : accountBalance(tx.state, account.id)
  if (available < total)
    throw new DomainError(
      'insufficient_funds',
      `The team payment totals ${usdText(total)} but only ${usdText(available)} is available.`,
    )
  const batchId = newId('batch')
  return input.items.map((item) =>
    sendPayment(tx, {
      agencyId: input.agencyId,
      type: 'team',
      recipient: { kind: 'member', userId: item.userId },
      accountId: input.accountId,
      budgetId: input.budgetId,
      amount: item.amount,
      category: 'team',
      memo: input.memo,
      batchId,
    }),
  )
}

// ─── Bills and reconciliation ────────────────────────────────────────────────

export type AddBillInput = {
  agencyId: Id
  destinationId: Id
  number: string
  issueDate: ISODate
  dueDate: ISODate
  amount: Cents
  category: SpendingCategory
  accountId: Id
  budgetId?: Id
  document: EvidenceDraft
  notes?: string
}

export function addBill(tx: Tx, input: AddBillInput): Bill {
  tx.authorize('manage_bills', { agencyId: input.agencyId })
  requirePositive(input.amount)
  if (input.dueDate < input.issueDate)
    throw new DomainError('validation', 'The due date cannot be before the issue date.')
  const destination = tx.find('destinations', input.destinationId, 'Payment destination')
  if (destination.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'This vendor belongs to another Agency.')
  const docId = newId('ev')
  const bill: Bill = {
    id: newId('bill'),
    agencyId: input.agencyId,
    destinationId: destination.id,
    number: requireText(input.number, 'Bill number', 40),
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    amount: input.amount,
    category: input.category,
    accountId: input.accountId,
    budgetId: input.budgetId,
    status: 'to_pay',
    document: {
      id: docId,
      ...input.document,
      sha256: pseudoSha256(`${docId}:${input.document.name}`),
      addedAt: tx.now,
      addedBy: tx.userId,
    },
    notes: input.notes?.trim() || undefined,
    createdBy: tx.userId,
    createdAt: tx.now,
  }
  tx.state.bills.push(bill)
  tx.activity(
    'bill_added',
    `Added ${destination.name} bill ${bill.number}`,
    { kind: 'bill', id: bill.id },
    {
      portfolioId: tx.portfolioOfAgency(input.agencyId),
      agencyId: input.agencyId,
      amount: bill.amount,
    },
  )
  return bill
}

export function payBill(
  tx: Tx,
  input: { billId: Id; accountId?: Id; budgetId?: Id | null; scheduledFor?: ISODate },
) {
  const bill = tx.find('bills', input.billId, 'Bill')
  tx.authorize('send_payment', { agencyId: bill.agencyId })
  if (bill.status === 'paid' || bill.status === 'reconciled')
    throw new DomainError('invalid_state', 'This bill is already paid.')
  const destination = tx.find('destinations', bill.destinationId, 'Payment destination')
  const payment = sendPayment(tx, {
    agencyId: bill.agencyId,
    type: bill.category === 'contractors' ? 'contractor' : bill.category === 'cloud' ? 'vendor' : 'tool',
    recipient: { kind: 'destination', destinationId: destination.id },
    accountId: input.accountId ?? bill.accountId,
    budgetId: input.budgetId === null ? undefined : (input.budgetId ?? bill.budgetId),
    amount: bill.amount,
    category: bill.category,
    memo: `${destination.name} bill ${bill.number}`,
    scheduledFor: input.scheduledFor,
    billId: bill.id,
  })
  bill.paymentId = payment.id
  bill.status = payment.status === 'scheduled' ? 'scheduled' : 'paid'
  bill.scheduledFor = payment.status === 'scheduled' ? payment.scheduledFor : undefined
  return { bill, payment }
}

/** Links a bill (or expense) to one canonical payment and its evidence. */
export function reconcile(tx: Tx, input: { agencyId: Id; paymentId: Id; billId?: Id; expenseId?: Id }) {
  tx.authorize('reconcile_bill', { agencyId: input.agencyId })
  const payment = tx.find('payments', input.paymentId, 'Payment')
  if (payment.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'This payment belongs to another Agency.')
  if (payment.status !== 'completed' || !payment.receiptId)
    throw new DomainError('invalid_state', 'Only completed payments can be reconciled.')
  if (tx.state.reconciliations.some((r) => r.paymentId === payment.id)) {
    throw new DomainError('invalid_state', 'This payment is already reconciled.')
  }
  const evidenceIds: Id[] = []
  let label = 'payment'
  if (input.billId) {
    const bill = tx.find('bills', input.billId, 'Bill')
    if (bill.amount !== payment.amount)
      throw new DomainError(
        'validation',
        `The bill is ${usdText(bill.amount)} but the payment is ${usdText(payment.amount)}.`,
      )
    bill.status = 'reconciled'
    bill.paymentId = payment.id
    evidenceIds.push(bill.document.id)
    label = `${tx.state.destinations.find((d) => d.id === bill.destinationId)?.name ?? 'Vendor'} bill ${bill.number}`
  }
  if (input.expenseId) {
    const expense = tx.find('expenses', input.expenseId, 'Expense')
    if (expense.receipt) evidenceIds.push(expense.receipt.id)
    label = `${expense.merchant} expense`
  }
  const reconciliation = {
    id: newId('rec'),
    agencyId: input.agencyId,
    paymentId: payment.id,
    billId: input.billId,
    expenseId: input.expenseId,
    evidenceIds,
    receiptId: payment.receiptId,
    reconciledBy: tx.userId,
    reconciledAt: tx.now,
  }
  tx.state.reconciliations.push(reconciliation)
  tx.activity(
    'bill_reconciled',
    `Reconciled ${label}`,
    { kind: 'payment', id: payment.id },
    {
      portfolioId: tx.portfolioOfAgency(input.agencyId),
      agencyId: input.agencyId,
      amount: payment.amount,
    },
  )
  return reconciliation
}

// ─── Expenses (Members) ──────────────────────────────────────────────────────

export function addExpense(
  tx: Tx,
  input: {
    agencyId: Id
    budgetId: Id
    merchant: string
    amount: Cents
    category: SpendingCategory
    spentAt: ISODate
    receipt?: EvidenceDraft
    paymentId?: Id
  },
): Expense {
  tx.authorize('upload_receipt', { agencyId: input.agencyId, ownerUserId: tx.userId })
  requirePositive(input.amount)
  const receipt = input.receipt
    ? (() => {
        const id = newId('ev')
        return {
          id,
          ...input.receipt!,
          sha256: pseudoSha256(`${id}:${input.receipt!.name}`),
          addedAt: tx.now,
          addedBy: tx.userId,
        }
      })()
    : undefined
  const expense: Expense = {
    id: newId('exp'),
    agencyId: input.agencyId,
    userId: tx.userId,
    budgetId: input.budgetId,
    merchant: requireText(input.merchant, 'Merchant', 80),
    amount: input.amount,
    category: input.category,
    spentAt: input.spentAt,
    paymentId: input.paymentId,
    receipt,
    createdAt: tx.now,
  }
  tx.state.expenses.push(expense)
  tx.activity(
    'expense_added',
    `Added a ${usdText(input.amount)} expense at ${expense.merchant}`,
    { kind: 'expense', id: expense.id },
    {
      portfolioId: tx.portfolioOfAgency(input.agencyId),
      agencyId: input.agencyId,
      amount: input.amount,
      subjectUserId: tx.userId,
    },
  )
  return expense
}

export function attachReceipt(tx: Tx, input: { expenseId: Id; receipt: EvidenceDraft }) {
  const expense = tx.find('expenses', input.expenseId, 'Expense')
  tx.authorize('upload_receipt', { agencyId: expense.agencyId, ownerUserId: expense.userId })
  const id = newId('ev')
  expense.receipt = {
    id,
    ...input.receipt,
    sha256: pseudoSha256(`${id}:${input.receipt.name}`),
    addedAt: tx.now,
    addedBy: tx.userId,
  }
  return expense
}

export function addDestination(
  tx: Tx,
  input: {
    agencyId: Id
    name: string
    kind: 'vendor' | 'service' | 'contractor'
    category: SpendingCategory
    settlementLabel: string
    website?: string
  },
) {
  tx.authorize('send_payment', { agencyId: input.agencyId })
  const destination = {
    id: newId('dest'),
    agencyId: input.agencyId,
    name: requireText(input.name, 'Name', 80),
    kind: input.kind,
    category: input.category,
    settlementLabel: requireText(input.settlementLabel, 'Settlement method', 80),
    website: input.website?.trim() || undefined,
    status: 'approved' as const,
    addedAt: tx.now,
  }
  tx.state.destinations.push(destination)
  return destination
}

/** A Member sends money they received but no longer need back to the Agency. */
export function returnUnusedFunds(tx: Tx, input: { agencyId: Id; amount: Cents }) {
  tx.authorize('receive_payout', { agencyId: input.agencyId, ownerUserId: tx.userId })
  requirePositive(input.amount)
  const memberLocation = { kind: 'recipient', recipient: { kind: 'member', userId: tx.userId } } as const
  const received = tx.state.movements.reduce((total, m) => {
    const toMe =
      m.to.kind === 'recipient' &&
      m.to.recipient.kind === 'member' &&
      m.to.recipient.userId === tx.userId &&
      m.agencyId === input.agencyId
    const fromMe =
      m.from.kind === 'recipient' &&
      m.from.recipient.kind === 'member' &&
      m.from.recipient.userId === tx.userId &&
      m.agencyId === input.agencyId
    return total + (toMe ? m.amount : 0) - (fromMe ? m.amount : 0)
  }, 0)
  if (input.amount > received) {
    throw new DomainError(
      'insufficient_funds',
      `You can return up to ${usdText(cents(Math.max(0, received)))} received from this Agency.`,
    )
  }
  const operations = tx.state.accounts.find(
    (a) => a.agencyId === input.agencyId && a.template === 'operations',
  )
  if (!operations) throw new DomainError('not_found', 'The Agency has no operations account.')
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const operationId = newId('ret')
  const receipt = tx.receipt({
    kind: 'transfer',
    amount: input.amount,
    fromLabel: tx.nameOf(tx.userId),
    toLabel: operations.name,
    description: 'Unused funds returned to the Agency',
    policyLabel: 'Member return · personal funds',
    operationId,
    portfolioId,
    agencyId: input.agencyId,
  })
  tx.move(
    'transfer',
    input.amount,
    memberLocation,
    { kind: 'account', accountId: operations.id },
    { portfolioId, agencyId: input.agencyId, refId: operationId, receiptId: receipt.id },
  )
  tx.activity(
    'funds_transferred',
    `${tx.nameOf(tx.userId)} returned ${usdText(input.amount)} of unused funds`,
    { kind: 'receipt', id: receipt.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      amount: input.amount,
      subjectUserId: tx.userId,
    },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: input.agencyId }),
    'Funds returned',
    `${tx.nameOf(tx.userId)} returned ${usdText(input.amount)} to ${operations.name}.`,
    `/agency/${input.agencyId}/accounts/${operations.id}`,
  )
  return receipt
}

import {
  advanceStanding,
  isAdvance,
  JUSTIFY_WITHIN_DAYS,
  otherMoneyReturnable,
  returnableFor,
} from '../accountability'
import { parseAddress, shortAddress } from '../address'
import { newId } from '../ids'
import { cents, clampToZero, sum, type Cents } from '../money'
import { evaluatePolicy, paysRequester, withAgreementRules, type PolicyRequest } from '../policy'
import { accountTemplate } from '../labels'
import {
  aboveExceptionThreshold,
  activeOperationsAccount,
  exceptionThresholdOf,
  isException,
} from '../queries'
import {
  accountBalance,
  agentSpentToday,
  budgetUsage,
  dayWindow,
  holderSpentInPeriod,
  memberHeld,
} from '../selectors'
import { assertTransition, canTransitionRequest } from '../status'
import type {
  Account,
  AccountTemplate,
  Actor,
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
  PaymentRequest,
  PaymentType,
  PayoutAddress,
  PolicyDecision,
  RequestDestination,
  RequestType,
  Schedule,
  SpendingAllowance,
  SpendingCategory,
  ViatikRecipient,
} from '../types'
import {
  DomainError,
  evidenceFrom,
  requirePositive,
  requireText,
  usdText,
  type EvidenceDraft,
  type Tx,
} from './core'
import { schedulePayment, stopSchedule } from './schedules'

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

/**
 * The account released funding lands in by default. An Agency gets one when
 * it accepts funding, so a new Agency can receive money without setting up
 * accounts first. Opened by whoever accepts (an Agency Admin).
 */
export function ensureOperationsAccount(tx: Tx, agencyId: Id): Account {
  return (
    activeOperationsAccount(tx.state, agencyId) ??
    createAccount(tx, {
      agencyId,
      template: 'operations',
      name: accountTemplate.operations.label,
      purpose: accountTemplate.operations.description,
    })
  )
}

/**
 * Opens the Operations account from a form that needs one. If it already
 * exists (another admin, another tab, or an agreement accepted meanwhile),
 * the existing account is returned instead of a second one.
 */
export function openOperationsAccount(tx: Tx, input: { agencyId: Id }): Account {
  tx.authorize('create_account', { agencyId: input.agencyId })
  return ensureOperationsAccount(tx, input.agencyId)
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
  // The ledger records the first allocation under the budget's own id.
  const receipt = tx.receipt({
    kind: 'allocation',
    amount: input.allocation,
    fromLabel: source.name,
    toLabel: budget.name,
    description: `Allocated to ${budget.name}`,
    policyLabel: 'Budget allocation · Agency Admin authorization',
    operationId: budget.id,
    portfolioId,
    agencyId: input.agencyId,
  })
  tx.move(
    'allocate',
    input.allocation,
    { kind: 'account', accountId: source.id },
    { kind: 'budget', budgetId: budget.id },
    {
      portfolioId,
      agencyId: input.agencyId,
      refId: budget.id,
      receiptId: receipt.id,
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
  // Its own operation id: the ledger already recorded the budget id for the first allocation.
  const operationId = newId('alloc')
  const source = tx.find('accounts', budget.sourceAccountId, 'Source account')
  const receipt = (fromLabel: string, toLabel: string, description: string) =>
    tx.receipt({
      kind: 'allocation',
      amount: input.amount,
      fromLabel,
      toLabel,
      description,
      policyLabel: 'Budget allocation · Agency Admin authorization',
      operationId,
      portfolioId,
      agencyId: budget.agencyId,
    })
  if (input.direction === 'allocate') {
    const available = accountBalance(tx.state, budget.sourceAccountId)
    if (available < input.amount)
      throw new DomainError('insufficient_funds', `The source account has ${usdText(available)} available.`)
    const allocated = receipt(source.name, budget.name, `Allocated to ${budget.name}`)
    tx.move(
      'allocate',
      input.amount,
      { kind: 'account', accountId: budget.sourceAccountId },
      { kind: 'budget', budgetId: budget.id },
      {
        portfolioId,
        agencyId: budget.agencyId,
        refId: operationId,
        receiptId: allocated.id,
      },
    )
  } else {
    const usage = budgetUsage(tx.state, budget, tx.now)
    if (usage.available < input.amount)
      throw new DomainError('insufficient_funds', `Only ${usdText(usage.available)} is free to return.`)
    const returned = receipt(budget.name, source.name, `Returned from ${budget.name}`)
    tx.move(
      'deallocate',
      input.amount,
      { kind: 'budget', budgetId: budget.id },
      { kind: 'account', accountId: budget.sourceAccountId },
      {
        portfolioId,
        agencyId: budget.agencyId,
        refId: operationId,
        receiptId: returned.id,
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
  // Only rule fields change; anything else a caller sends is ignored.
  const changes: Partial<Budget> = {}
  for (const key of [
    'perOperationLimit',
    'periodLimit',
    'approvalThreshold',
    'allowedCategories',
    'allowedDestinationIds',
    'expiresAt',
    'name',
    'purpose',
  ] as const) {
    if (input[key] !== undefined) Object.assign(changes, { [key]: input[key] })
  }
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
  } else {
    const agent = tx.find('agents', input.holder.agentId, 'Automation')
    if (agent.agencyId !== budget.agencyId)
      throw new DomainError('forbidden', 'Allowances can only go to automations in this Agency.')
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
  /** vendor_payment / automation only. */
  destinationId?: Id
  amount: Cents
  category: SpendingCategory
  purpose: string
  /** reimbursement only (required there). */
  merchant?: string
  /** reimbursement only (optional). */
  spentAt?: ISODate
  attachments?: EvidenceDraft[]
  idempotencyKey: string
}

/** Same decision requestPayment reaches (exception routing and the work rule included). */
export function previewPolicy(
  tx: Tx,
  input: {
    budgetId: Id
    type: RequestType
    amount: Cents
    category: SpendingCategory
    destinationId?: Id | null
  },
): PolicyDecision {
  return requestDecision(tx, {
    budgetId: input.budgetId,
    type: input.type,
    amount: input.amount,
    category: input.category,
    // Money into the requester's own Viatik balance is not limited by the vendor list.
    destinationId: paysRequester(input.type) ? null : (input.destinationId ?? null),
  }).decision
}

/**
 * The decision on a request: the budget policy for whoever asks, plus the
 * agreement's rules (the Investor decides exceptions; payment for work is
 * always reviewed by an Agency Admin and refused above the exception
 * threshold). For requests that reach the ledger it is the same outcome as the
 * ledger's, so nothing else may send a request to approval.
 */
function requestDecision(
  tx: Tx,
  input: {
    budgetId: Id
    type: RequestType
    amount: Cents
    category: SpendingCategory
    destinationId: Id | null
  },
  actor: Actor = tx.actor,
): { decision: PolicyDecision; isException: boolean } {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  const decision = policyForHolder(tx, budget, actor, {
    amount: input.amount,
    category: input.category,
    destinationId: input.destinationId,
  })
  return withAgreementRules(decision, input, exceptionThresholdOf(tx.state, budget.agencyId))
}

/**
 * The budget policy for whoever asks (`actor`), against current state. Pending
 * requests are not counted, so a request waiting for approval can be checked
 * again without counting itself. If pending requests start to count (M-14),
 * the request being approved has to be left out here.
 */
function policyForHolder(
  tx: Tx,
  budget: Budget,
  actor: Actor,
  request: PolicyRequest,
  holderName?: string,
): PolicyDecision {
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
    request,
    usage: {
      budgetAvailable: usage.available,
      holderSpentThisPeriod: holder ? holderSpentInPeriod(tx.state, budget, holder, tx.now) : cents(0),
      budgetSpentThisPeriod: usage.committedThisPeriod,
      agentSpentToday: agent ? agentSpentToday(tx.state, agent.id, tx.now) : undefined,
    },
    now: tx.now,
    holderName,
  })
}

export function requestPayment(tx: Tx, input: RequestPaymentInput): PaymentRequest {
  const budget = tx.find('budgets', input.budgetId, 'Budget')
  if (budget.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'This budget belongs to another Agency.')
  tx.authorize('request_payment', { agencyId: input.agencyId })
  requirePositive(input.amount)
  const destination = requestDestination(tx, input)
  const reimbursement = input.type === 'reimbursement'
  // A reimbursement carries what was bought and its receipt: its Expense is built from them when it is paid.
  const merchant = reimbursement ? requireText(input.merchant, 'Merchant', 80) : undefined
  if (reimbursement) {
    if (!(input.attachments ?? []).some((item) => item.kind === 'file'))
      throw new DomainError('validation', 'Attach the receipt of what you paid.')
    if (input.spentAt) requireNotFuture(input.spentAt, tx.now)
  }

  // A retry with the same key returns the original request, but only to the
  // person (or automation) who made it, in the same Agency: keys are not secrets.
  const requester = tx.actorKey()
  const duplicate = tx.state.requests.find(
    (r) =>
      r.idempotencyKey === input.idempotencyKey &&
      r.agencyId === input.agencyId &&
      tx.actorKey(r.requester) === requester,
  )
  if (duplicate) return duplicate
  // Every request's files back the money it asks for (a reimbursement's receipt, a vendor's invoice,
  // a quote, proof of work): none may already back other money. Checked after the retry above, since
  // a retried request carries the files its first try stored.
  requireUnusedReceipts(tx, input.agencyId, input.attachments ?? [])

  // Above the Investor's exception threshold nothing approves itself, even within the
  // budget's automatic limit: the Investor decides (M-1, the same rule as the contract).
  // Payment for work is always reviewed by an Agency Admin.
  const { decision, isException: toInvestor } = requestDecision(tx, {
    budgetId: budget.id,
    type: input.type,
    amount: input.amount,
    category: input.category,
    destinationId: destination.kind === 'destination' ? destination.destinationId : null,
  })
  const attachments: Evidence[] = (input.attachments ?? []).map((item) =>
    evidenceFrom(item, requester, tx.now),
  )

  const request: PaymentRequest = {
    id: newId('req'),
    agencyId: input.agencyId,
    budgetId: budget.id,
    requester: tx.actor,
    type: input.type,
    destination,
    amount: input.amount,
    category: input.category,
    purpose: requireText(input.purpose, 'Purpose', 200),
    attachments,
    merchant,
    spentAt: reimbursement ? input.spentAt : undefined,
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

  if (tx.actor.kind === 'ai_agent' && destination.kind === 'destination') {
    tx.state.agentDecisions.unshift({
      id: newId('dec'),
      agentId: tx.actor.agentId,
      destinationId: destination.destinationId,
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
    // Exceptions are decided by the Investor, everything else (payment for work included) by the Agency Admins.
    tx.notify(
      toInvestor
        ? tx.holders('investor', { portfolioId })
        : tx.holders('agency_admin', { agencyId: input.agencyId }),
      'Request needs approval',
      `${tx.actorName()} requested ${usdText(input.amount)} for ${request.purpose}.`,
      toInvestor ? `/investor/${portfolioId}/approvals` : `/agency/${input.agencyId}/approvals`,
    )
    return request
  }

  // Approved by policy: hold, then capture to the destination.
  capture(tx, request)
  return request
}

/**
 * Where a request pays. Money for purchases, a reimbursement and payment for
 * work go into the requester's own Viatik balance; a vendor payment (or an
 * automation's) goes to an approved vendor of the Agency.
 */
function requestDestination(
  tx: Tx,
  input: Pick<RequestPaymentInput, 'agencyId' | 'type' | 'destinationId'>,
): RequestDestination {
  if (paysRequester(input.type)) {
    if (tx.actor.kind !== 'user')
      throw new DomainError('forbidden', 'Only a person can request money into their Viatik balance.')
    if (input.destinationId)
      throw new DomainError('validation', 'This request pays your Viatik balance, not a vendor.')
    return { kind: 'member', userId: tx.actor.userId }
  }
  if (!input.destinationId) throw new DomainError('validation', 'Choose where the money goes.')
  const destination = tx.find('destinations', input.destinationId, 'Payment destination')
  if (destination.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'This payment destination belongs to another Agency.')
  requirePayable(destination)
  return { kind: 'destination', destinationId: destination.id }
}

/** How a request's recipient reads on its receipt and in activity. */
function recipientLabels(tx: Tx, destination: RequestDestination): { receipt: string; activity: string } {
  if (destination.kind === 'member') {
    const name = tx.nameOf(destination.userId)
    return { receipt: `${name} · Viatik balance`, activity: `${name}'s Viatik balance` }
  }
  const name =
    tx.state.destinations.find((d) => d.id === destination.destinationId)?.name ?? 'Payment destination'
  return { receipt: name, activity: name }
}

/** The kind of payment a request becomes when it is paid. */
function paymentTypeForRequest(request: PaymentRequest): PaymentType {
  if (request.requester.kind === 'ai_agent') return 'automation'
  if (request.type === 'reimbursement') return 'reimbursement'
  // Older requests paid a vendor whatever their type: only money into a person's balance is an advance or work pay.
  if (request.destination.kind === 'member') {
    if (request.type === 'funds') return 'advance'
    if (request.type === 'work') return 'team'
  }
  return 'tool'
}

/** What the requester hears when their request is paid. */
function paidNotice(
  request: PaymentRequest,
  recipient: string,
): { title: string; body: string; href: string } {
  const amount = usdText(request.amount)
  const balance = `/member/${request.agencyId}/payments`
  if (request.destination.kind === 'member') {
    if (request.type === 'funds') {
      return {
        title: 'Money for your purchase',
        body: `${amount} is in your Viatik balance. Add its receipts within ${JUSTIFY_WITHIN_DAYS} days or return what you do not use.`,
        href: balance,
      }
    }
    if (request.type === 'reimbursement')
      return { title: 'Reimbursement paid', body: `${amount} is back in your Viatik balance.`, href: balance }
    if (request.type === 'work')
      return { title: 'Payment for your work', body: `${amount} is in your Viatik balance.`, href: balance }
  }
  return {
    title: 'Payment completed',
    body: `${amount} to ${recipient} is complete.`,
    href: `/member/${request.agencyId}/requests/${request.id}`,
  }
}

/**
 * The payment id of approved payment for work, taken from its request. Work is
 * paid with the ledger's `pay`, which has no request status to stop a second
 * approval: with one id per request, every Agency Admin who prepares the
 * approval plans the same payment, and the ledger's claim on that id stops the
 * same Admin from paying it twice. The claim is per signer: keeping two Admins
 * from both paying it is up to the server, which can key its check on this id.
 */
export const workPaymentId = (requestId: Id): Id => `pay_${requestId}`

function capture(tx: Tx, request: PaymentRequest) {
  assertTransition('Request', canTransitionRequest, request.status, 'processing')
  request.status = 'processing'
  const budget = tx.find('budgets', request.budgetId, 'Budget')
  const portfolioId = tx.portfolioOfAgency(request.agencyId)
  const paymentId = request.type === 'work' ? workPaymentId(request.id) : newId('pay')
  const recipient: ViatikRecipient =
    request.destination.kind === 'member'
      ? { kind: 'member', userId: request.destination.userId }
      : { kind: 'destination', destinationId: request.destination.destinationId }
  const labels = recipientLabels(tx, request.destination)
  const receipt = tx.receipt({
    kind: 'payment',
    amount: request.amount,
    fromLabel: `${tx.state.accounts.find((a) => a.id === budget.sourceAccountId)?.name ?? 'Account'} · ${budget.name}`,
    toLabel: labels.receipt,
    description: request.purpose,
    policyLabel:
      request.type === 'work'
        ? 'Payment for work · approved by an Agency Admin'
        : `${budget.name} · per-operation limit ${usdText(budget.perOperationLimit)}`,
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
    type: paymentTypeForRequest(request),
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

  // A vendor payment and a reimbursement document a purchase. Money for purchases is justified
  // later with its own receipts (addExpense); payment for work needs none. A request that pays a
  // vendor whatever its type (sent before money for purchases paid the requester) keeps its Expense.
  const requesterUserId = request.requester.kind === 'user' ? request.requester.userId : undefined
  if (requesterUserId && (request.type === 'reimbursement' || request.destination.kind === 'destination')) {
    const reimbursement = request.type === 'reimbursement'
    const expense: Expense = {
      id: newId('exp'),
      agencyId: request.agencyId,
      userId: requesterUserId,
      budgetId: budget.id,
      merchant: (reimbursement && request.merchant) || labels.activity,
      amount: request.amount,
      category: request.category,
      spentAt: reimbursement ? (request.spentAt ?? request.createdAt) : tx.now,
      paymentId,
      receipt: reimbursement ? request.attachments.find((a) => a.kind === 'file') : request.attachments[0],
      createdAt: tx.now,
    }
    tx.state.expenses.push(expense)
  }
  tx.activity(
    'payment_completed',
    `Paid ${usdText(request.amount)} to ${labels.activity}`,
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
    const notice = paidNotice(request, labels.activity)
    tx.notify([requesterUserId], notice.title, notice.body, notice.href)
  }
  return { payment, receipt }
}

/**
 * Agency Admin (or Investor, for exceptions) approves a request that needed a
 * decision. Payment for work is always an Agency Admin's to approve.
 */
export function approveRequest(tx: Tx, input: { requestId: Id }) {
  const request = tx.find('requests', input.requestId, 'Request')
  const byInvestor = isException(tx.state, request)
  tx.authorize('approve_payment', {
    agencyId: request.agencyId,
    createdBy: request.requester,
    isException: byInvestor,
  })
  // Exceptions belong to the Investor of THIS Agency's portfolio, not to anyone
  // who happens to be an Investor somewhere (e.g. of a portfolio they created).
  const portfolioOfRequest = tx.portfolioOfAgency(request.agencyId)
  const isInvestor = tx
    .subject()
    .memberships.some(
      (m) =>
        m.role === 'investor' &&
        m.status === 'active' &&
        m.scope.kind === 'portfolio' &&
        m.scope.portfolioId === portfolioOfRequest,
    )
  if (byInvestor && !isInvestor) {
    throw new DomainError(
      'forbidden',
      'This operation is above the agreement exception threshold. The Investor must approve it.',
    )
  }
  if (request.status !== 'needs_approval')
    throw new DomainError('invalid_state', 'This request does not need a decision.')
  // An Agency Admin pays work from the budget, which the ledger refuses above the
  // exception threshold (it may have been lowered since the request was sent).
  if (request.type === 'work' && aboveExceptionThreshold(tx.state, request)) {
    throw new DomainError(
      'limit_exceeded',
      'Payment for work above the exception threshold cannot be paid. Decline it.',
    )
  }
  const budget = tx.find('budgets', request.budgetId, 'Budget')
  if (budget.status !== 'active')
    throw new DomainError('invalid_state', 'The budget is paused. Resume it before approving.')
  if (request.destination.kind === 'destination')
    requirePayable(tx.find('destinations', request.destination.destinationId, 'Payment destination'))
  // The rules are checked again now, not as they were when the request was
  // sent: other payments may have used the limit since, or the budget changed.
  const requesterName = tx.actorName(request.requester)
  const recheck = policyForHolder(
    tx,
    budget,
    request.requester,
    {
      amount: request.amount,
      category: request.category,
      destinationId: request.destination.kind === 'destination' ? request.destination.destinationId : null,
    },
    requesterName,
  )
  if (recheck.outcome === 'rejected' && recheck.reason) {
    throw new DomainError(
      recheck.reason.rule === 'budget_available' ? 'insufficient_funds' : 'policy_rejected',
      `${recheck.reason.message} The request stays pending until it fits the rules or is declined.`,
    )
  }

  request.status = 'approved'
  request.approvedBy = tx.userId
  request.decidedAt = tx.now
  const portfolioId = tx.portfolioOfAgency(request.agencyId)
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
  return capture(tx, request)
}

export function declineRequest(tx: Tx, input: { requestId: Id; reason: string }) {
  const request = tx.find('requests', input.requestId, 'Request')
  tx.authorize('approve_payment', {
    agencyId: request.agencyId,
    createdBy: request.requester,
    isException: isException(tx.state, request),
  })
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
  /** Money for purchases (an advance) only ever comes from a request. */
  type: Exclude<PaymentType, 'advance'>
  /** A vendor or a person's Viatik balance. Paying an address outside Viatik is payOutside, with its own rules. */
  recipient: ViatikRecipient
  accountId: Id
  budgetId?: Id
  amount: Cents
  category: SpendingCategory
  memo: string
  scheduledFor?: ISODate
  billId?: Id
  batchId?: Id
}

/**
 * An Agency Admin pays a vendor or a person's Viatik balance. With a
 * `scheduledFor` in the future it is scheduled instead (a schedule with one
 * run, `schedulePayment`), and the keeper pays it on Monad when it is due: the
 * result is then the Schedule, not a Payment.
 */
export function sendPayment(tx: Tx, input: SendPaymentInput): Payment | Schedule {
  const { scheduledFor, batchId: _batchId, ...rest } = input
  if (scheduledFor && Date.parse(scheduledFor) > Date.parse(tx.now))
    return schedulePayment(tx, { ...rest, firstRunAt: scheduledFor })
  return payNow(tx, input)
}

/** What `checkAgencyPayment` resolved for a payment that passes. */
export type AgencyPaymentChecks = {
  account: Account
  budget?: Budget
  portfolioId: Id
  recipientName: string
}

/**
 * What a payment an Agency Admin makes must satisfy, paid now, scheduled, or
 * when the keeper runs it: a positive amount; the account (and budget) of this
 * Agency; a payee who is a person in it (never the Admin paying: they request
 * payment for work, which another Agency Admin reviews) or an approved vendor
 * of it; then the ledger's own limits, in its order (a paused budget pays
 * nothing, the budget's per-operation limit and approved vendors, then the
 * Investor's exception threshold). The money available is checked by the caller.
 */
export function checkAgencyPayment(
  tx: Tx,
  input: { agencyId: Id; recipient: ViatikRecipient; accountId: Id; budgetId?: Id; amount: Cents },
): AgencyPaymentChecks {
  requirePositive(input.amount)
  const account = tx.find('accounts', input.accountId, 'Account')
  if (account.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The account belongs to another Agency.')
  const recipient = input.recipient
  if (recipient.kind === 'member') {
    const inAgency = tx.state.memberships.some(
      (m) =>
        m.userId === recipient.userId &&
        m.status === 'active' &&
        m.scope.kind === 'agency' &&
        m.scope.agencyId === input.agencyId,
    )
    if (!inAgency) throw new DomainError('forbidden', 'Payments can only go to people in this Agency.')
    if (tx.actor.kind === 'user' && recipient.userId === tx.actor.userId) {
      throw new DomainError(
        'forbidden',
        'You cannot pay yourself. Request payment for work and another Agency Admin reviews it.',
      )
    }
  } else {
    const destination = tx.find('destinations', recipient.destinationId, 'Payment destination')
    if (destination.agencyId !== input.agencyId)
      throw new DomainError('forbidden', 'This payment destination belongs to another Agency.')
    requirePayable(destination)
  }
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

  const exceptionThreshold = exceptionThresholdOf(tx.state, input.agencyId)
  if (exceptionThreshold !== undefined && input.amount > exceptionThreshold) {
    throw new DomainError(
      'limit_exceeded',
      `Payments above ${usdText(exceptionThreshold)} are exceptions and need the Investor's approval.`,
    )
  }

  const recipientName =
    input.recipient.kind === 'member'
      ? tx.nameOf(input.recipient.userId)
      : (tx.state.destinations.find((d) => d.id === (input.recipient as { destinationId: Id }).destinationId)
          ?.name ?? 'Payment destination')
  return { account, budget, portfolioId, recipientName }
}

/** Pays now: the money moves from the account or budget, with its receipt. */
export function payNow(tx: Tx, input: SendPaymentInput): Payment {
  tx.authorize(input.recipient.kind === 'member' ? 'pay_member' : 'send_payment', {
    agencyId: input.agencyId,
  })
  const { account, budget, portfolioId, recipientName } = checkAgencyPayment(tx, input)
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
    status: 'completed',
    createdBy: tx.actor,
    scheduledFor: tx.now,
    billId: input.billId,
    batchId: input.batchId,
  }

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
  tx.state.payments.push(payment)
  tx.activity(
    'payment_completed',
    `Paid ${usdText(input.amount)} to ${recipientName}`,
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
      'Payment received',
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
  // Authorize before reading any balance: the error below states how much is available.
  tx.authorize('pay_member', { agencyId: input.agencyId })
  if (input.items.length === 0) throw new DomainError('validation', 'Choose at least one team member.')
  const total = sum(input.items, (i) => i.amount)
  const account = tx.find('accounts', input.accountId, 'Account')
  if (account.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The account belongs to another Agency.')
  const budget = input.budgetId ? tx.find('budgets', input.budgetId, 'Budget') : undefined
  if (budget && budget.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The budget belongs to another Agency.')
  const available = budget
    ? budgetUsage(tx.state, budget, tx.now).available
    : accountBalance(tx.state, account.id)
  if (available < total)
    throw new DomainError(
      'insufficient_funds',
      `The team payment totals ${usdText(total)} but only ${usdText(available)} is available.`,
    )
  const batchId = newId('batch')
  return input.items.map((item) =>
    payNow(tx, {
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

/** The payment type an Agency payment gets from its category (bills, payments outside Viatik). */
export function paymentTypeForCategory(category: SpendingCategory): Exclude<PaymentType, 'advance'> {
  return category === 'contractors' ? 'contractor' : category === 'cloud' ? 'vendor' : 'tool'
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
  requirePayable(destination)
  // Paid from a budget, a bill comes out of the budget's own account, and the budget must pay this vendor.
  const budget = input.budgetId ? tx.find('budgets', input.budgetId, 'Budget') : undefined
  if (budget && budget.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'The budget belongs to another Agency.')
  if (
    budget &&
    budget.allowedDestinationIds.length > 0 &&
    !budget.allowedDestinationIds.includes(destination.id)
  ) {
    throw new DomainError('policy_rejected', 'This payment destination is not approved for this budget.')
  }
  // A bill's invoice documents one purchase: it cannot also be a member's receipt or another invoice.
  requireUnusedReceipts(tx, input.agencyId, [input.document])
  const bill: Bill = {
    id: newId('bill'),
    agencyId: input.agencyId,
    destinationId: destination.id,
    number: requireText(input.number, 'Bill number', 40),
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    amount: input.amount,
    category: input.category,
    accountId: budget ? budget.sourceAccountId : input.accountId,
    budgetId: budget?.id,
    status: 'to_pay',
    document: evidenceFrom(input.document, tx.userId, tx.now),
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

/**
 * Pays a bill now, or schedules it for a later date (a schedule with one run
 * that the keeper pays when it is due; a `scheduledFor` less than a minute
 * ahead is refused, not paid now). A bill already scheduled is paid now
 * or rescheduled by cancelling its schedule in the same transaction.
 */
export function payBill(
  tx: Tx,
  input: { billId: Id; accountId?: Id; budgetId?: Id | null; scheduledFor?: ISODate },
): { bill: Bill; payment?: Payment; schedule?: Schedule } {
  const bill = tx.find('bills', input.billId, 'Bill')
  tx.authorize('send_payment', { agencyId: bill.agencyId })
  if (bill.status === 'paid' || bill.status === 'reconciled')
    throw new DomainError('invalid_state', 'This bill is already paid.')
  const destination = tx.find('destinations', bill.destinationId, 'Payment destination')
  requirePayable(destination)
  // Paying or rescheduling a scheduled bill replaces its schedule: nothing was paid for it yet.
  const previous = bill.scheduleId ? tx.state.schedules.find((s) => s.id === bill.scheduleId) : undefined
  if (previous && (previous.status === 'active' || previous.status === 'paused')) {
    tx.authorize('manage_schedules', { agencyId: bill.agencyId })
    stopSchedule(tx, previous)
  }
  const payment = {
    agencyId: bill.agencyId,
    type: paymentTypeForCategory(bill.category),
    recipient: { kind: 'destination', destinationId: destination.id } as const,
    accountId: input.accountId ?? bill.accountId,
    budgetId: input.budgetId === null ? undefined : (input.budgetId ?? bill.budgetId),
    amount: bill.amount,
    category: bill.category,
    memo: `${destination.name} bill ${bill.number}`,
    billId: bill.id,
  }
  // A date always means "schedule it": one too close or already past (a clock behind the
  // server's) is refused by schedulePayment, never paid now behind a "Payment scheduled" screen.
  if (input.scheduledFor) {
    const schedule = schedulePayment(tx, { ...payment, firstRunAt: input.scheduledFor })
    bill.status = 'scheduled'
    bill.scheduleId = schedule.id
    bill.scheduledFor = schedule.nextRunAt
    delete bill.paymentId
    return { bill, schedule }
  }
  const paid = payNow(tx, payment)
  bill.paymentId = paid.id
  bill.status = 'paid'
  delete bill.scheduledFor
  return { bill, payment: paid }
}

/** Links a bill (or expense) to one canonical payment and its evidence. */
export function reconcile(tx: Tx, input: { agencyId: Id; paymentId: Id; billId?: Id; expenseId?: Id }) {
  tx.authorize('reconcile_bill', { agencyId: input.agencyId })
  const payment = tx.find('payments', input.paymentId, 'Payment')
  if (payment.agencyId !== input.agencyId)
    throw new DomainError('forbidden', 'This payment belongs to another Agency.')
  if (payment.type === 'advance') {
    throw new DomainError(
      'invalid_state',
      'Money for purchases is settled with its receipts and returns, not reconciled.',
    )
  }
  if (payment.status !== 'completed' || !payment.receiptId)
    throw new DomainError('invalid_state', 'Only completed payments can be reconciled.')
  if (tx.state.reconciliations.some((r) => r.paymentId === payment.id)) {
    throw new DomainError('invalid_state', 'This payment is already reconciled.')
  }
  const evidenceIds: Id[] = []
  let label = 'payment'
  if (input.billId) {
    const bill = tx.find('bills', input.billId, 'Bill')
    if (bill.agencyId !== input.agencyId)
      throw new DomainError('forbidden', 'This bill belongs to another Agency.')
    if (bill.amount !== payment.amount)
      throw new DomainError(
        'validation',
        `The bill is ${usdText(bill.amount)} but the payment is ${usdText(payment.amount)}.`,
      )
    // The payment must be the one that paid this vendor for this bill.
    const toVendor =
      payment.recipient.kind === 'destination' && payment.recipient.destinationId === bill.destinationId
    if (!toVendor) throw new DomainError('validation', 'This payment did not go to the vendor on the bill.')
    if ((payment.billId && payment.billId !== bill.id) || (bill.paymentId && bill.paymentId !== payment.id)) {
      throw new DomainError('validation', 'This payment belongs to another bill.')
    }
    bill.status = 'reconciled'
    bill.paymentId = payment.id
    evidenceIds.push(bill.document.id)
    label = `${tx.state.destinations.find((d) => d.id === bill.destinationId)?.name ?? 'Vendor'} bill ${bill.number}`
  }
  if (input.expenseId) {
    const expense = tx.find('expenses', input.expenseId, 'Expense')
    if (expense.agencyId !== input.agencyId)
      throw new DomainError('forbidden', 'This expense belongs to another Agency.')
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

/**
 * A receipt that justifies money the person requested for purchases (an
 * advance), added in one step: what they bought, for how much, when, and the
 * receipt itself. To get money back for something paid with their own money,
 * a person sends a reimbursement request instead.
 */
export function addExpense(
  tx: Tx,
  input: {
    agencyId: Id
    /** The member's own completed advance this expense justifies (required). */
    paymentId: Id
    merchant: string
    amount: Cents
    category: SpendingCategory
    spentAt: ISODate
    /** Required, kind 'file'. */
    receipt: EvidenceDraft
  },
): Expense {
  tx.authorize('upload_receipt', { agencyId: input.agencyId, ownerUserId: tx.userId })
  requirePositive(input.amount)
  const advance = requireOwnAdvance(tx, input.paymentId, input.agencyId)
  requireFileReceipt(input.receipt)
  const merchant = requireText(input.merchant, 'Merchant', 80)
  if (!advance.budgetId) throw new DomainError('invalid_state', 'This money did not come from a budget.')
  const budget = tx.find('budgets', advance.budgetId, 'Budget')
  if (budget.allowedCategories.length > 0 && !budget.allowedCategories.includes(input.category))
    throw new DomainError('validation', `This category is not an approved use of ${budget.name}.`)
  requireNotFuture(input.spentAt, tx.now)
  // What was bought before the money was requested is not what this money paid for.
  const requestedAt =
    tx.state.requests.find((r) => r.id === advance.requestId)?.createdAt ?? advance.scheduledFor
  if (Date.parse(input.spentAt) < Date.parse(dayWindow(requestedAt).start))
    throw new DomainError('validation', 'The receipt is dated before you requested this money.')
  // A file the person attached when requesting this same money (an invoice, a quote) may justify it:
  // that request's files do not count as used here. Every other use still does.
  requireUnusedReceipts(tx, input.agencyId, [input.receipt], advance.requestId)
  // Only what is still pending can be justified: more than that is a reimbursement.
  const { pending } = advanceStanding(tx.state, advance, tx.now)
  if (input.amount > pending) {
    throw new DomainError(
      'limit_exceeded',
      pending > 0
        ? `You can add up to ${usdText(pending)} to this advance. For more, request a reimbursement.`
        : 'This advance is already justified. For more, request a reimbursement.',
    )
  }
  const receipt = evidenceFrom(input.receipt, tx.userId, tx.now)
  const expense: Expense = {
    id: newId('exp'),
    agencyId: input.agencyId,
    userId: tx.userId,
    budgetId: budget.id,
    merchant,
    amount: input.amount,
    category: input.category,
    spentAt: input.spentAt,
    paymentId: advance.id,
    receipt,
    createdAt: tx.now,
  }
  tx.state.expenses.push(expense)
  receiptAdded(tx, expense)
  return expense
}

/** Adds the receipt to an expense that has none yet (a vendor payment's, for example). Once only. */
export function attachReceipt(tx: Tx, input: { expenseId: Id; receipt: EvidenceDraft }) {
  const expense = tx.find('expenses', input.expenseId, 'Expense')
  tx.authorize('upload_receipt', { agencyId: expense.agencyId, ownerUserId: expense.userId })
  // A receipt, once attached, may already back a reconciliation: it is never replaced.
  if (expense.receipt) throw new DomainError('invalid_state', 'This expense already has a receipt.')
  requireFileReceipt(input.receipt)
  // The request that paid this expense documents the same purchase: its files do not count as used.
  const paidBy = expense.paymentId
    ? tx.state.requests.find((r) => r.agencyId === expense.agencyId && r.paymentId === expense.paymentId)
    : undefined
  requireUnusedReceipts(tx, expense.agencyId, [input.receipt], paidBy?.id)
  expense.receipt = evidenceFrom(input.receipt, tx.userId, tx.now)
  receiptAdded(tx, expense)
  return expense
}

/**
 * The person's own money for purchases (an advance) in this Agency: the only
 * money they justify with receipts or give back unused.
 */
function requireOwnAdvance(tx: Tx, paymentId: Id, agencyId: Id) {
  const payment = tx.find('payments', paymentId, 'Payment')
  if (payment.agencyId !== agencyId)
    throw new DomainError('forbidden', 'This payment belongs to another Agency.')
  if (!isAdvance(payment) || payment.recipient.userId !== tx.userId)
    throw new DomainError('forbidden', 'This is not money you requested for purchases.')
  return payment
}

/** A receipt is an uploaded file: a link or a note cannot be proven later. */
function requireFileReceipt(receipt: EvidenceDraft | undefined) {
  if (receipt?.kind !== 'file') throw new DomainError('validation', 'Attach the receipt.')
}

/** Requests whose attachments no longer back any money. */
const CLOSED_REQUESTS: ReadonlySet<PaymentRequest['status']> = new Set<PaymentRequest['status']>([
  'declined',
  'cancelled',
  'rejected',
])

/**
 * A receipt justifies money once per Agency: a file (by its fingerprint) already
 * on one of its expenses, attached to one of its requests that is still in play
 * (not declined, cancelled or rejected), or the invoice of one of its outside
 * payments, cannot back other money. Only new files are checked, when a person
 * adds them: to a request of any type, to an expense, or as an expense's
 * receipt. `exceptRequestId` is the request that paid the money being
 * justified: its own files document the same purchase, so they are not a
 * second use (a paid reimbursement's receipt that becomes its Expense's, an
 * invoice attached when requesting money for purchases).
 */
export function requireUnusedReceipts(tx: Tx, agencyId: Id, drafts: EvidenceDraft[], exceptRequestId?: Id) {
  const fingerprints = new Set(
    drafts.flatMap((draft) => (draft.kind === 'file' && draft.sha256 ? [draft.sha256] : [])),
  )
  if (fingerprints.size === 0) return
  const onExpense = tx.state.expenses.some(
    (e) => e.agencyId === agencyId && e.receipt !== undefined && fingerprints.has(e.receipt.sha256),
  )
  const onRequest = tx.state.requests.some(
    (r) =>
      r.agencyId === agencyId &&
      r.id !== exceptRequestId &&
      !CLOSED_REQUESTS.has(r.status) &&
      r.attachments.some((a) => fingerprints.has(a.sha256)),
  )
  const onOutsidePayment = tx.state.payments.some(
    (p) => p.agencyId === agencyId && p.proof !== undefined && fingerprints.has(p.proof.sha256),
  )
  const onBill = tx.state.bills.some((b) => b.agencyId === agencyId && fingerprints.has(b.document.sha256))
  if (onExpense || onRequest || onOutsidePayment || onBill)
    throw new DomainError('validation', 'This file was already used as a receipt or invoice.')
}

/** A date a person picked is not in the future: anything up to the end of today (UTC) is fine. */
function requireNotFuture(date: ISODate, now: ISODate) {
  const time = Date.parse(date)
  if (Number.isNaN(time)) throw new DomainError('validation', 'Enter a valid date.')
  if (time >= Date.parse(dayWindow(now).end))
    throw new DomainError('validation', 'Pick a date that is not in the future.')
}

/** A receipt reached an expense: it shows in activity and the Agency Admins hear about it. */
function receiptAdded(tx: Tx, expense: Expense) {
  const summary = `${usdText(expense.amount)} receipt from ${expense.merchant}`
  tx.activity(
    'receipt_added',
    `Added a ${summary}`,
    { kind: 'expense', id: expense.id },
    {
      portfolioId: tx.portfolioOfAgency(expense.agencyId),
      agencyId: expense.agencyId,
      amount: expense.amount,
      subjectUserId: expense.userId,
    },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: expense.agencyId }),
    'Receipt uploaded',
    `${tx.actorName()} added a ${summary}.`,
    `/agency/${expense.agencyId}/team/${expense.userId}`,
  )
}

export function addDestination(
  tx: Tx,
  input: {
    agencyId: Id
    name: string
    kind: 'vendor' | 'service' | 'contractor'
    category: SpendingCategory
    /** Optional: a note for people, such as a customer number. */
    settlementLabel?: string
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
    settlementLabel: paymentReference(input.settlementLabel),
    website: input.website?.trim() || undefined,
    status: 'approved' as const,
    addedAt: tx.now,
  }
  tx.state.destinations.push(destination)
  return destination
}

/** A provider's payment reference is optional: an empty text leaves it (or makes it) empty. */
function paymentReference(value: string | undefined): string {
  return value?.trim() ? requireText(value, 'Payment reference', 80) : ''
}

/** A destination can only be paid while it is approved: a paused or archived one is not. */
function requirePayable(destination: { name: string; status: string }) {
  if (destination.status === 'approved') return
  const why =
    destination.status === 'paused'
      ? 'is paused. Resume it to pay it again.'
      : destination.status === 'archived'
        ? 'is archived. Restore it to pay it again.'
        : 'is still waiting for review.'
  throw new DomainError('invalid_state', `${destination.name} ${why}`)
}

/** What a person holds in an agency (kept here for existing imports; it lives in selectors). */
export { memberHeld }

/**
 * A Member sends money they received but no longer need back to the Agency.
 * The person always says what they are returning:
 * - With `paymentId`, the unused rest of money they requested for purchases
 *   (an advance): the return settles that much of it, up to what can be
 *   returned of it (`returnableFor`: its pending part, within their Viatik
 *   balance).
 * - Without `paymentId`, "Other money": a plain return that settles no
 *   advance. It is capped by `otherMoneyReturnable` (their Viatik balance
 *   beyond what their open advances still have pending), so unused money for
 *   purchases is returned against its own advance and never leaves while that
 *   advance stays pending. Nothing is linked automatically.
 */
export function returnUnusedFunds(tx: Tx, input: { agencyId: Id; amount: Cents; paymentId?: Id }) {
  tx.authorize('receive_payout', { agencyId: input.agencyId, ownerUserId: tx.userId })
  requirePositive(input.amount)
  const memberLocation = { kind: 'recipient', recipient: { kind: 'member', userId: tx.userId } } as const
  const advance = input.paymentId ? requireOwnAdvance(tx, input.paymentId, input.agencyId) : undefined
  if (advance) {
    const standing = advanceStanding(tx.state, advance, tx.now)
    if (standing.pending === 0)
      throw new DomainError('invalid_state', 'This money is already justified: nothing is left to return.')
    // Money already withdrawn from the Viatik balance can only be justified with receipts.
    const returnable = returnableFor(tx.state, standing)
    if (input.amount > returnable) {
      throw returnable < standing.pending
        ? new DomainError(
            'insufficient_funds',
            `You can return up to ${usdText(returnable)}, what is left in your Viatik balance. Add receipts for the rest.`,
          )
        : new DomainError('limit_exceeded', `You can return up to ${usdText(returnable)} of this money.`)
    }
  } else {
    const held = clampToZero(cents(memberHeld(tx.state, input.agencyId, tx.userId)))
    const otherMoney = otherMoneyReturnable(tx.state, { agencyId: input.agencyId, userId: tx.userId }, tx.now)
    if (input.amount > otherMoney) {
      // Open money for purchases keeps part of the balance: that part goes back against its advance.
      if (otherMoney < held) {
        throw new DomainError(
          'limit_exceeded',
          otherMoney > 0
            ? `Return it against your money for purchases first. You can return up to ${usdText(otherMoney)} as other money.`
            : 'Choose which money for purchases you are returning.',
        )
      }
      throw new DomainError(
        'insufficient_funds',
        `You can return up to ${usdText(held)} received from this Agency.`,
      )
    }
  }
  const operations = activeOperationsAccount(tx.state, input.agencyId)
  if (!operations) throw new DomainError('not_found', 'The Agency has no operations account.')
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const operationId = newId('ret')
  const name = tx.nameOf(tx.userId)
  const receipt = tx.receipt({
    kind: 'transfer',
    amount: input.amount,
    fromLabel: name,
    toLabel: operations.name,
    description: advance ? `Unused money returned · ${advance.memo}` : 'Unused funds returned to the Agency',
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
    {
      portfolioId,
      agencyId: input.agencyId,
      refId: operationId,
      receiptId: receipt.id,
      // Only a return of money for purchases settles it (and carries the key).
      ...(advance ? { settlesPaymentId: advance.id } : {}),
    },
  )
  if (advance) {
    tx.activity(
      'advance_returned',
      `${name} returned ${usdText(input.amount)} unused from ${advance.memo}`,
      { kind: 'receipt', id: receipt.id },
      { portfolioId, agencyId: input.agencyId, amount: input.amount, subjectUserId: tx.userId },
    )
    tx.notify(
      tx.holders('agency_admin', { agencyId: input.agencyId }),
      'Unused money returned',
      `${name} returned ${usdText(input.amount)} unused from ${advance.memo} to ${operations.name}.`,
      `/agency/${input.agencyId}/team/${tx.userId}`,
    )
    return receipt
  }
  tx.activity(
    'funds_transferred',
    `${name} returned ${usdText(input.amount)} of unused funds`,
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
    `${name} returned ${usdText(input.amount)} to ${operations.name}.`,
    `/agency/${input.agencyId}/accounts/${operations.id}`,
  )
  return receipt
}

/**
 * A person takes what an Agency paid them out of their Viatik balance, to their
 * account or another address. It only touches their own balance.
 */
export function withdrawBalance(tx: Tx, input: { agencyId: Id; amount: Cents; to: string }) {
  tx.authorize('receive_payout', { agencyId: input.agencyId, ownerUserId: tx.userId })
  requirePositive(input.amount)
  const address = parseAddress(input.to)
  if (!address)
    throw new DomainError('validation', 'Enter a valid account address (0x followed by 40 characters).')
  const held = memberHeld(tx.state, input.agencyId, tx.userId)
  if (input.amount > held) {
    throw new DomainError(
      'insufficient_funds',
      `You can withdraw up to ${usdText(cents(Math.max(0, held)))} from this Agency.`,
    )
  }
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const operationId = newId('wd')
  const receipt = tx.receipt({
    kind: 'withdrawal',
    amount: input.amount,
    fromLabel: tx.nameOf(tx.userId),
    toLabel: shortAddress(address),
    description: 'Balance withdrawn to an account',
    policyLabel: 'A withdrawal only takes your own balance',
    operationId,
    portfolioId,
    agencyId: input.agencyId,
  })
  tx.move(
    'withdrawal',
    input.amount,
    { kind: 'recipient', recipient: { kind: 'member', userId: tx.userId } },
    { kind: 'external', label: shortAddress(address), address },
    { portfolioId, agencyId: input.agencyId, refId: operationId, receiptId: receipt.id },
  )
  tx.activity(
    'funds_withdrawn',
    `${tx.nameOf(tx.userId)} withdrew ${usdText(input.amount)}`,
    { kind: 'receipt', id: receipt.id },
    { portfolioId, agencyId: input.agencyId, amount: input.amount, subjectUserId: tx.userId },
  )
  // The Agency Admins hear about it, but never where it went: the address stays the person's.
  tx.notify(
    tx.holders('agency_admin', { agencyId: input.agencyId }),
    'Balance withdrawn',
    `${tx.nameOf(tx.userId)} sent ${usdText(input.amount)} from their Viatik balance.`,
    `/agency/${input.agencyId}/team/${tx.userId}`,
  )
  return receipt
}

const MAX_PAYOUT_ADDRESSES = 10

/** A person saves an address to send their money to. Their Agency Admins can see it. */
export function addPayoutAddress(tx: Tx, input: { label: string; address: string }): PayoutAddress {
  const userId = tx.userId
  const address = parseAddress(input.address)
  if (!address)
    throw new DomainError('validation', 'Enter a valid account address (0x followed by 40 characters).')
  const saved = tx.state.payoutAddresses.filter((a) => a.userId === userId)
  if (saved.some((a) => a.address === address))
    throw new DomainError('invalid_state', 'You already saved this address.')
  if (saved.length >= MAX_PAYOUT_ADDRESSES)
    throw new DomainError('limit_exceeded', `You can save up to ${MAX_PAYOUT_ADDRESSES} addresses.`)
  const record: PayoutAddress = {
    id: newId('addr'),
    userId,
    label: requireText(input.label, 'Label', 40),
    address,
    createdAt: tx.now,
  }
  tx.state.payoutAddresses.push(record)
  return record
}

export function removePayoutAddress(tx: Tx, input: { addressId: Id }) {
  const record = tx.find('payoutAddresses', input.addressId, 'Saved address')
  if (record.userId !== tx.userId) throw new DomainError('forbidden', 'This address is not yours.')
  tx.state.payoutAddresses = tx.state.payoutAddresses.filter((a) => a.id !== record.id)
  return record
}

/** An Agency Admin edits a payment destination (vendor, service or contractor). */
export function updateDestination(
  tx: Tx,
  input: {
    destinationId: Id
    name?: string
    kind?: 'vendor' | 'service' | 'contractor'
    category?: SpendingCategory
    /** The payment reference; an empty text removes it. */
    settlementLabel?: string
    /** An empty text removes it. */
    website?: string
  },
) {
  const destination = tx.find('destinations', input.destinationId, 'Payment destination')
  tx.authorize('send_payment', { agencyId: destination.agencyId })
  if (input.name !== undefined) destination.name = requireText(input.name, 'Name', 80)
  if (input.kind !== undefined) destination.kind = input.kind
  if (input.category !== undefined) destination.category = input.category
  if (input.settlementLabel !== undefined)
    destination.settlementLabel = paymentReference(input.settlementLabel)
  if (input.website !== undefined) destination.website = input.website.trim() || undefined
  tx.activity(
    'destination_updated',
    `Updated ${destination.name}`,
    { kind: 'destination', id: destination.id },
    { portfolioId: tx.portfolioOfAgency(destination.agencyId), agencyId: destination.agencyId },
  )
  return destination
}

/** Pauses, archives or restores a payment destination. Only an approved one can be paid. */
export function setDestinationStatus(
  tx: Tx,
  input: { destinationId: Id; status: 'approved' | 'paused' | 'archived' },
) {
  const destination = tx.find('destinations', input.destinationId, 'Payment destination')
  tx.authorize('send_payment', { agencyId: destination.agencyId })
  if (destination.status === input.status)
    throw new DomainError('invalid_state', `${destination.name} is already ${input.status}.`)
  const previous = destination.status
  destination.status = input.status
  const verb =
    input.status === 'paused'
      ? 'Paused'
      : input.status === 'archived'
        ? 'Archived'
        : previous === 'paused'
          ? 'Resumed'
          : 'Restored'
  tx.activity(
    'destination_updated',
    `${verb} ${destination.name}`,
    { kind: 'destination', id: destination.id },
    { portfolioId: tx.portfolioOfAgency(destination.agencyId), agencyId: destination.agencyId },
  )
  return destination
}

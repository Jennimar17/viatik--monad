import { attachmentsHash, decisionHash } from '@/domain/evidence'
import { ZERO, type Cents } from '@/domain/money'
import type {
  Actor,
  Budget,
  Id,
  Membership,
  Movement,
  PaymentRequest,
  PolicyRuleId,
  SpendingAllowance,
  VerifiedDetails,
  ViatikState,
} from '@/domain/types'
import type {
  LedgerError,
  LedgerErrorCode,
  LedgerOp,
  LedgerRecord,
  PlannedRecord,
  RecordEnd,
  SettlementPlan,
  SettlementResult,
} from '@/ledger/types'

/**
 * Bridge between domain commands and the ledger. The engine decides what a
 * command means for the product; the plan says what the ledger has to record
 * for it, as data: the same plan runs on the mock ledger, and step 8.2 encodes
 * it as one Monad transaction. A ledger rejection is authoritative.
 *
 * The plan is the difference between the state before and after the command,
 * so nested effects (an Operations account opened on acceptance, allowances
 * created with a budget, cascades of a revocation) are settled too, and every
 * money movement is either settled or reported as uncovered.
 */

/**
 * Budget rules the settlement contract enforces itself, with the error it
 * records. A request rejected for any other rule never reaches the ledger.
 */
export const LEDGER_RULES: ReadonlyMap<PolicyRuleId, LedgerErrorCode> = new Map([
  ['budget_active', 'budget_paused'],
  ['destination_allowed', 'destination_not_allowed'],
  ['per_operation_limit', 'limit_exceeded'],
  ['budget_available', 'insufficient_funds'],
])

/**
 * The payment id a request reserves when it is not paid at once. The ledger
 * only uses it if it pays anyway; then the record has a known id, never zero.
 */
export const reservedPaymentId = (requestId: Id) => `${requestId}:payment`

type PlanArgs = {
  before: ViatikState
  after: ViatikState
  actor: Actor
}

export function planSettlement({ before, after, actor }: PlanArgs): SettlementPlan | null {
  const signerUserId = actor.kind === 'user' ? actor.userId : null
  const newMovements = added(before.movements, after.movements)
  // Automations and the system have no account to sign with: their money stays offchain (demo).
  if (!signerUserId) {
    return newMovements.length > 0
      ? { ops: [], records: [], signerUserId, keepOnFailure: false, uncovered: newMovements.map((m) => m.id) }
      : null
  }

  const ops: LedgerOp[] = []
  const records: PlannedRecord[] = []
  const push = (op: LedgerOp, record?: PlannedRecord) => {
    ops.push(op)
    if (record) records.push(record)
  }
  let refusal: LedgerError | undefined
  let keepOnFailure = false
  /** What the engine changed that no operation settles: the Monad ledger refuses the plan. */
  const uncovered: Id[] = []
  /** Payments a request operation already settles (paid at once, or approved). */
  const settledPayments = new Set<Id>()

  // 1. New portfolios. Opening one makes the signer its Investor, so that membership needs no join.
  const newPortfolios = new Set<Id>()
  for (const portfolio of added(before.portfolios, after.portfolios)) {
    const vault = after.vaults.find((v) => v.kind === 'portfolio' && v.portfolioId === portfolio.id)
    if (!vault) {
      uncovered.push(portfolio.id)
      continue
    }
    newPortfolios.add(portfolio.id)
    push({ call: 'createPortfolio', portfolioId: portfolio.id, vaultId: vault.id })
  }

  // 2. New agencies, with the funding vault they start with.
  const knownVaults = new Set(before.vaults.map((v) => v.id))
  for (const agency of added(before.agencies, after.agencies)) {
    const vault = after.vaults.find(
      (v) => v.kind === 'funding' && v.agencyId === agency.id && !knownVaults.has(v.id) && !v.agreementId,
    )
    if (!vault) {
      uncovered.push(agency.id)
      continue
    }
    push({
      call: 'registerAgency',
      agencyId: agency.id,
      portfolioId: agency.portfolioId,
      fundingVaultId: vault.id,
    })
  }

  // 3. Roles granted (accepting an invitation).
  const { granted, revoked } = membershipChanges(before.memberships, after.memberships)
  for (const membership of granted) {
    const implicit =
      membership.role === 'investor' &&
      membership.scope.kind === 'portfolio' &&
      newPortfolios.has(membership.scope.portfolioId) &&
      membership.userId === signerUserId
    if (!implicit)
      push({ call: 'join', scope: membership.scope, role: membership.role, userId: membership.userId })
  }

  // 4. New accounts (an Operations account may be opened as a side effect).
  for (const account of added(before.accounts, after.accounts)) {
    push({
      call: 'createAccount',
      accountId: account.id,
      agencyId: account.agencyId,
      isOperations: account.template === 'operations',
    })
  }

  // 5. New agreements, bound to their funding vault (new, or the agency's unbound one).
  for (const agreement of added(before.agreements, after.agreements)) {
    const vault = after.vaults.find((v) => v.kind === 'funding' && v.agreementId === agreement.id)
    if (!vault) {
      uncovered.push(agreement.id)
      continue
    }
    push({
      call: 'createAgreement',
      agreementId: agreement.id,
      agencyId: agreement.agencyId,
      vaultId: vault.id,
      committed: agreement.committed,
      exceptionThreshold: agreement.spendingPolicy.exceptionThreshold,
      tranches: after.tranches
        .filter((t) => t.agreementId === agreement.id)
        .sort((a, b) => a.index - b.index)
        .map((t) => ({ trancheId: t.id, amount: t.amount, milestone: Boolean(t.milestoneId) })),
    })
  }

  // 6. Agreement status.
  for (const [previous, next] of changed(before.agreements, after.agreements)) {
    if (previous.status === 'pending_acceptance' && next.status === 'active')
      push({ call: 'acceptAgreement', agreementId: next.id })
    else if (previous.status === 'active' && next.status === 'paused')
      push({ call: 'setAgreementPaused', agreementId: next.id, paused: true })
    else if (previous.status === 'paused' && next.status === 'active')
      push({ call: 'setAgreementPaused', agreementId: next.id, paused: false })
  }

  // 7. New budgets, with their first allocation (recorded under the budget id).
  const newBudgets = new Set<Id>()
  for (const budget of added(before.budgets, after.budgets)) {
    newBudgets.add(budget.id)
    const allocation = newMovements
      .filter(
        (m) =>
          m.kind === 'allocate' &&
          m.to.kind === 'budget' &&
          m.to.budgetId === budget.id &&
          m.refId === budget.id,
      )
      .reduce((total, m) => total + m.amount, 0) as Cents
    push(
      {
        call: 'createBudget',
        budgetId: budget.id,
        sourceAccountId: budget.sourceAccountId,
        perOperationLimit: budget.perOperationLimit,
        approvalThreshold: budget.approvalThreshold,
        allowedDestinationIds: budget.allowedDestinationIds,
        allocation,
      },
      allocation > 0
        ? record(budget.id, 'allocation', allocation, { id: budget.sourceAccountId }, { id: budget.id })
        : undefined,
    )
  }

  // 8. Budget rules the contract copies, and pauses. Period, categories and dates stay offchain.
  for (const [previous, next] of changed(before.budgets, after.budgets)) {
    if (
      previous.perOperationLimit !== next.perOperationLimit ||
      previous.approvalThreshold !== next.approvalThreshold ||
      !sameSet(previous.allowedDestinationIds, next.allowedDestinationIds)
    ) {
      push({
        call: 'updateRules',
        budgetId: next.id,
        perOperationLimit: next.perOperationLimit,
        approvalThreshold: next.approvalThreshold,
        allowedDestinationIds: next.allowedDestinationIds,
      })
    }
    if (isPaused(previous) !== isPaused(next))
      push({ call: 'setBudgetPaused', budgetId: next.id, paused: isPaused(next) })
  }

  // 9. Spending access of people (automations stay offchain). A person whose
  // membership ends in this command loses access onchain with the role.
  const leaving = new Set(
    revoked.filter((m) => m.scope.kind === 'agency').map((m) => `${scopeOf(m)}:${m.userId}`),
  )
  const accessBefore = memberAccess(before.allowances)
  const accessAfter = memberAccess(after.allowances)
  for (const [budgetId, userId] of accessKeys(accessBefore, accessAfter)) {
    const previous = accessBefore.get(budgetId)?.get(userId)
    const next = accessAfter.get(budgetId)?.get(userId)
    if (previous === next) continue
    const budget = after.budgets.find((b) => b.id === budgetId)
    if (!budget || leaving.has(`${budget.agencyId}:${userId}`)) continue
    push({
      call: 'setAllowance',
      budgetId,
      userId,
      active: next !== undefined,
      perOperationLimit: next ?? ZERO,
    })
  }

  // 10. Roles revoked. Before closing requests: an Investor may only close a stale one.
  for (const membership of revoked)
    push({ call: 'revokeRole', scope: membership.scope, userId: membership.userId })

  // 11. Tranche requests and milestone reviews. Releases come with their money movement.
  for (const [previous, next] of changed(before.tranches, after.tranches)) {
    if (next.status === 'under_review' && previous.status !== 'under_review') {
      const milestone = next.milestoneId ? after.milestones.find((m) => m.id === next.milestoneId) : undefined
      if (!next.destinationAccountId) {
        uncovered.push(next.id)
        continue
      }
      push({
        call: 'requestTranche',
        trancheId: next.id,
        accountId: next.destinationAccountId,
        evidenceHash: milestone?.evidenceHash ?? null,
      })
    } else if (
      previous.status === 'under_review' &&
      next.milestoneId &&
      (next.status === 'available' || next.status === 'rejected')
    ) {
      push({ call: 'requestChanges', trancheId: next.id, reject: next.status === 'rejected' })
    }
  }

  // 12. Payment requests: new ones, approvals and closings. Requests of
  // automations never reach the ledger; their money stays uncovered.
  for (const request of added(before.requests, after.requests)) {
    if (request.requester.kind !== 'user') continue
    const base = requestCall(request)
    if (request.status === 'rejected') {
      // The rejection stays in the history and is the answer, whether the ledger records it or not.
      keepOnFailure = true
      const rule = request.decision.reason?.rule
      // The ledger records a rejection for its own rules, and only from someone
      // with spending access: without it, the contract refuses before checking.
      const hasAccess = request.decision.checks.some((c) => c.rule === 'holder_has_access' && c.passed)
      const recorded = rule && hasAccess ? LEDGER_RULES.get(rule) : undefined
      refusal = {
        code: recorded ?? 'policy_rejected',
        message: request.decision.reason?.message ?? 'This request is outside the budget rules.',
        retryable: false,
      }
      if (recorded) {
        push(
          { ...base, paymentId: reservedPaymentId(request.id), expected: 'rejected' },
          requestRecord(request, request.id, 'payment_rejected'),
        )
      }
    } else if (request.status === 'needs_approval') {
      push(
        { ...base, paymentId: reservedPaymentId(request.id), expected: 'pending' },
        requestRecord(request, request.id, 'payment_pending'),
      )
    } else if (request.paymentId) {
      settledPayments.add(request.paymentId)
      push(
        { ...base, paymentId: request.paymentId, expected: 'executed' },
        requestRecord(request, request.paymentId, 'payment'),
      )
    }
  }
  for (const [previous, next] of changed(before.requests, after.requests)) {
    if (previous.status !== 'needs_approval' || next.requester.kind !== 'user') continue
    if (next.status === 'declined' || next.status === 'cancelled') {
      push({ call: 'closeRequest', requestId: next.id })
    } else if (next.paymentId) {
      settledPayments.add(next.paymentId)
      push(
        { call: 'approvePayment', requestId: next.id, paymentId: next.paymentId },
        requestRecord(next, next.paymentId, 'payment'),
      )
    }
  }

  // 13. Money movements, in the order the engine made them.
  for (const movement of newMovements) {
    const settled = movementCall(movement, after, signerUserId, newBudgets, settledPayments)
    if (settled === 'settled') continue
    if (settled) push(settled.op, settled.record)
    else uncovered.push(movement.id)
  }

  if (ops.length === 0 && !refusal && uncovered.length === 0) return null
  return { ops, records, signerUserId, keepOnFailure, ...(refusal ? { refusal } : {}), uncovered }
}

/**
 * Writes what the ledger recorded onto the state the command produced, after
 * every settlement (the mock now, Monad's confirm in step 8.3): the verified
 * details of the command's receipts, of a payment request (also a rejected
 * one) and of a tranche request. A request refused before the ledger gets no
 * ledger record, so no screen can say the ledger refused it.
 *
 * It changes `after` in place, so a command's result (which points into it)
 * carries the same details.
 */
export function applySettlement(
  before: ViatikState,
  after: ViatikState,
  plan: SettlementPlan,
  result: SettlementResult,
): void {
  const planned = new Map(plan.records.map((record) => [record.opId, record]))
  const recorded = (opId: Id, call: LedgerRecord['call']) =>
    result.records.find((record) => record.opId === opId && record.call === call)

  // Receipts keep the product's policy wording; the rest is the ledger's.
  const known = new Set(before.receipts.map((r) => r.id))
  for (const receipt of after.receipts) {
    if (known.has(receipt.id)) continue
    const record = result.records.find((r) => r.opId === receipt.operationId && r.call !== 'requestTranche')
    if (!record) continue
    receipt.verified = {
      ...record.verified,
      contractPolicy: receipt.verified.contractPolicy,
      ...fingerprints(planned.get(record.opId)),
    }
  }

  for (const op of plan.ops) {
    if (op.call === 'requestPayment') {
      const request = after.requests.find((r) => r.id === op.requestId)
      const record = recorded(op.requestId, 'requestPayment') ?? recorded(op.paymentId, 'requestPayment')
      if (!request || !record) continue
      const receipt = after.receipts.find((r) => r.operationId === record.opId)
      // The rule that decided it, as the request shows it; the ledger's own words if it
      // rejected for another reason (its state can differ from the app's).
      const rule = request.decision.reason?.rule
      const sameReason = !record.reason || (rule !== undefined && LEDGER_RULES.get(rule) === record.reason)
      request.ledger = {
        ...record.verified,
        contractPolicy: sameReason
          ? (request.decision.reason?.message ?? receipt?.policyLabel ?? record.verified.contractPolicy)
          : record.verified.contractPolicy,
        outcome: record.outcome,
        reason: record.reason ? { code: record.reason, limit: record.limit } : undefined,
        ...fingerprints(planned.get(record.opId)),
      }
    }
    if (op.call === 'requestTranche') {
      const record = recorded(op.trancheId, 'requestTranche')
      const tranche = after.tranches.find((t) => t.id === op.trancheId)
      if (!record || !tranche) continue
      const details: VerifiedDetails = {
        ...record.verified,
        contractPolicy: tranche.milestoneId
          ? 'Milestone evidence fingerprinted · the Investor reviews it before releasing'
          : 'Requested by the Agency · the Investor approves the release',
        evidenceHash: op.evidenceHash ?? undefined,
      }
      tranche.requestVerified = details
      const milestone = tranche.milestoneId
        ? after.milestones.find((m) => m.id === tranche.milestoneId)
        : undefined
      if (milestone) milestone.submissionVerified = details
    }
  }
}

/** The fingerprint a record carries: a payment's documents, or the decision behind a release. */
function fingerprints(record: PlannedRecord | undefined): Partial<VerifiedDetails> {
  if (!record) return {}
  if (record.kind === 'tranche_release')
    return record.evidenceHash ? { decisionHash: record.evidenceHash } : {}
  if (record.kind === 'payment' || record.kind === 'payment_pending' || record.kind === 'payment_rejected')
    return { evidenceHash: record.evidenceHash }
  return {}
}

/**
 * The ledger operation that settles a money movement, with what the ledger
 * records for it; `settled` when another operation already does; null when
 * none can.
 */
function movementCall(
  movement: Movement,
  after: ViatikState,
  signerUserId: Id,
  newBudgets: ReadonlySet<Id>,
  settledPayments: ReadonlySet<Id>,
): { op: LedgerOp; record: PlannedRecord } | 'settled' | null {
  const { from, to, refId, amount } = movement
  if (!refId) return null
  switch (movement.kind) {
    case 'deposit':
      if (to.kind !== 'vault') return null
      return {
        op: { call: 'deposit', opId: refId, portfolioId: movement.portfolioId, vaultId: to.vaultId, amount },
        record: record(refId, 'deposit', amount, null, { id: to.vaultId }),
      }
    case 'fund_agreement':
      if (from.kind !== 'vault' || to.kind !== 'vault' || !movement.agreementId) return null
      return {
        op: {
          call: 'fundAgreement',
          opId: refId,
          agreementId: movement.agreementId,
          portfolioVaultId: from.vaultId,
          amount,
        },
        record: record(refId, 'funding', amount, { id: from.vaultId }, { id: to.vaultId }),
      }
    case 'release_tranche': {
      const tranche = after.tranches.find((t) => t.id === refId)
      if (!tranche || from.kind !== 'vault' || to.kind !== 'account') return null
      const milestone = tranche.milestoneId
        ? after.milestones.find((m) => m.id === tranche.milestoneId)
        : undefined
      const decision = milestone ? decisionHash(milestone) : null
      return {
        op: { call: 'releaseTranche', trancheId: tranche.id, decisionHash: decision },
        record: record(
          tranche.id,
          'tranche_release',
          amount,
          { id: from.vaultId },
          { id: to.accountId },
          decision,
        ),
      }
    }
    case 'transfer':
      if (from.kind === 'account' && to.kind === 'account')
        return {
          op: {
            call: 'transfer',
            opId: refId,
            fromAccountId: from.accountId,
            toAccountId: to.accountId,
            amount,
          },
          record: record(refId, 'transfer', amount, { id: from.accountId }, { id: to.accountId }),
        }
      // A Member returning unused funds: the ledger credits the Agency's Operations account.
      if (
        from.kind === 'recipient' &&
        from.recipient.kind === 'member' &&
        to.kind === 'account' &&
        movement.agencyId
      )
        return {
          op: { call: 'returnToAgency', opId: refId, agencyId: movement.agencyId, amount },
          record: record(refId, 'return', amount, { member: signerUserId }, { id: to.accountId }),
        }
      return null
    case 'allocate':
      if (to.kind !== 'budget' || from.kind !== 'account') return null
      // A new budget's first allocation travels with its creation.
      if (newBudgets.has(to.budgetId) && refId === to.budgetId) return 'settled'
      return {
        op: { call: 'allocate', opId: refId, budgetId: to.budgetId, delta: amount },
        record: record(refId, 'allocation', amount, { id: from.accountId }, { id: to.budgetId }),
      }
    case 'deallocate':
      if (from.kind !== 'budget' || to.kind !== 'account') return null
      return {
        op: { call: 'allocate', opId: refId, budgetId: from.budgetId, delta: -amount },
        record: record(refId, 'allocation', amount, { id: from.budgetId }, { id: to.accountId }),
      }
    case 'payment': {
      if (settledPayments.has(refId)) return 'settled'
      const payment = after.payments.find((p) => p.id === refId)
      // A payment for a request is settled by the request (paid at once or approved).
      if (!payment || payment.requestId) return null
      const bill = payment.billId ? after.bills.find((b) => b.id === payment.billId) : undefined
      const evidenceHash = bill ? attachmentsHash([bill.document]) : null
      const sourceId = payment.budgetId ?? payment.sourceAccountId
      const destinationId = payment.recipient.kind === 'destination' ? payment.recipient.destinationId : null
      const memberUserId = payment.recipient.kind === 'member' ? payment.recipient.userId : null
      return {
        op: {
          call: 'pay',
          paymentId: payment.id,
          sourceId,
          destinationId,
          memberUserId,
          amount,
          evidenceHash,
        },
        record: record(
          payment.id,
          'payment',
          amount,
          { id: sourceId },
          target(destinationId, memberUserId),
          evidenceHash,
        ),
      }
    }
    default:
      return null
  }
}

function requestCall(request: PaymentRequest) {
  return {
    call: 'requestPayment' as const,
    requestId: request.id,
    budgetId: request.budgetId,
    destinationId: request.destination.kind === 'destination' ? request.destination.destinationId : null,
    memberUserId: request.destination.kind === 'member' ? request.destination.userId : null,
    amount: request.amount,
    evidenceHash: attachmentsHash(request.attachments),
  }
}

/** A request's record: paid (under the payment id), waiting or rejected (under the request id). */
function requestRecord(request: PaymentRequest, opId: Id, kind: PlannedRecord['kind']): PlannedRecord {
  const { destinationId, memberUserId, evidenceHash } = requestCall(request)
  return record(
    opId,
    kind,
    request.amount,
    { id: request.budgetId },
    target(destinationId, memberUserId),
    evidenceHash,
  )
}

function record(
  opId: Id,
  kind: PlannedRecord['kind'],
  amount: Cents,
  from: RecordEnd,
  to: RecordEnd,
  evidenceHash: PlannedRecord['evidenceHash'] = null,
): PlannedRecord {
  return { opId, kind, amount, from, to, evidenceHash }
}

/** Where a payment goes: a Member's Viatik balance, a payment destination, or nowhere named. */
function target(destinationId: Id | null, memberUserId: Id | null): RecordEnd {
  return memberUserId ? { member: memberUserId } : destinationId ? { id: destinationId } : null
}

function membershipChanges(before: readonly Membership[], after: readonly Membership[]) {
  const previous = new Map(before.map((m) => [m.id, m]))
  const granted: Membership[] = []
  const revoked: Membership[] = []
  for (const membership of after) {
    const was = previous.get(membership.id)?.status
    if (membership.status === 'active' && was !== 'active') granted.push(membership)
    if (membership.status === 'revoked' && was === 'active') revoked.push(membership)
  }
  return { granted, revoked }
}

const scopeOf = (membership: Membership) =>
  membership.scope.kind === 'agency' ? membership.scope.agencyId : membership.scope.portfolioId

/** Budget → person → the active allowance's own per-operation limit (0: the budget's). */
function memberAccess(allowances: readonly SpendingAllowance[]) {
  const access = new Map<Id, Map<Id, Cents>>()
  for (const allowance of allowances) {
    if (allowance.status !== 'active' || allowance.holder.kind !== 'member') continue
    const byPerson = access.get(allowance.budgetId) ?? new Map<Id, Cents>()
    byPerson.set(allowance.holder.userId, allowance.perOperationLimit ?? ZERO)
    access.set(allowance.budgetId, byPerson)
  }
  return access
}

/** Every (budget, person) pair with access before or after. */
function accessKeys(...maps: Map<Id, Map<Id, Cents>>[]): [Id, Id][] {
  const keys = new Map<string, [Id, Id]>()
  for (const map of maps)
    for (const [budgetId, byPerson] of map)
      for (const userId of byPerson.keys()) keys.set(JSON.stringify([budgetId, userId]), [budgetId, userId])
  return [...keys.values()]
}

/** The ledger only knows paused or not; an expired or closed budget does not pay either. */
const isPaused = (budget: Budget) => budget.status !== 'active'

function added<T extends { id: Id }>(before: readonly T[], after: readonly T[]): T[] {
  const known = new Set(before.map((item) => item.id))
  return after.filter((item) => !known.has(item.id))
}

function changed<T extends { id: Id }>(before: readonly T[], after: readonly T[]): [T, T][] {
  const previous = new Map(before.map((item) => [item.id, item]))
  const pairs: [T, T][] = []
  for (const item of after) {
    const was = previous.get(item.id)
    if (was) pairs.push([was, item])
  }
  return pairs
}

function sameSet(a: readonly Id[], b: readonly Id[]) {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

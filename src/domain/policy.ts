import { formatUsd, type Cents } from './money'
import type {
  AiAgent,
  Budget,
  ISODate,
  PolicyCheck,
  PolicyDecision,
  PolicyOutcome,
  RequestType,
  SpendingAllowance,
  SpendingCategory,
} from './types'

export type PolicyRequest = {
  amount: Cents
  category: SpendingCategory
  /** Payment destination id, or null when paying a Member. */
  destinationId: string | null
}

export type PolicyUsage = {
  /** Budget balance minus active holds. */
  budgetAvailable: Cents
  /** What this holder already spent or reserved in the current period. */
  holderSpentThisPeriod: Cents
  /** What the whole budget already spent or reserved in the current period. */
  budgetSpentThisPeriod: Cents
  /** AI Agents only: spent or reserved today. */
  agentSpentToday?: Cents
}

export type PolicyInput = {
  budget: Budget
  allowance: SpendingAllowance | null
  agent?: AiAgent | null
  request: PolicyRequest
  usage: PolicyUsage
  now: ISODate
  /** Who the request is for, when someone else reads the result (an approver); otherwise it is worded for the requester. */
  holderName?: string
}

const fmt = (value: Cents) => formatUsd(value, { withCode: true })

/**
 * Deterministic spending policy. The same rules are enforced by the ledger
 * contract; running them here gives the requester an instant, plain-English
 * answer before anything is submitted.
 */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { budget, allowance, agent, request, usage, now, holderName } = input
  const whose = holderName ? `${holderName}'s` : 'your'
  const checks: PolicyCheck[] = []
  const push = (check: PolicyCheck) => checks.push(check)

  push({
    rule: 'budget_active',
    passed: budget.status === 'active',
    blocking: true,
    message:
      budget.status === 'active'
        ? 'The budget is active.'
        : 'This budget is paused. New requests are on hold.',
  })

  const expired = budget.expiresAt ? budget.expiresAt < now : false
  push({
    rule: 'budget_not_expired',
    passed: !expired,
    blocking: true,
    message: expired ? 'This budget has expired.' : 'The budget is within its active dates.',
  })

  const hasAccess = allowance?.status === 'active'
  push({
    rule: 'holder_has_access',
    passed: hasAccess,
    blocking: true,
    message: hasAccess
      ? `${holderName ? `${holderName} has` : 'You have'} spending access to this budget.`
      : `${holderName ? `${holderName} does` : 'You do'} not have spending access to this budget.`,
  })

  if (agent) {
    const agentActive = agent.status === 'active' && agent.expiresAt >= now
    push({
      rule: 'agent_active',
      passed: agentActive,
      blocking: true,
      message: agentActive ? 'The automation is active.' : 'This automation is paused or expired.',
    })
  }

  if (request.destinationId !== null) {
    const allowedList = agent ? agent.allowedDestinationIds : budget.allowedDestinationIds
    const destinationAllowed = allowedList.length === 0 || allowedList.includes(request.destinationId)
    push({
      rule: 'destination_allowed',
      passed: destinationAllowed,
      blocking: true,
      message: destinationAllowed
        ? 'The payment destination is approved for this budget.'
        : 'This payment destination is not approved for this budget.',
    })
  }

  const categoryAllowed = budget.allowedCategories.includes(request.category)
  push({
    rule: 'category_allowed',
    passed: categoryAllowed,
    blocking: true,
    message: categoryAllowed
      ? 'The category is an approved use of this budget.'
      : 'This category is not an approved use of this budget.',
  })

  const perOperationLimit = minDefined(budget.perOperationLimit, allowance?.perOperationLimit)
  const withinPerOperation = request.amount <= perOperationLimit
  push({
    rule: 'per_operation_limit',
    passed: withinPerOperation,
    blocking: true,
    message: withinPerOperation
      ? `Within ${whose} per-operation limit of ${fmt(perOperationLimit)}.`
      : `The amount exceeds ${whose} per-operation limit of ${fmt(perOperationLimit)}.${holderName ? '' : ' Reduce the amount or request a budget change.'}`,
  })

  if (allowance) {
    const withinHolder = usage.holderSpentThisPeriod + request.amount <= allowance.periodLimit
    const withinBudget = usage.budgetSpentThisPeriod + request.amount <= budget.periodLimit
    const holderLeft = Math.max(0, allowance.periodLimit - usage.holderSpentThisPeriod) as Cents
    const budgetLeft = Math.max(0, budget.periodLimit - usage.budgetSpentThisPeriod) as Cents
    const noun = periodNoun(budget.period)
    // Say which limit ran out: the holder's allowance or the whole budget's.
    push({
      rule: 'period_limit',
      passed: withinHolder && withinBudget,
      blocking: true,
      message:
        withinHolder && withinBudget
          ? `Within ${whose} ${noun} limit. ${fmt(holderLeft)} left before this request.`
          : !withinHolder
            ? `The amount exceeds what is left of ${whose} ${noun} limit (${fmt(holderLeft)}).`
            : `The amount exceeds what is left of the budget's ${noun} limit (${fmt(budgetLeft)}).`,
    })
  }

  const fundsAvailable = request.amount <= usage.budgetAvailable
  push({
    rule: 'budget_available',
    passed: fundsAvailable,
    blocking: true,
    message: fundsAvailable
      ? 'The budget has enough available funds.'
      : `The budget has ${fmt(usage.budgetAvailable)} available, which is not enough for this request.`,
  })

  if (agent) {
    const withinOperation = request.amount <= agent.perOperationMax
    push({
      rule: 'agent_per_operation_max',
      passed: withinOperation,
      blocking: true,
      message: withinOperation
        ? `Within the automation's per-operation maximum of ${fmt(agent.perOperationMax)}.`
        : `Exceeds the automation's per-operation maximum of ${fmt(agent.perOperationMax)}.`,
    })
    const spentToday = usage.agentSpentToday ?? (0 as Cents)
    const withinDaily = spentToday + request.amount <= agent.dailyCap
    push({
      rule: 'agent_daily_cap',
      passed: withinDaily,
      blocking: true,
      message: withinDaily
        ? `Within the automation's daily cap of ${fmt(agent.dailyCap)}.`
        : `Exceeds the automation's daily cap of ${fmt(agent.dailyCap)}.`,
    })
  }

  const belowThreshold = request.amount <= budget.approvalThreshold
  push({
    rule: 'approval_threshold',
    passed: belowThreshold,
    blocking: false,
    message: belowThreshold
      ? `Up to ${fmt(budget.approvalThreshold)} approves automatically.`
      : `Requests above ${fmt(budget.approvalThreshold)} need approval from an Agency Admin.`,
  })

  const firstBlockingFailure = checks.find((check) => check.blocking && !check.passed)
  let outcome: PolicyOutcome = 'approved'
  let reason: PolicyCheck | undefined
  if (firstBlockingFailure) {
    outcome = 'rejected'
    reason = firstBlockingFailure
  } else if (!belowThreshold) {
    outcome = 'needs_approval'
    reason = checks.find((check) => check.rule === 'approval_threshold')
  }

  return { outcome, checks, reason, evaluatedAt: now }
}

/**
 * Requests that pay the requester's own Viatik balance (money for purchases, a
 * reimbursement, payment for work). The others pay an approved vendor.
 */
export function paysRequester(type: RequestType): boolean {
  return type === 'funds' || type === 'reimbursement' || type === 'work'
}

/**
 * The rules a request meets on top of its budget's policy, as the ledger applies them:
 * - Above the Investor's exception threshold nothing approves itself: the Investor decides.
 * - Payment for work reaches the ledger only when an Agency Admin pays it, so an Agency Admin
 *   always reviews it, and above the exception threshold it cannot be paid at all: it is refused.
 *
 * `isException` says whether the Investor decides (never for work).
 */
export function withAgreementRules(
  decision: PolicyDecision,
  request: { type: RequestType; amount: Cents },
  exceptionThreshold: Cents | undefined,
): { decision: PolicyDecision; isException: boolean } {
  const aboveException = exceptionThreshold !== undefined && request.amount > exceptionThreshold
  const threshold = exceptionThreshold === undefined ? '' : fmt(exceptionThreshold)
  if (request.type === 'work') {
    // The budget's automatic limit plays no part: work is always reviewed.
    const checks = decision.checks.filter((check) => check.rule !== 'approval_threshold')
    if (aboveException) {
      checks.push({
        rule: 'exception_threshold',
        passed: false,
        blocking: true,
        message: `Payment for work cannot be above the Investor's exception threshold of ${threshold}.`,
      })
    }
    const failure = checks.find((check) => check.blocking && !check.passed)
    if (failure) {
      return { decision: { ...decision, outcome: 'rejected', checks, reason: failure }, isException: false }
    }
    const review: PolicyCheck = {
      rule: 'work_review',
      passed: false,
      blocking: false,
      message: 'Payment for work is always reviewed by an Agency Admin.',
    }
    return {
      decision: { ...decision, outcome: 'needs_approval', checks: [...checks, review], reason: review },
      isException: false,
    }
  }
  if (!aboveException || decision.outcome === 'rejected') return { decision, isException: aboveException }
  // Within the automatic limit or not, the reason shown is the exception: the Investor decides.
  const reason: PolicyCheck = {
    rule: 'exception_threshold',
    passed: false,
    blocking: false,
    message: `Above the Investor's exception threshold of ${threshold}. The Investor decides.`,
  }
  return {
    decision: { ...decision, outcome: 'needs_approval', checks: [...decision.checks, reason], reason },
    isException: true,
  }
}

/** An allowance without a per-operation limit of its own (unset or 0) follows the budget's, as onchain. */
function minDefined(a: Cents, b: Cents | undefined): Cents {
  return !b ? a : (Math.min(a, b) as Cents)
}

export function periodNoun(period: Budget['period']): string {
  switch (period) {
    case 'monthly':
      return 'monthly'
    case 'quarterly':
      return 'quarterly'
    case 'one_time':
      return 'total'
  }
}

/** Plain-English budget rules, as the Agency Admin reviews them before creating a budget. */
export function describeBudgetPolicy(
  budget: Pick<
    Budget,
    'period' | 'perOperationLimit' | 'periodLimit' | 'approvalThreshold' | 'allowedCategories' | 'expiresAt'
  >,
  options: {
    destinationNames?: string[]
    categoryLabels?: Record<SpendingCategory, string>
    locale?: string
  } = {},
): string[] {
  const lines: string[] = []
  const periodWord =
    budget.period === 'one_time' ? 'in total' : `per ${budget.period === 'monthly' ? 'month' : 'quarter'}`
  lines.push(`Up to ${fmt(budget.periodLimit)} can be spent ${periodWord}.`)
  lines.push(`A single payment cannot exceed ${fmt(budget.perOperationLimit)}.`)
  lines.push(
    budget.approvalThreshold > 0
      ? `Payments up to ${fmt(budget.approvalThreshold)} are approved automatically. Anything above needs an Agency Admin.`
      : 'Every payment needs an Agency Admin approval.',
  )
  // The vendor list limits vendor payments only: money a person requests goes to their own Viatik balance.
  if (options.destinationNames && options.destinationNames.length > 0) {
    lines.push(`Vendor payments can only go to ${joinList(options.destinationNames)}.`)
  } else {
    lines.push('Vendor payments can go to any approved payment destination of the Agency.')
  }
  if (options.categoryLabels) {
    lines.push(
      `Approved uses: ${joinList(budget.allowedCategories.map((c) => options.categoryLabels![c].toLowerCase()))}.`,
    )
  }
  if (budget.expiresAt) {
    const date = new Intl.DateTimeFormat(options.locale ?? 'en-US', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(budget.expiresAt))
    lines.push(`The budget closes on ${date}. Unused funds return to the source account.`)
  }
  return lines
}

export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

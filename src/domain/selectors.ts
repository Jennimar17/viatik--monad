import { add, cents, clampToZero, sum, ZERO, type Cents } from './money'
import type {
  Account,
  AllowanceHolder,
  Budget,
  BudgetPeriod,
  Id,
  ISODate,
  Location,
  Movement,
  PaymentRequest,
  SpendingCategory,
  ViatikState,
} from './types'

/**
 * Pure read models over the state snapshot. Balances are always derived from
 * movements (which mirror ledger events), never stored as totals.
 */

export function sameLocation(a: Location, b: Location): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'external':
      return true
    case 'vault':
      return a.vaultId === (b as typeof a).vaultId
    case 'account':
      return a.accountId === (b as typeof a).accountId
    case 'budget':
      return a.budgetId === (b as typeof a).budgetId
    case 'recipient': {
      const other = (b as typeof a).recipient
      if (a.recipient.kind === 'member' && other.kind === 'member') return a.recipient.userId === other.userId
      if (a.recipient.kind === 'destination' && other.kind === 'destination')
        return a.recipient.destinationId === other.destinationId
      return false
    }
  }
}

export function balanceOf(movements: readonly Movement[], location: Location, until?: ISODate): Cents {
  let total = 0
  for (const movement of movements) {
    if (until && movement.createdAt > until) continue
    if (sameLocation(movement.to, location)) total += movement.amount
    if (sameLocation(movement.from, location)) total -= movement.amount
  }
  return cents(total)
}

export const vaultBalance = (state: ViatikState, vaultId: Id) =>
  balanceOf(state.movements, { kind: 'vault', vaultId })
export const accountBalance = (state: ViatikState, accountId: Id) =>
  balanceOf(state.movements, { kind: 'account', accountId })
export const budgetBalance = (state: ViatikState, budgetId: Id) =>
  balanceOf(state.movements, { kind: 'budget', budgetId })

// ─── Periods ────────────────────────────────────────────────────────────────

export type Window = { start: ISODate; end: ISODate }

export function periodWindow(period: BudgetPeriod, now: ISODate, createdAt?: ISODate): Window {
  const date = new Date(now)
  if (period === 'monthly') {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
    return { start: start.toISOString(), end: end.toISOString() }
  }
  if (period === 'quarterly') {
    const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3
    const start = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1))
    const end = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth + 3, 1))
    return { start: start.toISOString(), end: end.toISOString() }
  }
  return { start: createdAt ?? '1970-01-01T00:00:00.000Z', end: '9999-12-31T00:00:00.000Z' }
}

export function dayWindow(now: ISODate): Window {
  const date = new Date(now)
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { start: start.toISOString(), end: end.toISOString() }
}

const inWindow = (date: ISODate, window: Window) => date >= window.start && date < window.end

// ─── Holds and budget usage ─────────────────────────────────────────────────

/**
 * When a request's money counts against limits: when it was approved, or
 * when it was sent if it never waited. Approved in a new period, it counts there.
 */
export function committedAt(request: PaymentRequest): ISODate {
  return request.decidedAt ?? request.createdAt
}

/** Requests whose money is held (approved, not yet captured). */
export function isHold(request: PaymentRequest): boolean {
  return request.status === 'approved' || request.status === 'processing'
}

/** Requests that count against limits: holds plus completed spend. */
function countsAgainstLimits(request: PaymentRequest): boolean {
  return isHold(request) || request.status === 'completed' || request.status === 'needs_approval'
}

export function reservedForBudget(state: ViatikState, budgetId: Id): Cents {
  return sum(
    state.requests.filter((r) => r.budgetId === budgetId && isHold(r)),
    (r) => r.amount,
  )
}

export function budgetAvailable(state: ViatikState, budgetId: Id): Cents {
  return clampToZero(cents(budgetBalance(state, budgetId) - reservedForBudget(state, budgetId)))
}

export function budgetSpent(state: ViatikState, budgetId: Id, window?: Window): Cents {
  return sum(
    state.movements.filter(
      (m) =>
        m.kind === 'payment' &&
        m.from.kind === 'budget' &&
        m.from.budgetId === budgetId &&
        (!window || inWindow(m.createdAt, window)),
    ),
    (m) => m.amount,
  )
}

export function budgetAllocated(state: ViatikState, budgetId: Id): Cents {
  let total = 0
  for (const m of state.movements) {
    if (m.kind === 'allocate' && m.to.kind === 'budget' && m.to.budgetId === budgetId) total += m.amount
    if (m.kind === 'deallocate' && m.from.kind === 'budget' && m.from.budgetId === budgetId) total -= m.amount
  }
  return cents(total)
}

export type BudgetUsage = {
  allocated: Cents
  balance: Cents
  reserved: Cents
  available: Cents
  spentThisPeriod: Cents
  spentTotal: Cents
  periodLimit: Cents
  /** Spend + holds in the current period, what counts against the period limit. */
  committedThisPeriod: Cents
  window: Window
}

export function budgetUsage(state: ViatikState, budget: Budget, now: ISODate): BudgetUsage {
  const window = periodWindow(budget.period, now, budget.createdAt)
  const reserved = reservedForBudget(state, budget.id)
  const balance = budgetBalance(state, budget.id)
  const spentThisPeriod = budgetSpent(state, budget.id, window)
  const reservedThisPeriod = sum(
    state.requests.filter((r) => r.budgetId === budget.id && isHold(r) && inWindow(committedAt(r), window)),
    (r) => r.amount,
  )
  return {
    allocated: budgetAllocated(state, budget.id),
    balance,
    reserved,
    available: clampToZero(cents(balance - reserved)),
    spentThisPeriod,
    spentTotal: budgetSpent(state, budget.id),
    periodLimit: budget.periodLimit,
    committedThisPeriod: add(spentThisPeriod, reservedThisPeriod),
    window,
  }
}

function holderMatches(request: PaymentRequest, holder: AllowanceHolder): boolean {
  if (holder.kind === 'member')
    return request.requester.kind === 'user' && request.requester.userId === holder.userId
  return request.requester.kind === 'ai_agent' && request.requester.agentId === holder.agentId
}

export function holderSpentInPeriod(
  state: ViatikState,
  budget: Budget,
  holder: AllowanceHolder,
  now: ISODate,
): Cents {
  const window = periodWindow(budget.period, now, budget.createdAt)
  return sum(
    state.requests.filter(
      (r) =>
        r.budgetId === budget.id &&
        holderMatches(r, holder) &&
        countsAgainstLimits(r) &&
        r.status !== 'needs_approval' &&
        inWindow(committedAt(r), window),
    ),
    (r) => r.amount,
  )
}

export function agentSpentToday(state: ViatikState, agentId: Id, now: ISODate): Cents {
  const window = dayWindow(now)
  return sum(
    state.requests.filter(
      (r) =>
        r.requester.kind === 'ai_agent' &&
        r.requester.agentId === agentId &&
        (isHold(r) || r.status === 'completed') &&
        inWindow(committedAt(r), window),
    ),
    (r) => r.amount,
  )
}

// ─── Capital states ─────────────────────────────────────────────────────────

/** The seven capital states. They are never merged into one balance. */
export type CapitalStates = {
  committed: Cents
  funded: Cents
  released: Cents
  allocated: Cents
  reserved: Cents
  spent: Cents
  returned: Cents
}

function sumMovements(state: ViatikState, predicate: (m: Movement) => boolean): Cents {
  return sum(state.movements.filter(predicate), (m) => m.amount)
}

export function agreementCapital(state: ViatikState, agreementId: Id) {
  const agreement = state.agreements.find((a) => a.id === agreementId)
  const committed = agreement?.committed ?? ZERO
  const funded = sumMovements(state, (m) => m.kind === 'fund_agreement' && m.agreementId === agreementId)
  const released = sumMovements(state, (m) => m.kind === 'release_tranche' && m.agreementId === agreementId)
  const returned = sumMovements(state, (m) => m.kind === 'capital_return' && m.agreementId === agreementId)
  return {
    committed,
    funded,
    released,
    returned,
    /** Funded but not yet released: what sits in the Funding Vault. */
    inFundingVault: clampToZero(cents(funded - released)),
    remainingCommitment: clampToZero(cents(committed - released)),
    unfunded: clampToZero(cents(committed - funded)),
  }
}

export function agencyAccounts(state: ViatikState, agencyId: Id): Account[] {
  return state.accounts.filter((a) => a.agencyId === agencyId)
}

export function agencyCapital(state: ViatikState, agencyId: Id, now: ISODate) {
  const accounts = agencyAccounts(state, agencyId)
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId)
  const agreements = state.agreements.filter((a) => a.agencyId === agencyId)

  const accountBalances = accounts.map((a) => ({ account: a, balance: accountBalance(state, a.id) }))
  const operating = accountBalances.filter(
    (a) => a.account.template !== 'reserve' && a.account.template !== 'taxes',
  )
  const availableToOperate = sum(operating, (a) => a.balance)
  const held = sum(
    accountBalances.filter((a) => a.account.template === 'reserve' || a.account.template === 'taxes'),
    (a) => a.balance,
  )
  const reserved = sum(budgets, (b) => reservedForBudget(state, b.id))
  const budgetBalances = sum(budgets, (b) => budgetBalance(state, b.id))
  const monthWindow = periodWindow('monthly', now)
  const spentThisPeriod = sumMovements(
    state,
    (m) => m.kind === 'payment' && m.agencyId === agencyId && inWindow(m.createdAt, monthWindow),
  )

  const committed = sum(agreements, (a) => a.committed)
  const funded = sum(agreements, (a) => agreementCapital(state, a.id).funded)
  const released = sum(agreements, (a) => agreementCapital(state, a.id).released)
  const returned = sum(agreements, (a) => agreementCapital(state, a.id).returned)
  const spent = sumMovements(state, (m) => m.kind === 'payment' && m.agencyId === agencyId)

  return {
    availableToOperate,
    heldInReserve: held,
    allocated: clampToZero(cents(budgetBalances - reserved)),
    reserved,
    spentThisPeriod,
    states: {
      committed,
      funded,
      released,
      allocated: clampToZero(cents(budgetBalances - reserved)),
      reserved,
      spent,
      returned,
    } satisfies CapitalStates,
  }
}

export function portfolioCapital(state: ViatikState, portfolioId: Id, now: ISODate) {
  const agreements = state.agreements.filter((a) => a.portfolioId === portfolioId)
  const portfolioVault = state.vaults.find((v) => v.portfolioId === portfolioId && v.kind === 'portfolio')
  const agencies = state.agencies.filter((a) => a.portfolioId === portfolioId)

  const committed = sum(
    agreements.filter((a) => a.status !== 'cancelled' && a.status !== 'draft'),
    (a) => a.committed,
  )
  const funded = sum(agreements, (a) => agreementCapital(state, a.id).funded)
  const released = sum(agreements, (a) => agreementCapital(state, a.id).released)
  const returned = sum(agreements, (a) => agreementCapital(state, a.id).returned)
  const agencyStates = agencies.map((a) => agencyCapital(state, a.id, now))

  return {
    committed,
    funded,
    released,
    returned,
    availableCapital: portfolioVault ? vaultBalance(state, portfolioVault.id) : ZERO,
    activeAgencies: agencies.filter((a) => a.status === 'active').length,
    pendingTrancheRequests: state.tranches.filter(
      (t) =>
        (t.status === 'under_review' || t.status === 'requested') &&
        agreements.some((a) => a.id === t.agreementId),
    ).length,
    states: {
      committed,
      funded,
      released,
      allocated: sum(agencyStates, (s) => s.allocated),
      reserved: sum(agencyStates, (s) => s.reserved),
      spent: sum(agencyStates, (s) => s.states.spent),
      returned,
    } satisfies CapitalStates,
  }
}

// ─── Series for charts ───────────────────────────────────────────────────────

export type MonthBucket = { key: string; label: string; start: ISODate; end: ISODate }

export function lastMonths(now: ISODate, count: number, locale = 'en-US'): MonthBucket[] {
  const date = new Date(now)
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' })
  return Array.from({ length: count }, (_, i) => {
    const offset = count - 1 - i
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset, 1))
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - offset + 1, 1))
    return {
      key: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
      label: formatter.format(start),
      start: start.toISOString(),
      end: end.toISOString(),
    }
  })
}

/** Cumulative funded / released / spent at the end of each month. */
export function capitalOverTime(
  state: ViatikState,
  filter: { portfolioId?: Id; agencyId?: Id },
  now: ISODate,
  months = 6,
) {
  const matches = (m: Movement) =>
    (!filter.portfolioId || m.portfolioId === filter.portfolioId) &&
    (!filter.agencyId || m.agencyId === filter.agencyId)
  return lastMonths(now, months).map((bucket) => {
    const upTo = state.movements.filter((m) => matches(m) && m.createdAt < bucket.end)
    return {
      month: bucket.label,
      funded: sum(
        upTo.filter((m) => m.kind === 'fund_agreement'),
        (m) => m.amount,
      ),
      released: sum(
        upTo.filter((m) => m.kind === 'release_tranche'),
        (m) => m.amount,
      ),
      spent: sum(
        upTo.filter((m) => m.kind === 'payment'),
        (m) => m.amount,
      ),
    }
  })
}

/** Monthly spend split by a key (category, budget, …). */
export function spendByMonth<K extends string>(
  state: ViatikState,
  filter: { agencyId?: Id; budgetId?: Id; userId?: Id },
  keyOf: (m: Movement) => K | null,
  now: ISODate,
  months = 6,
) {
  const buckets = lastMonths(now, months)
  return buckets.map((bucket) => {
    const row: Record<string, number | string> = { month: bucket.label }
    for (const m of state.movements) {
      if (m.kind !== 'payment') continue
      if (filter.agencyId && m.agencyId !== filter.agencyId) continue
      if (filter.budgetId && !(m.from.kind === 'budget' && m.from.budgetId === filter.budgetId)) continue
      if (
        filter.userId &&
        !(
          m.to.kind === 'recipient' &&
          m.to.recipient.kind === 'member' &&
          m.to.recipient.userId === filter.userId
        )
      )
        continue
      if (m.createdAt < bucket.start || m.createdAt >= bucket.end) continue
      const key = keyOf(m)
      if (!key) continue
      row[key] = ((row[key] as number | undefined) ?? 0) + m.amount
    }
    return row
  })
}

export function paymentCategory(state: ViatikState, movement: Movement): SpendingCategory | null {
  const payment = state.payments.find((p) => p.id === movement.refId)
  return payment?.category ?? null
}

export function isOverdue(dueDate: ISODate, now: ISODate): boolean {
  return dueDate < now
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000))
}

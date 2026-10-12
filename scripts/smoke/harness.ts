import { decodeFunctionData, sha256, stringToHex } from 'viem'

import { applySettlement, planSettlement } from '@/data/settlement'
import {
  DomainError,
  runCommand,
  type CommandContext,
  type CommandInput,
  type CommandName,
  type CommandResult,
  type DomainErrorCode,
  type EvidenceDraft,
} from '@/domain/engine'
import { createDemoState } from '@/domain/fixtures'
import { cents, type Cents } from '@/domain/money'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import type { Activity, Id, ISODate, Movement, Notification, Receipt, ViatikState } from '@/domain/types'
import { scopeStateForUser } from '@/domain/visibility'
import { encodePlan, receiptHashOf } from '@/ledger/encode'
import { buildGenesis, placeholderAddress, type Genesis } from '@/ledger/genesis'
import { witnessesOf } from '@/ledger/ids'
import { MockLedgerAdapter, simulateLedger } from '@/ledger/mock'
import { ledgerSnapshot, type LedgerSnapshot } from '@/ledger/snapshot'
import {
  RECEIPTLESS_CALLS,
  type ChainContext,
  type LedgerCall,
  type LedgerErrorCode,
  type LedgerOp,
  type PlannedRecord,
  type RecordEnd,
  type SettlementPlan,
  type SettlementResult,
} from '@/ledger/types'
import { parseCommandInput } from '@/server/schemas'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'

/**
 * The smoke's shared pieces. A `World` runs real commands the way the API and
 * the demo data source do (schema, engine, settlement plan, mock ledger,
 * applySettlement) and checks, after every step, that the ledger would keep
 * the same books as the app. Scenarios assert changes against the state
 * before each step, never the seed's absolute numbers.
 */

/** What `scripts/smoke.mjs` hands every suite. */
export type Checker = {
  /** One PASS or FAIL line; returns `ok`. The detail is shown when it fails. */
  check(name: string, ok: boolean, detail?: string): boolean
  /** A titled group of checks; a failed step stops the scenario, and the suite goes on. */
  scenario(title: string, run: () => Promise<void> | void): Promise<void>
  /** A line of context that is not a check. */
  note(text: string): void
}

/** The fixed time the seed is built at; `SMOKE_NOW` (any date `Date` reads) overrides it. */
export const NOW: ISODate = smokeNow(process.env.SMOKE_NOW)

function smokeNow(value: string | undefined): ISODate {
  if (!value?.trim()) return '2026-10-08T12:00:00.000Z'
  const time = Date.parse(value)
  if (Number.isNaN(time)) throw new Error(`SMOKE_NOW is not a date: "${value}"`)
  return new Date(time).toISOString()
}

const HOUR = 60 * 60 * 1000

/** A step that had to succeed did not: its scenario cannot go on. */
export class StepFailed extends Error {
  constructor(label: string) {
    super(`${label} did not go as expected`)
    this.name = 'StepFailed'
  }
}

/** What a step expects from the ledger. */
export type Expect = {
  /** The ledger calls, in order; [] when nothing reaches the ledger. */
  ops?: LedgerCall[]
  /** How the mock ledger answers (default: completed, or none without a plan). */
  settle?: 'completed' | 'failed' | 'none'
  /** The error a failed settlement gives. */
  error?: LedgerErrorCode
  /** The plan keeps the engine's state when the ledger refuses (a rejected request stays in history). */
  keep?: boolean
}

export type Step<N extends CommandName> = {
  before: ViatikState
  /** The state the command produced, with what the ledger recorded written in. */
  after: ViatikState
  result: CommandResult<N>
  plan: SettlementPlan | null
  settled: SettlementResult | null
  /** The new state was kept (settled, or a rejection that stays in history). */
  committed: boolean
  calls: LedgerCall[]
  notifications: Notification[]
  activity: Activity[]
  receipts: Receipt[]
  movements: Movement[]
}

/** The chain context the plans are encoded with: everyone on a placeholder account. */
export const SMOKE_CHAIN: ChainContext = {
  namespace: 'smoke',
  addressOf: (userId) => placeholderAddress('smoke', userId),
}

export class World {
  state: ViatikState
  now: ISODate
  private steps = 0

  constructor(
    private readonly t: Checker,
    /** Part of every id seed, so two worlds never share ids by accident. */
    private readonly name: string,
    now: ISODate = NOW,
  ) {
    this.now = now
    this.state = createDemoState(now)
  }

  /** Moves the clock forward. */
  later(hours: number) {
    this.now = new Date(Date.parse(this.now) + hours * HOUR).toISOString()
  }

  /** What a person sees of the world. */
  view(userId: Id): ViatikState {
    return scopeStateForUser(this.state, userId)
  }

  /** A context for one command by a person, with its own id seed. */
  context(userId: Id): CommandContext {
    this.steps += 1
    return { actor: { kind: 'user', userId }, now: this.now, idSeed: `smoke:${this.name}:${this.steps}` }
  }

  /**
   * Runs a command that must go through: the API schema, the engine (twice, to
   * check it is deterministic), the settlement plan, the mock ledger and
   * applySettlement, then the ledger invariants. A step that does not go as
   * expected throws `StepFailed`.
   */
  async run<N extends CommandName>(
    userId: Id,
    name: N,
    input: CommandInput<N>,
    label: string,
    expect: Expect = {},
  ): Promise<Step<N>> {
    const t = this.t
    const before = this.state

    let parsed: CommandInput<N>
    try {
      parsed = parseCommandInput(name, input)
    } catch (error) {
      t.check(`${label}: the API schema accepts the input`, false, messageOf(error))
      throw new StepFailed(label)
    }
    const dropped = droppedKeys(input, parsed)
    if (dropped.length > 0) t.check(`${label}: the API schema keeps every field`, false, dropped.join(', '))

    const ctx = this.context(userId)
    let out: { state: ViatikState; result: CommandResult<N> }
    try {
      out = runCommand(before, ctx, name, parsed)
    } catch (error) {
      t.check(`${label}: the engine accepts it`, false, messageOf(error))
      throw new StepFailed(label)
    }
    const again = runCommand(before, ctx, name, parsed)
    const plan = planSettlement({ before, after: out.state, actor: ctx.actor })
    const planAgain = planSettlement({ before, after: again.state, actor: ctx.actor })

    const problems: string[] = []
    if (
      JSON.stringify(out.state) !== JSON.stringify(again.state) ||
      JSON.stringify(out.result) !== JSON.stringify(again.result)
    )
      problems.push('the same command on the same state gives another state')
    if (JSON.stringify(plan) !== JSON.stringify(planAgain))
      problems.push('the same command on the same state gives another settlement plan')

    const calls = plan ? plan.ops.map((op) => op.call) : []
    if (expect.ops)
      t.check(
        `${label}: ledger calls ${callList(expect.ops)}`,
        same(calls, expect.ops),
        `got ${callList(calls)}`,
      )
    if (plan && plan.uncovered.length > 0)
      problems.push(`money no ledger operation settles: ${plan.uncovered.join(', ')}`)

    let settled: SettlementResult | null = null
    if (plan) {
      settled = await new MockLedgerAdapter({ latencyMs: 0, now: () => this.now }).settle(plan, { before })
      applySettlement(before, out.state, plan, settled)
    }
    const status = settled?.status ?? 'none'
    const wanted = expect.settle ?? (plan ? 'completed' : 'none')
    const answer = settled?.error ? `${settled.error.code}: ${settled.error.message}` : ''
    const settledAsExpected =
      status === wanted &&
      (expect.error === undefined || settled?.error?.code === expect.error) &&
      (expect.keep === undefined || (plan?.keepOnFailure ?? false) === expect.keep)
    t.check(
      `${label}: ${wanted === 'none' ? 'nothing reaches the ledger' : wanted === 'completed' ? 'the ledger settles it' : `the ledger refuses it (${expect.error ?? 'any reason'})`}`,
      settledAsExpected,
      `ledger: ${status}${answer ? ` (${answer})` : ''}${plan ? `, keepOnFailure ${plan.keepOnFailure}` : ''}`,
    )
    if (!settledAsExpected) throw new StepFailed(label)

    const committed = !plan || !settled || settled.status === 'completed' || plan.keepOnFailure
    if (committed) {
      problems.push(...ledgerInvariants(before, out.state, plan, settled, this.now))
      this.state = out.state
    }
    // A refused step that is not kept leaves the world as it was: only determinism was checked.
    if (problems.length === 0)
      t.check(`${label}: ${committed ? 'ledger invariants hold' : 'deterministic, and nothing kept'}`, true)
    for (const problem of problems) t.check(`${label}: ${problem}`, false)

    const after = out.state
    return {
      before,
      after,
      result: out.result,
      plan,
      settled,
      committed,
      calls,
      notifications: added(before.notifications, after.notifications),
      activity: added(before.activity, after.activity),
      receipts: added(before.receipts, after.receipts),
      movements: added(before.movements, after.movements),
    }
  }

  /**
   * A command the product refuses: the API schema (`schema`) or the engine (a
   * DomainError code). The world does not change. Returns the message given.
   */
  refuse<N extends CommandName>(
    userId: Id,
    name: N,
    input: CommandInput<N>,
    code: DomainErrorCode | 'schema',
    label: string,
  ): string {
    return this.refuseRaw(userId, name, input, code, label)
  }

  /**
   * Like `refuse`, for inputs the engine's types do not allow (a missing field).
   * With `skipSchema` it calls the engine directly, to show the engine refuses
   * on its own too.
   */
  refuseRaw(
    userId: Id,
    name: CommandName,
    input: unknown,
    code: DomainErrorCode | 'schema',
    label: string,
    options: { skipSchema?: boolean } = {},
  ): string {
    const before = JSON.stringify(this.state)
    let outcome: string | undefined
    let message = ''
    let parsed = input
    if (!options.skipSchema) {
      try {
        parsed = parseCommandInput(name, input)
      } catch (error) {
        outcome = 'schema'
        message = messageOf(error)
      }
    }
    if (outcome === undefined) {
      try {
        runCommand(this.state, this.context(userId), name, parsed as CommandInput<typeof name>)
        outcome = 'accepted'
      } catch (error) {
        if (!(error instanceof DomainError)) throw error
        outcome = error.code
        message = error.message
      }
    }
    const unchanged = JSON.stringify(this.state) === before
    this.t.check(
      `${label}: refused (${code})`,
      outcome === code && unchanged,
      `${outcome}${message ? `: ${message}` : ''}${unchanged ? '' : ' (and the world changed)'}`,
    )
    return message
  }

  /**
   * Setup: makes sure a budget has `amount` available, as its Agency Admin would, moving
   * money into its source account from the Agency's other accounts first if needed. The
   * seed's balances depend on the date and on the demo story, so a scenario funds what it
   * spends instead of relying on them.
   */
  async fund(adminId: Id, budgetId: Id, amount: Cents): Promise<void> {
    const budget = must(
      this.state.budgets.find((b) => b.id === budgetId),
      `budget ${budgetId}`,
    )
    const available = budgetUsage(this.state, budget, this.now).available
    if (available >= amount) return
    const need = cents(amount - available)
    await this.gather(adminId, budget.sourceAccountId, need)
    await this.run(
      adminId,
      'allocateToBudget',
      { budgetId, amount: need, direction: 'allocate' },
      `setup: ${budget.name} gets ${need} cents more`,
      { ops: ['allocate'] },
    )
  }

  /**
   * Setup: makes sure an account holds at least `amount`, moving money from the Agency's
   * other active accounts, fullest first.
   */
  async gather(adminId: Id, accountId: Id, amount: Cents): Promise<void> {
    const account = must(
      this.state.accounts.find((a) => a.id === accountId),
      `account ${accountId}`,
    )
    let missing = amount - accountBalance(this.state, accountId)
    const donors = this.state.accounts
      .filter((a) => a.agencyId === account.agencyId && a.status === 'active' && a.id !== accountId)
      .map((a) => ({ account: a, balance: accountBalance(this.state, a.id) }))
      .sort((a, b) => b.balance - a.balance)
    for (const donor of donors) {
      if (missing <= 0) return
      if (donor.balance <= 0) break
      const moved = cents(Math.min(missing, donor.balance))
      await this.run(
        adminId,
        'transferFunds',
        {
          agencyId: account.agencyId,
          fromAccountId: donor.account.id,
          toAccountId: accountId,
          amount: moved,
        },
        `setup: ${donor.account.name} moves ${moved} cents into ${account.name}`,
        { ops: ['transfer'] },
      )
      missing -= moved
    }
    if (missing > 0)
      throw new Error(`${account.name} cannot gather ${amount} cents: the Agency holds too little`)
  }

  /** Runs a hand-made plan on the mock ledger, over the world (or another state). */
  settleCrafted(plan: SettlementPlan, before: ViatikState = this.state): Promise<SettlementResult> {
    return new MockLedgerAdapter({ latencyMs: 0, now: () => this.now }).settle(plan, { before })
  }
}

/** A hand-made plan signed by a person. */
export function crafted(signerUserId: Id, ops: LedgerOp[], records: PlannedRecord[] = []): SettlementPlan {
  return { ops, records, signerUserId, keepOnFailure: false, uncovered: [] }
}

// ─── Ledger invariants ───────────────────────────────────────────────────────

/**
 * What must hold after a step the app keeps: the ledger would keep the same
 * books (replaying the plan's records on the ledger's view before, and running
 * the plan on the mock's own storage, both give the ledger's view after), no
 * balance goes below zero, the plan encodes for Monad, the genesis of the new
 * state builds, and every new receipt carries what the ledger recorded.
 */
export function ledgerInvariants(
  before: ViatikState,
  after: ViatikState,
  plan: SettlementPlan | null,
  settled: SettlementResult | null,
  now: ISODate,
): string[] {
  const problems: string[] = []
  const start = ledgerSnapshot(before)
  const end = ledgerSnapshot(after)
  const expected = balancesOf(end)

  if (plan) {
    const mirrored = replay(start, end, plan)
    const differences = differencesOf(mirrored, expected)
    if (differences.length > 0)
      problems.push(`the plan's records do not add up to the balances after: ${differences.join('; ')}`)

    const run = simulateLedger(plan, before, now)
    if (run.status !== 'reverted') {
      const storage = new Map<string, number>()
      for (const [id, place] of run.places) storage.set(id, place.balance)
      for (const [key, amount] of run.members) storage.set(`member:${key}`, amount)
      const drift = differencesOf(storage, expected)
      for (const [key, proof] of end.outside) {
        const known = run.outside.get(key)
        if (!known || known.evidenceHash !== proof.evidenceHash) drift.push(`outside ${key}`)
      }
      for (const key of run.outside.keys())
        if (!end.outside.has(key)) drift.push(`outside ${key} (ledger only)`)
      // Scheduled payments: the ledger's schedule and the app's mirror move together.
      for (const [id, mirror] of end.schedules) {
        const known = run.schedules.get(id)
        if (
          !known ||
          known.status !== mirror.status ||
          known.runsLeft !== mirror.runsLeft ||
          known.nextRunAt !== mirror.nextRunAt ||
          known.pausedByInvestor !== mirror.pausedByInvestor
        )
          drift.push(
            `schedule ${id} (ledger ${known ? `${known.status} ${known.runsLeft} left, next ${known.nextRunAt}` : 'none'}; app ${mirror.status} ${mirror.runsLeft} left, next ${mirror.nextRunAt})`,
          )
      }
      for (const id of run.schedules.keys())
        if (!end.schedules.has(id)) drift.push(`schedule ${id} (ledger only)`)
      if (drift.length > 0)
        problems.push(`the mock ledger's books differ from the app's: ${drift.join('; ')}`)
    }

    try {
      encodePlan(
        plan.ops.filter((op) => op.call !== 'join'),
        SMOKE_CHAIN,
      )
      for (const record of plan.records) receiptHashOf(record, SMOKE_CHAIN)
      const witnesses = witnessesOf(plan)
      if (witnesses.length !== plan.ops.length || witnesses.some((w) => !w.id || w.events.length === 0))
        throw new Error('an operation has no witness')
    } catch (error) {
      problems.push(`the plan does not encode for Monad: ${messageOf(error)}`)
    }
  }

  const negative = [...expected].filter(([, amount]) => amount < 0).map(([key, amount]) => `${key} ${amount}`)
  if (negative.length > 0) problems.push(`a balance is below zero: ${negative.join(', ')}`)

  try {
    buildGenesis(after, 'smoke', () => undefined)
  } catch (error) {
    problems.push(`the genesis of the new state does not build: ${messageOf(error)}`)
  }

  const fresh = added(before.receipts, after.receipts)
  for (const receipt of fresh) {
    const record = settled?.records.find(
      (r) => r.opId === receipt.operationId && !RECEIPTLESS_CALLS.has(r.call),
    )
    if (!record) problems.push(`receipt ${receipt.number} (${receipt.kind}) has no ledger record`)
    else if (receipt.verified.status !== 'confirmed')
      problems.push(`receipt ${receipt.number} is not confirmed`)
    // Verified details hide the mock ledger's stand-in transaction, block and hash only when flagged.
    else if (receipt.verified.simulated !== true)
      problems.push(`receipt ${receipt.number} is not flagged simulated`)
  }
  return problems
}

/** Every balance the ledger keeps: places by id, Members as `member:agency|user`. */
export function balancesOf(snapshot: Pick<LedgerSnapshot, 'places' | 'members'>): Map<string, number> {
  const balances = new Map<string, number>()
  for (const [id, place] of snapshot.places) balances.set(id, place.balance)
  for (const [key, amount] of snapshot.members) balances.set(`member:${key}`, amount)
  return balances
}

/** The sum of every balance the ledger keeps (what backs it in TestUSD). */
export function bookedTotal(state: ViatikState): number {
  let total = 0
  for (const amount of balancesOf(ledgerSnapshot(state)).values()) total += amount
  return total
}

/**
 * The ledger's view before, with the plan's money records applied: the `from`
 * end goes down, a place or a Member at the `to` end goes up, and an address,
 * a vendor or nothing named means the money left the ledger.
 */
function replay(start: LedgerSnapshot, end: LedgerSnapshot, plan: SettlementPlan): Map<string, number> {
  const balances = balancesOf(start)
  const scopeOf = (id: Id) => end.places.get(id)?.scope ?? start.places.get(id)?.scope
  // A Member's balance is per agency: the operation that names them says which.
  const agencyOf = new Map<Id, Id | undefined>()
  for (const op of plan.ops) {
    if (op.call === 'requestPayment') {
      agencyOf.set(op.paymentId, scopeOf(op.budgetId))
      agencyOf.set(op.requestId, scopeOf(op.budgetId))
    } else if (op.call === 'approvePayment')
      agencyOf.set(op.paymentId, start.requests.get(op.requestId)?.agency)
    else if (op.call === 'pay') agencyOf.set(op.paymentId, scopeOf(op.sourceId))
    else if (op.call === 'returnToAgency' || op.call === 'withdrawMemberBalance')
      agencyOf.set(op.opId, op.agencyId)
  }
  // Any other record that pays a Member (a scheduled run): the agency of the place it comes from.
  for (const record of plan.records)
    if (!agencyOf.has(record.opId) && record.from && 'id' in record.from)
      agencyOf.set(record.opId, scopeOf(record.from.id))
  const keyOf = (recordEnd: RecordEnd, opId: Id): string | null => {
    if (recordEnd === null || 'address' in recordEnd) return null
    if ('member' in recordEnd) return `member:${agencyOf.get(opId)}|${recordEnd.member}`
    return start.places.has(recordEnd.id) || end.places.has(recordEnd.id) ? recordEnd.id : null
  }
  const add = (key: string | null, amount: number) => {
    if (key) balances.set(key, (balances.get(key) ?? 0) + amount)
  }
  for (const record of plan.records) {
    // A request waiting for approval or rejected moves nothing.
    if (record.kind === 'payment_pending' || record.kind === 'payment_rejected') continue
    add(keyOf(record.from, record.opId), -record.amount)
    add(keyOf(record.to, record.opId), record.amount)
  }
  return balances
}

function differencesOf(actual: Map<string, number>, expected: Map<string, number>): string[] {
  const keys = new Set([...actual.keys(), ...expected.keys()])
  return [...keys]
    .filter((key) => (actual.get(key) ?? 0) !== (expected.get(key) ?? 0))
    .map((key) => `${key} ${actual.get(key) ?? 0} ≠ ${expected.get(key) ?? 0}`)
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Records in `after` that were not in `before` (by id). */
export function added<T extends { id: Id }>(before: readonly T[], after: readonly T[]): T[] {
  const known = new Set(before.map((item) => item.id))
  return after.filter((item) => !known.has(item.id))
}

/** Who a step notified. */
export const notifiedUsers = (step: Pick<Step<CommandName>, 'notifications'>) =>
  [...new Set(step.notifications.map((n) => n.userId))].sort()

/**
 * JSON with object keys sorted, so two values compare by content. Undefined fields count as
 * absent; big integers (decoded calldata) read as `<digits>n`.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint'
      ? `${item}n`
      : item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : item,
  )
}

export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b)

/** `same`, as a check whose failure shows both sides. */
export function checkSame(t: Checker, name: string, actual: unknown, expected: unknown): boolean {
  return t.check(name, same(actual, expected), `got ${canonical(actual)}, expected ${canonical(expected)}`)
}

export function messageOf(error: unknown): string {
  if (error instanceof DomainError) return `${error.code}: ${error.message}`
  if (error instanceof Error) return error.message.split('\n')[0] ?? error.name
  return String(error)
}

const callList = (calls: readonly LedgerCall[]) => `[${calls.join(', ')}]`

/** Top-level fields of the input that the schema dropped (the engine would never see them). */
function droppedKeys(input: unknown, parsed: unknown): string[] {
  if (!input || typeof input !== 'object' || !parsed || typeof parsed !== 'object') return []
  return Object.keys(input).filter(
    (key) => (input as Record<string, unknown>)[key] !== undefined && !(key in (parsed as object)),
  )
}

export type DecodedCall = { label: string; name: string; args: readonly unknown[] }

/** A genesis's calls, decoded with the ledger's ABI. */
export function decodeGenesis(genesis: Pick<Genesis, 'calls'>): DecodedCall[] {
  return genesis.calls.map((call) => {
    const decoded = decodeFunctionData({ abi: viatikLedgerAbi, data: call.data }) as unknown as {
      functionName: string
      args?: readonly unknown[]
    }
    return { label: call.label, name: decoded.functionName, args: decoded.args ?? [] }
  })
}

/** An uploaded file, as the API passes it on after verifying the upload. */
export function file(name: string): EvidenceDraft {
  return {
    kind: 'file',
    name,
    mimeType: 'application/pdf',
    sizeBytes: 48_000,
    sha256: sha256(stringToHex(`smoke:${name}`)).slice(2),
  }
}

export const link = (name: string, url: string): EvidenceDraft => ({ kind: 'link', name, url })

/** A day (YYYY-MM-DD) `days` before `now`. */
export const dayBefore = (now: ISODate, days = 0) =>
  new Date(Date.parse(now) - days * 24 * HOUR).toISOString().slice(0, 10)

/** `iso` plus whole hours. */
export const plusHours = (iso: ISODate, hours: number) =>
  new Date(Date.parse(iso) + hours * HOUR).toISOString()

/** Throws when a record the scenario relies on is missing. */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} is missing`)
  return value
}

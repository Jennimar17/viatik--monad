import { createIdFactory, createRandom, pseudoSha256 } from '../ids'
import { cents, formatUsd, type Cents } from '../money'
import type {
  Activity,
  ActivityType,
  Actor,
  Evidence,
  Id,
  ISODate,
  Location,
  Movement,
  MovementKind,
  Receipt,
  ReceiptKind,
  ViatikState,
} from '../types'
import { simulatedVerification } from '../verification'

const DAY = 24 * 60 * 60 * 1000

/**
 * Small helper used by the demo seed to append records while keeping running
 * balances, so the generated history can never overdraw an account.
 */
export class SeedBuilder {
  readonly state: ViatikState
  readonly id = createIdFactory()
  readonly random = createRandom(20260923)
  private readonly balances = new Map<string, number>()
  private receiptSequence = 0

  constructor(readonly now: ISODate) {
    this.state = {
      version: 1,
      generatedAt: now,
      users: [],
      memberships: [],
      invitations: [],
      portfolios: [],
      agencies: [],
      agreements: [],
      tranches: [],
      milestones: [],
      vaults: [],
      accounts: [],
      budgets: [],
      allowances: [],
      destinations: [],
      requests: [],
      payments: [],
      bills: [],
      expenses: [],
      reconciliations: [],
      receipts: [],
      movements: [],
      agents: [],
      agentDecisions: [],
      activity: [],
      notifications: [],
      payoutAddresses: [],
      reminders: [],
      schedules: [],
    }
  }

  // ─── Time ──────────────────────────────────────────────────────────────────

  /** `days` before now, at a fixed UTC time of day. */
  ago(days: number, hour = 10, minute = 0): ISODate {
    const date = new Date(new Date(this.now).getTime() - days * DAY)
    date.setUTCHours(hour, minute, 0, 0)
    return date.toISOString()
  }

  /** `days` after now, at a fixed UTC time of day. */
  ahead(days: number, hour = 10, minute = 0): ISODate {
    return this.ago(-days, hour, minute)
  }

  /** A day in the month `offset` months from now (0 = current month). */
  inMonth(offset: number, day: number, hour = 10, minute = 0): ISODate {
    const base = new Date(this.now)
    const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, day, hour, minute))
    return date.toISOString()
  }

  isPast(date: ISODate): boolean {
    return date <= this.now
  }

  // ─── Money movements ───────────────────────────────────────────────────────

  private key(location: Location): string | null {
    switch (location.kind) {
      case 'external':
        return null
      case 'recipient':
        return null
      case 'vault':
        return `vault:${location.vaultId}`
      case 'account':
        return `account:${location.accountId}`
      case 'budget':
        return `budget:${location.budgetId}`
    }
  }

  balance(location: Location): Cents {
    const key = this.key(location)
    return cents(key ? (this.balances.get(key) ?? 0) : 0)
  }

  canMove(amount: Cents, from: Location): boolean {
    const key = this.key(from)
    return key === null || (this.balances.get(key) ?? 0) >= amount
  }

  move(
    kind: MovementKind,
    amount: Cents,
    from: Location,
    to: Location,
    meta: {
      at: ISODate
      portfolioId: Id
      agencyId?: Id
      agreementId?: Id
      refId?: Id
      receiptId?: Id
      /** A give-back: the advance (money for purchases) it returns money for. */
      settlesPaymentId?: Id
    },
  ): Movement {
    if (amount <= 0) throw new Error(`Movement amount must be positive (${kind})`)
    if (!this.canMove(amount, from)) {
      throw new Error(
        `Seed would overdraw ${this.key(from)} by ${amount - this.balance(from)} cents (${kind})`,
      )
    }
    const fromKey = this.key(from)
    const toKey = this.key(to)
    if (fromKey) this.balances.set(fromKey, (this.balances.get(fromKey) ?? 0) - amount)
    if (toKey) this.balances.set(toKey, (this.balances.get(toKey) ?? 0) + amount)
    const movement: Movement = {
      id: this.id('mv'),
      kind,
      amount,
      from,
      to,
      portfolioId: meta.portfolioId,
      agencyId: meta.agencyId,
      agreementId: meta.agreementId,
      refId: meta.refId,
      receiptId: meta.receiptId,
      // Only a give-back carries the key, as the engine's returnUnusedFunds does.
      ...(meta.settlesPaymentId ? { settlesPaymentId: meta.settlesPaymentId } : {}),
      createdAt: meta.at,
    }
    this.state.movements.push(movement)
    return movement
  }

  // ─── Records ───────────────────────────────────────────────────────────────

  receipt(input: {
    kind: ReceiptKind
    amount: Cents
    fromLabel: string
    toLabel: string
    description: string
    policyLabel: string
    operationId: Id
    at: ISODate
    portfolioId: Id
    agencyId?: Id
    account: string
    evidenceIds?: Id[]
  }): Receipt {
    this.receiptSequence += 1
    const year = new Date(input.at).getUTCFullYear()
    const receipt: Receipt = {
      id: this.id('rcpt'),
      number: `VTK-${year}-${String(this.receiptSequence).padStart(6, '0')}`,
      kind: input.kind,
      amount: input.amount,
      fromLabel: input.fromLabel,
      toLabel: input.toLabel,
      description: input.description,
      policyLabel: input.policyLabel,
      portfolioId: input.portfolioId,
      agencyId: input.agencyId,
      operationId: input.operationId,
      evidenceIds: input.evidenceIds ?? [],
      issuedAt: input.at,
      verified: simulatedVerification({
        operationId: input.operationId,
        account: input.account,
        timestamp: input.at,
        contractPolicy: input.policyLabel,
      }),
    }
    this.state.receipts.push(receipt)
    return receipt
  }

  activity(
    type: ActivityType,
    actor: Actor,
    summary: string,
    entity: { kind: string; id: Id },
    at: ISODate,
    extra: { portfolioId: Id; agencyId?: Id; amount?: Cents; subjectUserId?: Id },
  ): Activity {
    const record: Activity = {
      id: this.id('act'),
      type,
      actor,
      entity,
      summary,
      createdAt: at,
      ...extra,
    }
    this.state.activity.push(record)
    return record
  }

  notify(userId: Id, title: string, body: string, href: string, at: ISODate, read = false) {
    this.state.notifications.push({
      id: this.id('ntf'),
      userId,
      title,
      body,
      href,
      createdAt: at,
      readAt: read ? at : undefined,
    })
  }

  evidence(
    kind: Evidence['kind'],
    name: string,
    addedBy: Id,
    at: ISODate,
    extra: Partial<Pick<Evidence, 'url' | 'mimeType' | 'sizeBytes'>> = {},
  ): Evidence {
    const id = this.id('ev')
    return { id, kind, name, addedBy, addedAt: at, sha256: pseudoSha256(`${id}:${name}`), ...extra }
  }

  /** Random amount between two whole-dollar bounds, with realistic cents. */
  amountBetween(minDollars: number, maxDollars: number, roundCents = false): Cents {
    const dollars = this.random.int(minDollars, maxDollars)
    const fraction = roundCents ? 0 : this.random.pick([0, 0, 20, 40, 50, 80, 90, 99])
    return cents(dollars * 100 + fraction)
  }
}

export const usdLabel = (value: Cents) => formatUsd(value, { withCode: true })

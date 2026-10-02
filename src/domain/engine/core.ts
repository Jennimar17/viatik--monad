import { linkFingerprint, noteFingerprint, standInFingerprint } from '../evidence'
import { newId } from '../ids'
import { formatUsd, type Cents } from '../money'
import { decide, type Capability, type PermissionContext, type Subject } from '../permissions'
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

export type DomainErrorCode =
  | 'forbidden'
  | 'self_approval'
  | 'not_found'
  | 'invalid_state'
  | 'validation'
  | 'insufficient_funds'
  | 'policy_rejected'
  | 'limit_exceeded'

/** Errors carry product-language messages that can be shown as-is. */
export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export type VerifyInput = { operationId: Id; account: string; contractPolicy: string; timestamp: ISODate }

/**
 * Everything a command needs besides state and input. `verify` is where the
 * ledger adapter plugs in: the mock returns simulated details immediately;
 * the Monad adapter settles first and passes the confirmed details in.
 */
export type CommandContext = {
  actor: Actor
  now: ISODate
  verify?: (input: VerifyInput) => Receipt['verified']
}

export class Tx {
  constructor(
    readonly state: ViatikState,
    readonly ctx: CommandContext,
  ) {}

  get now() {
    return this.ctx.now
  }

  get actor() {
    return this.ctx.actor
  }

  get userId(): Id {
    if (this.ctx.actor.kind !== 'user')
      throw new DomainError('forbidden', 'This action needs a signed-in person.')
    return this.ctx.actor.userId
  }

  subject(): Subject {
    const actor = this.ctx.actor
    const memberships =
      actor.kind === 'user' ? this.state.memberships.filter((m) => m.userId === actor.userId) : []
    return { actor, memberships }
  }

  /** Throws unless the actor may perform `capability` in the given scope. */
  authorize(capability: Capability, context: PermissionContext = {}) {
    const decision = decide(this.subject(), capability, { agencies: this.state.agencies, ...context })
    if (decision.allowed) return decision
    if (decision.reason === 'self_approval') {
      throw new DomainError('self_approval', 'You created this request, so someone else must approve it.')
    }
    throw new DomainError('forbidden', 'You do not have permission to do this.', {
      capability,
      reason: decision.reason,
    })
  }

  find<K extends keyof ViatikState>(collection: K, id: Id, label: string) {
    const list = this.state[collection] as unknown as { id: Id }[]
    const record = list.find((item) => item.id === id)
    if (!record) throw new DomainError('not_found', `${label} not found.`)
    return record as ViatikState[K] extends (infer T)[] ? T : never
  }

  nameOf(userId: Id | undefined): string {
    const user = this.state.users.find((u) => u.id === userId)
    return user?.name.trim() || user?.email.split('@')[0] || 'Someone'
  }

  actorName(actor: Actor = this.ctx.actor): string {
    if (actor.kind === 'user') return this.nameOf(actor.userId)
    if (actor.kind === 'ai_agent')
      return this.state.agents.find((a) => a.id === actor.agentId)?.name ?? 'Automation'
    return 'Viatik'
  }

  actorKey(actor: Actor = this.ctx.actor): string {
    return actor.kind === 'user' ? actor.userId : actor.kind === 'ai_agent' ? actor.agentId : 'system'
  }

  move(
    kind: MovementKind,
    amount: Cents,
    from: Location,
    to: Location,
    meta: { portfolioId: Id; agencyId?: Id; agreementId?: Id; refId?: Id; receiptId?: Id },
  ): Movement {
    const movement: Movement = { id: newId('mv'), kind, amount, from, to, createdAt: this.now, ...meta }
    this.state.movements.push(movement)
    return movement
  }

  receipt(input: {
    kind: ReceiptKind
    amount: Cents
    fromLabel: string
    toLabel: string
    description: string
    policyLabel: string
    operationId: Id
    portfolioId: Id
    agencyId?: Id
    evidenceIds?: Id[]
  }): Receipt {
    const verify = this.ctx.verify ?? ((v: VerifyInput) => simulatedVerification(v))
    const sequence = this.state.receipts.length + 1
    const receipt: Receipt = {
      id: newId('rcpt'),
      number: `VTK-${new Date(this.now).getUTCFullYear()}-${String(sequence).padStart(6, '0')}`,
      issuedAt: this.now,
      evidenceIds: input.evidenceIds ?? [],
      ...input,
      verified: verify({
        operationId: input.operationId,
        account: this.actorKey(),
        contractPolicy: input.policyLabel,
        timestamp: this.now,
      }),
    }
    this.state.receipts.push(receipt)
    return receipt
  }

  activity(
    type: ActivityType,
    summary: string,
    entity: { kind: string; id: Id },
    extra: { portfolioId: Id; agencyId?: Id; amount?: Cents; subjectUserId?: Id; actor?: Actor },
  ): Activity {
    const { actor, ...rest } = extra
    const record: Activity = {
      id: newId('act'),
      type,
      actor: actor ?? this.actor,
      entity,
      summary,
      createdAt: this.now,
      ...rest,
    }
    this.state.activity.unshift(record)
    return record
  }

  notify(userIds: Id[], title: string, body: string, href: string) {
    for (const userId of new Set(userIds)) {
      if (this.ctx.actor.kind === 'user' && this.ctx.actor.userId === userId) continue
      this.state.notifications.unshift({ id: newId('ntf'), userId, title, body, href, createdAt: this.now })
    }
  }

  /** Active user ids holding `role` in an agency or the portfolio. */
  holders(role: 'investor' | 'agency_admin' | 'member', scope: { agencyId?: Id; portfolioId?: Id }): Id[] {
    return this.state.memberships
      .filter(
        (m) =>
          m.status === 'active' &&
          m.role === role &&
          ((scope.agencyId && m.scope.kind === 'agency' && m.scope.agencyId === scope.agencyId) ||
            (scope.portfolioId && m.scope.kind === 'portfolio' && m.scope.portfolioId === scope.portfolioId)),
      )
      .map((m) => m.userId)
  }

  portfolioOfAgency(agencyId: Id): Id {
    const agency = this.state.agencies.find((a) => a.id === agencyId)
    if (!agency) throw new DomainError('not_found', 'Agency not found.')
    return agency.portfolioId
  }
}

export const usdText = (value: Cents) => formatUsd(value, { withCode: true })

export function requirePositive(amount: Cents, label = 'Amount') {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new DomainError('validation', `${label} must be greater than zero.`)
  }
}

/** What a person attaches: a file's metadata, a link or a note. */
export type EvidenceDraft = Pick<Evidence, 'kind' | 'name' | 'url' | 'mimeType' | 'sizeBytes'> & {
  /** SHA-256 of an uploaded file's content (hex). The API only accepts it for files it has verified. */
  sha256?: string
}

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * A stored piece of evidence. Only the known draft fields are copied, so a
 * caller can never choose the record id or add fields of its own; links must
 * be http(s) because they are rendered as anchors for other people.
 */
export function evidenceFrom(draft: EvidenceDraft, addedBy: Id, now: ISODate): Evidence {
  const id = newId('ev')
  const name = requireText(draft.name, 'Document name', 300)
  const isFile = draft.kind === 'file'
  // Only links have a URL, and only files have a type, a size and an uploaded fingerprint.
  const url = draft.url?.trim() || undefined
  if (draft.kind === 'link') {
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new DomainError('validation', 'Links must start with http:// or https://.')
    }
  } else if (url) {
    throw new DomainError('validation', 'Only links can point to a web address.')
  }
  if (draft.sha256 !== undefined && (!isFile || !SHA256_HEX.test(draft.sha256))) {
    throw new DomainError('validation', 'This file could not be verified. Upload it again.')
  }
  const sha256 =
    draft.sha256 ??
    (draft.kind === 'link'
      ? linkFingerprint(url as string)
      : draft.kind === 'note'
        ? noteFingerprint(name)
        : standInFingerprint(id, name))
  return {
    id,
    kind: draft.kind,
    name,
    url: draft.kind === 'link' ? url : undefined,
    mimeType: isFile ? draft.mimeType : undefined,
    sizeBytes: isFile ? draft.sizeBytes : undefined,
    sha256,
    addedAt: now,
    addedBy,
  }
}

export function requireText(value: string | undefined, label: string, max = 280): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) throw new DomainError('validation', `${label} is required.`)
  if (trimmed.length > max)
    throw new DomainError('validation', `${label} must be ${max} characters or fewer.`)
  return trimmed
}

/** Applies a command to a deep copy of the state; the input state is never mutated. */
export function execute<R>(
  state: ViatikState,
  ctx: CommandContext,
  command: (tx: Tx) => R,
): { state: ViatikState; result: R } {
  const draft = structuredClone(state)
  const tx = new Tx(draft, ctx)
  const result = command(tx)
  return { state: draft, result }
}

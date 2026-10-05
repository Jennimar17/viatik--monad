import { createHash } from 'node:crypto'

import { and, asc, desc, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Address } from 'viem'

import type { ConfirmAnswer, PendingCall } from '@/data/api-contract'
import { canonical } from '@/data/canonical'
import { applySettlement, planSettlement } from '@/data/settlement'
import { DomainError, runCommand, type CommandInput, type CommandName } from '@/domain/engine'
import type { Actor, ViatikState } from '@/domain/types'
import { needsReseed } from '@/ledger/genesis'
import { MockLedgerAdapter } from '@/ledger/mock'
import type { MonadLedgerAdapter } from '@/ledger/monad'
import type {
  ChainContext,
  ConfirmedTx,
  LedgerError,
  PreparedTx,
  SettlementPlan,
  SettlementResult,
} from '@/ledger/types'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { operations, users, type OperationRow, type OperationStatus, type UserRow } from './db/schema'
import { ApiError, ledgerStatus } from './errors'
import { verifiedFiles } from './evidence'
import { chainContextFor, requireMonad, saveBalancesAfter } from './ledger'
import { readWorld, readWorldLedger, withWorld, type DbTx } from './repository'
import { isCommandName, parseCommandInput } from './schemas'
import { requireUser, withCaller } from './user'

const KEY_TTL_MS = 24 * 60 * 60 * 1000
/** A prepared operation not found on Monad after this (with a full search) is marked expired. */
const PENDING_TTL_MS = 10 * 60 * 1000
/** A stored hash Monad has never heard of is dropped after this, and the logs are searched instead. */
const UNKNOWN_HASH_MS = 2 * 60 * 1000
/** How long a confirmation waits for the receipt before answering "still processing". */
const CONFIRM_TIMEOUT_MS = 15_000
/** How long one request may spend searching Monad's logs; the next one carries on from there. */
const SEARCH_BUDGET_MS = 20_000
/** The state read sweeps operations still pending after this, */
const SWEEP_AFTER_MS = 30_000
/** each at most this often, */
const SWEEP_EVERY_MS = 60_000
/** and never makes the read wait longer than this. */
const SWEEP_DEADLINE_MS = 2_500

const noStore = { 'cache-control': 'no-store' }
const HASH = /^0x[0-9a-fA-F]{64}$/
/** Operations that wait for their transaction, and can still be settled by it. */
const OPEN: OperationStatus[] = ['pending', 'expired']

type Hash = `0x${string}`
type Answer = { status: ContentfulStatusCode; body: unknown; replayed?: boolean; savedName?: string }
type Landed = Extract<ConfirmedTx, { status: 'confirmed' }>
type Caller = { user: UserRow; key: string; name: CommandName; requestId: string }
type Prepared = OperationRow & { prepared: PreparedTx; preparedAt: Date }

const replay = (row: OperationRow): Answer => ({
  status: row.statusCode as ContentfulStatusCode,
  body: row.response,
  replayed: true,
})

const failure = (code: string, message: string): Answer => ({
  status: ledgerStatus(code),
  body: { error: { code, message } },
})

const ledgerFailure = (error: LedgerError | undefined) =>
  failure(
    error?.code ?? 'ledger_failed',
    error?.message ?? 'The operation could not be completed. Nothing was moved.',
  )

const diverged = (message: string): Answer => ({
  status: 409,
  body: { error: { code: 'diverged', message } },
})

const conflict = () =>
  new ApiError(422, 'idempotency_conflict', 'This operation was already submitted with different details.')

const unrelated = () =>
  new ApiError(409, 'unrelated_transaction', 'This transaction is not the operation that was prepared.')

const pendingCall = (tx: PreparedTx): PendingCall => ({
  to: tx.to,
  data: tx.data,
  chainId: tx.chainId,
  from: tx.from,
  expiresAt: tx.expiresAt,
})

/**
 * The plan as the ledger sees it. A refusal's wording quotes balances at the
 * time it was written, so only its code counts.
 */
const comparable = (plan: SettlementPlan) =>
  canonical({
    ...plan,
    refusal: plan.refusal && { code: plan.refusal.code, retryable: plan.refusal.retryable },
  })

const operationOf = (user: UserRow, key: string) =>
  and(eq(operations.userId, user.id), eq(operations.idempotencyKey, key))

const isOpen = (row: OperationRow) => OPEN.includes(row.status)

/**
 * Whether the same key may prepare again: the operation expired unseen, its
 * transaction did not go through, or its role permit expired unsigned. The
 * seeded ids repeat, so the old and the new transaction can never both land.
 */
function reprepareable(row: OperationRow, now: Date) {
  if (!row.prepared) return false
  if (row.status === 'expired' || row.status === 'failed') return true
  return row.status === 'pending' && row.prepared.expiresAt != null && new Date(row.prepared.expiresAt) <= now
}

function idempotencyKey(header: string | undefined): string {
  const key = header ?? ''
  if (key.length < 8 || key.length > 120) {
    throw new ApiError(400, 'idempotency_key_required', 'Operations need an Idempotency-Key header.')
  }
  return key
}

function commandName(name: string): CommandName {
  if (!isCommandName(name)) throw new ApiError(404, 'unknown_operation', 'This operation does not exist.')
  return name
}

/** Stores what became of an operation, replacing an earlier row of the same key. */
async function saveOperation(
  tx: DbTx,
  values: Omit<typeof operations.$inferInsert, 'expiresAt'> & { expiresAt?: Date },
) {
  await tx
    .delete(operations)
    .where(and(eq(operations.userId, values.userId), eq(operations.idempotencyKey, values.idempotencyKey)))
  await tx.insert(operations).values({ expiresAt: new Date(Date.now() + KEY_TTL_MS), ...values })
}

/** Names typed in onboarding or taken from an invitation also live on the account (best effort). */
async function syncName(user: UserRow, savedName: string | undefined, requestId: string) {
  if (!savedName || savedName === user.name) return
  await getDb()
    .update(users)
    .set({ name: savedName })
    .where(eq(users.id, user.id))
    .catch((error: unknown) => console.error(`[api] ${requestId} name sync`, error))
}

/** Transactions this person's other operations already settled as: never another operation's. */
async function claimedHashes(user: UserRow, key: string): Promise<Set<string>> {
  const rows = await getDb()
    .select({ txHash: operations.txHash })
    .from(operations)
    .where(
      and(
        eq(operations.userId, user.id),
        ne(operations.idempotencyKey, key),
        isNotNull(operations.txHash),
        inArray(operations.status, ['done', 'diverged']),
      ),
    )
  return new Set(rows.map((row) => row.txHash!.toLowerCase()))
}

/**
 * Runs the command under the state lock and stores it at once: offchain
 * commands, every command on the demo ledger, and a refusal Monad gave before
 * anything was signed (`verdict`), which stays in the history.
 */
function commitLocked(
  { user, key, name }: Caller,
  input: CommandInput<CommandName>,
  fingerprint: string,
  verdict?: { plan: SettlementPlan; result: SettlementResult },
): Promise<Answer> {
  return withWorld<Answer>(async (world, tx) => {
    const now = new Date()
    const nowIso = now.toISOString()
    const [previous] = await tx.select().from(operations).where(operationOf(user, key)).limit(1)
    if (previous && previous.expiresAt > now) {
      if (previous.fingerprint !== fingerprint) throw conflict()
      if (!reprepareable(previous, now)) return { state: null, result: replay(previous) }
    }

    const before = withCaller(world.state, user, nowIso) ?? world.state
    const actor: Actor = { kind: 'user', userId: user.id }
    // Ids are seeded by person and key, so a retry or the confirmation creates the same ones.
    const outcome = runCommand(before, { actor, now: nowIso, idSeed: `${user.id}:${key}` }, name, input)

    let answer: Answer = { status: 200, body: { result: outcome.result } }
    const plan = planSettlement({ before, after: outcome.state, actor })
    if (plan) {
      let settled: SettlementResult
      if (!world.ledger) {
        settled = await new MockLedgerAdapter({ latencyMs: 0, now: () => nowIso }).settle(plan, { before })
      } else if (verdict && comparable(plan) === comparable(verdict.plan)) {
        settled = verdict.result
      } else {
        // On Monad a command that moves something is prepared first; the state changed under this one.
        throw new ApiError(409, 'invalid_state', 'This changed in the meantime. Refresh and try again.')
      }
      applySettlement(before, outcome.state, plan, settled)
      if (settled.status === 'failed') {
        const refused = ledgerFailure(settled.error)
        if (!plan.keepOnFailure) {
          const { code, message } = (refused.body as { error: { code: string; message: string } }).error
          throw new ApiError(refused.status, code, message)
        }
        answer = refused
      }
    }

    await saveOperation(tx, {
      userId: user.id,
      idempotencyKey: key,
      command: name,
      fingerprint,
      status: 'done',
      statusCode: answer.status,
      response: answer.body,
    })
    return {
      state: outcome.state,
      result: { ...answer, savedName: outcome.state.users.find((u) => u.id === user.id)?.name.trim() },
    }
  })
}

/**
 * Stores what a transaction that landed (or did not) did to a prepared
 * operation, under the state lock: the command runs again at the time it was
 * prepared, with the same ids, on the current state, and must plan the same.
 * Anything else that landed is a divergence, kept for review: a transaction
 * that landed always leaves a final row.
 */
function settleConfirmation({ user, key, name, requestId }: Caller, confirmed: Landed): Promise<Answer> {
  return withWorld<Answer>(async (world, tx) => {
    const [row] = await tx.select().from(operations).where(operationOf(user, key)).for('update')
    if (!row) throw new ApiError(404, 'not_found', 'There is no operation to confirm with this key.')
    if (!isOpen(row)) return { state: null, result: replay(row) }
    const { prepared, preparedAt } = row
    if (!prepared || !preparedAt) throw new Error(`Operation ${name} has no prepared transaction.`)

    // One transaction settles one operation.
    const [claimed] = await tx
      .select({ key: operations.idempotencyKey })
      .from(operations)
      .where(
        and(
          eq(operations.txHash, confirmed.hash),
          inArray(operations.status, ['done', 'diverged']),
          ne(operations.idempotencyKey, key),
        ),
      )
      .limit(1)
    if (claimed) throw unrelated()

    const finish = async (status: OperationStatus, answer: Answer, state: ViatikState | null) => {
      await tx
        .update(operations)
        .set({ status, statusCode: answer.status, response: answer.body, txHash: confirmed.hash })
        .where(operationOf(user, key))
      const savedName = state?.users.find((u) => u.id === user.id)?.name.trim()
      return { state, result: { ...answer, savedName } }
    }
    if (world.ledger?.namespace !== prepared.namespace) {
      return finish(
        'failed',
        failure('invalid_state', 'Viatik was reset after this was prepared. It no longer applies.'),
        null,
      )
    }
    if (!confirmed.landed) return finish('failed', ledgerFailure(confirmed.result.error), null)

    const now = preparedAt.toISOString()
    const before = withCaller(world.state, user, now) ?? world.state
    const actor: Actor = { kind: 'user', userId: user.id }
    let outcome: ReturnType<typeof runCommand>
    let plan: SettlementPlan | null
    try {
      outcome = runCommand(before, { actor, now, idSeed: `${user.id}:${key}` }, name, row.input as never)
      plan = planSettlement({ before, after: outcome.state, actor })
    } catch (error) {
      if (!(error instanceof DomainError)) console.error(`[api] ${requestId} confirm re-run`, error)
      return finish(
        'diverged',
        diverged('This was recorded on Monad, but Viatik could not apply it. It is flagged for review.'),
        null,
      )
    }
    const result = confirmed.result
    if (
      !plan ||
      comparable(plan) !== comparable(prepared.plan) ||
      (result.status === 'failed' && (result.error?.code === 'rule_drift' || !plan.keepOnFailure))
    ) {
      return finish(
        'diverged',
        diverged('Monad recorded this differently from what was prepared. It is flagged for review.'),
        null,
      )
    }
    applySettlement(before, outcome.state, plan, result)
    return finish(
      'done',
      result.status === 'completed'
        ? { status: 200, body: { result: outcome.result } }
        : ledgerFailure(result.error),
      outcome.state,
    )
  })
}

/**
 * Looks for a prepared operation's transaction on Monad, from where the last
 * search stopped. Found: it is settled by the caller. Otherwise how far the
 * search got is kept, and after a full search past the deadline (and past any
 * role permit's expiry) the operation is marked expired: still confirmable if
 * its transaction shows up, and preparable again with the same key.
 */
async function search(
  caller: Caller,
  monad: MonadLedgerAdapter,
  chain: ChainContext,
  row: Prepared,
  budgetMs = SEARCH_BUDGET_MS,
): Promise<{ found: Landed } | { answer: Answer } | { waiting: true }> {
  const found = await monad.findConfirmation(row.prepared, chain, {
    from: row.scannedTo == null ? undefined : row.scannedTo + 1,
    budgetMs,
    exclude: await claimedHashes(caller.user, caller.key),
  })
  if (found.status === 'found') return { found: found.confirmed }
  const where = operationOf(caller.user, caller.key)
  await getDb()
    .update(operations)
    .set({ scannedTo: found.scannedTo })
    .where(and(where, inArray(operations.status, OPEN)))
  const permitOpen = row.prepared.expiresAt != null && new Date(row.prepared.expiresAt) > new Date()
  const overdue = Date.now() - row.preparedAt.getTime() > PENDING_TTL_MS && !permitOpen
  // An operation already expired (or abandoned unsigned) that a full search did not find stays so.
  if (found.status === 'searched' && found.complete && row.status === 'expired')
    return { answer: replay(row) }
  if (found.status !== 'searched' || !found.complete || !overdue) return { waiting: true }
  const answer = failure(
    'expired',
    'This operation was not found on Monad in time. If it was signed, checking again later still picks it up.',
  )
  await getDb()
    .update(operations)
    .set({ status: 'expired', statusCode: answer.status, response: answer.body })
    .where(and(where, eq(operations.status, 'pending')))
  return { answer }
}

/**
 * Confirms an open operation: with a hash (given now, or stored), reads its
 * transaction; without one, or with one Monad never heard of, searches the
 * logs. Settles it when found; otherwise it is still processing. Shared by
 * `/:name/confirm` and the sweep in GET /v1/state, each with its own budget.
 */
export async function confirmOpen(
  caller: Caller,
  row: OperationRow,
  given?: Hash,
  { confirmTimeoutMs = CONFIRM_TIMEOUT_MS, searchBudgetMs = SEARCH_BUDGET_MS } = {},
): Promise<{ answer: Answer } | { processing: Hash | null }> {
  const { user, key, name, requestId } = caller
  const where = operationOf(user, key)
  const open = and(where, inArray(operations.status, OPEN))
  const { prepared, preparedAt } = row
  if (!prepared || !preparedAt) throw new Error(`Operation ${name} has no prepared transaction.`)

  const ledger = await readWorldLedger()
  if (!ledger || ledger.namespace !== prepared.namespace) {
    // Reset while this waited: it belongs to a story that is gone.
    const reset = failure('invalid_state', 'Viatik was reset after this was prepared. It no longer applies.')
    await getDb()
      .update(operations)
      .set({ status: 'failed', statusCode: reset.status, response: reset.body })
      .where(open)
    const [after] = await getDb().select().from(operations).where(where).limit(1)
    return { answer: after ? replay(after) : reset }
  }
  const monad = requireMonad()
  const chain = await chainContextFor(ledger)
  const settle = async (confirmed: Landed) => {
    const answer = await settleConfirmation(caller, confirmed)
    if (confirmed.landed) await saveBalancesAfter(monad, chain, confirmed.block, requestId)
    return { answer }
  }

  let hash = given ?? (row.txHash as Hash | null) ?? undefined
  if (hash && (await claimedHashes(user, key)).has(hash.toLowerCase())) {
    if (given) throw unrelated()
    await getDb()
      .update(operations)
      .set({ txHash: null })
      .where(and(open, eq(operations.txHash, hash)))
    hash = undefined
  }
  if (hash) {
    const confirmed = await monad.confirm(prepared, hash, chain, { timeoutMs: confirmTimeoutMs })
    if (confirmed.status === 'confirmed') return settle(confirmed)
    // Forget a stored hash that is not this operation, or that Monad never heard of after a while
    // (dropped, replaced, mistyped): the next confirmation searches the logs instead.
    const stale =
      confirmed.status === 'unrelated' ||
      (!given &&
        Date.now() - preparedAt.getTime() > UNKNOWN_HASH_MS &&
        (await monad.knowsTransaction(hash)) === false)
    if (stale) {
      await getDb()
        .update(operations)
        .set({ txHash: null })
        .where(and(open, eq(operations.txHash, hash)))
    }
    if (confirmed.status === 'unrelated') {
      const [after] = await getDb().select().from(operations).where(where).limit(1)
      if (after && !isOpen(after)) return { answer: replay(after) }
      throw unrelated()
    }
    if (!stale) {
      if (given && given !== row.txHash) await getDb().update(operations).set({ txHash: given }).where(open)
      return { processing: hash }
    }
  }

  const searched = await search(caller, monad, chain, { ...row, prepared, preparedAt }, searchBudgetMs)
  if ('found' in searched) return settle(searched.found)
  if ('answer' in searched) return { answer: searched.answer }
  return { processing: null }
}

/** When each operation was last swept on this server, so a poll every 15 s does not repeat the work. */
const swept = new Map<string, number>()

/**
 * The sweep behind GET /v1/state: the caller's operations still pending after
 * 30 s get a short look, so one whose tab closed after signing (or that was
 * signed on another device) settles on its own. Each read looks at the newest
 * (the likeliest to have landed) and the oldest (so one never signed gets
 * marked expired), each at most once a minute, and never makes the read wait
 * more than a couple of seconds: an unfinished look carries on in the background.
 */
export async function sweepOpenOperations(user: UserRow, requestId: string): Promise<void> {
  const work = (async () => {
    const due = and(
      eq(operations.userId, user.id),
      eq(operations.status, 'pending'),
      lt(operations.preparedAt, new Date(Date.now() - SWEEP_AFTER_MS)),
    )
    const [newest] = await getDb()
      .select()
      .from(operations)
      .where(due)
      .orderBy(desc(operations.preparedAt))
      .limit(1)
    if (!newest) return
    const [oldest] = await getDb()
      .select()
      .from(operations)
      .where(due)
      .orderBy(asc(operations.preparedAt))
      .limit(1)
    const rows = oldest && oldest.idempotencyKey !== newest.idempotencyKey ? [newest, oldest] : [newest]
    for (const row of rows) {
      const id = `${user.id}:${row.idempotencyKey}`
      if (!isCommandName(row.command) || Date.now() - (swept.get(id) ?? 0) < SWEEP_EVERY_MS) continue
      swept.set(id, Date.now())
      try {
        const outcome = await confirmOpen(
          { user, key: row.idempotencyKey, name: row.command, requestId },
          row,
          undefined,
          {
            confirmTimeoutMs: 0,
            searchBudgetMs: 2_000,
          },
        )
        if ('answer' in outcome) await syncName(user, outcome.answer.savedName, requestId)
      } catch (error) {
        console.error(
          `[api] ${requestId} sweep ${row.idempotencyKey}: ${error instanceof ApiError ? error.code : String(error)}`,
        )
      }
    }
    if (swept.size > 1_000) swept.clear()
  })().catch((error: unknown) => console.error(`[api] ${requestId} sweep`, error))
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, SWEEP_DEADLINE_MS))])
}

/**
 * `POST /v1/commands/:name`: runs one domain command for the signed-in person.
 *
 * A world on the demo ledger runs it, settles what it moves under the
 * contract's limits and stores the result at once, holding the state lock.
 *
 * A world bound to Monad runs the command and plans it on a snapshot, then
 * prepares the plan (encoded and simulated from the person's account) with
 * no lock held during the RPC calls, and stores only a pending operation: 202
 * with the transaction to sign. The state changes when `/:name/confirm` reads
 * the result from Monad. Commands that move nothing, and refusals Monad gives
 * before anything is signed that must stay in the history (a payment request
 * over its limit), are stored at once under the lock. Setup and network
 * failures store nothing: the same key can try again.
 *
 * `POST /v1/commands/:name/confirm` (same key, `{ txHash? }`): reads what the
 * transaction recorded and settles it (`settleConfirmation`). Without a hash,
 * or with one Monad never heard of, it searches Monad's logs (`search`). Not
 * final yet: 202, ask again.
 */
export const commands = new Hono<AppEnv>()
  .post(
    '/:name',
    requireAccount,
    requireUser,
    bodyLimit({
      maxSize: 512 * 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'This operation is too large to process.')
      },
    }),
    async (c) => {
      const user = c.get('user')
      const caller: Caller = {
        user,
        key: idempotencyKey(c.req.header('idempotency-key')),
        name: commandName(c.req.param('name')),
        requestId: c.get('requestId'),
      }
      const { key, name } = caller
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiError(400, 'invalid_json', 'The request body must be JSON.')
      })
      const input = parseCommandInput(name, body)
      // Attached files must be this person's verified uploads
      // (their type and size are taken from the upload, before the fingerprint below).
      await verifiedFiles(user.id, input)
      const fingerprint = createHash('sha256')
        .update(`${name}:${canonical(input)}`)
        .digest('hex')
      const respond = async (answer: Answer) => {
        await syncName(user, answer.savedName, caller.requestId)
        return c.json(answer.body as object, answer.status, {
          ...noStore,
          ...(answer.replayed ? { 'idempotent-replayed': 'true' } : {}),
        })
      }

      const world = await readWorld()
      if (!world.ledger) return respond(await commitLocked(caller, input, fingerprint))
      const monad = requireMonad()
      const chain = await chainContextFor(world.ledger)

      const now = new Date()
      const [previous] = await getDb().select().from(operations).where(operationOf(user, key)).limit(1)
      if (previous && previous.expiresAt > now) {
        if (previous.fingerprint !== fingerprint) throw conflict()
        if (!reprepareable(previous, now)) return respond(replay(previous))
        // Before preparing it again: the first transaction may have landed after all.
        if (isOpen(previous) && previous.prepared && previous.preparedAt) {
          const earlier = await search(caller, monad, chain, {
            ...previous,
            prepared: previous.prepared,
            preparedAt: previous.preparedAt,
          })
          if ('found' in earlier) {
            const answer = await settleConfirmation(caller, earlier.found)
            if (earlier.found.landed)
              await saveBalancesAfter(monad, chain, earlier.found.block, caller.requestId)
            return respond(answer)
          }
          if ('waiting' in earlier) {
            throw new ApiError(
              503,
              'still_processing',
              'This operation may still be on its way. Try again in a moment.',
            )
          }
        }
      }

      // Engine and plan on a snapshot: the confirmation runs them again under the lock.
      const nowIso = now.toISOString()
      const before = withCaller(world.state, user, nowIso) ?? world.state
      const actor: Actor = { kind: 'user', userId: user.id }
      const outcome = runCommand(before, { actor, now: nowIso, idSeed: `${user.id}:${key}` }, name, input)
      const plan = planSettlement({ before, after: outcome.state, actor })
      if (!plan) return respond(await commitLocked(caller, input, fingerprint))

      // The account the person signs with now does not hold their roles on Monad (it changed since
      // the seed, or the seed gave them a placeholder): only a new seed binds it.
      if (
        needsReseed(
          user.id,
          user.walletAddress as Address | null,
          world.ledger.placeholders,
          world.ledger.accounts,
        )
      ) {
        throw new ApiError(
          409,
          'account_changed',
          'Your account is not the one Viatik was last reset with, so it cannot act on Monad. Ask an admin to reset the demo.',
        )
      }
      const prepared = await monad.prepare(plan, chain)
      if (prepared.status === 'done') {
        const { result } = prepared
        // Only the ledger's own verdict on this plan is kept; anything else stores nothing and may be retried.
        if (result.status === 'failed' && plan.keepOnFailure && result.error?.code === plan.refusal?.code) {
          return respond(await commitLocked(caller, input, fingerprint, { plan, result }))
        }
        if (result.status === 'failed') {
          const refused = ledgerFailure(result.error)
          const { code, message } = (refused.body as { error: { code: string; message: string } }).error
          throw new ApiError(refused.status, code, message)
        }
        return respond(await commitLocked(caller, input, fingerprint))
      }

      // Keep only the pending operation, unless another request with this key got there first.
      const answer: Answer = { status: 202, body: { pending: pendingCall(prepared.tx) } }
      const stored = await getDb().transaction(async (tx) => {
        const at = new Date()
        const [current] = await tx.select().from(operations).where(operationOf(user, key)).for('update')
        if (current && current.expiresAt > at) {
          if (current.fingerprint !== fingerprint) throw conflict()
          if (!reprepareable(current, at)) return replay(current)
        }
        await saveOperation(tx, {
          userId: user.id,
          idempotencyKey: key,
          command: name,
          fingerprint,
          status: 'pending',
          statusCode: answer.status,
          response: answer.body,
          input,
          prepared: prepared.tx,
          preparedAt: now,
          worldVersion: world.version,
        })
        return answer
      })
      return respond(stored)
    },
  )
  .post(
    '/:name/confirm',
    requireAccount,
    requireUser,
    bodyLimit({
      maxSize: 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'This confirmation is too large to process.')
      },
    }),
    async (c) => {
      const user = c.get('user')
      const caller: Caller = {
        user,
        key: idempotencyKey(c.req.header('idempotency-key')),
        name: commandName(c.req.param('name')),
        requestId: c.get('requestId'),
      }
      const { key, name } = caller
      const raw: unknown = await c.req.json().catch(() => null)
      const body = raw && typeof raw === 'object' ? (raw as { txHash?: unknown; abandoned?: unknown }) : {}
      if (body.txHash !== undefined && (typeof body.txHash !== 'string' || !HASH.test(body.txHash))) {
        throw new ApiError(400, 'invalid_transaction', 'This is not a transaction hash.')
      }
      const respond = async (answer: Answer) => {
        await syncName(user, answer.savedName, caller.requestId)
        return c.json(answer.body as object, answer.status, {
          ...noStore,
          ...(answer.replayed ? { 'idempotent-replayed': 'true' } : {}),
        })
      }
      const [row] = await getDb().select().from(operations).where(operationOf(user, key)).limit(1)
      if (!row || row.command !== name) {
        throw new ApiError(404, 'not_found', 'There is no operation to confirm with this key.')
      }
      if (!isOpen(row)) return respond(replay(row))
      // The browser never got to sign it (the wallet refused before sending): mark it expired, so the
      // sweep stops looking for it. A transaction that shows up for it later still settles it.
      if (body.abandoned === true && !body.txHash && !row.txHash) {
        const notSigned = failure('not_signed', 'This operation was not signed. Nothing was moved.')
        await getDb()
          .update(operations)
          .set({ status: 'expired', statusCode: notSigned.status, response: notSigned.body })
          .where(and(operationOf(user, key), eq(operations.status, 'pending')))
        const [after] = await getDb().select().from(operations).where(operationOf(user, key)).limit(1)
        return respond(after ? replay(after) : notSigned)
      }
      const outcome = await confirmOpen(caller, row, body.txHash as Hash | undefined)
      return 'processing' in outcome
        ? c.json({ processing: { txHash: outcome.processing } } satisfies ConfirmAnswer, 202, noStore)
        : respond(outcome.answer)
    },
  )

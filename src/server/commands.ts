import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { canonical } from '@/data/canonical'
import { applySettlement, planSettlement } from '@/data/settlement'
import { runCommand, type CommandName } from '@/domain/engine'
import type { Actor } from '@/domain/types'
import { MockLedgerAdapter } from '@/ledger/mock'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { operations, users } from './db/schema'
import { ApiError, ledgerStatus } from './errors'
import { verifiedFiles } from './evidence'
import { withWorld } from './repository'
import { isCommandName, parseCommandInput } from './schemas'
import { requireUser, withCaller } from './user'

const KEY_TTL_MS = 24 * 60 * 60 * 1000

type Answer = { status: ContentfulStatusCode; body: unknown; replayed?: boolean; savedName?: string }

/**
 * `POST /v1/commands/:name`: runs one domain command for the signed-in person.
 *
 * In one database transaction, holding the state row lock: replay a known
 * Idempotency-Key, make sure the caller is in the state with their verified
 * email, run the engine (the same code the demo runs in the browser), settle
 * money-moving commands on the ledger under the contract's limits, then store
 * the new state and the operation. A ledger rejection that must stay in the
 * history (a payment request over its limit) is stored and answered as an
 * error; any other failure stores nothing.
 */
export const commands = new Hono<AppEnv>().post(
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
    const key = c.req.header('idempotency-key') ?? ''
    if (key.length < 8 || key.length > 120) {
      throw new ApiError(400, 'idempotency_key_required', 'Operations need an Idempotency-Key header.')
    }
    const name = c.req.param('name')
    if (!isCommandName(name)) throw new ApiError(404, 'unknown_operation', 'This operation does not exist.')
    const body: unknown = await c.req.json().catch(() => {
      throw new ApiError(400, 'invalid_json', 'The request body must be JSON.')
    })
    const input = parseCommandInput(name, body)
    // Outside the state lock: attached files must be this person's verified uploads
    // (their type and size are taken from the upload, before the fingerprint below).
    await verifiedFiles(user.id, input)
    const fingerprint = createHash('sha256')
      .update(`${name}:${canonical(input)}`)
      .digest('hex')

    const answer = await withWorld<Answer>(async (world, tx) => {
      const now = new Date()
      const nowIso = now.toISOString()

      const [previous] = await tx
        .select()
        .from(operations)
        .where(and(eq(operations.userId, user.id), eq(operations.idempotencyKey, key)))
        .limit(1)
      if (previous && previous.expiresAt > now) {
        if (previous.fingerprint !== fingerprint) {
          throw new ApiError(
            422,
            'idempotency_conflict',
            'This operation was already submitted with different details.',
          )
        }
        return {
          state: null,
          result: {
            status: previous.statusCode as ContentfulStatusCode,
            body: previous.response,
            replayed: true,
          },
        }
      }

      const before = withCaller(world.state, user, nowIso) ?? world.state
      const actor: Actor = { kind: 'user', userId: user.id }
      // Ids are seeded by person and key, so a retry or a later confirm creates the same ones.
      const ctx = { actor, now: nowIso, idSeed: `${user.id}:${key}` }
      const outcome = runCommand(before, ctx, name as CommandName, input)

      let answer: Answer = { status: 200, body: { result: outcome.result } }
      const plan = planSettlement({ before, after: outcome.state, actor })
      if (plan) {
        // Phase 8 swaps this for the Monad ledger; the limits and error codes are the same.
        const ledger = new MockLedgerAdapter({ latencyMs: 0, now: () => nowIso })
        const settled = await ledger.settle(plan, { before })
        applySettlement(before, outcome.state, plan, settled)
        if (settled.status === 'failed') {
          const code = settled.error?.code ?? 'ledger_failed'
          const message = settled.error?.message ?? 'The operation could not be completed. Nothing was moved.'
          if (!plan.keepOnFailure) throw new ApiError(ledgerStatus(code), code, message)
          answer = { status: ledgerStatus(code), body: { error: { code, message } } }
        }
      }

      await tx
        .delete(operations)
        .where(and(eq(operations.userId, user.id), eq(operations.idempotencyKey, key)))
      await tx.insert(operations).values({
        userId: user.id,
        idempotencyKey: key,
        command: name,
        fingerprint,
        statusCode: answer.status,
        response: answer.body,
        expiresAt: new Date(now.getTime() + KEY_TTL_MS),
      })

      return {
        state: outcome.state,
        result: { ...answer, savedName: outcome.state.users.find((u) => u.id === user.id)?.name.trim() },
      }
    })

    // Names typed in onboarding or taken from an invitation also live on the
    // account. Best effort and outside the state lock: the state is the source.
    if (answer.savedName && answer.savedName !== user.name) {
      await getDb()
        .update(users)
        .set({ name: answer.savedName })
        .where(eq(users.id, user.id))
        .catch((error: unknown) => console.error(`[api] ${c.get('requestId')} name sync`, error))
    }

    return c.json(answer.body as object, answer.status, {
      'cache-control': 'no-store',
      ...(answer.replayed ? { 'idempotent-replayed': 'true' } : {}),
    })
  },
)

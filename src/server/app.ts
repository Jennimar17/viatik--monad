import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { timing } from 'hono/timing'

import type { ApiErrorBody } from '@/data/api-contract'
import { publicEnv, readServerEnv } from '@/lib/env'

import { admin } from './admin'
import { commands } from './commands'
import { requestId, type AppEnv } from './context'
import { getDb } from './db/client'
import { toErrorResponse } from './errors'
import { evidence } from './evidence'
import { keeper } from './keeper'
import { session } from './session'
import { getMonadLedger } from './ledger'
import { ledgerView } from './ledger-view'
import { invitations, state } from './state'
import { webhooks } from './webhooks'

/** The ledger check, kept for a minute: the endpoint is public and each check costs four RPC calls. */
let ledgerChecked: { at: number; status: 'ok' | 'unavailable' | 'not_configured' } | null = null

/** Settlement on Monad: the deployment answers on the expected chain, with its token and registrar. */
async function ledgerHealth(requestId: string) {
  if (ledgerChecked && Date.now() - ledgerChecked.at < 60_000) return ledgerChecked.status
  const monad = getMonadLedger()
  let status: 'ok' | 'unavailable' | 'not_configured' = 'not_configured'
  if (monad) {
    const timeout = new Promise<{ ok: false; problem: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, problem: 'no answer within 5 s' }), 5_000),
    )
    const health = await Promise.race([monad.check(), timeout])
    status = health.ok ? 'ok' : 'unavailable'
    if (!health.ok) console.error(`[api] ${requestId} health: ledger ${health.problem}`)
  }
  ledgerChecked = { at: Date.now(), status }
  return status
}

/**
 * The Viatik API, mounted by Next at `/api`. Product routes verify the
 * caller's Privy token and run the same domain engine as the demo, on the
 * state stored in Supabase.
 */
export const app = new Hono<AppEnv>()
  .basePath('/api')
  // A Server-Timing header on every answer (DevTools ▸ Network ▸ Timing): `total`, and the steps
  // timed on the way, `auth` (Privy token) and `user` (account row) on signed-in routes, `sweep`,
  // `version` and `state` on GET /v1/state, `privy`, `db`, `wallet` and `alchemy` on POST /v1/session.
  .use('*', timing())
  .use('*', requestId)
  .get('/health', async (c) => {
    const env = readServerEnv()
    let database: 'ok' | 'unavailable' | 'not_configured' = 'not_configured'
    if (env.DATABASE_URL) {
      try {
        await getDb().execute(sql`select 1`)
        database = 'ok'
      } catch (error) {
        console.error(`[api] ${c.get('requestId')} health: database`, error)
        database = 'unavailable'
      }
    }
    // Sign-in needs Privy's public keys to verify tokens (unless a verification key is set locally).
    let accounts: 'ok' | 'unavailable' | 'not_configured' = 'not_configured'
    if (publicEnv.NEXT_PUBLIC_PRIVY_APP_ID && env.PRIVY_APP_SECRET) {
      accounts = 'ok'
      if (!env.PRIVY_JWT_VERIFICATION_KEY) {
        try {
          const keys = await fetch(
            `https://auth.privy.io/api/v1/apps/${publicEnv.NEXT_PUBLIC_PRIVY_APP_ID}/jwks.json`,
            { cache: 'no-store', signal: AbortSignal.timeout(5_000) },
          )
          if (!keys.ok) throw new Error(`status ${keys.status}`)
        } catch (error) {
          console.error(`[api] ${c.get('requestId')} health: Privy keys`, error)
          accounts = 'unavailable'
        }
      }
    }
    const ledger = await ledgerHealth(c.get('requestId'))
    return c.json(
      { ok: database === 'ok' && accounts === 'ok' && ledger !== 'unavailable', database, accounts, ledger },
      200,
      { 'cache-control': 'no-store' },
    )
  })
  .route('/v1/session', session)
  .route('/v1/state', state)
  .route('/v1/invitations', invitations)
  .route('/v1/commands', commands)
  .route('/v1/evidence', evidence)
  .route('/v1/ledger', ledgerView)
  .route('/v1/admin', admin)
  // Scheduled payments and monthly reminders when they are due: Supabase Cron (`/run`, with
  // KEEPER_TRIGGER_TOKEN) and the Admins' "Run due payments" (`/run-now`).
  .route('/v1/keeper', keeper)
  // Alchemy's deliveries (no sign-in, signed by Alchemy); absent without ALCHEMY_WEBHOOK_SIGNING_KEY.
  .route('/v1/webhooks', webhooks)

app.notFound((c) =>
  c.json<ApiErrorBody>({ error: { code: 'not_found', message: 'This endpoint does not exist.' } }, 404),
)

app.onError((error, c) => {
  const { status, code, message, expected } = toErrorResponse(error)
  if (!expected) console.error(`[api] ${c.get('requestId')}`, error)
  return c.json<ApiErrorBody>({ error: { code, message } }, status)
})

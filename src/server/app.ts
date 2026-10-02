import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

import type { ApiErrorBody } from '@/data/api-contract'
import { publicEnv, readServerEnv } from '@/lib/env'

import { admin } from './admin'
import { commands } from './commands'
import { requestId, type AppEnv } from './context'
import { getDb } from './db/client'
import { toErrorResponse } from './errors'
import { session } from './session'
import { invitations, state } from './state'

/**
 * The Viatik API, mounted by Next at `/api`. Product routes verify the
 * caller's Privy token and run the same domain engine as the demo, on the
 * state stored in Supabase.
 */
export const app = new Hono<AppEnv>()
  .basePath('/api')
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
    const accounts = publicEnv.NEXT_PUBLIC_PRIVY_APP_ID && env.PRIVY_APP_SECRET ? 'ok' : 'not_configured'
    return c.json({ ok: database === 'ok' && accounts === 'ok', database, accounts }, 200, {
      'cache-control': 'no-store',
    })
  })
  .route('/v1/session', session)
  .route('/v1/state', state)
  .route('/v1/invitations', invitations)
  .route('/v1/commands', commands)
  .route('/v1/admin', admin)

app.notFound((c) =>
  c.json<ApiErrorBody>({ error: { code: 'not_found', message: 'This endpoint does not exist.' } }, 404),
)

app.onError((error, c) => {
  const { status, code, message, expected } = toErrorResponse(error)
  if (!expected) console.error(`[api] ${c.get('requestId')}`, error)
  return c.json<ApiErrorBody>({ error: { code, message } }, status)
})

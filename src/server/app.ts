import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

import type { ApiErrorBody } from '@/data/api-contract'
import { publicEnv, readServerEnv } from '@/lib/env'

import { requestId, type AppEnv } from './context'
import { getDb } from './db/client'
import { ApiError } from './errors'
import { session } from './session'

/**
 * The Viatik API, mounted by Next at `/api`. Every product route verifies the
 * caller's Privy token; the next phases add state, commands and evidence.
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

app.notFound((c) =>
  c.json<ApiErrorBody>({ error: { code: 'not_found', message: 'This endpoint does not exist.' } }, 404),
)

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json<ApiErrorBody>({ error: { code: error.code, message: error.message } }, error.status)
  }
  console.error(`[api] ${c.get('requestId')}`, error)
  return c.json<ApiErrorBody>(
    { error: { code: 'unknown', message: 'Something went wrong. Nothing was changed.' } },
    500,
  )
})

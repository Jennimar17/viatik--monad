import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { readServerEnv } from '@/lib/env'

import { ApiError } from '../errors'
import * as schema from './schema'

type Database = PostgresJsDatabase<typeof schema>

// Dev reloads re-evaluate modules; keeping the pool on globalThis avoids leaking connections.
const cache = globalThis as unknown as { viatikDb?: { sql: postgres.Sql; db: Database } }

/**
 * Postgres on Supabase. `DATABASE_URL` is the transaction pooler (port 6543),
 * which does not support prepared statements, hence `prepare: false`.
 */
export function getDb(): Database {
  if (cache.viatikDb) return cache.viatikDb.db
  const url = readServerEnv().DATABASE_URL
  if (!url) throw new ApiError(503, 'storage_not_configured', 'Viatik is not available right now.')
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, connect_timeout: 10 })
  const db = drizzle({ client: sql, schema })
  cache.viatikDb = { sql, db }
  return db
}

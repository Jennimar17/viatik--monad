import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

import type { ViatikState } from '@/domain/types'

/**
 * Tables as they exist in Supabase. Changes are applied as Supabase
 * migrations (`create_users`, `create_world_state_and_operations`,
 * `create_uploads`) and mirrored here by hand.
 */

/** People who signed in with Privy; `id` is the product user id the domain engine uses. */
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  privyId: text('privy_id').notNull().unique(),
  email: text('email'),
  name: text('name'),
  walletAddress: text('wallet_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})

export type UserRow = typeof users.$inferSelect

/** The whole product state as one document (row id `main`), versioned on every write. */
export const worldState = pgTable('world_state', {
  id: text('id').primaryKey(),
  state: jsonb('state').$type<ViatikState>().notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A command a person ran: replayed for a retry with the same key, kept as an audit log. */
export const operations = pgTable(
  'operations',
  {
    userId: text('user_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    command: text('command').notNull(),
    fingerprint: text('fingerprint').notNull(),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.idempotencyKey] })],
)

/**
 * An evidence file in the private `evidence` bucket. Pending while the browser
 * uploads it; verified once the server has read it back and confirmed its
 * SHA-256 and size. Commands only accept files verified for their uploader.
 */
export const uploads = pgTable('uploads', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  sha256: text('sha256').notNull(),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  status: text('status').$type<'pending' | 'verified'>().notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
})

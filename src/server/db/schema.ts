import { integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type { Address } from 'viem'

import type { Id, ViatikState } from '@/domain/types'
import type { Balances, PreparedTx } from '@/ledger/types'

/**
 * Tables as they exist in Supabase. Changes are applied as Supabase
 * migrations (`create_users`, `create_world_state_and_operations`,
 * `create_uploads`, `ledger_settlement`) and mirrored here by hand.
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

/**
 * Where the world settles on Monad: the namespace of its ids, the stand-in
 * accounts its genesis gave people without one, and the last balances read
 * from the chain. Absent while the world settles on the demo ledger.
 */
export type WorldLedger = {
  namespace: string
  placeholders: Record<Id, Address>
  /** The real accounts the genesis bound (person → account); a person whose account changed since needs a re-seed. */
  accounts?: Record<Id, Address>
  /** When the genesis ran, and its transactions. */
  genesis?: { at: string; transactions: string[] }
  balances?: Balances
}

/** The whole product state as one document (row id `main`), versioned on every write. */
export const worldState = pgTable('world_state', {
  id: text('id').primaryKey(),
  state: jsonb('state').$type<ViatikState>().notNull(),
  version: integer('version').notNull().default(1),
  ledger: jsonb('ledger').$type<WorldLedger>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * What became of an operation:
 * - `pending`: prepared, waiting for the person to sign and confirm;
 * - `expired`: not found on Monad in time; its transaction can still settle it, and the same key can prepare it again;
 * - `done`: settled;
 * - `failed`: refused, or its transaction did not go through (the same key can prepare it again);
 * - `diverged`: recorded on Monad differently from what the app expected, flagged for review.
 */
export type OperationStatus = 'pending' | 'expired' | 'done' | 'failed' | 'diverged'

/** A command a person ran: replayed for a retry with the same key, kept as an audit log. */
export const operations = pgTable(
  'operations',
  {
    userId: text('user_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    command: text('command').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').$type<OperationStatus>().notNull().default('done'),
    statusCode: integer('status_code').notNull(),
    response: jsonb('response').notNull(),
    /** A pending operation: the input it ran with, to run it again when it is confirmed. */
    input: jsonb('input'),
    /** A pending operation: the transaction prepared for it, with its plan. */
    prepared: jsonb('prepared').$type<PreparedTx>(),
    /** The time the engine ran at when it was prepared; the confirmation runs it at the same time. */
    preparedAt: timestamp('prepared_at', { withTimezone: true }),
    worldVersion: integer('world_version'),
    txHash: text('tx_hash'),
    /** How far the search for its transaction got (the last block scanned), so the next one carries on. */
    scannedTo: integer('scanned_to'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.idempotencyKey] })],
)

export type OperationRow = typeof operations.$inferSelect

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

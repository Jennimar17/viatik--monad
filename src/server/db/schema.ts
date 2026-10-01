import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

/**
 * Tables as they exist in Supabase. Changes are applied as Supabase
 * migrations (the first one is `create_users`) and mirrored here by hand.
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

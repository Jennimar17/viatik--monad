import type { LinkedAccount, User } from '@privy-io/node'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { getAddress, isAddress } from 'viem'

import { ID_TOKEN_HEADER, type SessionResponse } from '@/data/api-contract'
import { newId } from '@/domain/ids'
import { readServerEnv } from '@/lib/env'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { users, type UserRow } from './db/schema'
import { getPrivy } from './privy'

type Profile = { email: string | null; name: string | null; address: `0x${string}` | null }

/**
 * The person behind a verified access token. The identity token (when the
 * client sends it and it belongs to the same person) saves a call to Privy;
 * otherwise the user is fetched by the verified id. The embedded account is
 * created right after the first sign-in, so an identity token issued before
 * that has no address yet: the API lookup then has the fresh record.
 */
async function readIdentity(privyUserId: string, identityToken: string | undefined): Promise<User> {
  const privy = getPrivy()
  if (identityToken) {
    try {
      const user = await privy.users().get({ id_token: identityToken })
      if (user.id === privyUserId && embeddedAddress(user.linked_accounts)) return user
    } catch {
      // Expired or malformed identity token: the API lookup below is authoritative.
    }
  }
  return privy.users()._get(privyUserId)
}

function embeddedAddress(accounts: LinkedAccount[]): `0x${string}` | null {
  for (const account of accounts) {
    if (account.type !== 'wallet' || account.chain_type !== 'ethereum') continue
    if (!('wallet_client_type' in account) || account.wallet_client_type !== 'privy') continue
    return isAddress(account.address) ? getAddress(account.address) : null
  }
  return null
}

/** "maya.chen+test@example.com" → "Maya Chen". */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0]?.split('+')[0] ?? ''
  const words = local.split(/[._-]+/).filter(Boolean)
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ') || email
}

function profileOf(user: User): Profile {
  let email: string | null = null
  let googleName: string | null = null
  for (const account of user.linked_accounts) {
    if (account.type === 'email') email ??= account.address
    if (account.type === 'google_oauth') {
      email ??= account.email
      googleName ??= account.name
    }
  }
  email = email?.toLowerCase() ?? null
  return {
    email,
    name: googleName ?? (email ? nameFromEmail(email) : null),
    address: embeddedAddress(user.linked_accounts),
  }
}

/**
 * Finds or creates the product user for a Privy account. Emails listed in
 * `DEMO_ACCOUNTS` take over a seeded demo person (Elena, Maya, Alex), even
 * from a new Privy account; anyone else gets a fresh id.
 */
async function upsertUser(privyId: string, profile: Profile): Promise<{ row: UserRow; isNew: boolean }> {
  const db = getDb()
  const now = new Date()
  const [existing] = await db.select().from(users).where(eq(users.privyId, privyId)).limit(1)

  if (existing) {
    const [row] = await db
      .update(users)
      .set({
        email: profile.email ?? existing.email,
        name: existing.name ?? profile.name,
        walletAddress: profile.address ?? existing.walletAddress,
        lastSeenAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
    return { row: row ?? existing, isNew: false }
  }

  const values = {
    privyId,
    email: profile.email,
    name: profile.name,
    walletAddress: profile.address,
    lastSeenAt: now,
  }
  const demoId = profile.email ? readServerEnv().DEMO_ACCOUNTS[profile.email] : undefined
  // Concurrent sign-ins (two tabs, or the refresh that records a new wallet)
  // can reach these conflicts in any order: a missing value never erases a known one.
  const keepKnown = {
    email: sql`coalesce(excluded.email, ${users.email})`,
    walletAddress: sql`coalesce(excluded.wallet_address, ${users.walletAddress})`,
    lastSeenAt: now,
  }

  const [row] = demoId
    ? // A demo person signing in from a new Privy account takes over the seeded id.
      await db
        .insert(users)
        .values({ id: demoId, ...values })
        .onConflictDoUpdate({
          target: users.id,
          set: { ...keepKnown, privyId, name: sql`coalesce(${users.name}, excluded.name)` },
        })
        .returning()
    : // Two requests for the same new person: the second keeps the first one's id.
      await db
        .insert(users)
        .values({ id: newId('u'), ...values })
        .onConflictDoUpdate({ target: users.privyId, set: keepKnown })
        .returning()

  if (!row) throw new Error('The user row was not written.')
  return { row, isNew: true }
}

/** `POST /v1/session`: who the signed-in person is, as a product user. */
export const session = new Hono<AppEnv>().post('/', requireAccount, async (c) => {
  const privyUserId = c.get('privyUserId')
  const identity = await readIdentity(privyUserId, c.req.header(ID_TOKEN_HEADER))
  const { row, isNew } = await upsertUser(privyUserId, profileOf(identity))
  return c.json<SessionResponse>(
    {
      userId: row.id,
      email: row.email,
      name: row.name,
      address: row.walletAddress && isAddress(row.walletAddress) ? getAddress(row.walletAddress) : null,
      isNew,
    },
    200,
    { 'cache-control': 'no-store' },
  )
})

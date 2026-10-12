import type { LinkedAccount, User } from '@privy-io/node'
import { eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { wrapTime } from 'hono/timing'
import { getAddress, isAddress } from 'viem'

import { ID_TOKEN_HEADER, type SessionResponse } from '@/data/api-contract'
import { newId } from '@/domain/ids'
import { readServerEnv } from '@/lib/env'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { users, type UserRow } from './db/schema'
import { getPrivy } from './privy'
import { watchAddressOnAlchemy } from './webhooks'

type Profile = { email: string | null; name: string | null; address: `0x${string}` | null }

/**
 * The person behind a verified access token. The identity token (when the
 * client sends it and it belongs to the same person) saves a call to Privy;
 * otherwise the user is fetched by the verified id.
 */
async function readIdentity(privyUserId: string, identityToken: string | undefined): Promise<User> {
  const privy = getPrivy()
  if (identityToken) {
    try {
      const user = await privy.users().get({ id_token: identityToken })
      if (user.id === privyUserId) return user
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

/**
 * Only what Privy verified: the email, and a name when Google provides one.
 * Viatik never derives a name from an email; the person types it in
 * onboarding, or it comes from the invitation they accept.
 */
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
  return {
    email: email?.toLowerCase() ?? null,
    name: googleName?.trim() || null,
    address: embeddedAddress(user.linked_accounts),
  }
}

/**
 * Every person gets an embedded account, created here rather than by Privy's
 * login modal: the modal's creation step silently stalls when its wallet
 * iframe is not ready yet (Privy React SDK 3.46), leaving people without an
 * account. The row is locked while creating, so two tabs signing in at once
 * create one account, and a person whose creation failed before gets it now.
 */
async function ensureWallet(privyId: string): Promise<`0x${string}` | null> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .select({ walletAddress: users.walletAddress })
      .from(users)
      .where(eq(users.privyId, privyId))
      .for('update')
    if (row?.walletAddress && isAddress(row.walletAddress)) return getAddress(row.walletAddress)

    const privy = getPrivy()
    let user = await privy.users()._get(privyId)
    let address = embeddedAddress(user.linked_accounts)
    if (!address) {
      user = await privy.users().pregenerateWallets(privyId, { wallets: [{ chain_type: 'ethereum' }] })
      address = embeddedAddress(user.linked_accounts)
    }
    if (address) await tx.update(users).set({ walletAddress: address }).where(eq(users.privyId, privyId))
    return address
  })
}

/**
 * Finds or creates the product user for a Privy account. Emails listed in
 * `DEMO_ACCOUNTS` take over a seeded demo person (Elena, Maya, Alex), even
 * from a new Privy account; anyone else gets a fresh id. `previousAddress` is
 * the account the row had before (null for a new row).
 */
async function upsertUser(
  privyId: string,
  profile: Profile,
): Promise<{ row: UserRow; isNew: boolean; previousAddress: string | null }> {
  const db = getDb()
  const now = new Date()
  const [existing] = await db.select().from(users).where(eq(users.privyId, privyId)).limit(1)

  if (existing) {
    // Written as SQL so a value another request just stored (for example the
    // wallet address) is never replaced by this request's older view of it.
    const [row] = await db
      .update(users)
      .set({
        email: sql`coalesce(${profile.email}::text, ${users.email})`,
        name: sql`coalesce(${users.name}, ${profile.name}::text)`,
        walletAddress: sql`coalesce(${profile.address}::text, ${users.walletAddress})`,
        lastSeenAt: now,
      })
      .where(eq(users.id, existing.id))
      .returning()
    return { row: row ?? existing, isNew: false, previousAddress: existing.walletAddress }
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
          set: {
            ...keepKnown,
            privyId,
            name: sql`coalesce(${users.name}, excluded.name)`,
            // An embedded account belongs to one Privy account: a different one
            // taking over the demo person starts without it and gets its own.
            // (SET expressions read the old row, so users.privy_id is the previous owner.)
            walletAddress: sql`case when ${users.privyId} = excluded.privy_id then coalesce(excluded.wallet_address, ${users.walletAddress}) else excluded.wallet_address end`,
          },
        })
        .returning()
    : // Two requests for the same new person: the second keeps the first one's id.
      await db
        .insert(users)
        .values({ id: newId('u'), ...values })
        .onConflictDoUpdate({ target: users.privyId, set: keepKnown })
        .returning()

  if (!row) throw new Error('The user row was not written.')
  return { row, isNew: true, previousAddress: null }
}

/** `POST /v1/session`: who the signed-in person is, as a product user. */
export const session = new Hono<AppEnv>().post('/', requireAccount, async (c) => {
  const privyUserId = c.get('privyUserId')
  const identity = await wrapTime(c, 'privy', readIdentity(privyUserId, c.req.header(ID_TOKEN_HEADER)))
  const profile = profileOf(identity)
  const { row, isNew, previousAddress } = await wrapTime(c, 'db', upsertUser(privyUserId, profile))

  let address =
    profile.address ??
    (row.walletAddress && isAddress(row.walletAddress) ? getAddress(row.walletAddress) : null)
  if (!address) {
    try {
      address = await wrapTime(c, 'wallet', ensureWallet(privyUserId))
    } catch (error) {
      // The session still works; the client asks again shortly and the next request retries.
      console.error(`[api] ${c.get('requestId')} embedded account could not be created`, error)
    }
  }
  // A Viatik account Viatik had not recorded for this person yet (just created, or first seen):
  // Alchemy starts watching it, so money sent to it is noticed. Best effort, never blocks sign-in.
  if (address && address.toLowerCase() !== previousAddress?.toLowerCase())
    await wrapTime(c, 'alchemy', watchAddressOnAlchemy(address, c.get('requestId')))

  return c.json<SessionResponse>(
    {
      userId: row.id,
      email: row.email,
      name: row.name,
      address,
      isNew,
    },
    200,
    { 'cache-control': 'no-store' },
  )
})

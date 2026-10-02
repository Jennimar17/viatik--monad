import { eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'

import { withVerifiedPerson } from '@/domain/identity'
import type { ViatikState } from '@/domain/types'

import type { AppEnv } from './context'
import { getDb } from './db/client'
import { users, type UserRow } from './db/schema'
import { ApiError } from './errors'

/**
 * Resolves the product user behind a verified Privy id (after
 * `requireAccount`). The row exists once POST /v1/session ran; a caller
 * without one signs in again, which creates it.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.privyId, c.get('privyUserId')))
    .limit(1)
  if (!user) throw new ApiError(401, 'unauthenticated', 'Sign in again to continue.')
  c.set('user', user)
  await next()
})

/**
 * The state with the caller present and their verified details applied
 * (null when nothing changes). Runs before any command, so the engine sees
 * the email the person proved: invitations depend on it.
 */
export function withCaller(state: ViatikState, user: UserRow, now: string): ViatikState | null {
  return withVerifiedPerson(state, user.id, { name: user.name, email: user.email }, { now })
}

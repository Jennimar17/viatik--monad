import { createMiddleware } from 'hono/factory'

import type { UserRow } from './db/schema'

/** Values the middleware chain sets for route handlers. */
export type AppEnv = {
  Variables: {
    requestId: string
    /** Privy DID of the caller, set only after the access token was verified. */
    privyUserId: string
    /** The caller's product user, resolved from the verified Privy id (`requireUser`). */
    user: UserRow
  }
}

/** Tags every request so a failure in the logs can be matched to what the person saw. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = c.req.header('x-request-id') ?? crypto.randomUUID()
  c.set('requestId', id)
  await next()
  c.header('x-request-id', id)
})

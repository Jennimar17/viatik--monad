import { InvalidAuthTokenError } from '@privy-io/node'
import { createMiddleware } from 'hono/factory'

import type { AppEnv } from './context'
import { unauthenticated } from './errors'
import { getPrivy } from './privy'

/**
 * Lets a request through only with a valid Privy access token
 * (`Authorization: Bearer …`). The caller's identity comes from the verified
 * token, never from anything else the client sends.
 */
export const requireAccount = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
  if (!token) throw unauthenticated()

  const privy = getPrivy()
  try {
    const claims = await privy.utils().auth().verifyAccessToken(token)
    c.set('privyUserId', claims.user_id)
  } catch (error) {
    if (error instanceof InvalidAuthTokenError) throw unauthenticated('Your session ended. Sign in again.')
    throw error
  }
  await next()
})

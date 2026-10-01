import { InvalidAuthTokenError } from '@privy-io/node'
import { createMiddleware } from 'hono/factory'

import { publicEnv } from '@/lib/env'

import type { AppEnv } from './context'
import { ApiError, unauthenticated } from './errors'
import { getPrivy } from './privy'

/** Unverified look at a token's claims, only to decide which error to answer with. */
function readClaims(token: string): Record<string, unknown> | null {
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Issued by Privy for this app and not expired: if it fails, the cause is not the token's age or audience. */
function couldBeCurrent(token: string): boolean {
  const claims = readClaims(token)
  return (
    claims !== null &&
    claims.iss === 'privy.io' &&
    claims.aud === publicEnv.NEXT_PUBLIC_PRIVY_APP_ID &&
    typeof claims.exp === 'number' &&
    claims.exp * 1000 > Date.now()
  )
}

/**
 * Lets a request through only with a valid Privy access token
 * (`Authorization: Bearer …`). The caller's identity comes from the verified
 * token, never from anything else the client sends.
 *
 * A token that is expired, malformed or meant for another app answers 401 and
 * the client signs the person out. The SDK reports a bad signature and an
 * outage of Privy's key endpoint the same way, so a token that looks current
 * but cannot be verified answers 503: the person keeps their session and can
 * try again.
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
    if (!(error instanceof InvalidAuthTokenError)) throw error
    if (!couldBeCurrent(token)) throw unauthenticated('Your session ended. Sign in again.')
    console.error(`[api] ${c.get('requestId')} access token could not be verified: ${error.message}`)
    throw new ApiError(
      503,
      'accounts_unavailable',
      'We could not confirm your sign-in right now. Please try again in a moment.',
    )
  }
  await next()
})

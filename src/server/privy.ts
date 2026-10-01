import { PrivyClient } from '@privy-io/node'

import { publicEnv, readServerEnv } from '@/lib/env'

import { ApiError } from './errors'

let client: PrivyClient | null = null

/**
 * Server-side Privy client. With `PRIVY_JWT_VERIFICATION_KEY` set, access
 * tokens are verified locally; otherwise the SDK fetches Privy's public keys
 * once and caches them.
 */
export function getPrivy(): PrivyClient {
  if (client) return client
  const appId = publicEnv.NEXT_PUBLIC_PRIVY_APP_ID
  const { PRIVY_APP_SECRET, PRIVY_JWT_VERIFICATION_KEY } = readServerEnv()
  if (!appId || !PRIVY_APP_SECRET) {
    throw new ApiError(503, 'accounts_not_configured', 'Sign-in is not available right now.')
  }
  client = new PrivyClient({
    appId,
    appSecret: PRIVY_APP_SECRET,
    // Keys pasted into a .env file usually keep their line breaks escaped.
    jwtVerificationKey: PRIVY_JWT_VERIFICATION_KEY?.replace(/\\n/g, '\n'),
  })
  return client
}

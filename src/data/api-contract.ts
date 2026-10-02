/**
 * Wire types shared by the browser and the API (`src/server`). Nothing here
 * may import server code, so client bundles can use it freely.
 */

/** Every API error has this shape; `message` is product language, safe to show. */
export type ApiErrorBody = { error: { code: string; message: string } }

/** Header that carries the Privy identity token. The access token goes in `Authorization`. */
export const ID_TOKEN_HEADER = 'privy-id-token'

/**
 * The product user the screen is showing. Sign-in is shared across tabs, so
 * a tab can hold another person's token; the server refuses to act for
 * someone other than who the screen shows.
 */
export const EXPECTED_USER_HEADER = 'viatik-user'

/** Error code of a request that never got an answer: it may or may not have run. */
export const CONNECTION_FAILED = 'connection_failed'

/** The signed-in person, resolved by the server from a verified Privy token. */
export type SessionResponse = {
  /** Product user id the domain engine uses (`u_…`). */
  userId: string
  email: string | null
  name: string | null
  /** Embedded account address, once Privy has created it. */
  address: `0x${string}` | null
  /** First sign-in of this Privy account. */
  isNew: boolean
}

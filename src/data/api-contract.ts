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

// ─── Commands settled on Monad ───────────────────────────────────────────────

type Hex = `0x${string}`

/**
 * A command that moves money on Monad, prepared and simulated by Viatik: the
 * one transaction the person's account signs (sponsored gas), sent as is.
 */
export type PendingCall = {
  to: Hex
  data: Hex
  chainId: number
  /** The account that must sign it; the browser refuses to send from another. */
  from: Hex
  /** When the role permits in it expire (null without one); after that, prepare again. */
  expiresAt: string | null
}

/**
 * `POST /v1/commands/:name`: settled (`result`, 200), or prepared and waiting
 * for the person's signature (`pending`, 202). A world on the demo ledger
 * always answers `result`.
 */
export type CommandAnswer<R = unknown> = { result: R } | { pending: PendingCall }

/**
 * `POST /v1/commands/:name/confirm`, with the same Idempotency-Key: the hash
 * of the signed transaction. Without one, Viatik looks for it on Monad.
 */
export type ConfirmRequest = { txHash?: Hex }

/** The confirmation: settled (`result`), or not final yet (`processing`, 202): confirm again shortly. */
export type ConfirmAnswer<R = unknown> = { result: R } | { processing: { txHash: Hex | null } }

// ─── Evidence files ──────────────────────────────────────────────────────────

/** What the private `evidence` bucket accepts; Storage enforces the same limits. */
export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024
export const EVIDENCE_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
] as const

/** `POST /v1/evidence`: announce a file before sending its bytes to Storage. */
export type EvidenceUploadRequest = { name: string; mimeType: string; sizeBytes: number; sha256: string }

/** Where to send the bytes: a signed Storage URL, valid for a short while. */
export type EvidenceUploadTicket = { uploadId: string; uploadUrl: string }

/** `POST /v1/evidence/:uploadId/verify`: the file as the server read it back. */
export type VerifiedUpload = {
  kind: 'file'
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

/** `GET /v1/evidence/:evidenceId/link`: a short-lived link to open a file the caller may see. */
export type EvidenceLink = { url: string }

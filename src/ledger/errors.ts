import { BaseError, HttpRequestError } from 'viem'

import type { LedgerError } from './types'

/**
 * Maps sponsorship and network failures to product language from their text.
 * Safe for the browser: it carries no contract ABI. Reverts are decoded by the
 * contract error's name on the server (`revert.ts`). The raw message is kept
 * for Developer mode only.
 */
export type TranslatedError = LedgerError & { raw: string }

const NOT_SENT: LedgerError = {
  code: 'network_unavailable',
  message: 'The network is busy. Your operation was not sent — please try again.',
  retryable: true,
}

const PATTERNS: [RegExp, LedgerError][] = [
  [
    /too many requests|rate limit/i,
    {
      code: 'sponsorship_unavailable',
      message: 'Too many operations in a short time. Wait a few seconds and try again.',
      retryable: true,
    },
  ],
  [
    /paymaster|sponsor/i,
    {
      code: 'sponsorship_unavailable',
      message: 'We could not process this right now. Please try again in a moment.',
      retryable: true,
    },
  ],
  [
    /execution reverted/i,
    { code: 'unknown', message: 'The ledger refused this operation. Nothing was moved.', retryable: false },
  ],
  [
    /already known/i,
    { code: 'already_processed', message: 'This operation was already sent.', retryable: false },
  ],
  [
    /nonce too low/i,
    {
      code: 'network_unavailable',
      message: 'Another operation from this account went first. Please try again.',
      retryable: true,
    },
  ],
  [/timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|\b50[234]\b/i, NOT_SENT],
]

/** The failure's own words: viem's short message and details, never the request body it echoes. */
function textOf(raw: unknown): string {
  if (raw instanceof BaseError) return [raw.shortMessage, raw.details].filter(Boolean).join(' · ')
  if (raw instanceof Error) return raw.message
  return String(raw)
}

export function translateLedgerError(raw: unknown): TranslatedError {
  const text = textOf(raw)
  // The RPC's own rate limit or a gateway error, before the text: viem words them generically.
  const busy =
    raw instanceof BaseError &&
    raw.walk(
      (cause) =>
        cause instanceof HttpRequestError &&
        cause.status !== undefined &&
        [429, 502, 503, 504].includes(cause.status),
    )
  if (busy) return { ...NOT_SENT, raw: text }
  for (const [pattern, error] of PATTERNS) {
    if (pattern.test(text)) return { ...error, raw: text }
  }
  return {
    code: 'unknown',
    message: 'Something went wrong while processing this operation.',
    retryable: true,
    raw: text,
  }
}

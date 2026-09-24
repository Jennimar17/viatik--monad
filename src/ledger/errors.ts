import type { LedgerError } from './types'

/**
 * Maps raw infrastructure failures to product language. Raw messages are kept
 * for Developer mode only; people see what happened and what to do next.
 */
const PATTERNS: [RegExp, LedgerError][] = [
  [
    /PerOperationLimit|LimitExceeded/i,
    {
      code: 'limit_exceeded',
      message: 'The amount is above the limit allowed by the budget rules.',
      retryable: false,
    },
  ],
  [
    /DestinationNotAllowed/i,
    {
      code: 'destination_not_allowed',
      message: 'This payment destination is not approved for this budget.',
      retryable: false,
    },
  ],
  [
    /BudgetPaused/i,
    { code: 'budget_paused', message: 'This budget is paused. New payments are on hold.', retryable: false },
  ],
  [
    /InsufficientBalance|transfer amount exceeds balance/i,
    {
      code: 'insufficient_funds',
      message: 'There are not enough available funds for this operation.',
      retryable: false,
    },
  ],
  [
    /NotAuthorized|SelfApproval|AccessControl/i,
    { code: 'not_authorized', message: 'You are not allowed to do this.', retryable: false },
  ],
  [
    /AlreadyCaptured|AlreadyReleased|nonce too low/i,
    { code: 'already_processed', message: 'This operation was already completed.', retryable: false },
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
    /timeout|fetch failed|ECONNRESET|503|502/i,
    {
      code: 'network_unavailable',
      message: 'The network is busy. Your operation was not sent — please try again.',
      retryable: true,
    },
  ],
]

export function translateLedgerError(raw: unknown): LedgerError & { raw: string } {
  const text = raw instanceof Error ? raw.message : String(raw)
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

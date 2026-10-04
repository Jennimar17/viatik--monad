import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'

import { DomainError, type DomainErrorCode } from '@/domain/engine'
import { InvalidTransitionError } from '@/domain/status'
import type { LedgerErrorCode } from '@/ledger/types'

/** An expected failure with a product-language message the client can show as-is. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const unauthenticated = (message = 'Sign in to continue.') =>
  new ApiError(401, 'unauthenticated', message)

/** Domain errors already carry product-language messages; only the status is mapped here. */
const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  forbidden: 403,
  self_approval: 403,
  not_found: 404,
  invalid_state: 409,
  already_applied: 409,
  validation: 422,
  insufficient_funds: 422,
  policy_rejected: 422,
  limit_exceeded: 422,
}

/** A rejection by the ledger (the contract's rules): the person can act on most of them. */
export function ledgerStatus(code: LedgerErrorCode | string): ContentfulStatusCode {
  switch (code) {
    case 'not_authorized':
      return 403
    case 'already_processed':
    case 'invalid_state':
    case 'not_registered':
    case 'rule_drift':
    case 'expired':
      return 409
    case 'network_unavailable':
    case 'sponsorship_unavailable':
    case 'not_configured':
    case 'still_processing':
      return 503
    default:
      return 422
  }
}

/** "allowedDestinationIds" → "allowed destinations"; the field a person can recognize. */
function fieldLabel(path: PropertyKey[]): string | null {
  const key = [...path].reverse().find((part): part is string => typeof part === 'string')
  if (!key) return null
  return key
    .replace(/Ids?$/, (match) => (match === 'Ids' ? 's' : ''))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
}

/** Turns any thrown value into a status and the `{ error: { code, message } }` body. */
export function toErrorResponse(error: unknown): {
  status: ContentfulStatusCode
  code: string
  message: string
  expected: boolean
} {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message, expected: true }
  }
  if (error instanceof DomainError) {
    return {
      status: DOMAIN_ERROR_STATUS[error.code],
      code: error.code,
      message: error.message,
      expected: true,
    }
  }
  if (error instanceof InvalidTransitionError) {
    // With several people on the same data, this usually means someone acted first.
    return {
      status: 409,
      code: 'invalid_state',
      message: 'This changed in the meantime. Refresh and try again.',
      expected: true,
    }
  }
  if (error instanceof ZodError) {
    const field = fieldLabel(error.issues[0]?.path ?? [])
    return {
      status: 422,
      code: 'validation',
      message: field ? `Check the ${field} and try again.` : 'Check the details and try again.',
      expected: true,
    }
  }
  return {
    status: 500,
    code: 'unknown',
    message: 'Something went wrong. Nothing was changed.',
    expected: false,
  }
}

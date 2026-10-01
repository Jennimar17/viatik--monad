import type { ContentfulStatusCode } from 'hono/utils/http-status'

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

import { CONNECTION_FAILED, EXPECTED_USER_HEADER, ID_TOKEN_HEADER, type ApiErrorBody } from './api-contract'
import { DataSourceError } from './data-source'

/** Privy tokens for one request. The server verifies both; the client never asserts who it is. */
export type ApiCredentials = { accessToken: string | null; identityToken?: string | null }

type ApiRequest = {
  method?: 'GET' | 'POST'
  body?: unknown
  credentials: ApiCredentials
  /** Mutations carry one so a retry never repeats an operation. */
  idempotencyKey?: string
  /** ETag of the copy the caller already has; an unchanged resource answers 304. */
  ifNoneMatch?: string
  /** Product user the screen shows; the server answers 409 if the token is someone else's. */
  expectedUserId?: string
}

/**
 * Calls the Viatik API (`/api/…`) and returns the response when it is a
 * success or a 304. Failures become `DataSourceError` with the server's
 * product-language message, the same error the demo data source throws.
 */
export async function apiRequest(path: `/${string}`, request: ApiRequest): Promise<Response> {
  const { method = 'GET', body, credentials, idempotencyKey, ifNoneMatch, expectedUserId } = request
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (credentials.accessToken) headers.authorization = `Bearer ${credentials.accessToken}`
  if (credentials.identityToken) headers[ID_TOKEN_HEADER] = credentials.identityToken
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch
  if (expectedUserId) headers[EXPECTED_USER_HEADER] = expectedUserId

  let response: Response
  try {
    // `no-store` keeps the browser cache out of the way: a 304 reaches this
    // code only when the caller asked with its own ETag.
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw connectionFailed()
  }

  if (response.status === 304 && ifNoneMatch) return response
  if (!response.ok) throw await toError(response)
  return response
}

/** `apiRequest` for a JSON answer. */
export async function apiFetch<T>(path: `/${string}`, request: ApiRequest): Promise<T> {
  const response = await apiRequest(path, request)
  try {
    return (await response.json()) as T
  } catch {
    // The answer was cut off: the operation may have run, so it is not "nothing changed".
    throw connectionFailed()
  }
}

const connectionFailed = () =>
  new DataSourceError('We could not reach Viatik. Check your connection and try again.', CONNECTION_FAILED)

async function toError(response: Response): Promise<DataSourceError> {
  try {
    const { error } = (await response.json()) as Partial<ApiErrorBody>
    if (error?.message) return new DataSourceError(error.message, error.code ?? String(response.status))
  } catch {
    // Not JSON (a proxy or platform error page): fall through to a generic message.
  }
  return new DataSourceError('Something went wrong. Please try again.', String(response.status))
}

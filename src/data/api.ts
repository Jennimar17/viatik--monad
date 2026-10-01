import { ID_TOKEN_HEADER, type ApiErrorBody } from './api-contract'
import { DataSourceError } from './data-source'

/** Privy tokens for one request. The server verifies both; the client never asserts who it is. */
export type ApiCredentials = { accessToken: string | null; identityToken?: string | null }

type ApiRequest = {
  method?: 'GET' | 'POST'
  body?: unknown
  credentials: ApiCredentials
  /** Mutations carry one so a retry never repeats an operation. */
  idempotencyKey?: string
}

/**
 * Calls the Viatik API (`/api/…`). Failures become `DataSourceError` with the
 * server's product-language message, the same error the demo data source throws.
 */
export async function apiFetch<T>(path: `/${string}`, request: ApiRequest): Promise<T> {
  const { method = 'GET', body, credentials, idempotencyKey } = request
  const headers: Record<string, string> = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (credentials.accessToken) headers.authorization = `Bearer ${credentials.accessToken}`
  if (credentials.identityToken) headers[ID_TOKEN_HEADER] = credentials.identityToken
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    throw new DataSourceError(
      'We could not reach Viatik. Check your connection and try again.',
      'network_unavailable',
    )
  }

  if (!response.ok) throw await toError(response)
  return (await response.json()) as T
}

async function toError(response: Response): Promise<DataSourceError> {
  try {
    const { error } = (await response.json()) as Partial<ApiErrorBody>
    if (error?.message) return new DataSourceError(error.message, error.code ?? String(response.status))
  } catch {
    // Not JSON (a proxy or platform error page): fall through to a generic message.
  }
  return new DataSourceError('Something went wrong. Please try again.', String(response.status))
}

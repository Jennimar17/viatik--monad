import { readServerEnv } from '@/lib/env'

import { ApiError } from './errors'

/**
 * The private `evidence` bucket in Supabase Storage, through its REST API
 * with the service role. Only the server talks to Storage with this key;
 * browsers get short-lived signed URLs for one object at a time.
 */

const BUCKET = 'evidence'
/** Signed links to open a file live this long. */
const LINK_SECONDS = 120

const unavailable = () =>
  new ApiError(503, 'storage_unavailable', 'Files are not available right now. Please try again.')

function storage() {
  const env = readServerEnv()
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new ApiError(503, 'not_configured', 'File uploads are not available right now.')
  }
  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`
  const auth = { authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY }
  return { base, auth }
}

const objectPath = (path: string) => `${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`

/** One Storage call with a deadline; an unreachable Storage is a 503, never an unexpected 500. */
async function call(url: string, init: RequestInit, action: string, ms: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(ms) })
  } catch (error) {
    console.error(`[storage] ${action} unreachable`, error)
    throw unavailable()
  }
}

async function failure(response: Response, action: string): Promise<never> {
  const detail = await response.text().catch(() => '')
  console.error(`[storage] ${action} failed with ${response.status}: ${detail.slice(0, 300)}`)
  throw unavailable()
}

async function json<T>(response: Response, action: string): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    console.error(`[storage] ${action} answered without JSON`)
    throw unavailable()
  }
}

/** A URL the browser can PUT the file to directly (the API never carries the bytes). */
export async function signedUploadUrl(path: string): Promise<string> {
  const { base, auth } = storage()
  const response = await call(
    `${base}/object/upload/sign/${objectPath(path)}`,
    { method: 'POST', headers: auth },
    'sign upload',
    10_000,
  )
  if (!response.ok) return failure(response, 'sign upload')
  const { url } = await json<{ url?: string }>(response, 'sign upload')
  if (!url) return failure(response, 'sign upload')
  return `${base}${url}`
}

/** The stored bytes and the type Storage serves them with, or null when nothing was uploaded there. */
export async function readObject(path: string): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const { base, auth } = storage()
  const response = await call(`${base}/object/${objectPath(path)}`, { headers: auth }, 'read', 30_000)
  if (response.ok) {
    try {
      const bytes = await response.arrayBuffer()
      return { bytes, contentType: response.headers.get('content-type') ?? '' }
    } catch (error) {
      console.error('[storage] read interrupted', error)
      throw unavailable()
    }
  }
  // Storage answers 400 with a NoSuchKey body for a missing object.
  const body = await response.text().catch(() => '')
  if (response.status === 404 || /NoSuchKey|not_found/i.test(body)) return null
  console.error(`[storage] read failed with ${response.status}: ${body.slice(0, 300)}`)
  throw unavailable()
}

/** Deletes an object that must not be kept (a mismatched or abandoned upload). Best effort. */
export async function deleteObject(path: string): Promise<void> {
  const { base, auth } = storage()
  try {
    const response = await call(
      `${base}/object/${BUCKET}`,
      {
        method: 'DELETE',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: [path] }),
      },
      'delete',
      10_000,
    )
    if (!response.ok) await failure(response, 'delete')
  } catch (error) {
    // Left behind, it only takes space; the row that pointed to it is gone.
    console.error('[storage] delete failed', error)
  }
}

/** A short-lived link that opens the file in the browser (Storage serves it with its own content type). */
export async function signedReadUrl(path: string): Promise<string> {
  const { base, auth } = storage()
  const response = await call(
    `${base}/object/sign/${objectPath(path)}`,
    {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: LINK_SECONDS }),
    },
    'sign read',
    10_000,
  )
  if (!response.ok) return failure(response, 'sign read')
  const { signedURL } = await json<{ signedURL?: string }>(response, 'sign read')
  if (!signedURL) return failure(response, 'sign read')
  return `${base}${signedURL}`
}

import { EVIDENCE_MAX_BYTES, EVIDENCE_MIME_TYPES } from './api-contract'
import { DataSourceError } from './data-source'

/** The checks Storage applies, run first so the person hears about them right away. */
export function assertEvidenceFile(file: File) {
  if (!(EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new DataSourceError(`${file.name} is not a PDF, PNG, JPG, WEBP or HEIC file.`, 'invalid_file')
  }
  if (file.size === 0) throw new DataSourceError(`${file.name} is empty.`, 'invalid_file')
  if (file.size > EVIDENCE_MAX_BYTES) {
    throw new DataSourceError(`${file.name} is larger than 10 MB.`, 'invalid_file')
  }
}

/** SHA-256 of the file's content, as lowercase hex (the same digest the server computes). */
export async function sha256Hex(file: File): Promise<string> {
  // Browsers only offer hashing on secure origins (https or localhost).
  if (globalThis.isSecureContext === false || !globalThis.crypto?.subtle) {
    throw new DataSourceError('Files can only be added over a secure (https) connection.', 'insecure_context')
  }
  let content: ArrayBuffer
  try {
    content = await file.arrayBuffer()
  } catch {
    throw new DataSourceError(
      `${file.name} could not be read. Remove it and choose it again.`,
      'unreadable_file',
    )
  }
  const digest = await crypto.subtle.digest('SHA-256', content)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

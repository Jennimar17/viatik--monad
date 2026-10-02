import { concat, sha256, stringToHex } from 'viem'

import { pseudoSha256 } from './ids'
import type { Evidence } from './types'

/**
 * Evidence fingerprints. A stored file's is the SHA-256 of its content; a
 * link's and a note's are SHA-256s of their text, so anyone can recompute
 * them. A milestone's submission is fingerprinted as a whole, which is the
 * value the ledger records.
 */

/** SHA-256 over the items' fingerprints, in order (0x-prefixed, 32 bytes). */
export function evidenceSetHash(items: readonly Pick<Evidence, 'sha256'>[]): `0x${string}` {
  return sha256(concat(items.map((item) => `0x${item.sha256}` as const)))
}

export const linkFingerprint = (url: string) => sha256(stringToHex(url)).slice(2)
export const noteFingerprint = (text: string) => sha256(stringToHex(`note:${text}`)).slice(2)

/** What a file recorded without an upload (the seeded story, older data) gets instead. */
export const standInFingerprint = (id: string, name: string) => pseudoSha256(`${id}:${name}:`)

/**
 * Whether a file has a stored copy that can be opened. Example files from
 * the seed and files recorded before uploads existed carry a stand-in
 * fingerprint, derived from their id and name, and nothing behind it.
 */
export function hasStoredCopy(item: Evidence): boolean {
  if (item.kind !== 'file') return false
  return (
    item.sha256 !== standInFingerprint(item.id, item.name) &&
    item.sha256 !== pseudoSha256(`${item.id}:${item.name}`)
  )
}

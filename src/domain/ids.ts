import { sha256, stringToHex } from 'viem'

/**
 * Deterministic helpers for ids and demo-only hashes. Real hashes come from
 * the ledger adapter; these exist so seeded data and the mock ledger are
 * reproducible across reloads and machines.
 */

/** Mulberry32 — tiny seeded PRNG, good enough for fixtures. */
export function createRandom(seed: number) {
  let t = seed >>> 0
  const next = () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(min: number, max: number) {
      return Math.floor(next() * (max - min + 1)) + min
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(next() * items.length)] as T
    },
    chance(probability: number) {
      return next() < probability
    },
  }
}

export type Random = ReturnType<typeof createRandom>

/** 32-bit FNV-1a. */
function fnv1a(input: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** Deterministic pseudo-hash of `bytes` length, rendered as 0x-prefixed hex. */
export function pseudoHash(input: string, bytes = 32): string {
  let out = ''
  let round = 0
  while (out.length < bytes * 2) {
    // Distinct seed per round; XOR-ing the round into both the text and the
    // seed would cancel out and repeat blocks.
    const seed = (0x811c9dc5 + Math.imul(round + 1, 0x9e3779b1)) >>> 0
    out += fnv1a(`${input}#${round}`, seed).toString(16).padStart(8, '0')
    round++
  }
  return `0x${out.slice(0, bytes * 2)}`
}

export const pseudoAddress = (input: string) => pseudoHash(`address:${input}`, 20)

/** Unprefixed digest used for evidence fingerprints in the demo. */
export const pseudoSha256 = (input: string) => pseudoHash(`sha256:${input}`, 32).slice(2)

export function createIdFactory() {
  const counters = new Map<string, number>()
  return (prefix: string) => {
    const next = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, next)
    return `${prefix}_${String(next).padStart(4, '0')}`
  }
}

/** Invitation codes are bearer secrets: never derived from a seed someone else may know. */
const ALWAYS_RANDOM = new Set(['join'])

let seeded: ((prefix: string) => string) | null = null

/**
 * Runs `run` with ids derived from `seed` (a person and an idempotency key):
 * running the same command twice on the same state creates the same ids, so
 * a transaction prepared from one run is confirmed by the next. Counters are
 * per prefix, so `pay_` stays stable even when a command notifies more people.
 */
export function withSeededIds<T>(seed: string | undefined, run: () => T): { result: T; created: string[] } {
  if (!seed) return { result: run(), created: [] }
  const previous = seeded
  const counters = new Map<string, number>()
  const created: string[] = []
  seeded = (prefix) => {
    const next = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, next)
    const id = `${prefix}_${sha256(stringToHex(`${seed}:${prefix}:${next}`)).slice(2, 14)}`
    created.push(id)
    return id
  }
  try {
    return { result: run(), created }
  } finally {
    seeded = previous
  }
}

/** Id for records created at runtime (client or server); seeded inside a command. */
export function newId(prefix: string): string {
  if (seeded && !ALWAYS_RANDOM.has(prefix)) return seeded(prefix)
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(16).slice(2, 14)
  return `${prefix}_${random}`
}

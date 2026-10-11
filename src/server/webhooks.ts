import { createHmac, timingSafeEqual } from 'node:crypto'

import { inArray, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  decodeEventLog,
  getAddress,
  isAddress,
  isAddressEqual,
  isHex,
  pad,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'

import { DomainError, execute } from '@/domain/engine'
import { noteFundsArrived } from '@/domain/engine/system'
import type { Cents } from '@/domain/money'
import type { Id } from '@/domain/types'
import { unitsToCents } from '@/ledger/units'
import { readServerEnv } from '@/lib/env'
import { testUsdAbi } from '@/web3/abi/test-usd'

import type { AppEnv } from './context'
import { getDb } from './db/client'
import { users } from './db/schema'
import { ApiError } from './errors'
import { withWorld } from './repository'

/** Alchemy delivers a few activities at a time; anything bigger than this is not a delivery. */
export const ALCHEMY_MAX_BODY_BYTES = 256 * 1024

/** Alchemy's API for changing the addresses an Address Activity webhook watches. */
const ALCHEMY_ADDRESSES_URL = 'https://dashboard.alchemy.com/api/update-webhook-addresses'
/** Adding an address must never hold a sign-in for long. */
const ALCHEMY_WATCH_TIMEOUT_MS = 4_000

const noStore = { 'cache-control': 'no-store' }

// ─── Pure pieces (checked by scripts/smoke/alchemy.ts) ──────────────────────

/** Alchemy's signature of a delivery: hex HMAC-SHA256 of the raw body, keyed with the webhook's signing key. */
export function alchemySignature(rawBody: string | Uint8Array, signingKey: string): string {
  return createHmac('sha256', signingKey).update(rawBody).digest('hex')
}

/** Whether `X-Alchemy-Signature` signs exactly this body, compared in constant time. */
export function isAlchemySignatureValid(
  rawBody: string | Uint8Array,
  signature: string | null | undefined,
  signingKey: string,
): boolean {
  const given = signature?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(given)) return false
  return timingSafeEqual(Buffer.from(given, 'hex'), Buffer.from(alchemySignature(rawBody, signingKey), 'hex'))
}

/** A TestUSD transfer into some account, as one delivery reported it. */
export type FundsArrival = {
  to: Address
  from: Address
  /** Token units (6 decimals). */
  units: bigint
  amount: Cents
  txHash: Hex
  logIndex: number
  /** Minted (from 0x0), as "Get test funds" does: told as test funds. */
  mint: boolean
}

export type AlchemyDelivery =
  /** Nothing in it concerns Viatik (another webhook, another network, another kind of event). */
  | { status: 'ignored'; reason: string }
  /** The TestUSD transfers in it worth telling someone about; `skipped` counts the other entries. */
  | { status: 'ok'; arrivals: FundsArrival[]; skipped: number }

/** One event log, whichever webhook type carried it. */
type RawLog = {
  address: unknown
  topics: unknown
  data: unknown
  /** Address Activity also gives the amount as `rawContract.rawValue`. */
  rawValue?: unknown
  txHash: unknown
  logIndex: unknown
  removed: unknown
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A log index as Alchemy writes it: a number (Custom webhooks) or a hex string (Address Activity). */
function logIndexOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value === 'string' && /^0x[0-9a-f]{1,8}$/i.test(value)) return Number.parseInt(value, 16)
  if (typeof value === 'string' && /^\d{1,9}$/.test(value)) return Number(value)
  return null
}

/** The logs of an Address Activity delivery (`event.activity[].log`) or a Custom one (`event.data.block.logs`). */
function rawLogsOf(payload: Json): RawLog[] | string {
  const event = isObject(payload.event) ? payload.event : null
  if (!event) return 'no_event'
  if (payload.type === 'ADDRESS_ACTIVITY') {
    if (!Array.isArray(event.activity)) return 'no_activity'
    return event.activity.filter(isObject).map((item) => {
      const log: Json = isObject(item.log) ? item.log : {}
      const raw: Json = isObject(item.rawContract) ? item.rawContract : {}
      return {
        address: log.address ?? raw.address,
        topics: log.topics,
        data: log.data,
        rawValue: raw.rawValue,
        txHash: log.transactionHash ?? item.hash,
        logIndex: log.logIndex,
        removed: log.removed,
      }
    })
  }
  if (payload.type === 'GRAPHQL') {
    const data = isObject(event.data) ? event.data : null
    const block = data && isObject(data.block) ? data.block : null
    if (!block || !Array.isArray(block.logs)) return 'no_logs'
    return block.logs.filter(isObject).map((log) => {
      const account: Json = isObject(log.account) ? log.account : {}
      const transaction: Json = isObject(log.transaction) ? log.transaction : {}
      return {
        address: account.address,
        topics: log.topics,
        data: log.data,
        txHash: transaction.hash,
        logIndex: log.index,
        // A failed transaction emits no logs; a reverted one reported anyway is not money that arrived.
        removed: log.removed === true || transaction.status === 0,
      }
    })
  }
  return 'unsupported_type'
}

/** An ERC20 `Transfer` decoded with TestUSD's ABI, or null when the log is anything else. */
function transferOf(topics: [Hex, Hex, Hex], data: Hex) {
  try {
    return decodeEventLog({ abi: testUsdAbi, eventName: 'Transfer', topics, data, strict: true }).args
  } catch {
    return null
  }
}

/** The TestUSD transfer a log describes, or null when it is not one Viatik tells anyone about. */
function arrivalOf(log: RawLog, token: Address, ledger: Address | undefined): FundsArrival | null {
  if (log.removed === true) return null
  if (typeof log.address !== 'string' || !isAddress(log.address) || !isAddressEqual(log.address, token))
    return null
  if (!isHex(log.txHash) || log.txHash.length !== 66) return null
  const logIndex = logIndexOf(log.logIndex)
  if (logIndex === null) return null
  if (!Array.isArray(log.topics) || log.topics.length !== 3 || !log.topics.every((t) => isHex(t))) return null
  const topics = log.topics as [Hex, Hex, Hex]
  // The amount is the log's data; Address Activity repeats it as rawContract.rawValue.
  const data =
    isHex(log.data) && log.data.length === 66
      ? log.data
      : isHex(log.rawValue) && log.rawValue.length <= 66
        ? pad(log.rawValue, { size: 32 })
        : null
  if (!data) return null
  const transfer = transferOf(topics, data)
  if (!transfer) return null
  const { from, to, value } = transfer
  // Withdrawals from the ledger: the app already follows them until they show. Mints (from 0x0, as
  // "Get test funds" does) are kept and told as test funds.
  if (ledger && isAddressEqual(from, ledger)) return null
  if (isAddressEqual(to, zeroAddress) || value <= 0n) return null
  let amount: Cents
  try {
    amount = unitsToCents(value).cents
  } catch {
    return null
  }
  if (amount <= 0) return null
  return {
    to: getAddress(to),
    from: getAddress(from),
    units: value,
    amount,
    txHash: log.txHash.toLowerCase() as Hex,
    logIndex,
    mint: isAddressEqual(from, zeroAddress),
  }
}

/**
 * The TestUSD transfers into accounts in a verified Alchemy delivery: an
 * Address Activity webhook, or a Custom (GraphQL) one on the token's logs.
 * Deliveries from another webhook (when `webhookId` is set) or a mainnet are
 * ignored. Transfers dropped by a reorg, withdrawals from the ledger, sub-cent
 * amounts and the same log twice are left out; mints from 0x0 are kept (`mint`).
 */
export function arrivalsOf(
  payload: unknown,
  options: { token: Address; ledger?: Address; webhookId?: string },
): AlchemyDelivery {
  if (!isObject(payload)) return { status: 'ignored', reason: 'not_an_object' }
  if (options.webhookId && payload.webhookId !== options.webhookId)
    return { status: 'ignored', reason: 'other_webhook' }
  const network = isObject(payload.event) ? payload.event.network : undefined
  // Viatik runs on Monad Testnet only. The exact name Alchemy sends is not pinned down, so only a
  // mainnet is refused.
  if (typeof network === 'string' && /MAINNET/i.test(network))
    return { status: 'ignored', reason: 'other_network' }
  const logs = rawLogsOf(payload)
  if (typeof logs === 'string') return { status: 'ignored', reason: logs }
  const arrivals: FundsArrival[] = []
  const seen = new Set<string>()
  for (const log of logs) {
    const arrival = arrivalOf(log, options.token, options.ledger)
    if (!arrival) continue
    const key = `${arrival.txHash}:${arrival.logIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    arrivals.push(arrival)
  }
  return { status: 'ok', arrivals, skipped: logs.length - arrivals.length }
}

/** The idempotency seed of one transfer: the same log delivered again creates the same notification id. */
export const arrivalSeed = (arrival: Pick<FundsArrival, 'txHash' | 'logIndex'>) =>
  `alchemy:${arrival.txHash.toLowerCase()}:${arrival.logIndex}`

// ─── Server pieces ───────────────────────────────────────────────────────────

/** The person each address belongs to. An address two people claim belongs to neither (as in `chainContextFor`). */
async function holdersOf(addresses: Address[]): Promise<Map<string, Id>> {
  const lowered = [...new Set(addresses.map((address) => address.toLowerCase()))]
  if (lowered.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: users.id, wallet: users.walletAddress })
    .from(users)
    .where(inArray(sql`lower(${users.walletAddress})`, lowered))
  const claims = new Map<string, Id[]>()
  for (const row of rows) {
    if (!row.wallet) continue
    const key = row.wallet.toLowerCase()
    claims.set(key, [...(claims.get(key) ?? []), row.id])
  }
  const holders = new Map<string, Id>()
  for (const [address, ids] of claims) if (ids.length === 1) holders.set(address, ids[0]!)
  return holders
}

/**
 * `POST /v1/webhooks/alchemy`: Alchemy reports TestUSD arriving in a person's
 * Viatik account, and they get a "Funds arrived" notification ("Test funds
 * arrived" for a mint; their screens then read the balance again). Without ALCHEMY_WEBHOOK_SIGNING_KEY the route
 * does not exist. No sign-in: the body must carry Alchemy's signature. The
 * notification is written before answering 200; a failure answers 5xx so
 * Alchemy delivers it again, and a transfer delivered twice is told once.
 * Addresses Viatik does not know are answered 200 with nothing written, and
 * so are arrivals under 1.00 USD and arrivals while the person still has an
 * unread "Funds arrived" from the last 10 minutes (`noteFundsArrived`).
 *
 * `GET /v1/webhooks/alchemy/status` says, without sign-in, whether this
 * deployment hears from Alchemy at all: the screens where someone waits for
 * money poll faster only then.
 */
export const webhooks = new Hono<AppEnv>()
  .get('/alchemy/status', (c) => {
    const env = readServerEnv()
    return c.json({ enabled: Boolean(env.ALCHEMY_WEBHOOK_SIGNING_KEY && env.TEST_USD_ADDRESS) }, 200, noStore)
  })
  .post(
    '/alchemy',
    async (_c, next) => {
      if (!readServerEnv().ALCHEMY_WEBHOOK_SIGNING_KEY)
        throw new ApiError(404, 'not_found', 'This endpoint does not exist.')
      await next()
    },
    bodyLimit({
      maxSize: ALCHEMY_MAX_BODY_BYTES,
      onError: () => {
        throw new ApiError(413, 'too_large', 'This request is too large.')
      },
    }),
    async (c) => {
      const env = readServerEnv()
      const raw = new Uint8Array(await c.req.arrayBuffer())
      if (
        !isAlchemySignatureValid(raw, c.req.header('x-alchemy-signature'), env.ALCHEMY_WEBHOOK_SIGNING_KEY!)
      )
        throw new ApiError(401, 'unauthenticated', 'A valid signature is required.')
      let payload: unknown
      try {
        payload = JSON.parse(Buffer.from(raw).toString('utf8'))
      } catch {
        throw new ApiError(400, 'invalid_json', 'The request body must be JSON.')
      }
      if (!env.TEST_USD_ADDRESS) return c.json({ ok: true, ignored: 'token_not_configured' }, 200, noStore)

      const delivery = arrivalsOf(payload, {
        token: env.TEST_USD_ADDRESS,
        ledger: env.VIATIK_LEDGER_ADDRESS,
        webhookId: env.ALCHEMY_WEBHOOK_ID,
      })
      if (delivery.status === 'ignored') return c.json({ ok: true, ignored: delivery.reason }, 200, noStore)

      const holders = await holdersOf(delivery.arrivals.map((arrival) => arrival.to))
      const known = delivery.arrivals.flatMap((arrival) => {
        const userId = holders.get(arrival.to.toLowerCase())
        return userId ? [{ arrival, userId }] : []
      })
      const counts = {
        notified: 0,
        duplicates: 0,
        unknown: delivery.arrivals.length - known.length,
        small: 0,
        recent: 0,
      }
      if (known.length > 0) {
        const now = new Date().toISOString()
        const written = await withWorld(async (world) => {
          let state = world.state
          const tally = { notified: 0, duplicates: 0, unknown: 0, small: 0, recent: 0 }
          for (const { arrival, userId } of known) {
            try {
              // Always the transfer's own seed, also when nothing is written: a transfer delivered
              // again is still recognized (already_applied).
              const outcome = execute(
                state,
                { actor: { kind: 'system' }, now, idSeed: arrivalSeed(arrival) },
                (tx) => noteFundsArrived(tx, { userId, amount: arrival.amount, mint: arrival.mint }),
              )
              const { status } = outcome.result
              if (status === 'notified') {
                // Kept for the next arrival: a second one for the same person is then `recent`.
                state = outcome.state
                tally.notified += 1
              } else {
                // A person who never opened Viatik, under 1.00 USD, or an unread "Funds arrived" from
                // the last 10 minutes already tells them: nothing written.
                tally[status] += 1
              }
            } catch (error) {
              // Delivered before: its notification exists already.
              if (error instanceof DomainError && error.code === 'already_applied') tally.duplicates += 1
              else throw error
            }
          }
          return { state: tally.notified > 0 ? state : null, result: tally }
        })
        counts.notified = written.notified
        counts.duplicates = written.duplicates
        counts.unknown += written.unknown
        counts.small = written.small
        counts.recent = written.recent
      }
      return c.json({ ok: true, ...counts, skipped: delivery.skipped }, 200, noStore)
    },
  )

/**
 * Asks Alchemy to watch a new Viatik account (added to the webhook's
 * addresses; adding one twice is harmless), so money sent to it is noticed.
 * Only with ALCHEMY_NOTIFY_AUTH_TOKEN and ALCHEMY_WEBHOOK_ID. Best effort:
 * never throws, and logs a failure without the token.
 */
export async function watchAddressOnAlchemy(address: Address, requestId: string): Promise<void> {
  const env = readServerEnv()
  if (!env.ALCHEMY_NOTIFY_AUTH_TOKEN || !env.ALCHEMY_WEBHOOK_ID) return
  try {
    const response = await fetch(ALCHEMY_ADDRESSES_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-alchemy-token': env.ALCHEMY_NOTIFY_AUTH_TOKEN },
      body: JSON.stringify({
        webhook_id: env.ALCHEMY_WEBHOOK_ID,
        addresses_to_add: [address],
        addresses_to_remove: [],
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(ALCHEMY_WATCH_TIMEOUT_MS),
    })
    if (!response.ok)
      console.error(`[api] ${requestId} Alchemy did not add the account: status ${response.status}`)
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown error'
    console.error(`[api] ${requestId} Alchemy did not add the account: ${reason}`)
  }
}

import { createHmac } from 'node:crypto'

import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  pad,
  stringToHex,
  toHex,
  zeroAddress,
  type Hex,
} from 'viem'

import { commands, DomainError, execute } from '@/domain/engine'
import {
  FUNDS_ARRIVED_MIN,
  FUNDS_ARRIVED_QUIET_MS,
  fundsArrivedHref,
  noteFundsArrived,
} from '@/domain/engine/system'
import { createDemoState } from '@/domain/fixtures'
import { cents } from '@/domain/money'
import type { Id, ViatikState } from '@/domain/types'
import { isCommandName } from '@/server/schemas'
import { alchemySignature, arrivalSeed, arrivalsOf, isAlchemySignatureValid } from '@/server/webhooks'

import { checkSame, NOW, type Checker } from './harness'

/**
 * Alchemy: the webhook's signature check, which TestUSD transfers in a
 * delivery are worth a "Funds arrived", and the system engine function that
 * writes it (once per transfer, with a link that depends on the person's
 * role). Pure: no database, no network, no keys.
 */

const TOKEN = getAddress('0x1111111111111111111111111111111111111111')
const LEDGER = getAddress('0x2222222222222222222222222222222222222222')
const OTHER_TOKEN = getAddress('0x3333333333333333333333333333333333333333')
const PERSON = getAddress('0x4444444444444444444444444444444444444444')
const SENDER = getAddress('0x5555555555555555555555555555555555555555')
const TRANSFER = keccak256(stringToHex('Transfer(address,address,uint256)'))
const KEY = 'whsec_smoke_only_not_a_real_key'

const txHash = (n: number) => keccak256(stringToHex(`smoke-tx-${n}`))
const topic = (address: Hex) => pad(address, { size: 32 }).toLowerCase() as Hex
/** 6-decimal token units of a USD amount. */
const units = (usd: number) => BigInt(Math.round(usd * 1_000_000))
/** JSON for a failure's detail; token units are bigints. */
const show = (value: unknown) =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))

/** One Address Activity entry, as Alchemy documents it for an ERC20 transfer. */
function activity(o: {
  from?: Hex
  to?: Hex
  usd?: number
  token?: Hex
  tx?: Hex
  logIndex?: number
  removed?: boolean
  noData?: boolean
}) {
  const value = units(o.usd ?? 25)
  const data = encodeAbiParameters([{ type: 'uint256' }], [value])
  const hash = o.tx ?? txHash(1)
  const token = (o.token ?? TOKEN).toLowerCase()
  return {
    fromAddress: (o.from ?? SENDER).toLowerCase(),
    toAddress: (o.to ?? PERSON).toLowerCase(),
    blockNum: '0x4223e2b',
    hash,
    value: o.usd ?? 25,
    asset: 'TUSD',
    category: 'token',
    rawContract: { rawValue: toHex(value, { size: 32 }), address: token, decimals: 6 },
    log: {
      address: token,
      topics: [TRANSFER, topic(o.from ?? SENDER), topic(o.to ?? PERSON)],
      data: o.noData ? undefined : data,
      blockNumber: '0x4223e2b',
      transactionHash: hash,
      transactionIndex: '0x0',
      blockHash: keccak256(stringToHex('block')),
      logIndex: toHex(o.logIndex ?? 0),
      removed: o.removed ?? false,
    },
  }
}

const delivery = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  webhookId: 'wh_smoke',
  id: 'whevt_smoke',
  createdAt: NOW,
  type: 'ADDRESS_ACTIVITY',
  event: { network: 'MONAD_TESTNET', activity: items },
  ...extra,
})

const options = { token: TOKEN, ledger: LEDGER, webhookId: 'wh_smoke' }

export default async function alchemy(t: Checker) {
  await t.scenario('A1. Signature of a delivery', () => signatures(t))
  await t.scenario('A2. Which transfers in a delivery count', () => filtering(t))
  await t.scenario('A3. "Funds arrived": written once, linked by role', () => notes(t))
  await t.scenario('A4. "Funds arrived": small amounts and bursts', () => quiet(t))
}

// ─── A1. Signature ───────────────────────────────────────────────────────────

function signatures(t: Checker) {
  const body = JSON.stringify(delivery([activity({})]))
  const expected = createHmac('sha256', KEY).update(body, 'utf8').digest('hex')
  t.check('A1: the signature is hex HMAC-SHA256 of the raw body', alchemySignature(body, KEY) === expected)
  t.check('A1: the right signature passes', isAlchemySignatureValid(body, expected, KEY))
  t.check(
    'A1: the raw bytes and the text give the same answer',
    isAlchemySignatureValid(new TextEncoder().encode(body), expected, KEY),
  )
  t.check('A1: upper-case hex passes too', isAlchemySignatureValid(body, expected.toUpperCase(), KEY))
  t.check('A1: another key fails', !isAlchemySignatureValid(body, expected, `${KEY}x`))
  t.check('A1: a changed body fails', !isAlchemySignatureValid(`${body} `, expected, KEY))
  t.check('A1: no signature fails', !isAlchemySignatureValid(body, undefined, KEY))
  t.check('A1: a signature that is not hex fails', !isAlchemySignatureValid(body, 'z'.repeat(64), KEY))
  t.check('A1: a truncated signature fails', !isAlchemySignatureValid(body, expected.slice(0, 62), KEY))
}

// ─── A2. Filtering ───────────────────────────────────────────────────────────

function filtering(t: Checker) {
  const parsed = arrivalsOf(
    delivery([
      activity({ usd: 25, tx: txHash(1), logIndex: 3 }),
      // The same log twice in one delivery.
      activity({ usd: 25, tx: txHash(1), logIndex: 3 }),
      activity({ from: zeroAddress, tx: txHash(2) }),
      activity({ from: LEDGER, tx: txHash(3) }),
      activity({ removed: true, tx: txHash(4) }),
      activity({ token: OTHER_TOKEN, tx: txHash(5) }),
      activity({ usd: 0.004, tx: txHash(6) }),
      // The amount only in rawContract.rawValue.
      activity({ usd: 7.5, tx: txHash(7), logIndex: 1, noData: true }),
      { category: 'external', fromAddress: SENDER, toAddress: PERSON, hash: txHash(8), value: 1 },
    ]),
    options,
  )
  if (!t.check('A2: an Address Activity delivery is read', parsed.status === 'ok', show(parsed))) return
  if (parsed.status !== 'ok') return
  checkSame(
    t,
    'A2: only real transfers in are kept (no mint, no ledger withdrawal, no reorg, no other token, no dust, once each)',
    parsed.arrivals.map((a) => ({ to: a.to, from: a.from, amount: a.amount, tx: a.txHash, i: a.logIndex })),
    [
      { to: PERSON, from: SENDER, amount: 2500, tx: txHash(1), i: 3 },
      { to: PERSON, from: SENDER, amount: 750, tx: txHash(7), i: 1 },
    ],
  )
  t.check('A2: the others are counted as skipped', parsed.skipped === 7, `skipped ${parsed.skipped}`)
  t.check(
    'A2: units keep the 6 decimals',
    parsed.arrivals[0]?.units === 25_000_000n,
    String(parsed.arrivals[0]?.units),
  )
  t.check(
    'A2: the seed names the transaction and the log',
    parsed.arrivals[0] !== undefined && arrivalSeed(parsed.arrivals[0]) === `alchemy:${txHash(1)}:3`,
  )

  const ignored = (payload: unknown, reason: string, label: string) => {
    const result = arrivalsOf(payload, options)
    t.check(`A2: ${label} is ignored`, result.status === 'ignored' && result.reason === reason, show(result))
  }
  ignored(delivery([activity({})], { webhookId: 'wh_other' }), 'other_webhook', 'another webhook')
  ignored(
    delivery([activity({})], { event: { network: 'MONAD_MAINNET', activity: [activity({})] } }),
    'other_network',
    'a mainnet delivery',
  )
  ignored(delivery([activity({})], { type: 'NFT_ACTIVITY' }), 'unsupported_type', 'an NFT Activity delivery')
  ignored('not json', 'not_an_object', 'a body that is not an object')
  const anyWebhook = arrivalsOf(delivery([activity({})], { webhookId: 'wh_other' }), { token: TOKEN })
  t.check(
    'A2: without a webhook id configured, any webhook of this key is read',
    anyWebhook.status === 'ok' && anyWebhook.arrivals.length === 1,
  )

  // A Custom (GraphQL) webhook on the token's logs.
  const custom = arrivalsOf(
    {
      webhookId: 'wh_smoke',
      id: 'whevt_custom',
      createdAt: NOW,
      type: 'GRAPHQL',
      event: {
        sequenceNumber: '1',
        network: 'MONAD_TESTNET',
        data: {
          block: {
            number: 69_400_000,
            logs: [
              {
                account: { address: TOKEN.toLowerCase() },
                topics: [TRANSFER, topic(SENDER), topic(PERSON)],
                data: encodeAbiParameters([{ type: 'uint256' }], [units(12.34)]),
                index: 5,
                transaction: { hash: txHash(9), status: 1 },
              },
              {
                account: { address: TOKEN.toLowerCase() },
                topics: [TRANSFER, topic(SENDER), topic(PERSON)],
                data: encodeAbiParameters([{ type: 'uint256' }], [units(1)]),
                index: 6,
                transaction: { hash: txHash(10), status: 0 },
              },
            ],
          },
        },
      },
    },
    options,
  )
  checkSame(
    t,
    'A2: a Custom webhook log is read the same way (a failed transaction is not)',
    custom.status === 'ok' ? custom.arrivals.map((a) => [a.to, a.amount, a.txHash, a.logIndex]) : custom,
    [[PERSON, 1234, txHash(9), 5]],
  )
}

// ─── A3. noteFundsArrived ────────────────────────────────────────────────────

function holderOf(state: ViatikState, role: 'investor' | 'member' | 'agency_admin'): Id | undefined {
  const roles = (userId: Id) =>
    new Set(state.memberships.filter((m) => m.userId === userId && m.status === 'active').map((m) => m.role))
  // Someone holding only this role, so the expected link is unambiguous.
  return state.users.find((u) => {
    const held = roles(u.id)
    return held.size === 1 && held.has(role)
  })?.id
}

function notes(t: Checker) {
  const state = createDemoState(NOW)
  const system = (seed: string) => ({ actor: { kind: 'system' as const }, now: NOW, idSeed: seed })

  t.check('A3: noteFundsArrived is not a public command', !('noteFundsArrived' in commands))
  t.check('A3: the API does not accept it as a command name', !isCommandName('noteFundsArrived'))

  const investor = holderOf(state, 'investor')
  const member = holderOf(state, 'member')
  const admin = holderOf(state, 'agency_admin')
  if (!t.check('A3: the seed has an Investor, a Member and an Admin', Boolean(investor && member && admin)))
    return
  const scopeOf = (userId: Id) =>
    state.memberships.find((m) => m.userId === userId && m.status === 'active')?.scope
  const investorScope = scopeOf(investor!)
  const memberScope = scopeOf(member!)
  const adminScope = scopeOf(admin!)
  checkSame(
    t,
    'A3: the link goes where each role sees their Viatik account',
    [investor!, member!, admin!].map((userId) => fundsArrivedHref(state, userId)),
    [
      `/investor/${investorScope?.kind === 'portfolio' ? investorScope.portfolioId : '?'}/vaults/add-funds`,
      `/member/${memberScope?.kind === 'agency' ? memberScope.agencyId : '?'}/payments`,
      `/agency/${adminScope?.kind === 'agency' ? adminScope.agencyId : '?'}/overview`,
    ],
  )
  const newcomer = { ...state.users[0]!, id: 'u_newcomer', email: 'newcomer@example.com', name: 'New' }
  const withNewcomer = { ...state, users: [...state.users, newcomer] }
  t.check(
    'A3: someone without a workspace yet is sent home',
    fundsArrivedHref(withNewcomer, 'u_newcomer') === '/',
  )

  const seed = `alchemy:${txHash(1)}:3`
  const first = execute(state, system(seed), (tx) =>
    noteFundsArrived(tx, { userId: member!, amount: cents(2500) }),
  )
  const note = first.result.status === 'notified' ? first.result.notification : null
  t.check(
    'A3: one notification for the person, marked funds_arrived',
    note !== null &&
      note.userId === member &&
      note.kind === 'funds_arrived' &&
      note.title === 'Funds arrived' &&
      first.state.notifications.length === state.notifications.length + 1 &&
      first.state.notifications[0]?.id === note.id,
    JSON.stringify(note),
  )
  t.check(
    'A3: it says how much arrived in their Viatik account',
    Boolean(note?.body.includes('25.00') && note.body.endsWith('arrived in your Viatik account.')),
    note?.body,
  )
  t.note(`body: ${note?.body}`)
  t.check(
    'A3: the state given in is not changed',
    state.notifications.length === first.state.notifications.length - 1,
  )

  let again: unknown = null
  try {
    execute(first.state, system(seed), (tx) => noteFundsArrived(tx, { userId: member!, amount: cents(2500) }))
  } catch (error) {
    again = error
  }
  t.check(
    'A3: the same transfer delivered again is already_applied',
    again instanceof DomainError && again.code === 'already_applied',
    String(again),
  )
  // Once the first one is read: an unread one from the last 10 minutes would hold it back (A4).
  const read = {
    ...first.state,
    notifications: first.state.notifications.map((n) => (n.id === note?.id ? { ...n, readAt: NOW } : n)),
  }
  const other = execute(read, system(`alchemy:${txHash(1)}:4`), (tx) =>
    noteFundsArrived(tx, { userId: member!, amount: cents(100) }),
  )
  t.check(
    'A3: another log of the same transaction is told too',
    other.result.status === 'notified' && other.result.notification.id !== note?.id,
    JSON.stringify(other.result),
  )

  const ghost = execute(state, system('alchemy:ghost:0'), (tx) =>
    noteFundsArrived(tx, { userId: 'u_never_opened_viatik', amount: cents(2500) }),
  )
  t.check(
    'A3: someone not in the state is not told (nothing written)',
    ghost.result.status === 'unknown' && ghost.state.notifications.length === state.notifications.length,
  )

  let forged: unknown = null
  try {
    execute(state, { actor: { kind: 'user', userId: member! }, now: NOW }, (tx) =>
      noteFundsArrived(tx, { userId: member!, amount: cents(2500) }),
    )
  } catch (error) {
    forged = error
  }
  t.check(
    'A3: a person cannot run it',
    forged instanceof DomainError && forged.code === 'forbidden',
    String(forged),
  )

  let zero: unknown = null
  try {
    execute(state, system('alchemy:zero:0'), (tx) =>
      noteFundsArrived(tx, { userId: member!, amount: cents(0) }),
    )
  } catch (error) {
    zero = error
  }
  t.check('A3: a zero amount is refused', zero instanceof DomainError && zero.code === 'validation')
}

// ─── A4. Small amounts and bursts ────────────────────────────────────────────

function quiet(t: Checker) {
  const state = createDemoState(NOW)
  const member = holderOf(state, 'member')
  if (!t.check('A4: the seed has a Member', Boolean(member))) return
  const userId = member!
  const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString()
  const run = (from: ViatikState, seed: string, usd: number, now = NOW) =>
    execute(from, { actor: { kind: 'system' as const }, now, idSeed: seed }, (tx) =>
      noteFundsArrived(tx, { userId, amount: cents(Math.round(usd * 100)) }),
    )
  const errorOf = (go: () => unknown) => {
    try {
      go()
      return null
    } catch (error) {
      return error instanceof DomainError ? error.code : String(error)
    }
  }
  const count = (s: ViatikState) => s.notifications.length

  t.check(
    'A4: the threshold is 1.00 USD and the quiet window 10 minutes',
    FUNDS_ARRIVED_MIN === 100 && FUNDS_ARRIVED_QUIET_MS === 600_000,
  )

  const small = run(state, `alchemy:${txHash(20)}:0`, 0.99)
  t.check(
    'A4: an arrival under 1.00 USD is ignored (nothing written)',
    small.result.status === 'small' && count(small.state) === count(state),
    JSON.stringify(small.result),
  )
  const dollar = run(state, `alchemy:${txHash(21)}:0`, 1)
  t.check('A4: exactly 1.00 USD is told', dollar.result.status === 'notified')

  const firstSeed = `alchemy:${txHash(22)}:0`
  const first = run(state, firstSeed, 25)
  if (!t.check('A4: the first arrival is told', first.result.status === 'notified')) return

  const secondSeed = `alchemy:${txHash(23)}:0`
  const second = run(first.state, secondSeed, 40, at(9 * 60_000))
  t.check(
    'A4: a second arrival within 10 minutes, the first still unread, is skipped (nothing written)',
    second.result.status === 'recent' && count(second.state) === count(first.state),
    JSON.stringify(second.result),
  )
  const secondAgain = run(first.state, secondSeed, 40, at(9 * 60_000 + 30_000))
  t.check(
    'A4: the skipped arrival delivered again is skipped again, still nothing written',
    secondAgain.result.status === 'recent' && count(secondAgain.state) === count(first.state),
  )

  const later = run(first.state, `alchemy:${txHash(24)}:0`, 40, at(FUNDS_ARRIVED_QUIET_MS))
  t.check(
    'A4: 10 minutes after the last one, a new arrival is told',
    later.result.status === 'notified' && count(later.state) === count(first.state) + 1,
    JSON.stringify(later.result),
  )

  const read = {
    ...first.state,
    notifications: first.state.notifications.map((n) =>
      first.result.status === 'notified' && n.id === first.result.notification.id ? { ...n, readAt: NOW } : n,
    ),
  }
  t.check(
    'A4: once the last one is read, the next arrival is told at once',
    run(read, `alchemy:${txHash(25)}:0`, 40, at(60_000)).result.status === 'notified',
  )

  const other = holderOf(state, 'investor')
  t.check(
    'A4: someone else’s unread one does not hold it back',
    Boolean(other) &&
      execute(
        first.state,
        { actor: { kind: 'system' }, now: at(60_000), idSeed: `alchemy:${txHash(26)}:0` },
        (tx) => noteFundsArrived(tx, { userId: other!, amount: cents(4000) }),
      ).result.status === 'notified',
  )

  t.check(
    'A4: the told arrival delivered again within 10 minutes is still already_applied',
    errorOf(() => run(first.state, firstSeed, 25, at(60_000))) === 'already_applied',
  )
  t.check(
    'A4: …and after 10 minutes too',
    errorOf(() => run(first.state, firstSeed, 25, at(FUNDS_ARRIVED_QUIET_MS + 60_000))) === 'already_applied',
  )
  t.check(
    'A4: …and while a newer unread one holds arrivals back',
    errorOf(() => run(later.state, firstSeed, 25, at(FUNDS_ARRIVED_QUIET_MS + 60_000))) === 'already_applied',
  )
}

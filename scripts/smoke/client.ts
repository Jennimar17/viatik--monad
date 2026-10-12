import { focusManager, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query'

import { ApiDataSource } from '@/data/api-data-source'
import { DataSourceError, type OpenOperation, type SendCall } from '@/data/data-source'
import { MockDataSource } from '@/data/mock-data-source'
import { LEDGER_ACCOUNT_KEY, LEDGER_KEY, refreshAfterCommand, STATE_KEY } from '@/data/query-keys'
import { planSettlement } from '@/data/settlement'
import { runCommand } from '@/domain/engine'
import { createDemoState } from '@/domain/fixtures'
import type { ViatikState } from '@/domain/types'

import { NOW, type Checker } from './harness'

/**
 * The browser side of a command: how the API data source reads the server's
 * answers, what it keeps on the device, and what it waits for. `fetch`,
 * `window.localStorage` and `setTimeout` are replaced for the suite (waits run
 * at once and are added up) and put back at the end, so later suites see the
 * real ones.
 */

const OPEN_KEY = 'viatik:open-operations'
const FROM = `0x${'a'.repeat(40)}` as const
const HASH = `0x${'1'.repeat(64)}` as const

type Scripted = [status: number, body: string]

/** The globals the suite swaps out, and what each scenario reads back. */
function browser() {
  const store = new Map<string, string>()
  const storageListeners: ((event: { key: string; newValue: string | null }) => void)[] = []
  const requests: string[] = []
  let answers: Scripted[] = []
  let waited = 0
  const real = { window: globalThis.window, fetch: globalThis.fetch, setTimeout: globalThis.setTimeout }
  const g = globalThis as Record<string, unknown>
  g.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
    addEventListener(type: string, listener: (event: { key: string; newValue: string | null }) => void) {
      if (type === 'storage') storageListeners.push(listener)
    },
    removeEventListener() {},
  }
  g.fetch = async (url: string | URL) => {
    requests.push(String(url))
    const [status, body] = answers.shift() ?? [500, '{"error":{"code":"unscripted","message":"No answer scripted."}}']
    return new Response(body, { status, headers: { 'content-type': 'application/json' } })
  }
  g.setTimeout = (run: () => void, ms = 0) => {
    waited += ms
    return real.setTimeout(run, 0)
  }
  return {
    store,
    requests,
    get waited() {
      return waited
    },
    /** What another tab hears when this device's storage changes (the browser's `storage` event). */
    broadcast(key: string) {
      for (const listener of storageListeners) listener({ key, newValue: store.get(key) ?? null })
    },
    /** The answers the server gives, in order, for the next scenario. */
    script(next: Scripted[]) {
      answers = [...next]
      requests.length = 0
      waited = 0
    },
    restore() {
      g.window = real.window
      g.fetch = real.fetch
      g.setTimeout = real.setTimeout
    },
  }
}

export default async function client(t: Checker) {
  const env = browser()
  try {
    await answers(t, env)
    await demo(t, env)
  } finally {
    env.restore()
  }
  // With the real timers: it measures how long a command waits for its refresh.
  await refresh(t)
}

async function answers(t: Checker, env: ReturnType<typeof browser>) {
  const source = new ApiDataSource()
  const credentials = async () => ({ accessToken: 'token' })
  let signed = 0
  const sendCall: SendCall = async (call) => {
    if (call.from.toLowerCase() !== FROM) throw new DataSourceError('Another account.', 'session_changed', true)
    signed += 1
    return HASH
  }

  async function dispatch(name: 'markNotificationsRead' | 'payBill', key: string) {
    const phases: string[] = []
    signed = 0
    try {
      const result = await source.dispatch('u_maya', name, {} as never, {
        credentials,
        sendCall,
        idempotencyKey: key,
        onPhase: (phase) => phases.push(phase),
      })
      return { ok: true as const, result, phases }
    } catch (error) {
      // Read the code by shape: jiti may load the errors module twice (alias and relative path).
      const code = (error as { code?: unknown } | null)?.code
      return { ok: false as const, code: typeof code === 'string' ? code : String(error), phases }
    }
  }

  await t.scenario('H1. A command with nothing to return settles at once', async () => {
    const seed = createDemoState(NOW)
    const actor = { kind: 'user', userId: 'u_maya' } as const
    const outcome = runCommand(seed, { actor, now: NOW, idSeed: 'smoke:read' }, 'markNotificationsRead', {})
    t.check(
      'markNotificationsRead returns nothing and never reaches the ledger',
      outcome.result === undefined && planSettlement({ before: seed, after: outcome.state, actor }) === null,
    )
    t.check(
      'the server answers null, which survives JSON (undefined would be dropped)',
      'result' in JSON.parse(JSON.stringify({ result: outcome.result ?? null })),
    )

    for (const [label, body] of [
      ['an empty answer, as stored before the fix', '{}'],
      ['a null result', '{"result":null}'],
    ] as const) {
      env.script([[200, body]])
      const run = await dispatch('markNotificationsRead', `op_read_${body.length}`)
      t.check(
        `${label} resolves after one request, with no confirmation and no wait`,
        run.ok && env.requests.length === 1 && env.waited === 0 && signed === 0,
        `ok ${run.ok}, requests ${env.requests.length}, waited ${env.waited} ms, signed ${signed}`,
      )
      t.check(
        `${label} leaves nothing open on the device`,
        !env.store.has(OPEN_KEY) && run.phases.join('>') === 'preparing>completed',
        `stored ${env.store.get(OPEN_KEY) ?? 'nothing'}, phases ${run.phases.join('>')}`,
      )
    }
  })

  await t.scenario('H1. A transaction to sign still waits for Monad', async () => {
    const pending = JSON.stringify({
      pending: { to: `0x${'b'.repeat(40)}`, data: '0x', chainId: 10143, from: FROM, expiresAt: null },
    })
    env.script([
      [202, pending],
      [202, '{"processing":{"txHash":null}}'],
      [200, '{"result":{"bill":{"id":"bill_1"}}}'],
    ])
    const run = await dispatch('payBill', 'op_pay')
    t.check(
      'pending → processing → result: signed once, confirmed, then forgotten',
      run.ok &&
        signed === 1 &&
        env.requests.length === 3 &&
        run.phases.join('>') === 'preparing>waiting_for_confirmation>processing>completed' &&
        !env.store.has(OPEN_KEY),
      `ok ${run.ok}, signed ${signed}, requests ${env.requests.length}, phases ${run.phases.join('>')}`,
    )

    env.script([
      [202, pending],
      [409, '{"error":{"code":"invalid_state","message":"It changed meanwhile."}}'],
    ])
    const refused = await dispatch('payBill', 'op_pay_refused')
    t.check(
      'a refusal while confirming fails and forgets the operation',
      !refused.ok && refused.code === 'invalid_state' && !env.store.has(OPEN_KEY),
      `ok ${refused.ok}, code ${refused.ok ? '' : refused.code}`,
    )
  })

  await t.scenario('H1. Entries already stuck on a device', async () => {
    const at = new Date().toISOString()
    const stuck: OpenOperation[] = [
      { key: 'op_stuck', name: 'markNotificationsRead', userId: 'u_maya', hash: null, at },
      { key: 'op_real', name: 'payBill', userId: 'u_maya', hash: null, at },
    ]
    env.store.set(OPEN_KEY, JSON.stringify(stuck))
    const open = source.openOperations('u_maya')
    const [real] = open
    t.check(
      'an open "mark as read" is dropped: it never waits for a signature',
      open.length === 1 && real?.key === 'op_real',
      open.map((o) => o.name).join(', '),
    )
    if (!real) return

    env.script([[200, '{}']])
    const outcome = await source.resume(real, { credentials, sendCall })
    t.check(
      'resuming an operation answered {} counts it as final and forgets it',
      outcome.status === 'confirmed' && !env.store.has(OPEN_KEY),
      JSON.stringify(outcome),
    )
  })
}

/** The no-account demo keeps its data in this browser: reloads, other tabs and reset. */
async function demo(t: Checker, env: ReturnType<typeof browser>) {
  const DEMO_KEY = 'viatik:demo-state'
  const unread = (state: ViatikState) => state.notifications.filter((n) => n.userId === 'u_maya' && !n.readAt).length
  const title = (state: ViatikState) => state.users.find((u) => u.id === 'u_maya')?.title

  await t.scenario('H2. The demo keeps its data across reloads and tabs', async () => {
    env.store.clear()
    const tabA = new MockDataSource()
    const seeded = unread(await tabA.load('u_maya'))
    await tabA.dispatch('u_maya', 'markNotificationsRead', {})
    const reloaded = await new MockDataSource().load('u_maya')
    t.check(
      'what one visit changed is still there after a full reload',
      seeded > 0 && unread(reloaded) === 0,
      `unread ${seeded} → ${unread(reloaded)} after reload`,
    )

    const tabB = new MockDataSource()
    await tabB.load('u_maya')
    let heard = 0
    tabB.subscribe(() => (heard += 1))
    await tabA.dispatch('u_maya', 'updateProfile', { title: 'Changed in tab A' })
    env.broadcast(DEMO_KEY)
    t.check(
      'another open tab takes the change',
      heard >= 1 && title(await tabB.load('u_maya')) === 'Changed in tab A',
      `heard ${heard}, title in tab B ${JSON.stringify(title(await tabB.load('u_maya')))}`,
    )

    const stale = JSON.parse(env.store.get(DEMO_KEY) ?? '{}') as ViatikState
    stale.version = 1
    const maya = stale.users.find((u) => u.id === 'u_maya')
    if (maya) maya.title = 'Saved by an older demo'
    env.store.set(DEMO_KEY, JSON.stringify(stale))
    t.check(
      'a copy saved by an older demo starts over',
      title(await new MockDataSource().load('u_maya')) !== 'Saved by an older demo',
    )

    const tab = new MockDataSource()
    await tab.load('u_maya')
    await tab.dispatch('u_maya', 'markNotificationsRead', {})
    await tab.reset()
    t.check('reset is kept after a reload', unread(await new MockDataSource().load('u_maya')) === seeded)
  })
}

/** A command's `run` resolves once the Viatik state is read again, never after a live Monad read. */
async function refresh(t: Checker) {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  await t.scenario('H3. A command does not wait for the live account read', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } })
    let stateReads = 0
    let accountReads = 0
    const stop = [
      new QueryObserver(queryClient, {
        queryKey: [...STATE_KEY, 'account', 'u_elena'],
        queryFn: async () => {
          stateReads += 1
          await sleep(30)
          return { read: stateReads }
        },
      }),
      new QueryObserver(queryClient, {
        queryKey: [...LEDGER_KEY, 'account', 'u_elena'],
        queryFn: async () => {
          await sleep(300)
          return { settlement: 'monad' }
        },
      }),
      // The live Monad read: slow, then failing, and its retry pauses while the tab is hidden.
      new QueryObserver(queryClient, {
        queryKey: [...LEDGER_ACCOUNT_KEY, 'account', 'u_elena'],
        queryFn: async () => {
          accountReads += 1
          await sleep(500)
          if (accountReads > 1) throw new Error('503')
          return { available: true }
        },
      }),
    ].map((observer) => observer.subscribe(() => {}))
    try {
      await sleep(600)
      focusManager.setFocused(false)
      const readsBefore = stateReads
      const mutation = new MutationObserver(queryClient, {
        mutationFn: async () => ({ id: 'rcpt_smoke' }),
        onSettled: () => refreshAfterCommand(queryClient),
        networkMode: 'always',
      })
      const started = Date.now()
      const outcome = await Promise.race([
        mutation.mutate(undefined).then((result) => result.id),
        sleep(2_000).then(() => 'still waiting'),
      ])
      const took = Date.now() - started
      t.check(
        'run resolves once the state is read again, with the tab hidden',
        outcome === 'rcpt_smoke' && took < 250 && stateReads > readsBefore,
        `${outcome} after ${took} ms, state reads ${readsBefore} → ${stateReads}`,
      )
    } finally {
      focusManager.setFocused(undefined)
      stop.forEach((unsubscribe) => unsubscribe())
      queryClient.clear()
    }
  })
}

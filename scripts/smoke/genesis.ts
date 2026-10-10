import { getAddress, keccak256, stringToHex, zeroAddress, zeroHash } from 'viem'

import { attachmentsHash } from '@/domain/evidence'
import { DEMO } from '@/domain/fixtures'
import { cents, usd } from '@/domain/money'
import { isOutsidePayment } from '@/domain/queries'
import { vaultBalance } from '@/domain/selectors'
import type { Id, ViatikState } from '@/domain/types'
import { buildGenesis, placeholderAddress, type Genesis } from '@/ledger/genesis'
import { ledgerId } from '@/ledger/ids'
import { ledgerSnapshot } from '@/ledger/snapshot'
import { centsToUnits } from '@/ledger/units'

import {
  balancesOf,
  checkSame,
  crafted,
  decodeGenesis,
  file,
  must,
  World,
  type Checker,
  type DecodedCall,
} from './harness'

/**
 * Genesis: the story imported into ViatikLedger under a fresh namespace. The
 * seed, and a state after Phase B's operations, decode to the calls the
 * contract needs, in its order: payments made outside Viatik are imported with
 * their invoice (nothing minted for them), payment for work waiting for an
 * Admin is not, and the TestUSD minted equals the balances the ledger books.
 */

const { users: U, agencies: A, accounts: ACC, budgets: B } = DEMO
const ARC = A.arc
const TOOL = getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72')

export default async function genesis(t: Checker) {
  await t.scenario('H1. Genesis of the seed', () => seedGenesis(t))
  await t.scenario('H2. Genesis after outside payments, returns and waiting requests', () => storyGenesis(t))
}

// ─── H1. The seed ────────────────────────────────────────────────────────────

function seedGenesis(t: Checker) {
  const w = new World(t, 'genesis-seed')
  const namespace = 'smoke-g1'
  const built = buildGenesis(w.state, namespace, () => undefined)
  const calls = decodeGenesis(built)
  t.note(`${calls.length} calls: ${countsOf(calls)}`)
  commonChecks(t, 'H1', w.state, built, calls)
  const again = buildGenesis(w.state, namespace, () => undefined)
  t.check(
    'H1: building it again gives the same calls',
    JSON.stringify(again.calls) === JSON.stringify(built.calls),
  )
  const seeded = w.state.payments.filter((p) => isOutsidePayment(p) && p.status === 'completed')
  t.note(`the seed has ${seeded.length} payments made outside Viatik`)

  // The demo story: both payments made outside Viatik, each with its invoice or none; Alex's
  // payment for work waiting for an Admin left out; what Lumen Labs returned in the Portfolio Vault.
  const id = (productId: Id) => ledgerId(namespace, productId)
  t.check(
    'H1: the seed has two payments made outside Viatik, one with its invoice',
    seeded.length === 2 && seeded.filter((p) => p.proof).length === 1,
  )
  const outsideCalls = calls.filter((c) => c.name === 'importOutsidePayment')
  for (const payment of seeded) {
    const proof = payment.proof ? attachmentsHash([payment.proof]) : null
    checkSame(
      t,
      `H1: ${payment.recipient.kind === 'address' ? payment.recipient.payee : payment.id} is imported once, ${proof ? 'with its invoice' : 'without an invoice'}`,
      outsideCalls.filter((c) => c.args[1] === id(payment.id)).map((c) => c.args),
      [[id(payment.agencyId), id(payment.id), proof ?? zeroHash]],
    )
  }
  const waitingWork = w.state.requests.filter(
    (r) => r.status === 'needs_approval' && r.requester.kind === 'user' && r.type === 'work',
  )
  const imported = calls
    .filter((c) => c.name === 'importPendingRequest')
    .map((c) => (c.args[0] as PendingImport).requestId)
  t.check(
    "H1: Alex's payment for work waiting for an Admin is not imported, and the genesis says so",
    waitingWork.length === 1 &&
      !imported.includes(id(waitingWork[0]?.id ?? '')) &&
      built.skipped.some((note) => note.startsWith('1 payments for work waiting')),
    built.skipped.join(' | '),
  )
  t.check(
    "H1: the requests waiting for approval that are imported are the people's other ones",
    imported.length > 0 &&
      imported.every((requestId) =>
        w.state.requests.some(
          (r) => id(r.id) === requestId && r.status === 'needs_approval' && r.type !== 'work',
        ),
      ),
  )
  const vault = calls.find((c) => c.name === 'importLocation' && c.args[0] === id(DEMO.vaults.portfolio))
  t.check(
    'H1: the Portfolio Vault is imported with the 5,000 Lumen Labs returned in it',
    vault?.args[3] === centsToUnits(vaultBalance(w.state, DEMO.vaults.portfolio)) &&
      w.state.movements.some(
        (m) =>
          m.kind === 'capital_return' &&
          m.amount === usd(5_000) &&
          m.to.kind === 'vault' &&
          m.to.vaultId === DEMO.vaults.portfolio,
      ),
  )
}

// ─── H2. After a story ───────────────────────────────────────────────────────

async function storyGenesis(t: Checker) {
  const w = new World(t, 'genesis-story')
  // The seed's own payment for work waiting for an Admin (the demo story's), left out too.
  const seededWaitingWork = waitingWorkOf(w.state)
  await w.gather(U.maya, ACC.arcReserve, usd(40))
  const mintedAtStart = buildGenesis(w.state, 'smoke-g2', () => undefined).minted

  const unproven = (
    await w.run(
      U.maya,
      'payOutside',
      {
        agencyId: ARC,
        source: { kind: 'account', accountId: ACC.arcReserve },
        to: TOOL,
        payee: 'Anthropic',
        amount: usd(40),
        category: 'ai_services',
        memo: 'Claude Teams, October',
      },
      'H2 setup: an outside payment, invoice pending',
      { ops: ['payOutside'] },
    )
  ).result
  t.check(
    'H2: TestUSD minted at genesis drops by what left the ledger',
    mintedAtStart - buildGenesis(w.state, 'smoke-g2', () => undefined).minted === usd(40),
  )
  await w.fund(U.maya, B.arcTeam, usd(60))
  const proven = (
    await w.run(
      U.maya,
      'payOutside',
      {
        agencyId: ARC,
        source: { kind: 'budget', budgetId: B.arcTeam },
        to: TOOL,
        payee: 'Linear',
        amount: usd(60),
        category: 'software',
        memo: 'Linear seats',
        proof: file('h2-linear-invoice.pdf'),
      },
      'H2 setup: an outside payment with its invoice',
      { ops: ['payOutside'] },
    )
  ).result
  await w.gather(U.maya, ACC.arcOperations, usd(15))
  const anchoredLater = (
    await w.run(
      U.maya,
      'payOutside',
      {
        agencyId: ARC,
        source: { kind: 'account', accountId: ACC.arcOperations },
        to: TOOL,
        payee: 'Figma',
        amount: usd(15),
        category: 'software',
        memo: 'Figma seat',
      },
      'H2 setup: another outside payment',
      { ops: ['payOutside'] },
    )
  ).result
  await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: anchoredLater.id, proof: file('h2-figma-invoice.pdf') },
    'H2 setup: its invoice, anchored later',
    { ops: ['recordEvidence'] },
  )
  const team = must(
    w.state.budgets.find((b) => b.id === B.arcTeam),
    'Team payments',
  )
  await w.run(
    U.maya,
    'assignAllowance',
    { budgetId: B.arcTeam, holder: { kind: 'member', userId: U.alex }, periodLimit: team.periodLimit },
    'H2 setup: Alex may spend from Team payments',
    { ops: ['setAllowance'] },
  )
  await w.fund(U.maya, B.arcTeam, usd(300))
  const work = (
    await w.run(
      U.alex,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTeam,
        type: 'work',
        amount: usd(300),
        category: 'team',
        purpose: 'Illustrations',
        idempotencyKey: 'smoke-h2-work',
      },
      'H2 setup: payment for work, waiting for an Admin',
      { ops: [] },
    )
  ).result
  const tools = must(
    w.state.budgets.find((b) => b.id === B.arcTools),
    'Tools',
  )
  await w.fund(U.maya, B.arcTools, cents(tools.approvalThreshold + usd(10)))
  const funds = (
    await w.run(
      U.daniel,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTools,
        type: 'funds',
        amount: cents(tools.approvalThreshold + usd(10)),
        category: 'software',
        purpose: 'Test devices',
        idempotencyKey: 'smoke-h2-funds',
      },
      'H2 setup: money for purchases, waiting for an Admin',
      { ops: ['requestPayment'] },
    )
  ).result
  await w.fund(U.maya, B.arcTools, usd(25))
  await w.run(
    U.alex,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'funds',
      amount: usd(25),
      category: 'software',
      purpose: 'Cables',
      idempotencyKey: 'smoke-h2-advance',
    },
    'H2 setup: money for purchases, paid',
    { ops: ['requestPayment'] },
  )
  await w.gather(U.maya, ACC.arcReserve, usd(500))
  await w.run(
    U.maya,
    'returnToInvestor',
    { agencyId: ARC, accountId: ACC.arcReserve, amount: usd(500), note: 'Quarter end' },

    'H2 setup: capital returned to the Investor',
    { ops: ['returnCapital'] },
  )

  const namespace = 'smoke-g2'
  const id = (productId: Id) => ledgerId(namespace, productId)
  const built = buildGenesis(w.state, namespace, () => undefined)
  const calls = decodeGenesis(built)
  t.note(`${calls.length} calls: ${countsOf(calls)}`)
  commonChecks(t, 'H2', w.state, built, calls)

  // Each payment made outside Viatik, with its invoice (or none), after the balances and before requests.
  const outsideCalls = calls.filter((c) => c.name === 'importOutsidePayment')
  for (const payment of [unproven, proven, anchoredLater]) {
    const stored = must(
      w.state.payments.find((p) => p.id === payment.id),
      'the outside payment',
    )
    const proof = stored.proof ? attachmentsHash([stored.proof]) : null
    const imported = outsideCalls.filter((c) => c.args[1] === id(payment.id))
    checkSame(
      t,
      `H2: ${stored.recipient.kind === 'address' ? stored.recipient.payee : payment.id} is imported once, ${proof ? 'with its invoice' : 'without an invoice'}`,
      imported.map((c) => c.args),
      [[id(ARC), id(payment.id), proof ?? zeroHash]],
    )
  }
  const position = (call: DecodedCall) => calls.indexOf(call)
  const arcScope = calls.findIndex((c) => c.name === 'importScope' && c.args[1] === id(ARC))
  const lastBalance = Math.max(...calls.map((c, i) => (c.name === 'importMemberBalance' ? i : -1)))
  const firstRequest = calls.findIndex((c) => c.name === 'importPendingRequest')
  const namespaceAt = calls.findIndex((c) => c.name === 'setNamespace')
  t.check(
    "H2: outside payments come after their Agency, the Members' balances, and before the requests and the namespace",
    outsideCalls.length > 0 &&
      outsideCalls.every(
        (c) =>
          position(c) > arcScope &&
          position(c) > lastBalance &&
          (firstRequest === -1 || position(c) < firstRequest) &&
          position(c) < namespaceAt,
      ),
    `scope ${arcScope}, last balance ${lastBalance}, outside ${outsideCalls.map(position).join(',')}, first request ${firstRequest}, namespace ${namespaceAt}`,
  )

  // Requests waiting: money for purchases is imported for the requester; payment for work is not.
  const requests = calls
    .filter((c) => c.name === 'importPendingRequest')
    .map((c) => c.args[0] as PendingImport)
  const daniel = requests.find((r) => r.requestId === id(funds.id))
  t.check(
    "H2: Daniel's waiting money for purchases is imported, paying his own balance",
    Boolean(
      daniel &&
      daniel.member === placeholderAddress(namespace, U.daniel) &&
      daniel.destination === zeroHash &&
      daniel.amount === centsToUnits(funds.amount),
    ),
    JSON.stringify(daniel, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value)),
  )
  t.check("H2: Alex's payment for work is not imported", !requests.some((r) => r.requestId === id(work.id)))
  t.check(
    "H2: the genesis says this payment for work is left out (with the seed's)",
    waitingWorkOf(w.state) === seededWaitingWork + 1 &&
      built.skipped.some((note) => note.startsWith(`${seededWaitingWork + 1} payments for work waiting`)),
    built.skipped.join(' | '),
  )

  // The returned capital is in the Portfolio Vault the genesis imports.
  const vault = calls.find((c) => c.name === 'importLocation' && c.args[0] === id(DEMO.vaults.portfolio))
  t.check(
    'H2: the Portfolio Vault is imported with the returned capital',
    vault?.args[3] === centsToUnits(vaultBalance(w.state, DEMO.vaults.portfolio)),
  )

  // The ledger built from this state knows its outside payments: an invoice is anchored once.
  const evidence = (paymentId: Id) =>
    crafted(U.maya, [
      {
        call: 'recordEvidence',
        agencyId: ARC,
        paymentId,
        evidenceHash: keccak256(stringToHex(`smoke:h2:${paymentId}`)),
      },
    ])
  const onUnproven = await w.settleCrafted(evidence(unproven.id))
  t.check(
    'H2: an invoice for the payment without one is accepted',
    onUnproven.status === 'completed',
    onUnproven.error?.message,
  )
  for (const paymentId of [proven.id, anchoredLater.id]) {
    const again = await w.settleCrafted(evidence(paymentId))
    t.check(
      `H2: a second invoice for ${paymentId === proven.id ? 'the payment that came with one' : 'the payment anchored later'} is refused`,
      again.status === 'failed' && again.error?.code === 'already_processed',
      again.error?.code,
    )
  }
  await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: unproven.id, proof: file('h2-claude-invoice.pdf') },
    'H2 the invoice of the first payment, after the genesis',
    { ops: ['recordEvidence'] },
  )
  const after = buildGenesis(w.state, 'smoke-g3', () => undefined)
  const reimported = decodeGenesis(after).find(
    (c) => c.name === 'importOutsidePayment' && c.args[1] === ledgerId('smoke-g3', unproven.id),
  )
  const stored = must(
    w.state.payments.find((p) => p.id === unproven.id),
    'the first outside payment',
  )
  t.check(
    'H2: a later genesis imports it with its invoice',
    reimported?.args[2] === attachmentsHash([must(stored.proof, 'its invoice')]),
  )

  // Outside payments the seed itself carries (none until the demo story adds some).
  const seed = new World(t, 'genesis-seeded')
  for (const payment of seed.state.payments.filter((p) => isOutsidePayment(p) && p.status === 'completed')) {
    const result = await seed.settleCrafted(
      crafted(payment.createdBy.kind === 'user' ? payment.createdBy.userId : U.maya, [
        {
          call: 'recordEvidence',
          agencyId: payment.agencyId,
          paymentId: payment.id,
          evidenceHash: keccak256(stringToHex(`smoke:seeded:${payment.id}`)),
        },
      ]),
    )
    t.check(
      `H2: the seeded outside payment ${payment.id} takes an invoice only if it has none`,
      payment.proof
        ? result.status === 'failed' && result.error?.code === 'already_processed'
        : result.status === 'completed',
      result.error?.code,
    )
  }
}

// ─── Shared checks ───────────────────────────────────────────────────────────

type PendingImport = { requestId: string; member: string; destination: string; amount: bigint }

/** What every genesis must do, whatever the state. */
function commonChecks(t: Checker, label: string, state: ViatikState, built: Genesis, calls: DecodedCall[]) {
  const snapshot = ledgerSnapshot(state)
  const namespaces = calls.filter((c) => c.name === 'setNamespace')
  t.check(
    `${label}: it ends by setting the namespace, once`,
    namespaces.length === 1 && calls.at(-1)?.name === 'setNamespace',
  )
  let positive = 0
  for (const amount of balancesOf(snapshot).values()) if (amount > 0) positive += amount
  t.check(
    `${label}: the TestUSD minted equals the balances the ledger books`,
    built.minted === positive,
    `${built.minted} vs ${positive}`,
  )
  const outside = state.payments.filter((p) => isOutsidePayment(p) && p.status === 'completed')
  t.check(
    `${label}: one import per payment made outside Viatik`,
    calls.filter((c) => c.name === 'importOutsidePayment').length === outside.length,
    `${calls.filter((c) => c.name === 'importOutsidePayment').length} vs ${outside.length}`,
  )
  const waiting = state.requests.filter((r) => r.status === 'needs_approval' && r.requester.kind === 'user')
  const waitingWork = waiting.filter((r) => r.type === 'work')
  t.check(
    `${label}: one import per request waiting for approval, none for payment for work`,
    calls.filter((c) => c.name === 'importPendingRequest').length === waiting.length - waitingWork.length,
  )
  t.check(
    `${label}: every place is imported with its balance`,
    [...snapshot.places].every(([placeId, place]) =>
      calls.some(
        (c) =>
          c.name === 'importLocation' &&
          c.args[0] === ledgerId(built.namespace, placeId) &&
          c.args[3] === centsToUnits(cents(place.balance)),
      ),
    ),
  )
  t.check(
    `${label}: everyone holding something without an account gets a placeholder`,
    Object.entries(built.placeholders).every(
      ([userId, address]) =>
        address === placeholderAddress(built.namespace, userId) && address !== zeroAddress,
    ) && Object.keys(built.placeholders).length > 0,
  )
}

/** Payment for work waiting for an Agency Admin (never on the ledger until it is paid). */
function waitingWorkOf(state: ViatikState): number {
  return state.requests.filter(
    (r) => r.status === 'needs_approval' && r.requester.kind === 'user' && r.type === 'work',
  ).length
}

function countsOf(calls: DecodedCall[]): string {
  const counts = new Map<string, number>()
  for (const call of calls) counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
  return [...counts].map(([name, count]) => `${name} ${count}`).join(', ')
}

import {
  decodeFunctionData,
  encodeErrorResult,
  getAddress,
  keccak256,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem'

import { attachmentsHash } from '@/domain/evidence'
import { DEMO } from '@/domain/fixtures'
import { cents, formatUsd, usd, type Cents } from '@/domain/money'
import { governingAgreement } from '@/domain/queries'
import { accountBalance } from '@/domain/selectors'
import type { Id } from '@/domain/types'
import { encodePlan, receiptHashOf } from '@/ledger/encode'
import { ledgerId, witnessesOf } from '@/ledger/ids'
import { ledgerErrorOf } from '@/ledger/revert'
import type { ChainContext, LedgerOp, PlannedRecord, SettlementResult } from '@/ledger/types'
import { centsToUnits } from '@/ledger/units'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'

import {
  checkSame,
  crafted,
  file,
  ledgerInvariants,
  must,
  same,
  SMOKE_CHAIN,
  World,
  type Checker,
} from './harness'

/**
 * The settlement layer on its own: whole plans for the Phase B operations,
 * hand-made plans the mock ledger must refuse exactly as ViatikLedger does
 * (with the same words the Monad adapter decodes from the contract's revert),
 * the calldata and witnesses of the new operations, the receipt-hash vectors
 * shared with the Solidity tests, and a self-test of the smoke's invariants.
 */

const { users: U, agencies: A, accounts: ACC, budgets: B } = DEMO
const ARC = A.arc
const LUMEN = A.lumen
const TOOL = getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72')

const usdText = (value: Cents) => formatUsd(value, { withCode: true })

export default async function settlement(t: Checker) {
  await t.scenario('S1. Whole plans of the Phase B operations', () => wholePlans(t))
  await t.scenario('S2. Hand-made plans the ledger refuses, in the contract’s words', () => craftedPlans(t))
  await t.scenario('S3. Calldata and witnesses of the new operations', () => calldata(t))
  await t.scenario('S4. Receipt-hash vectors shared with ViatikLedger.v3.t.sol', () => vectors(t))
  await t.scenario('S5. The smoke’s invariants catch a wrong plan', () => selfTest(t))
}

// ─── S1. Whole plans ─────────────────────────────────────────────────────────

async function wholePlans(t: Checker) {
  const w = new World(t, 'settlement-plans')
  await w.fund(U.maya, B.arcTools, usd(30))
  const funds = await w.run(
    U.alex,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'funds',
      amount: usd(30),
      category: 'software',
      purpose: 'Keyboard',
      idempotencyKey: 'smoke-s1-funds',
    },
    'S1 money for purchases, paid at once',
    { ops: ['requestPayment'] },
  )
  const paymentId = must(funds.result.paymentId, 'the payment id')
  checkSame(t, 'S1: the whole plan of money for purchases', funds.plan, {
    ops: [
      {
        call: 'requestPayment',
        requestId: funds.result.id,
        paymentId,
        budgetId: B.arcTools,
        destinationId: null,
        memberUserId: U.alex,
        amount: usd(30),
        evidenceHash: null,
        expected: 'executed',
      },
    ],
    records: [
      {
        opId: paymentId,
        kind: 'payment',
        amount: usd(30),
        from: { id: B.arcTools },
        to: { member: U.alex },
        evidenceHash: null,
      },
    ],
    signerUserId: U.alex,
    keepOnFailure: false,
    uncovered: [],
  })
  const request = must(
    w.state.requests.find((r) => r.id === funds.result.id),
    'the request',
  )
  t.check(
    'S1: the request shows what the ledger did with it',
    request.ledger?.outcome === 'executed' && request.ledger.status === 'confirmed',
  )

  await w.fund(U.maya, B.arcTools, usd(40))
  const work = await w.run(
    U.alex,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'work',
      amount: usd(40),
      category: 'software',
      purpose: 'Plugin development',
      idempotencyKey: 'smoke-s1-work-tools',
    },
    'S1 payment for work from Tools, where Alex may spend',
    { ops: [] },
  )
  t.check('S1: payment for work waiting has no plan at all', work.plan === null)
  const big = await w.run(
    U.alex,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'work',
      amount: cents(budgetPerOperation(w, B.arcTools) + usd(1)),
      category: 'software',
      purpose: 'A whole quarter of plugins',
      idempotencyKey: 'smoke-s1-work-big',
    },
    'S1 payment for work above the per-operation limit',
    { ops: [], settle: 'failed', error: 'policy_rejected', keep: true },
  )
  checkSame(t, 'S1: the whole plan of rejected work: a refusal before the ledger, kept', big.plan, {
    ops: [],
    records: [],
    signerUserId: U.alex,
    keepOnFailure: true,
    refusal: { code: 'policy_rejected', message: big.result.decision.reason?.message, retryable: false },
    uncovered: [],
  })

  await w.fund(U.maya, B.arcTeam, usd(60))
  const proof = file('s1-figma-invoice.pdf')
  const outside = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'budget', budgetId: B.arcTeam },
      to: TOOL,
      payee: 'Figma',
      amount: usd(60),
      category: 'software',
      memo: 'Figma seats',
      proof,
    },
    'S1 an outside payment from an open budget, with its invoice',
    { ops: ['payOutside'] },
  )
  const invoice = must(outside.result.proof, 'the invoice')
  const invoiceHash = attachmentsHash([invoice])
  checkSame(t, 'S1: the whole plan of an outside payment', outside.plan, {
    ops: [
      {
        call: 'payOutside',
        paymentId: outside.result.id,
        sourceId: B.arcTeam,
        to: TOOL,
        amount: usd(60),
        evidenceHash: invoiceHash,
      },
    ],
    records: [
      {
        opId: outside.result.id,
        kind: 'outside_payment',
        amount: usd(60),
        from: { id: B.arcTeam },
        to: { address: TOOL },
        evidenceHash: invoiceHash,
      },
    ],
    signerUserId: U.maya,
    keepOnFailure: false,
    uncovered: [],
  })
  t.check('S1: the invoice fingerprint is the uploaded file’s', invoice.sha256 === proof.sha256)

  await w.gather(U.maya, ACC.arcReserve, usd(225))
  const later = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcReserve },
      to: TOOL,
      payee: 'Anthropic',
      amount: usd(25),
      category: 'ai_services',
      memo: 'Claude Teams',
    },
    'S1 an outside payment, invoice to follow',
    { ops: ['payOutside'] },
  )
  const receiptBefore = must(
    w.state.receipts.find((r) => r.id === later.result.receiptId),
    'the outside payment receipt',
  )
  const proofStep = await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: later.result.id, proof: file('s1-claude-invoice.pdf') },
    'S1 the invoice, later',
    { ops: ['recordEvidence'] },
  )
  const anchoredHash = attachmentsHash([must(proofStep.result.proof, 'the invoice')])
  checkSame(t, 'S1: the whole plan of an invoice anchored later: no record', proofStep.plan, {
    ops: [{ call: 'recordEvidence', agencyId: ARC, paymentId: later.result.id, evidenceHash: anchoredHash }],
    records: [],
    signerUserId: U.maya,
    keepOnFailure: false,
    uncovered: [],
  })
  const receiptAfter = must(
    w.state.receipts.find((r) => r.id === later.result.receiptId),
    'the receipt',
  )
  t.check(
    "S1: anchoring the invoice leaves the payment receipt's ledger details as they were",
    same(receiptBefore.verified, receiptAfter.verified),
  )
  const record = must(proofStep.settled?.records[0], 'the ledger record of the invoice')
  checkSame(
    t,
    'S1: the payment keeps the ledger’s confirmation of the invoice',
    w.state.payments.find((p) => p.id === later.result.id)?.proofVerified,
    {
      ...record.verified,
      contractPolicy: 'Invoice fingerprinted · anchored once',
      evidenceHash: anchoredHash,
    },
  )

  const capital = await w.run(
    U.maya,
    'returnToInvestor',
    { agencyId: ARC, accountId: ACC.arcReserve, amount: usd(200) },
    'S1 capital returned to the Investor',
    { ops: ['returnCapital'] },
  )
  const opId = capital.result.operationId
  checkSame(t, 'S1: the whole plan of a capital return', capital.plan, {
    ops: [
      {
        call: 'returnCapital',
        opId,
        fromAccountId: ACC.arcReserve,
        portfolioVaultId: DEMO.vaults.portfolio,
        agreementId: DEMO.agreements.arc,
        amount: usd(200),
        evidenceHash: null,
      },
    ],
    records: [
      {
        opId,
        kind: 'capital_return',
        amount: usd(200),
        from: { id: ACC.arcReserve },
        to: { id: DEMO.vaults.portfolio },
        evidenceHash: null,
      },
    ],
    signerUserId: U.maya,
    keepOnFailure: false,
    uncovered: [],
  })
}

// ─── S2. Hand-made plans ─────────────────────────────────────────────────────

type PayOutsideOp = Extract<LedgerOp, { call: 'payOutside' }>
type ReturnCapitalOp = Extract<LedgerOp, { call: 'returnCapital' }>

async function craftedPlans(t: Checker) {
  const w = new World(t, 'settlement-crafted')
  await w.gather(U.maya, ACC.arcReserve, usd(100))

  const refuses = async (
    label: string,
    result: Promise<SettlementResult>,
    code: string,
    message?: string,
  ) => {
    const settled = await result
    return t.check(
      `${label}: the mock ledger refuses it (${code})`,
      settled.status === 'failed' &&
        settled.error?.code === code &&
        (message === undefined || settled.error.message === message),
      `${settled.status}${settled.error ? ` ${settled.error.code}: ${settled.error.message}` : ''}${message ? ` (expected "${message}")` : ''}`,
    )
  }
  const accepts = async (label: string, result: Promise<SettlementResult>) => {
    const settled = await result
    t.check(`${label}: the mock ledger accepts it`, settled.status === 'completed', settled.error?.message)
    return settled
  }
  const outsideOp = (overrides: Partial<PayOutsideOp> = {}): PayOutsideOp => ({
    call: 'payOutside',
    paymentId: 'pay_crafted',
    sourceId: ACC.arcReserve,
    to: TOOL,
    amount: usd(10),
    evidenceHash: null,
    ...overrides,
  })
  const outsideRecord = (op: PayOutsideOp, amount: Cents = op.amount): PlannedRecord => ({
    opId: op.paymentId,
    kind: 'outside_payment',
    amount,
    from: { id: op.sourceId },
    to: { address: op.to },
    evidenceHash: op.evidenceHash,
  })
  const ledgerWords = (errorName: string, args: readonly unknown[]) => {
    const data = encodeErrorResult({ abi: viatikLedgerAbi, errorName, args } as Parameters<
      typeof encodeErrorResult
    >[0])
    return ledgerErrorOf(data)
  }
  const id = (productId: Id) => ledgerId('smoke', productId)

  // payOutside: every refusal of the contract, in its order.
  const plain = outsideOp()
  await accepts(
    'S2 payOutside as the app plans it',
    w.settleCrafted(crafted(U.maya, [plain], [outsideRecord(plain)])),
  )
  await refuses(
    'S2 payOutside whose record differs from what the ledger would write',
    w.settleCrafted(crafted(U.maya, [plain], [outsideRecord(plain, cents(plain.amount + 1))])),
    'rule_drift',
  )
  const restricted = outsideOp({ sourceId: B.arcTools })
  const onlyVendors = ledgerWords('DestinationNotAllowed', [id(B.arcTools), zeroHash])
  await refuses(
    'S2 payOutside from Tools, limited to approved vendors',
    w.settleCrafted(crafted(U.maya, [restricted], [outsideRecord(restricted)])),
    'destination_not_allowed',
    onlyVendors?.message,
  )
  t.check(
    'S2: Monad decodes that revert to the same refusal',
    onlyVendors?.code === 'destination_not_allowed' &&
      onlyVendors.message.includes('Pay outside Viatik from an account instead.'),
    onlyVendors?.message,
  )
  const team = must(
    w.state.budgets.find((b) => b.id === B.arcTeam),
    'Team payments',
  )
  const overOperation = cents(team.perOperationLimit + usd(1))
  const perOperation = ledgerWords('LimitExceeded', [
    0,
    centsToUnits(team.perOperationLimit),
    centsToUnits(overOperation),
  ])
  const tooMuch = outsideOp({ sourceId: B.arcTeam, amount: overOperation })
  await refuses(
    'S2 payOutside above the per-operation limit of Team payments',
    w.settleCrafted(crafted(U.maya, [tooMuch], [outsideRecord(tooMuch)])),
    'limit_exceeded',
    perOperation?.message,
  )
  await w.run(
    U.maya,
    'setBudgetPaused',
    { budgetId: B.arcTeam, paused: true },
    'S2 setup: Maya pauses Team payments',
    {
      ops: ['setBudgetPaused'],
    },
  )
  const fromPaused = outsideOp({ sourceId: B.arcTeam })
  await refuses(
    'S2 payOutside from a paused budget',
    w.settleCrafted(crafted(U.maya, [fromPaused], [outsideRecord(fromPaused)])),
    'budget_paused',
  )
  await w.run(U.maya, 'setBudgetPaused', { budgetId: B.arcTeam, paused: false }, 'S2 setup: and resumes it', {
    ops: ['setBudgetPaused'],
  })
  const nowhere = outsideOp({ to: zeroAddress })
  await refuses(
    'S2 payOutside to the zero address',
    w.settleCrafted(crafted(U.maya, [nowhere], [outsideRecord(nowhere)])),
    'invalid_state',
  )
  await refuses(
    'S2 payOutside signed by a Member',
    w.settleCrafted(crafted(U.alex, [plain], [outsideRecord(plain)])),
    'not_authorized',
  )
  await refuses(
    "S2 payOutside from another Agency's account",
    w.settleCrafted(crafted(U.maya, [outsideOp({ sourceId: ACC.lumenOperations })])),
    'not_authorized',
  )
  await refuses(
    'S2 payOutside from something the ledger does not know',
    w.settleCrafted(crafted(U.maya, [outsideOp({ sourceId: 'acct_nowhere' })])),
    'not_registered',
  )

  // Above the exception threshold: no Investor path. Lumen Operations first holds more than it.
  const threshold = must(governingAgreement(w.state, LUMEN), "Lumen's agreement").spendingPolicy
    .exceptionThreshold
  await w.gather(U.ren, ACC.lumenOperations, cents(threshold + usd(1)))
  const above = cents(threshold + 1)
  const exception = ledgerWords('LimitExceeded', [3, centsToUnits(threshold), centsToUnits(above)])
  const aboveOp = outsideOp({ sourceId: ACC.lumenOperations, amount: above })
  await refuses(
    'S2 payOutside above the exception threshold',
    w.settleCrafted(crafted(U.ren, [aboveOp], [outsideRecord(aboveOp)])),
    'limit_exceeded',
    exception?.message,
  )
  const engineWords = w.refuse(
    U.ren,
    'payOutside',
    {
      agencyId: LUMEN,
      source: { kind: 'account', accountId: ACC.lumenOperations },
      to: TOOL,
      payee: 'Datadog',
      amount: above,
      category: 'cloud',
      memo: 'Annual plan',
    },
    'limit_exceeded',
    'S2 the engine refuses it first',
  )
  t.check(
    'S2: the engine, the mock and Monad word the threshold the same way',
    engineWords === exception?.message &&
      engineWords === `Above the Investor's exception threshold of ${usdText(threshold)}.`,
    `${engineWords} | ${exception?.message}`,
  )
  await refuses(
    'S2 paying a person above the exception threshold (payment for work)',
    w.settleCrafted(
      crafted(U.ren, [
        {
          call: 'pay',
          paymentId: 'pay_crafted_work',
          sourceId: ACC.lumenOperations,
          destinationId: null,
          memberUserId: U.noah,
          amount: above,
          evidenceHash: null,
        },
      ]),
    ),
    'limit_exceeded',
    exception?.message,
  )
  await refuses(
    "S2 a request that pays someone else's Viatik balance",
    w.settleCrafted(
      crafted(U.alex, [
        {
          call: 'requestPayment',
          requestId: 'req_crafted',
          paymentId: 'pay_crafted_request',
          budgetId: B.arcTools,
          destinationId: null,
          memberUserId: U.priya,
          amount: usd(5),
          evidenceHash: null,
          expected: 'executed',
        },
      ]),
    ),
    'not_authorized',
  )

  // recordEvidence: only a payment the ledger knows was paid outside, once, with a fingerprint.
  await w.gather(U.maya, ACC.arcReserve, usd(20))
  const unproven = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcReserve },
      to: TOOL,
      payee: 'Anthropic',
      amount: usd(20),
      category: 'ai_services',
      memo: 'Claude Teams',
    },
    'S2 setup: an outside payment without its invoice',
    { ops: ['payOutside'] },
  )
  const invoice = keccak256(stringToHex('smoke:s2-invoice'))
  const evidence = (paymentId: Id, evidenceHash: Hex = invoice, agencyId: Id = ARC) =>
    crafted(U.maya, [{ call: 'recordEvidence', agencyId, paymentId, evidenceHash }])
  await refuses(
    'S2 recordEvidence without a fingerprint',
    w.settleCrafted(evidence(unproven.result.id, zeroHash)),
    'invalid_state',
  )
  await refuses(
    'S2 recordEvidence for a payment the ledger never saw',
    w.settleCrafted(evidence('pay_nowhere')),
    'not_registered',
  )
  const vendorPayment = must(
    w.state.payments.find(
      (p) => p.agencyId === ARC && p.recipient.kind === 'destination' && p.status === 'completed',
    ),
    'a vendor payment of Arc',
  )
  await refuses(
    'S2 recordEvidence for a payment made inside Viatik',
    w.settleCrafted(evidence(vendorPayment.id)),
    'not_registered',
  )
  await refuses(
    'S2 recordEvidence signed by a Member',
    w.settleCrafted(
      crafted(U.alex, [
        { call: 'recordEvidence', agencyId: ARC, paymentId: unproven.result.id, evidenceHash: invoice },
      ]),
    ),
    'not_authorized',
  )
  await refuses(
    "S2 recordEvidence for another Agency's payment",
    w.settleCrafted(evidence(unproven.result.id, invoice, LUMEN)),
    'not_authorized',
  )
  const confirmed = await accepts(
    'S2 recordEvidence for that payment',
    w.settleCrafted(evidence(unproven.result.id)),
  )
  t.check(
    'S2: confirmed by its own event, without a receipt hash',
    confirmed.records.length === 1 &&
      confirmed.records[0]?.call === 'recordEvidence' &&
      confirmed.records[0].verified.receiptHash === undefined,
  )
  await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: unproven.result.id, proof: file('s2-invoice.pdf') },
    'S2 setup: Maya anchors its invoice',
    { ops: ['recordEvidence'] },
  )
  await refuses(
    'S2 recordEvidence a second time',
    w.settleCrafted(evidence(unproven.result.id)),
    'already_processed',
  )
  await refuses(
    'S2 payOutside with an id the ledger already recorded',
    w.settleCrafted(crafted(U.maya, [outsideOp({ paymentId: unproven.result.id })])),
    'already_processed',
  )

  // returnCapital: only from an account, to the Portfolio Vault of the Agency's portfolio.
  const capitalOp = (overrides: Partial<ReturnCapitalOp> = {}): ReturnCapitalOp => ({
    call: 'returnCapital',
    opId: 'cret_crafted',
    fromAccountId: ACC.arcReserve,
    portfolioVaultId: DEMO.vaults.portfolio,
    agreementId: DEMO.agreements.arc,
    amount: usd(10),
    evidenceHash: null,
    ...overrides,
  })
  const capitalRecord = (op: ReturnCapitalOp): PlannedRecord => ({
    opId: op.opId,
    kind: 'capital_return',
    amount: op.amount,
    from: { id: op.fromAccountId },
    to: { id: op.portfolioVaultId },
    evidenceHash: op.evidenceHash,
  })
  const unnamed = capitalOp({ agreementId: null })
  await accepts(
    'S2 returnCapital without naming an agreement',
    w.settleCrafted(crafted(U.maya, [unnamed], [capitalRecord(unnamed)])),
  )
  await refuses(
    'S2 returnCapital from a budget',
    w.settleCrafted(crafted(U.maya, [capitalOp({ fromAccountId: B.arcTeam })])),
    'not_registered',
  )
  await refuses(
    'S2 returnCapital into a funding vault',
    w.settleCrafted(crafted(U.maya, [capitalOp({ portfolioVaultId: DEMO.vaults.arcFunding })])),
    'not_registered',
  )
  const other = await w.run(
    U.marcus,
    'createPortfolio',
    { name: 'Second Fund', organization: 'Northstar Capital', timeZone: 'UTC' },
    'S2 setup: Marcus opens another portfolio',
    { ops: ['createPortfolio'] },
  )
  const otherVault = must(
    w.state.vaults.find((v) => v.kind === 'portfolio' && v.portfolioId === other.result.id),
    'the new Portfolio Vault',
  )
  await refuses(
    "S2 returnCapital into another portfolio's vault",
    w.settleCrafted(crafted(U.maya, [capitalOp({ portfolioVaultId: otherVault.id })])),
    'invalid_state',
  )
  await refuses(
    "S2 returnCapital under another Agency's agreement",
    w.settleCrafted(crafted(U.maya, [capitalOp({ agreementId: DEMO.agreements.lumen })])),
    'invalid_state',
  )
  await refuses(
    'S2 returnCapital of nothing',
    w.settleCrafted(crafted(U.maya, [capitalOp({ amount: cents(0) })])),
    'invalid_state',
  )
  await refuses(
    'S2 returnCapital signed by a Member',
    w.settleCrafted(crafted(U.alex, [capitalOp()])),
    'not_authorized',
  )
  await refuses(
    'S2 returnCapital of more than the account holds',
    w.settleCrafted(
      crafted(U.maya, [capitalOp({ amount: cents(accountBalance(w.state, ACC.arcReserve) + 1) })]),
    ),
    'insufficient_funds',
  )
}

// ─── S3. Calldata and witnesses ──────────────────────────────────────────────

function calldata(t: Checker) {
  const evidence = keccak256(stringToHex('smoke:s3-invoice'))
  const ops: LedgerOp[] = [
    {
      call: 'payOutside',
      paymentId: 'pay_s3',
      sourceId: B.arcTeam,
      to: TOOL,
      amount: usd(12),
      evidenceHash: evidence,
    },
    { call: 'recordEvidence', agencyId: ARC, paymentId: 'pay_s3b', evidenceHash: evidence },
    {
      call: 'returnCapital',
      opId: 'cret_s3',
      fromAccountId: ACC.arcReserve,
      portfolioVaultId: DEMO.vaults.portfolio,
      agreementId: null,
      amount: usd(34),
      evidenceHash: null,
    },
  ]
  const id = (productId: Id) => ledgerId(SMOKE_CHAIN.namespace, productId)
  const { calls } = encodePlan(ops, SMOKE_CHAIN)
  const decoded = calls.map(
    (data) =>
      decodeFunctionData({ abi: viatikLedgerAbi, data }) as unknown as {
        functionName: string
        args: readonly unknown[]
      },
  )
  checkSame(t, 'S3: payOutside calldata', decoded[0], {
    functionName: 'payOutside',
    args: [id('pay_s3'), id(B.arcTeam), TOOL, centsToUnits(usd(12)), evidence],
  })
  checkSame(t, 'S3: recordEvidence calldata', decoded[1], {
    functionName: 'recordEvidence',
    args: [id(ARC), id('pay_s3b'), evidence],
  })
  checkSame(t, 'S3: returnCapital calldata, no agreement and no document as zero', decoded[2], {
    functionName: 'returnCapital',
    args: [
      id('cret_s3'),
      id(ACC.arcReserve),
      id(DEMO.vaults.portfolio),
      zeroHash,
      centsToUnits(usd(34)),
      zeroHash,
    ],
  })
  checkSame(t, 'S3: what proves each one ran', witnessesOf(crafted(U.maya, ops)), [
    { events: ['Recorded'], id: 'pay_s3' },
    { events: ['EvidenceRecorded'], id: 'pay_s3b', args: { evidenceHash: evidence } },
    { events: ['Recorded'], id: 'cret_s3' },
  ])
}

// ─── S4. Receipt-hash vectors ────────────────────────────────────────────────

function vectors(t: Checker) {
  // The same literals as test_ReceiptHashVectorsMatchTheApp in contracts/test/ViatikLedger.v3.t.sol.
  const chain: ChainContext = { namespace: 'vector', addressOf: () => undefined }
  const INVOICE: Hex = '0x3897bd132a2928ba149f345800d0fbdfcea53173f47860befd5281705f927e2b'
  const BEEF: Address = getAddress('0x000000000000000000000000000000000000beef')
  t.check(
    'S4: the op id is keccak256("vector:op") and the invoice keccak256("qa:invoice_claude_teams")',
    ledgerId('vector', 'op') === keccak256(stringToHex('vector:op')) &&
      INVOICE === keccak256(stringToHex('qa:invoice_claude_teams')),
  )
  t.check(
    'S4: cents become the units the Solidity vectors use',
    centsToUnits(cents(123_456)) === 1_234_560_000n && centsToUnits(cents(98_765)) === 987_650_000n,
  )
  const cases: { name: string; record: PlannedRecord; hash: Hex }[] = [
    {
      name: 'kind 10, an outside payment with its invoice',
      record: {
        opId: 'op',
        kind: 'outside_payment',
        amount: cents(123_456),
        from: { id: 'from' },
        to: { address: BEEF },
        evidenceHash: INVOICE,
      },
      hash: '0x7b03f76c2f04595ab0ef89b901aee5e2ef55cdab8bf4a0487bec61969097b728',
    },
    {
      name: 'kind 10, an outside payment without an invoice',
      record: {
        opId: 'op',
        kind: 'outside_payment',
        amount: cents(123_456),
        from: { id: 'from' },
        to: { address: BEEF },
        evidenceHash: null,
      },
      hash: '0xac41098eb6048e754f545530e257bab4b2825c2cf0b7c8298e6a829853a60dfb',
    },
    {
      name: 'kind 11, a capital return',
      record: {
        opId: 'op',
        kind: 'capital_return',
        amount: cents(98_765),
        from: { id: 'from' },
        to: { id: 'to' },
        evidenceHash: null,
      },
      hash: '0x0307a06e88d043740bdeebcf56fa6a5beb6ba365c3401620baf462d47c2b900f',
    },
    {
      name: 'kind 9, a withdrawal with the same ends as the outside payment',
      record: {
        opId: 'op',
        kind: 'withdrawal',
        amount: cents(123_456),
        from: { id: 'from' },
        to: { address: BEEF },
        evidenceHash: null,
      },
      hash: '0x1222343280ac359833494b4db3dd16b1dccb5f2bf928030a388dd01c109953f0',
    },
  ]
  for (const { name, record, hash } of cases) {
    const actual = receiptHashOf(record, chain)
    t.check(`S4: ${name}`, actual === hash, `got ${actual}`)
  }
}

// ─── S5. Self-test ───────────────────────────────────────────────────────────

async function selfTest(t: Checker) {
  const w = new World(t, 'settlement-self')
  await w.gather(U.maya, ACC.arcReserve, usd(15))
  const step = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcReserve },
      to: TOOL,
      payee: 'Anthropic',
      amount: usd(15),
      category: 'ai_services',
      memo: 'Claude Teams',
    },
    'S5 a real step to tamper with',
    { ops: ['payOutside'] },
  )
  const plan = must(step.plan, 'the plan')
  t.check(
    'S5: the real step passes the invariants',
    ledgerInvariants(step.before, step.after, plan, step.settled, w.now).length === 0,
  )
  const wrongAmount = structuredClone(plan)
  const record = wrongAmount.records[0]
  if (record) record.amount = cents(record.amount + 100)
  const caught = ledgerInvariants(step.before, step.after, wrongAmount, step.settled, w.now)
  t.check(
    'S5: a record with the wrong amount is caught',
    caught.some((problem) => problem.includes('do not add up')),
    caught.join(' | '),
  )
  const lost = structuredClone(step.after)
  lost.movements = lost.movements.filter((m) => m.refId !== step.result.id)
  const missing = ledgerInvariants(step.before, lost, plan, step.settled, w.now)
  t.check(
    'S5: a movement the plan settles but the state lost is caught',
    missing.some((problem) => problem.includes('do not add up')) &&
      missing.some((problem) => problem.includes("mock ledger's books")),
    missing.join(' | '),
  )
  const unrecorded = ledgerInvariants(
    step.before,
    step.after,
    plan,
    { status: 'completed', records: [] },
    w.now,
  )
  t.check(
    'S5: a receipt without its ledger record is caught',
    unrecorded.some((problem) => problem.includes('has no ledger record')),
    unrecorded.join(' | '),
  )
}

/** The per-operation limit a budget applies (its own; allowances here have none of their own). */
function budgetPerOperation(w: World, budgetId: Id): Cents {
  return must(
    w.state.budgets.find((b) => b.id === budgetId),
    `budget ${budgetId}`,
  ).perOperationLimit
}

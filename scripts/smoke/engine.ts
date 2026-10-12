import { getAddress, keccak256, slice, stringToHex } from 'viem'

import {
  accountabilityByPerson,
  addDays,
  advanceStanding,
  advancesOf,
  agencyAccountability,
  JUSTIFY_WITHIN_DAYS,
  lastReminded,
  missingReceipts,
  otherMoneyReturnable,
  outsidePaymentsWithoutProof,
  PROOF_WITHIN_DAYS,
  REMIND_EVERY_HOURS,
  portfolioAccountability,
  remindersDue,
  returnableFor,
} from '@/domain/accountability'
import { planSettlement } from '@/data/settlement'
import { parseAddress, shortAddress } from '@/domain/address'
import {
  execute,
  previewPolicy,
  runCommand,
  workPaymentId,
  type CommandInput,
  type CommandName,
  type EvidenceDraft,
  type RequestPaymentInput,
} from '@/domain/engine'
import { attachmentsHash } from '@/domain/evidence'
import { DEMO } from '@/domain/fixtures'
import { cents, clampToZero, formatUsd, sum, usd, type Cents } from '@/domain/money'
import {
  agencyNextTranche,
  paymentTypeLabel,
  receiptKindLabel,
  releaseModelLabel,
  requestTypeLabel,
} from '@/domain/labels'
import { upgradeState } from '@/domain/migrate'
import { describeBudgetPolicy, paysRequester, perPaymentCap } from '@/domain/policy'
import {
  adminApprovals,
  agencyAgreementSummary,
  agencyFundingAgreement,
  agencyTeamSize,
  agreementsOf,
  budgetsForVendor,
  defaultBillAccount,
  exceptionThresholdOf,
  governingAgreement,
  investorApprovals,
  isException,
  isOutsidePayment,
  payablePeople,
  userName,
} from '@/domain/queries'
import {
  accountBalance,
  agencyCapital,
  agreementBadge,
  agreementCapital,
  agreementDisplayStatus,
  budgetUsage,
  holderSpentInPeriod,
  isFullyReleased,
  isGiveBack,
  isLastTranche,
  memberHeld,
  portfolioCapital,
  vaultBalance,
} from '@/domain/selectors'
import { justificationStatus, proofStatus, reminderStatus, trancheStatusFor } from '@/domain/status'
import type {
  Budget,
  Evidence,
  Id,
  ISODate,
  Location,
  Movement,
  Notification,
  NotificationSubject,
  PaymentRequest,
  PaymentType,
  PolicyDecision,
  RequestType,
  ViatikState,
} from '@/domain/types'
import { scopeStateForUser } from '@/domain/visibility'
import { buildGenesis } from '@/ledger/genesis'
import { ledgerId } from '@/ledger/ids'
import { simulateLedger } from '@/ledger/mock'
import { ledgerSnapshot } from '@/ledger/snapshot'
import { heldByCommand, heldByOperation, sharesAny } from '@/server/conflicts'
import { parseCommandInput } from '@/server/schemas'
import { USDC } from '@/web3/addresses'
import { MONAD_NETWORKS } from '@/web3/networks'

import {
  bookedTotal,
  checkSame,
  dayBefore,
  decodeGenesis,
  file,
  link,
  must,
  notifiedUsers,
  plusHours,
  same,
  World,
  type Checker,
  type Expect,
} from './harness'

/**
 * The product stories of Phase B, end to end through the engine and the mock
 * ledger: money for purchases and its receipts, reimbursements, payment for
 * work, payments outside Viatik and their invoices, capital returned to the
 * Investor, who sees what, reminders, and the checks of the first smoke
 * (withdrawals, saved addresses, providers).
 */

const { users: U, agencies: A, accounts: ACC, budgets: B, destinations: D } = DEMO
const ARC = A.arc
const LUMEN = A.lumen
const ADMINS = [U.jordan, U.maya].sort()
const INVESTORS = [U.elena, U.marcus].sort()
/** Where the Agency pays its tools outside Viatik. */
const TOOL = getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72')
/** A person's own wallet. */
const WALLET = '0x19F79Be75A05360af0BED0D99d9317eE3Df6D6c9'
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const DAY_MS = 24 * 60 * 60 * 1000

const usdText = (value: Cents) => formatUsd(value, { withCode: true })

export default async function engine(t: Checker) {
  await t.scenario('A. Money for purchases: receipts in one step, return the rest, overdue', () =>
    moneyForPurchases(t),
  )
  await t.scenario('B. Reimbursement', () => reimbursement(t))
  await t.scenario('C. Payment for work', () => paymentForWork(t))
  await t.scenario('D. Paying outside Viatik, and the invoice', () => outsidePayments(t))
  await t.scenario('E. Returning capital to the Investor', () => returnToInvestor(t))
  await t.scenario('F. Who sees what', () => visibility(t))
  await t.scenario('G. Monthly reminders and receipt reminders', () => reminders(t))
  await t.scenario('I. The first smoke: withdrawals, saved addresses, providers', () => firstSmoke(t))
  await t.scenario('J. Labels, statuses, the seed and the API schemas', () => labelsAndSeed(t))
  await t.scenario("K1. A Member's preview, on what they see, around the exception threshold", () =>
    memberPreview(t),
  )
  await t.scenario('K2. A receipt justifies money once, and not before it was requested', () =>
    receiptsUsedOnce(t),
  )
  await t.scenario('K3. Payment for work is paid once', () => workPaidOnce(t))
  await t.scenario('K4. A return says which money it gives back', () => returnsSayWhichMoney(t))
  await t.scenario('K5. An older request for money that pays a vendor keeps its Expense', () =>
    olderVendorFunds(t),
  )
  await t.scenario('K6. The server holds the files and bills of operations waiting to be signed', () =>
    filesAndBillsHeld(t),
  )
  await t.scenario('K7. Bills paid from a budget: the budgets that can pay the vendor', () =>
    billsFromBudgets(t),
  )
  await t.scenario("L. The seed's demo story, as the read models show it, and going on", () => seedStory(t))
  await t.scenario("M. A funding agreement's lifecycle, to its last tranche and a second agreement", () =>
    agreementLifecycle(t),
  )
  await t.scenario('N. Funding never exceeds what the tranches left can release', () => fundingCap(t))
  await t.scenario('O. A notification that asks for a decision is read once someone decides', () =>
    decidedNotifications(t),
  )
}

// ─── A. Money for purchases ──────────────────────────────────────────────────

async function moneyForPurchases(t: Checker) {
  const w = new World(t, 'engine-a')
  const tools = budgetOf(w.state, B.arcTools)
  t.check(
    'A: Tools only pays approved vendors, yet pays member requests',
    tools.allowedDestinationIds.length > 0,
  )
  const left = allowanceLeft(w, B.arcTools, U.alex)
  const amount = cents(Math.min(usd(150), left, tools.approvalThreshold))
  if (amount < usd(20)) throw new Error(`Alex has only ${left} cents left on Tools this month`)
  await w.fund(U.maya, B.arcTools, amount)
  const held = memberHeld(w.state, ARC, U.alex)
  const pendingBefore = personPending(w.state, ARC, U.alex, w.now)
  // The seed's own money for purchases of Daniel's (the demo story), older than anything below.
  const danielSeeded = advancesOf(w.state, { agencyId: ARC, userId: U.daniel }, w.now).length
  const spentBefore = agencyCapital(w.state, ARC, w.now).states.spent
  const portfolioSpentBefore = portfolioCapital(w.state, DEMO.portfolio, w.now).states.spent

  // A1. Alex asks for money for purchases: paid into his own Viatik balance at once.
  const ask: RequestPaymentInput = {
    agencyId: ARC,
    budgetId: B.arcTools,
    type: 'funds',
    amount,
    category: 'software',
    purpose: 'Design tablet',
    idempotencyKey: 'smoke-a1-funds',
  }
  const previewed = preview(w, U.alex, ask)
  const a1 = await w.run(U.alex, 'requestPayment', ask, 'A1 Alex asks for money for purchases', {
    ops: ['requestPayment'],
  })
  const request = a1.result
  samePreview(t, 'A1', previewed, request.decision)
  t.check('A1: approved and paid at once', request.status === 'completed', request.status)
  checkSame(t, "A1: it pays Alex's own Viatik balance", request.destination, {
    kind: 'member',
    userId: U.alex,
  })
  const advance = must(
    w.state.payments.find((p) => p.id === request.paymentId),
    'the payment of the money for purchases',
  )
  t.check(
    'A1: the payment is money for purchases (an advance) to Alex',
    advance.type === 'advance' && same(advance.recipient, { kind: 'member', userId: U.alex }),
    `${advance.type} ${JSON.stringify(advance.recipient)}`,
  )
  t.check('A1: Alex holds that much more', memberHeld(w.state, ARC, U.alex) - held === amount)
  t.check('A1: no expense is created for it', !w.state.expenses.some((e) => e.paymentId === advance.id))
  checkSame(t, 'A1: requestPayment pays the requester, no vendor', a1.plan?.ops[0], {
    call: 'requestPayment',
    requestId: request.id,
    paymentId: advance.id,
    budgetId: B.arcTools,
    destinationId: null,
    memberUserId: U.alex,
    amount,
    evidenceHash: null,
    expected: 'executed',
  })
  checkSame(t, 'A1: the record moves the money from Tools to Alex', a1.plan?.records, [
    {
      opId: advance.id,
      kind: 'payment',
      amount,
      from: { id: B.arcTools },
      to: { member: U.alex },
      evidenceHash: null,
    },
  ])
  const standing = advanceStanding(w.state, advance, w.now)
  t.check(
    `A1: all of it is pending, due in ${JUSTIFY_WITHIN_DAYS} days, not overdue`,
    standing.pending === amount &&
      standing.dueAt === addDays(w.now, JUSTIFY_WITHIN_DAYS) &&
      !standing.overdue,
    JSON.stringify({ pending: standing.pending, dueAt: standing.dueAt, overdue: standing.overdue }),
  )
  t.check(
    'A1: Alex has that much more to justify',
    personPending(w.state, ARC, U.alex, w.now) - pendingBefore === amount,
  )
  t.check('A1: Alex is not notified of his own request', !a1.notifications.some((n) => n.userId === U.alex))
  const alexName = userName(w.state, U.alex)
  t.check(
    "A1: the receipt and the activity name Alex's Viatik balance",
    a1.receipts[0]?.toLabel === `${alexName} · Viatik balance` &&
      a1.activity.some(
        (a) =>
          a.type === 'payment_completed' &&
          a.summary === `Paid ${usdText(amount)} to ${alexName}'s Viatik balance`,
      ),
    `${a1.receipts[0]?.toLabel} | ${a1.activity.map((a) => a.summary).join(' | ')}`,
  )

  // A2. A receipt for part of it, in one step.
  const first = cents(Math.floor(amount * 0.4))
  const a2 = await w.run(
    U.alex,
    'addExpense',
    {
      agencyId: ARC,
      paymentId: advance.id,
      merchant: 'Pixel Store',
      amount: first,
      category: 'software',
      spentAt: dayBefore(w.now),
      receipt: file('a2-pixel-store.pdf'),
    },
    'A2 Alex adds a receipt for part of it',
    { ops: [] },
  )
  const expense = a2.result
  t.check(
    'A2: the expense justifies the advance, on its budget, with its receipt',
    expense.paymentId === advance.id && expense.budgetId === B.arcTools && expense.receipt?.kind === 'file',
  )
  t.check(
    'A2: the rest is still pending',
    advanceStanding(w.state, advance, w.now).pending === amount - first,
    String(advanceStanding(w.state, advance, w.now).pending),
  )
  checkSame(t, 'A2: the Agency Admins hear about it', notifiedUsers(a2), ADMINS)
  t.check(
    "A2: 'Receipt uploaded', pointing to Alex's page",
    a2.notifications.every(
      (n) => n.title === 'Receipt uploaded' && n.href === `/agency/${ARC}/team/${U.alex}`,
    ),
  )
  t.check(
    "A2: Alex's activity shows the receipt",
    a2.activity.some((a) => a.type === 'receipt_added' && a.subjectUserId === U.alex),
  )

  // A3. Receipts only justify Alex's own money for purchases, with the file, up to what is pending.
  const pending = advanceStanding(w.state, advance, w.now).pending
  const receiptInput = {
    agencyId: ARC,
    paymentId: advance.id,
    merchant: 'Pixel Store',
    amount: usd(5),
    category: 'software' as const,
    spentAt: dayBefore(w.now),
    receipt: file('a3-receipt.pdf'),
  }
  const cap = w.refuse(
    U.alex,
    'addExpense',
    { ...receiptInput, amount: cents(pending + 1) },
    'limit_exceeded',
    'A3 a receipt above what is pending',
  )
  t.check(
    'A3: it says how much is left and to ask for a reimbursement',
    cap === `You can add up to ${usdText(pending)} to this advance. For more, request a reimbursement.`,
    cap,
  )
  const { paymentId: _unlinked, ...withoutAdvance } = receiptInput
  w.refuseRaw(
    U.alex,
    'addExpense',
    withoutAdvance,
    'schema',
    'A3 an expense not linked to money for purchases (API)',
  )
  w.refuseRaw(
    U.alex,
    'addExpense',
    withoutAdvance,
    'not_found',
    'A3 an expense not linked to money for purchases (engine)',
    { skipSchema: true },
  )
  const { receipt: _noFile, ...withoutReceipt } = receiptInput
  w.refuseRaw(U.alex, 'addExpense', withoutReceipt, 'schema', 'A3 an expense without its receipt (API)')
  const noReceipt = w.refuseRaw(
    U.alex,
    'addExpense',
    withoutReceipt,
    'validation',
    'A3 an expense without its receipt (engine)',
    { skipSchema: true },
  )
  t.check("A3: it says 'Attach the receipt.'", noReceipt === 'Attach the receipt.', noReceipt)
  w.refuse(
    U.alex,
    'addExpense',
    { ...receiptInput, receipt: link('Receipt', 'https://example.com/receipt') },
    'validation',
    'A3 a link instead of the receipt file',
  )
  const vendorPayment = must(
    w.state.payments.find(
      (p) => p.agencyId === ARC && p.recipient.kind === 'destination' && p.status === 'completed',
    ),
    'a vendor payment of Arc',
  )
  w.refuse(
    U.alex,
    'addExpense',
    { ...receiptInput, paymentId: vendorPayment.id },
    'forbidden',
    'A3 a receipt for a payment that is not money for purchases',
  )
  w.refuse(U.priya, 'addExpense', receiptInput, 'forbidden', "A3 Priya adds a receipt to Alex's money")
  w.refuse(
    U.alex,
    'addExpense',
    { ...receiptInput, category: 'travel' },
    'validation',
    'A3 a category Tools does not allow',
  )
  w.refuse(
    U.alex,
    'addExpense',
    { ...receiptInput, spentAt: dayBefore(w.now, -2) },
    'validation',
    'A3 a receipt dated in the future',
  )

  // A4. An older vendor payment's expense still takes its receipt, once, as a file.
  const missing = missingReceipts(w.state, { agencyId: ARC, userId: U.alex })
  const older = must(missing[0], "an older expense of Alex's without its receipt")
  const olderPayment = w.state.payments.find((p) => p.id === older.paymentId)
  t.check(
    "A4: the missing receipt is a vendor payment's, not money for purchases",
    olderPayment?.type !== 'advance',
    olderPayment?.type,
  )
  w.refuse(
    U.alex,
    'attachReceipt',
    { expenseId: older.id, receipt: link('Receipt', 'https://example.com/receipt') },
    'validation',
    'A4 a link is not a receipt',
  )
  w.refuse(
    U.priya,
    'attachReceipt',
    { expenseId: older.id, receipt: file('a4-not-mine.pdf') },
    'forbidden',
    "A4 Priya attaches a receipt to Alex's expense",
  )
  const a4 = await w.run(
    U.alex,
    'attachReceipt',
    { expenseId: older.id, receipt: file('a4-vertex-receipt.pdf') },
    'A4 Alex attaches the receipt of an older vendor payment',
    { ops: [] },
  )
  t.check('A4: the expense has its receipt', a4.result.receipt?.kind === 'file')
  t.check(
    'A4: one receipt fewer is missing',
    missingReceipts(w.state, { agencyId: ARC, userId: U.alex }).length === missing.length - 1,
  )
  checkSame(t, 'A4: the Agency Admins hear about it', notifiedUsers(a4), ADMINS)
  w.refuse(
    U.alex,
    'attachReceipt',
    { expenseId: older.id, receipt: file('a4-again.pdf') },
    'invalid_state',
    'A4 a second receipt for the same expense',
  )

  // A6. Overdue: 30 days after it was paid, while something is pending (read at a later time).
  const dueAt = advanceStanding(w.state, advance, w.now).dueAt
  const late = plusHours(dueAt, 1)
  t.check(
    `A6: on time ${JUSTIFY_WITHIN_DAYS} days after it was paid`,
    !advanceStanding(w.state, advance, dueAt).overdue,
  )
  const lateStanding = advanceStanding(w.state, advance, late)
  t.check(
    'A6: overdue an hour later, for what is still pending',
    lateStanding.overdue && lateStanding.pending === amount - first,
  )
  const alexLate = accountabilityByPerson(w.state, ARC, late).find((p) => p.userId === U.alex)
  t.check(
    'A6: overdue in the per-person view',
    Boolean(alexLate && alexLate.overdueCount >= 1 && alexLate.overdue >= lateStanding.pending),
    JSON.stringify(alexLate && { overdue: alexLate.overdue, count: alexLate.overdueCount }),
  )
  const arcLate = agencyAccountability(w.state, ARC, late)
  t.check(
    'A6: overdue in the Agency view',
    arcLate.peopleOverdue >= 1 && arcLate.overdue >= lateStanding.pending,
    JSON.stringify({ peopleOverdue: arcLate.peopleOverdue, overdue: arcLate.overdue }),
  )

  // A5. Return the rest: it settles the advance.
  const rest = advanceStanding(w.state, advance, w.now).pending
  w.refuse(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: cents(rest + 1), paymentId: advance.id },
    'limit_exceeded',
    'A5 returning more than is pending on it',
  )
  w.refuse(
    U.priya,
    'returnUnusedFunds',
    { agencyId: ARC, amount: usd(1), paymentId: advance.id },
    'forbidden',
    "A5 Priya returns Alex's money",
  )
  const operationsBefore = accountBalance(w.state, ACC.arcOperations)
  const a5 = await w.run(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: rest, paymentId: advance.id },
    'A5 Alex returns the rest',
    { ops: ['returnToAgency'] },
  )
  const returnId = a5.result.operationId
  checkSame(t, 'A5: returnToAgency for the rest', a5.plan?.ops[0], {
    call: 'returnToAgency',
    opId: returnId,
    agencyId: ARC,
    amount: rest,
  })
  checkSame(t, "A5: the record goes from Alex's balance to Operations", a5.plan?.records, [
    {
      opId: returnId,
      kind: 'return',
      amount: rest,
      from: { member: U.alex },
      to: { id: ACC.arcOperations },
      evidenceHash: null,
    },
  ])
  t.check('A5: the movement settles the advance', a5.movements[0]?.settlesPaymentId === advance.id)
  t.check(
    'A5: the receipt says it is unused money returned',
    a5.result.description === `Unused money returned · ${advance.memo}`,
    a5.result.description,
  )
  const settled = advanceStanding(w.state, advance, w.now)
  t.check(
    'A5: nothing is pending any more',
    settled.pending === 0 && settled.settled && settled.returned === rest,
    JSON.stringify({ pending: settled.pending, returned: settled.returned }),
  )
  t.check('A5: settled money is never overdue', !advanceStanding(w.state, advance, late).overdue)
  t.check(
    'A5: Operations gets it back',
    accountBalance(w.state, ACC.arcOperations) - operationsBefore === rest,
  )
  checkSame(t, 'A5: the Agency Admins hear about it', notifiedUsers(a5), ADMINS)
  t.check(
    'A5: the activity shows the return',
    a5.activity.some((a) => a.type === 'advance_returned'),
  )
  t.check(
    'A5: Spent counts only what was not given back',
    agencyCapital(w.state, ARC, w.now).states.spent - spentBefore === amount - rest,
    `${agencyCapital(w.state, ARC, w.now).states.spent - spentBefore} vs ${amount - rest}`,
  )
  t.check(
    "A5: so does the portfolio's Spent",
    portfolioCapital(w.state, DEMO.portfolio, w.now).states.spent - portfolioSpentBefore === amount - rest,
  )
  w.refuse(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: usd(1), paymentId: advance.id },
    'invalid_state',
    'A5 returning money already settled',
  )
  w.refuse(U.alex, 'addExpense', receiptInput, 'limit_exceeded', 'A5 a receipt for money already settled')

  // A7. Daniel asks for more than Tools approves by itself: an Agency Admin approves it.
  const danielAmount = cents(tools.approvalThreshold + usd(50))
  if (danielAmount > Math.min(tools.perOperationLimit, allowanceLeft(w, B.arcTools, U.daniel)))
    throw new Error('Daniel cannot ask for more than the automatic limit of Tools')
  const danielAsk: RequestPaymentInput = {
    ...ask,
    amount: danielAmount,
    purpose: 'Usability test kit',
    idempotencyKey: 'smoke-a7-funds',
  }
  await w.fund(U.maya, B.arcTools, danielAmount)
  const a7Preview = preview(w, U.daniel, danielAsk)
  const a7 = await w.run(
    U.daniel,
    'requestPayment',
    danielAsk,
    'A7 Daniel asks for more than Tools approves by itself',
    {
      ops: ['requestPayment'],
    },
  )
  const waiting = a7.result
  samePreview(t, 'A7', a7Preview, waiting.decision)
  t.check(
    'A7: it waits for an Agency Admin',
    waiting.status === 'needs_approval' &&
      waiting.decision.reason?.rule === 'approval_threshold' &&
      !isException(w.state, waiting),
    `${waiting.status} ${waiting.decision.reason?.rule}`,
  )
  checkSame(t, 'A7: the ledger keeps the request waiting', a7.plan?.ops[0], {
    call: 'requestPayment',
    requestId: waiting.id,
    paymentId: `${waiting.id}:payment`,
    budgetId: B.arcTools,
    destinationId: null,
    memberUserId: U.daniel,
    amount: danielAmount,
    evidenceHash: null,
    expected: 'pending',
  })
  checkSame(t, 'A7: recorded as waiting, for Daniel', a7.plan?.records, [
    {
      opId: waiting.id,
      kind: 'payment_pending',
      amount: danielAmount,
      from: { id: B.arcTools },
      to: { member: U.daniel },
      evidenceHash: null,
    },
  ])
  checkSame(t, 'A7: the Agency Admins are asked', notifiedUsers(a7), ADMINS)
  t.check(
    'A7: in the Agency Admins’ queue',
    adminApprovals(w.state, ARC).mine.some((r) => r.id === waiting.id),
  )
  const a7b = await w.run(U.maya, 'approveRequest', { requestId: waiting.id }, 'A7 Maya approves it', {
    ops: ['approvePayment'],
  })
  const paid = a7b.result.payment
  checkSame(t, 'A7: approvePayment pays it', a7b.plan?.ops[0], {
    call: 'approvePayment',
    requestId: waiting.id,
    paymentId: paid.id,
  })
  checkSame(t, 'A7: the record moves the money to Daniel', a7b.plan?.records, [
    {
      opId: paid.id,
      kind: 'payment',
      amount: danielAmount,
      from: { id: B.arcTools },
      to: { member: U.daniel },
      evidenceHash: null,
    },
  ])
  t.check('A7: it is money for purchases', paid.type === 'advance' && paid.approvedBy === U.maya)
  t.check(
    'A7: Daniel hears that it is in his Viatik balance, with the receipts rule',
    a7b.notifications.some(
      (n) =>
        n.userId === U.daniel &&
        n.title === 'Money for your purchase' &&
        n.body.includes(`within ${JUSTIFY_WITHIN_DAYS} days`) &&
        n.href === `/member/${ARC}/payments`,
    ),
  )
  t.check('A7: Daniel now has it to justify', personPending(w.state, ARC, U.daniel, w.now) >= danielAmount)

  // A8. The period limit is the app's own rule: refused before the ledger, kept in history.
  const alexLeft = allowanceLeft(w, B.arcTools, U.alex)
  const overPeriod = cents(alexLeft + usd(10))
  if (overPeriod > tools.perOperationLimit)
    throw new Error('Alex has too much left to go over his period limit')
  const overAsk: RequestPaymentInput = {
    ...ask,
    amount: overPeriod,
    purpose: 'Second monitor',
    idempotencyKey: 'smoke-a8-period',
  }
  const a8Preview = preview(w, U.alex, overAsk)
  const a8 = await w.run(
    U.alex,
    'requestPayment',
    overAsk,
    'A8 Alex asks for more than is left of his monthly limit',
    {
      ops: [],
      settle: 'failed',
      error: 'policy_rejected',
      keep: true,
    },
  )
  samePreview(t, 'A8', a8Preview, a8.result.decision)
  const rejected = must(
    w.state.requests.find((r) => r.id === a8.result.id),
    'the rejected request',
  )
  t.check(
    'A8: stored as rejected for the period limit, never sent to the ledger',
    rejected.status === 'rejected' && rejected.decision.reason?.rule === 'period_limit' && !rejected.ledger,
    `${rejected.status} ${rejected.decision.reason?.rule}`,
  )
  t.check(
    'A8: the activity shows the rejection',
    a8.activity.some((a) => a.type === 'policy_rejected'),
  )

  // A8b. Above the per-operation limit: a rule the ledger checks itself, so it records the rejection.
  const overOperation = cents(tools.perOperationLimit + usd(1))
  const a8b = await w.run(
    U.daniel,
    'requestPayment',
    { ...ask, amount: overOperation, purpose: 'Camera', idempotencyKey: 'smoke-a8-operation' },
    'A8 Daniel asks for more than the per-operation limit',
    { ops: ['requestPayment'], settle: 'failed', error: 'limit_exceeded', keep: true },
  )
  checkSame(t, 'A8: the ledger is asked and expected to reject it', a8b.plan?.ops[0], {
    call: 'requestPayment',
    requestId: a8b.result.id,
    paymentId: `${a8b.result.id}:payment`,
    budgetId: B.arcTools,
    destinationId: null,
    memberUserId: U.daniel,
    amount: overOperation,
    evidenceHash: null,
    expected: 'rejected',
  })
  checkSame(t, 'A8: recorded as rejected', a8b.plan?.records, [
    {
      opId: a8b.result.id,
      kind: 'payment_rejected',
      amount: overOperation,
      from: { id: B.arcTools },
      to: { member: U.daniel },
      evidenceHash: null,
    },
  ])
  const recorded = must(
    w.state.requests.find((r) => r.id === a8b.result.id),
    'the rejected request',
  )
  t.check(
    "A8: the request shows the ledger's rejection",
    recorded.status === 'rejected' &&
      recorded.ledger?.outcome === 'rejected' &&
      recorded.ledger.reason?.code === 'limit_exceeded',
    JSON.stringify(recorded.ledger?.reason),
  )

  // A9. Only vendor payments name where the money goes.
  const toVendor = w.refuse(
    U.alex,
    'requestPayment',
    { ...ask, amount: usd(10), destinationId: D.vertex, idempotencyKey: 'smoke-a9-dest' },
    'validation',
    'A9 money for purchases sent to a vendor',
  )
  t.check(
    'A9: it says the request pays his own balance',
    toVendor === 'This request pays your Viatik balance, not a vendor.',
    toVendor,
  )
  w.refuse(
    U.alex,
    'requestPayment',
    { ...ask, type: 'vendor_payment', amount: usd(10), idempotencyKey: 'smoke-a9-vendor' },
    'validation',
    'A9 a vendor payment without its vendor',
  )

  // A5b. "Return the rest" only takes what is still in the Viatik balance; the rest needs receipts.
  const keep = usd(100)
  const withdrawn = await w.run(
    U.daniel,
    'withdrawBalance',
    { agencyId: ARC, amount: cents(memberHeld(w.state, ARC, U.daniel) - keep), to: WALLET },
    'A5b Daniel withdraws all but 100 of his balance',
    { ops: ['withdrawMemberBalance'] },
  )
  checkSame(t, 'A5b: the Agency Admins hear about the withdrawal', notifiedUsers(withdrawn), ADMINS)
  t.check(
    'A5b: …but never where the money went',
    withdrawn.notifications.every(
      (n) =>
        n.title === 'Balance withdrawn' &&
        n.href === `/agency/${ARC}/team/${U.daniel}` &&
        !`${n.body} ${n.href}`.toLowerCase().includes(WALLET.toLowerCase()),
    ),
  )
  const danielStanding = advanceStanding(w.state, paid, w.now)
  t.check(
    'A5b: what can be returned is what is left in his balance',
    danielStanding.pending === danielAmount && returnableFor(w.state, danielStanding) === keep,
    `pending ${danielStanding.pending}, returnable ${returnableFor(w.state, danielStanding)}`,
  )
  const capped = w.refuse(
    U.daniel,
    'returnUnusedFunds',
    { agencyId: ARC, amount: cents(keep + usd(1)), paymentId: paid.id },
    'insufficient_funds',
    'A5b returning more than is left in his balance',
  )
  t.check('A5b: it says to add receipts for the rest', capped.includes('Add receipts for the rest.'), capped)
  await w.run(
    U.daniel,
    'returnUnusedFunds',
    { agencyId: ARC, amount: keep, paymentId: paid.id },
    'A5b Daniel returns what he still holds',
    { ops: ['returnToAgency'] },
  )
  t.check(
    'A5b: the rest stays pending, to justify with receipts',
    advanceStanding(w.state, paid, w.now).pending === danielAmount - keep,
  )

  // A10. A return that names no money for purchases works as before and settles nothing.
  const plainReturn = await w.run(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: usd(5) },
    'A10 Alex returns unused funds without naming money for purchases',
    { ops: ['returnToAgency'] },
  )
  t.check(
    'A10: it settles no advance',
    plainReturn.movements.every((m) => m.settlesPaymentId === undefined),
  )
  t.check(
    "A10: the Admins hear 'Funds returned'",
    plainReturn.notifications.every((n) => n.title === 'Funds returned'),
  )

  // A12. Money for purchases is settled with receipts and returns, never reconciled.
  w.refuse(
    U.maya,
    'reconcile',
    { agencyId: ARC, paymentId: advance.id },
    'invalid_state',
    'A12 reconciling money for purchases',
  )

  // A13. Above the exception threshold, money for purchases waits for the Investor (as the ledger decides).
  const lumenThreshold = must(governingAgreement(w.state, LUMEN), "Lumen's agreement").spendingPolicy
    .exceptionThreshold
  const exceptionAsk: RequestPaymentInput = {
    agencyId: LUMEN,
    budgetId: B.lumenSecurity,
    type: 'funds',
    amount: cents(lumenThreshold + usd(1)),
    category: 'legal',
    purpose: 'Security audit retainer',
    idempotencyKey: 'smoke-a13-exception',
  }
  await w.fund(U.ren, B.lumenSecurity, exceptionAsk.amount)
  const a13Preview = preview(w, U.ren, exceptionAsk)
  const a13 = await w.run(
    U.ren,
    'requestPayment',
    exceptionAsk,
    'A13 Ren asks for money above the exception threshold',
    {
      ops: ['requestPayment'],
    },
  )
  const exception = a13.result
  samePreview(t, 'A13', a13Preview, exception.decision)
  t.check(
    'A13: the Investor decides it',
    exception.status === 'needs_approval' &&
      exception.decision.reason?.rule === 'exception_threshold' &&
      isException(w.state, exception) &&
      investorApprovals(w.state, DEMO.portfolio).exceptions.some((r) => r.id === exception.id) &&
      adminApprovals(w.state, LUMEN).withInvestor.some((r) => r.id === exception.id),
    `${exception.status} ${exception.decision.reason?.rule}`,
  )
  const a13Op = a13.plan?.ops[0]
  t.check(
    "A13: the ledger keeps it waiting too, for Ren's own balance",
    a13Op?.call === 'requestPayment' && a13Op.expected === 'pending' && a13Op.memberUserId === U.ren,
  )
  checkSame(t, 'A13: the Investors are asked', notifiedUsers(a13), INVESTORS)
  t.check(
    'A13: …in their approvals',
    a13.notifications.every((n) => n.href === `/investor/${DEMO.portfolio}/approvals`),
  )
  w.refuse(
    U.maya,
    'approveRequest',
    { requestId: exception.id },
    'forbidden',
    "A13 another Agency's Admin approves it",
  )
  const a13b = await w.run(
    U.elena,
    'approveRequest',
    { requestId: exception.id },
    'A13 Elena approves the exception',
    {
      ops: ['approvePayment'],
    },
  )
  t.check(
    "A13: paid into Ren's balance as money for purchases",
    a13b.result.payment.type === 'advance' &&
      a13b.notifications.some((n) => n.userId === U.ren && n.title === 'Money for your purchase'),
  )

  // A11. Overdue blocks nothing: only flags and reminders.
  w.later(24 * (JUSTIFY_WITHIN_DAYS + 1))
  t.check("A11: a month later, Daniel's money is overdue", advanceStanding(w.state, paid, w.now).overdue)
  await w.fund(U.maya, B.arcTools, usd(50))
  const a11 = await w.run(
    U.daniel,
    'requestPayment',
    { ...ask, amount: usd(50), purpose: 'Batteries', idempotencyKey: 'smoke-a11-funds' },
    'A11 Daniel asks for more money while some is overdue',
    { ops: ['requestPayment'] },
  )
  t.check('A11: paid at once, as before', a11.result.status === 'completed', a11.result.status)
  const danielAdvances = advancesOf(w.state, { agencyId: ARC, userId: U.daniel }, w.now)
  t.check(
    "A11: Daniel's money for purchases, newest first",
    danielAdvances.length === danielSeeded + 2 &&
      danielAdvances[0]?.payment.id === a11.result.paymentId &&
      danielAdvances[1]?.payment.id === paid.id,
    danielAdvances.map((s) => s.payment.id).join(', '),
  )
}

// ─── B. Reimbursement ────────────────────────────────────────────────────────

async function reimbursement(t: Checker) {
  const w = new World(t, 'engine-b')
  const travel = budgetOf(w.state, B.arcTravel)
  t.check('B: Travel only pays Northwind, yet pays reimbursements', travel.allowedDestinationIds.length > 0)
  const taxi: RequestPaymentInput = {
    agencyId: ARC,
    budgetId: B.arcTravel,
    type: 'reimbursement',
    amount: usd(45),
    category: 'travel',
    purpose: 'Taxi to the client workshop',
    merchant: 'Uber',
    spentAt: dayBefore(w.now, 1),
    attachments: [file('b-uber-receipt.pdf')],
    idempotencyKey: 'smoke-b-uber',
  }
  const noTicket = w.refuse(
    U.sofia,
    'requestPayment',
    { ...taxi, attachments: undefined },
    'validation',
    'B1 a reimbursement without its receipt',
  )
  t.check(
    "B1: it says 'Attach the receipt of what you paid.'",
    noTicket === 'Attach the receipt of what you paid.',
    noTicket,
  )
  w.refuse(
    U.sofia,
    'requestPayment',
    { ...taxi, attachments: [link('Receipt', 'https://example.com/receipt')] },
    'validation',
    'B1 a link instead of the receipt file',
  )
  w.refuse(
    U.sofia,
    'requestPayment',
    { ...taxi, merchant: undefined },
    'validation',
    'B1 a reimbursement without its merchant',
  )
  w.refuse(U.sofia, 'requestPayment', { ...taxi, merchant: '   ' }, 'validation', 'B1 a blank merchant')
  w.refuse(
    U.sofia,
    'requestPayment',
    { ...taxi, destinationId: D.northwind },
    'validation',
    'B1 a reimbursement sent to a vendor',
  )
  w.refuse(
    U.sofia,
    'requestPayment',
    { ...taxi, spentAt: dayBefore(w.now, -3) },
    'validation',
    'B1 paid on a date in the future',
  )

  const held = memberHeld(w.state, ARC, U.sofia)
  const pendingBefore = personPending(w.state, ARC, U.sofia, w.now)
  await w.fund(U.maya, B.arcTravel, taxi.amount)
  const b2 = await w.run(U.sofia, 'requestPayment', taxi, 'B2 Sofia asks to be paid back for a taxi', {
    ops: ['requestPayment'],
  })
  const request = b2.result
  const evidenceHash = attachmentsHash(request.attachments)
  t.check('B2: paid at once', request.status === 'completed', request.status)
  t.check('B2: the request carries the fingerprint of its receipt', evidenceHash !== null)
  checkSame(t, "B2: requestPayment pays Sofia's balance, with the receipt's fingerprint", b2.plan?.ops[0], {
    call: 'requestPayment',
    requestId: request.id,
    paymentId: request.paymentId,
    budgetId: B.arcTravel,
    destinationId: null,
    memberUserId: U.sofia,
    amount: taxi.amount,
    evidenceHash,
    expected: 'executed',
  })
  checkSame(t, 'B2: the record moves the money from Travel to Sofia', b2.plan?.records, [
    {
      opId: request.paymentId,
      kind: 'payment',
      amount: taxi.amount,
      from: { id: B.arcTravel },
      to: { member: U.sofia },
      evidenceHash,
    },
  ])
  const payment = must(
    w.state.payments.find((p) => p.id === request.paymentId),
    'the reimbursement',
  )
  t.check(
    "B2: a reimbursement into Sofia's Viatik balance",
    payment.type === 'reimbursement' && same(payment.recipient, { kind: 'member', userId: U.sofia }),
  )
  t.check('B2: Sofia holds that much more', memberHeld(w.state, ARC, U.sofia) - held === taxi.amount)
  const expense = w.state.expenses.find((e) => e.paymentId === payment.id)
  t.check(
    'B2: the expense records the merchant, the date and the receipt',
    Boolean(
      expense &&
      expense.merchant === 'Uber' &&
      expense.spentAt === taxi.spentAt &&
      expense.budgetId === B.arcTravel &&
      expense.amount === taxi.amount &&
      expense.receipt?.id === request.attachments[0]?.id,
    ),
    JSON.stringify(expense),
  )
  t.check(
    'B2: nothing is left to justify for a reimbursement',
    personPending(w.state, ARC, U.sofia, w.now) === pendingBefore &&
      advancesOf(w.state, { agencyId: ARC, userId: U.sofia }, w.now).every(
        (s) => s.payment.id !== payment.id,
      ),
  )
  t.check(
    "B2: the request shows what the ledger recorded, with the receipt's fingerprint",
    w.state.requests.find((r) => r.id === request.id)?.ledger?.evidenceHash === evidenceHash,
  )
  t.check(
    'B2: the receipt lists the receipt file',
    b2.receipts.some((r) => r.evidenceIds.includes(request.attachments[0]?.id ?? '')),
  )

  await w.fund(U.maya, B.arcTravel, usd(20))
  const b3 = await w.run(
    U.sofia,
    'requestPayment',
    {
      ...taxi,
      amount: usd(20),
      merchant: 'Metro',
      spentAt: undefined,
      attachments: [file('b-metro.pdf')],
      idempotencyKey: 'smoke-b-metro',
    },
    'B3 a reimbursement without the date it was paid',
    { ops: ['requestPayment'] },
  )
  t.check(
    'B3: the expense is dated when the request was made',
    w.state.expenses.find((e) => e.paymentId === b3.result.paymentId)?.spentAt === b3.result.createdAt,
  )

  // B4. Above what Travel approves by itself: an Agency Admin approves, and Sofia hears she was paid back.
  const rail = cents(travel.approvalThreshold + usd(50))
  if (rail > allowanceLeft(w, B.arcTravel, U.sofia)) throw new Error('Sofia has too little left on Travel')
  await w.fund(U.maya, B.arcTravel, rail)
  const b4 = await w.run(
    U.sofia,
    'requestPayment',
    {
      ...taxi,
      amount: rail,
      merchant: 'Northwind Rail',
      purpose: 'Train to the conference',
      attachments: [file('b-rail-ticket.pdf')],
      idempotencyKey: 'smoke-b-rail',
    },
    'B4 a reimbursement above what Travel approves by itself',
    { ops: ['requestPayment'] },
  )
  t.check('B4: it waits for an Agency Admin', b4.result.status === 'needs_approval')
  t.check('B4: no expense until it is paid', !w.state.expenses.some((e) => e.merchant === 'Northwind Rail'))
  const b4b = await w.run(U.maya, 'approveRequest', { requestId: b4.result.id }, 'B4 Maya approves it', {
    ops: ['approvePayment'],
  })
  const railHash = attachmentsHash(b4.result.attachments)
  checkSame(t, "B4: the record carries the receipt's fingerprint", b4b.plan?.records, [
    {
      opId: b4b.result.payment.id,
      kind: 'payment',
      amount: rail,
      from: { id: B.arcTravel },
      to: { member: U.sofia },
      evidenceHash: railHash,
    },
  ])
  t.check(
    'B4: Sofia hears she was paid back',
    b4b.notifications.some(
      (n) =>
        n.userId === U.sofia &&
        n.title === 'Reimbursement paid' &&
        n.body === `${usdText(rail)} is back in your Viatik balance.` &&
        n.href === `/member/${ARC}/payments`,
    ),
  )
  t.check(
    'B4: the expense appears when it is paid',
    w.state.expenses.some((e) => e.merchant === 'Northwind Rail' && e.paymentId === b4b.result.payment.id),
  )
}

// ─── C. Payment for work ─────────────────────────────────────────────────────

async function paymentForWork(t: Checker) {
  const w = new World(t, 'engine-c')
  const team = budgetOf(w.state, B.arcTeam)
  const work = (
    amount: Cents,
    key: string,
    extra: Partial<RequestPaymentInput> = {},
  ): RequestPaymentInput => ({
    agencyId: ARC,
    budgetId: B.arcTeam,
    type: 'work',
    amount,
    category: 'team',
    purpose: 'Onboarding flow design',
    attachments: [file(`c-${key}.pdf`)],
    idempotencyKey: `smoke-c-${key}`,
    ...extra,
  })

  // Without spending access on the budget, payment for work is refused like any request. (The seed
  // gives Alex, Priya and Daniel access to Team payments; Sofia has none.)
  const c0 = await w.run(
    U.sofia,
    'requestPayment',
    work(usd(400), 'no-access'),
    'C0 Sofia asks without spending access',
    {
      ops: [],
      settle: 'failed',
      error: 'policy_rejected',
      keep: true,
    },
  )
  t.check('C0: refused for spending access', c0.result.decision.reason?.rule === 'holder_has_access')

  const setup = await w.run(
    U.maya,
    'assignAllowance',
    { budgetId: B.arcTeam, holder: { kind: 'member', userId: U.alex }, periodLimit: usd(1000) },
    "C setup: Maya sets Alex's spending access to Team payments to 1,000 a month",
    { ops: ['setAllowance'] },
  )
  checkSame(t, 'C setup: the ledger knows Alex may spend from it', setup.plan?.ops[0], {
    call: 'setAllowance',
    budgetId: B.arcTeam,
    userId: U.alex,
    active: true,
    perOperationLimit: 0,
  })

  // C1. Always reviewed by an Agency Admin, and nothing reaches the ledger until it is paid.
  const first = work(usd(400), 'work-1')
  await w.fund(U.maya, B.arcTeam, first.amount)
  const firstPreview = preview(w, U.alex, first)
  const c1 = await w.run(U.alex, 'requestPayment', first, 'C1 Alex asks to be paid for his work', { ops: [] })
  const request = c1.result
  samePreview(t, 'C1', firstPreview, request.decision)
  t.check('C1: no settlement plan at all', c1.plan === null)
  t.check(
    'C1: it waits for an Agency Admin, whatever the automatic limit',
    request.status === 'needs_approval' &&
      request.decision.reason?.rule === 'work_review' &&
      !request.decision.checks.some((c) => c.rule === 'approval_threshold'),
    `${request.status} ${request.decision.reason?.rule}`,
  )
  checkSame(t, 'C1: the Agency Admins are asked', notifiedUsers(c1), ADMINS)
  t.check(
    'C1: they are sent to their approvals',
    c1.notifications.every((n) => n.href === `/agency/${ARC}/approvals`),
  )
  t.check(
    "C1: in the Agency Admins' queue, never the Investor's",
    adminApprovals(w.state, ARC).mine.some((r) => r.id === request.id) &&
      !investorApprovals(w.state, DEMO.portfolio).exceptions.some((r) => r.id === request.id) &&
      !isException(w.state, request),
  )
  t.check('C1: the ledger does not know it as a request', !ledgerSnapshot(w.state).requests.has(request.id))
  w.refuse(
    U.elena,
    'approveRequest',
    { requestId: request.id },
    'forbidden',
    'C1 the Investor approves payment for work',
  )
  w.refuse(
    U.elena,
    'declineRequest',
    { requestId: request.id, reason: 'No' },
    'forbidden',
    'C1 the Investor declines payment for work',
  )
  w.refuse(
    U.alex,
    'requestPayment',
    work(usd(100), 'work-vendor', { destinationId: D.harbor }),
    'validation',
    'C1 payment for work sent to a vendor',
  )
  w.refuse(
    U.alex,
    'approveRequest',
    { requestId: request.id },
    'self_approval',
    'C1 Alex approves his own work',
  )

  // C2. Cancelled or declined: still nothing on the ledger.
  const c2 = await w.run(
    U.alex,
    'requestPayment',
    work(usd(300), 'work-2'),
    'C2 Alex asks for another payment',
    {
      ops: [],
    },
  )
  const cancelled = await w.run(U.alex, 'cancelRequest', { requestId: c2.result.id }, 'C2 Alex cancels it', {
    ops: [],
  })
  t.check('C2: cancelled', cancelled.result.status === 'cancelled')
  const c2b = await w.run(U.alex, 'requestPayment', work(usd(250), 'work-3'), 'C2 Alex asks once more', {
    ops: [],
  })
  const declined = await w.run(
    U.maya,
    'declineRequest',
    { requestId: c2b.result.id, reason: 'Already paid in the October payroll' },
    'C2 Maya declines it',
    { ops: [] },
  )
  t.check('C2: declined', declined.result.status === 'declined')
  t.check(
    'C2: Alex hears why',
    declined.notifications.some((n) => n.userId === U.alex && n.title === 'Request declined'),
  )

  // C3. An Agency Admin approves it: paid with exactly one `pay`, from the budget to Alex.
  const held = memberHeld(w.state, ARC, U.alex)
  const pendingBefore = personPending(w.state, ARC, U.alex, w.now)
  // The seed's paid work of Alex's may fall in this month too.
  const alexTeamSpent = holderSpentInPeriod(w.state, team, { kind: 'member', userId: U.alex }, w.now)
  const c3 = await w.run(
    U.maya,
    'approveRequest',
    { requestId: request.id },
    'C3 Maya approves the payment for work',
    {
      ops: ['pay'],
    },
  )
  const { payment, receipt } = c3.result
  const evidenceHash = attachmentsHash(request.attachments)
  checkSame(t, 'C3: pay from Team payments into Alex’s balance', c3.plan?.ops[0], {
    call: 'pay',
    paymentId: payment.id,
    sourceId: B.arcTeam,
    destinationId: null,
    memberUserId: U.alex,
    amount: first.amount,
    evidenceHash,
  })
  checkSame(t, 'C3: the record moves the money from Team payments to Alex', c3.plan?.records, [
    {
      opId: payment.id,
      kind: 'payment',
      amount: first.amount,
      from: { id: B.arcTeam },
      to: { member: U.alex },
      evidenceHash,
    },
  ])
  t.check(
    'C3: a team payment for the request, approved by Maya',
    payment.type === 'team' && payment.requestId === request.id && payment.approvedBy === U.maya,
  )
  t.check('C3: Alex holds that much more', memberHeld(w.state, ARC, U.alex) - held === first.amount)
  t.check(
    'C3: Alex hears he was paid for his work',
    c3.notifications.some((n) => n.userId === U.alex && n.title === 'Payment for your work'),
  )
  const paidRequest = must(
    w.state.requests.find((r) => r.id === request.id),
    'the work request',
  )
  t.check(
    'C3: completed, and never on the ledger as a request',
    paidRequest.status === 'completed' && !paidRequest.ledger,
  )
  t.check(
    'C3: the receipt says who approved it',
    receipt.policyLabel === 'Payment for work · approved by an Agency Admin',
  )
  t.check(
    'C3: payment for work is not money to justify',
    personPending(w.state, ARC, U.alex, w.now) === pendingBefore,
  )
  t.check('C3: and it creates no expense', !w.state.expenses.some((e) => e.paymentId === payment.id))
  t.check(
    "C3: it counts against Alex's monthly limit",
    holderSpentInPeriod(w.state, team, { kind: 'member', userId: U.alex }, w.now) - alexTeamSpent ===
      first.amount,
  )
  const c3b = await w.run(
    U.alex,
    'requestPayment',
    work(usd(700), 'work-over-period'),
    'C3 more work than is left of his monthly limit',
    { ops: [], settle: 'failed', error: 'policy_rejected', keep: true },
  )
  t.check('C3: rejected for the period limit', c3b.result.decision.reason?.rule === 'period_limit')

  // C4, C5. Rejections of work are refused before the ledger and kept in history.
  const c4 = await w.run(
    U.alex,
    'requestPayment',
    work(cents(team.perOperationLimit + usd(100)), 'work-big'),
    'C4 above the per-operation limit',
    { ops: [], settle: 'failed', error: 'policy_rejected', keep: true },
  )
  t.check(
    'C4: rejected for the per-operation limit, not on the ledger',
    c4.result.status === 'rejected' &&
      c4.result.decision.reason?.rule === 'per_operation_limit' &&
      !c4.result.ledger,
  )
  const threshold = must(governingAgreement(w.state, ARC), "Arc's agreement").spendingPolicy
    .exceptionThreshold
  const c5 = await w.run(
    U.alex,
    'requestPayment',
    work(cents(threshold + usd(1)), 'work-huge'),
    'C5 above the exception threshold',
    { ops: [], settle: 'failed', error: 'policy_rejected', keep: true },
  )
  t.check(
    'C5: rejected, and the exception threshold blocks it too',
    c5.result.status === 'rejected' &&
      c5.result.decision.checks.some((c) => c.rule === 'exception_threshold' && c.blocking && !c.passed),
  )
  const lumenThreshold = must(governingAgreement(w.state, LUMEN), "Lumen's agreement").spendingPolicy
    .exceptionThreshold
  const renWork: RequestPaymentInput = {
    agencyId: LUMEN,
    budgetId: B.lumenSecurity,
    type: 'work',
    amount: cents(lumenThreshold + usd(1)),
    category: 'legal',
    purpose: 'Security review',
    idempotencyKey: 'smoke-c-ren',
  }
  const c5Preview = preview(w, U.ren, renWork)
  const c5b = await w.run(
    U.ren,
    'requestPayment',
    renWork,
    'C5 Ren asks for work within every limit but the exception threshold',
    {
      ops: [],
      settle: 'failed',
      error: 'policy_rejected',
      keep: true,
    },
  )
  samePreview(t, 'C5', c5Preview, c5b.result.decision)
  t.check(
    'C5: rejected for the exception threshold: the Investor never decides payment for work',
    c5b.result.status === 'rejected' && c5b.result.decision.reason?.rule === 'exception_threshold',
    c5b.result.decision.reason?.rule,
  )

  // C6. Nobody approves their own payment for work; a vendor list does not stop paying a person.
  const travel = budgetOf(w.state, B.arcTravel)
  const mayaWork = work(cents(Math.min(usd(200), travel.approvalThreshold)), 'maya', {
    budgetId: B.arcTravel,
    category: 'travel',
    purpose: 'Workshop facilitation',
  })
  await w.fund(U.jordan, B.arcTravel, mayaWork.amount)
  const c6 = await w.run(U.maya, 'requestPayment', mayaWork, 'C6 Maya asks to be paid for her work', {
    ops: [],
  })
  t.check('C6: it waits even within the automatic limit', c6.result.status === 'needs_approval')
  w.refuse(
    U.maya,
    'approveRequest',
    { requestId: c6.result.id },
    'self_approval',
    'C6 Maya approves her own work',
  )
  const c6b = await w.run(U.jordan, 'approveRequest', { requestId: c6.result.id }, 'C6 Jordan approves it', {
    ops: ['pay'],
  })
  const c6Op = c6b.plan?.ops[0]
  t.check(
    'C6: paid from Travel to Maya, though Travel only pays Northwind',
    c6Op?.call === 'pay' &&
      c6Op.sourceId === B.arcTravel &&
      c6Op.memberUserId === U.maya &&
      c6Op.destinationId === null &&
      travel.allowedDestinationIds.length > 0,
  )

  // C7. Waiting payment for work is not on the ledger, nor in a genesis.
  await w.fund(U.maya, B.arcTeam, usd(300))
  const c7 = await w.run(
    U.alex,
    'requestPayment',
    work(usd(300), 'work-waiting'),
    'C7 Alex leaves a payment for work waiting',
    {
      ops: [],
    },
  )
  const waiting = c7.result
  const snapshot = ledgerSnapshot(w.state)
  t.check(
    'C7: not among the ledger’s requests, though known as processed',
    !snapshot.requests.has(waiting.id) && snapshot.processed.has(waiting.id),
  )
  const genesis = buildGenesis(w.state, 'smoke-c', () => undefined)
  const imported = decodeGenesis(genesis)
    .filter((call) => call.name === 'importPendingRequest')
    .map((call) => (call.args[0] as { requestId: string }).requestId)
  t.check('C7: the genesis does not import it', !imported.includes(ledgerId('smoke-c', waiting.id)))
  t.check(
    'C7: the genesis says why',
    genesis.skipped.some((note) => note.includes('payments for work waiting for an Admin')),
    genesis.skipped.join(' | '),
  )

  // C8. If the threshold is lowered after it was sent, it cannot be paid; declining still works.
  // (No command changes a threshold yet: the Investor's change is written into the state here.)
  const agreement = must(governingAgreement(w.state, ARC), "Arc's agreement")
  agreement.spendingPolicy.exceptionThreshold = cents(waiting.amount - usd(1))
  t.check(
    'C8: still the Agency Admins’ to decide',
    !isException(w.state, waiting) && adminApprovals(w.state, ARC).mine.some((r) => r.id === waiting.id),
  )
  w.refuse(
    U.maya,
    'approveRequest',
    { requestId: waiting.id },
    'limit_exceeded',
    'C8 paying work above a lowered threshold',
  )
  await w.run(
    U.maya,
    'declineRequest',
    { requestId: waiting.id, reason: 'Above the new exception threshold' },
    'C8 Maya declines it instead',
    { ops: [] },
  )
}

// ─── D. Paying outside Viatik ────────────────────────────────────────────────

async function outsidePayments(t: Checker) {
  const w = new World(t, 'engine-d')
  await w.gather(U.maya, ACC.arcReserve, usd(120))
  const reserveBefore = accountBalance(w.state, ACC.arcReserve)
  const bookedBefore = bookedTotal(w.state)
  const payee = 'Anthropic · Claude Teams'
  const amount = usd(120)

  // D1. From an account, the invoice to follow.
  const d1 = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcReserve },
      to: TOOL.toLowerCase(),
      payee,
      amount,
      category: 'ai_services',
      memo: 'Claude Teams, October',
    },
    'D1 Maya pays Claude Teams outside Viatik, invoice pending',
    { ops: ['payOutside'] },
  )
  const payment = d1.result
  checkSame(t, 'D1: paid to the address, checksummed', payment.recipient, {
    kind: 'address',
    payee,
    address: TOOL,
  })
  t.check(
    'D1: a completed tool payment from the Reserve',
    payment.type === 'tool' &&
      payment.status === 'completed' &&
      payment.budgetId === undefined &&
      payment.sourceAccountId === ACC.arcReserve &&
      payment.completedAt === w.now,
  )
  checkSame(t, 'D1: payOutside to the address, no invoice yet', d1.plan?.ops[0], {
    call: 'payOutside',
    paymentId: payment.id,
    sourceId: ACC.arcReserve,
    to: TOOL,
    amount,
    evidenceHash: null,
  })
  checkSame(t, 'D1: the record ends at the address', d1.plan?.records, [
    {
      opId: payment.id,
      kind: 'outside_payment',
      amount,
      from: { id: ACC.arcReserve },
      to: { address: TOOL },
      evidenceHash: null,
    },
  ])
  const movement = d1.movements[0]
  checkSame(
    t,
    'D1: the movement leaves the Reserve for the payee',
    movement && { kind: movement.kind, from: movement.from, to: movement.to },
    {
      kind: 'payment',
      from: { kind: 'account', accountId: ACC.arcReserve },
      to: { kind: 'external', label: payee, address: TOOL },
    },
  )
  t.check('D1: the Reserve pays it', reserveBefore - accountBalance(w.state, ACC.arcReserve) === amount)
  t.check('D1: the money leaves the ledger', bookedBefore - bookedTotal(w.state) === amount)
  const receipt = must(d1.receipts[0], 'the outside payment receipt')
  t.check(
    'D1: an outside payment receipt naming the payee and a short address',
    receipt.kind === 'outside_payment' && receipt.toLabel === `${payee} · ${shortAddress(TOOL)}`,
    receipt.toLabel,
  )
  checkSame(t, 'D1: the Investors hear about it', notifiedUsers(d1), INVESTORS)
  t.check(
    'D1: …with the invoice still pending',
    d1.notifications.every((n) => n.title === 'Paid outside Viatik' && n.body.endsWith('Invoice pending.')),
  )
  t.check(
    'D1: the activity says it was paid outside Viatik',
    d1.activity.some(
      (a) => a.type === 'paid_outside' && a.summary === `Paid ${usdText(amount)} to ${payee} outside Viatik`,
    ),
  )
  t.check(
    'D1: the receipt names the authorization',
    receipt.policyLabel === 'Paid outside Viatik · Agency Admin authorization',
  )
  t.check(
    'D1: the Investors are sent to the receipt',
    d1.notifications.every((n) => n.href === `/receipts/${receipt.id}`),
  )
  const pendingProof = outsidePaymentsWithoutProof(w.state, ARC, w.now).find(
    (s) => s.payment.id === payment.id,
  )
  t.check(
    `D1: waiting for its invoice, due in ${PROOF_WITHIN_DAYS} days`,
    Boolean(
      pendingProof && !pendingProof.overdue && pendingProof.dueAt === addDays(w.now, PROOF_WITHIN_DAYS),
    ),
  )
  const late = plusHours(addDays(w.now, PROOF_WITHIN_DAYS), 1)
  t.check(
    'D1: overdue a week later',
    Boolean(
      outsidePaymentsWithoutProof(w.state, ARC, late).find((s) => s.payment.id === payment.id)?.overdue,
    ) && agencyAccountability(w.state, ARC, late).proofOverdue >= 1,
  )
  checkSame(
    t,
    "D1: the portfolio view shows Arc's the same way",
    portfolioAccountability(w.state, DEMO.portfolio, late).find((a) => a.agencyId === ARC),
    agencyAccountability(w.state, ARC, late),
  )
  t.check(
    'D1: the ledger knows it was paid, without an invoice',
    ledgerSnapshot(w.state).outside.get(`${ARC}|${payment.id}`)?.evidenceHash === null,
  )

  // D2. The invoice later: anchored once, with no money record.
  const d2 = await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: payment.id, proof: file('d2-claude-invoice.pdf') },
    'D2 Maya adds the invoice',
    { ops: ['recordEvidence'] },
  )
  const proof = must(d2.result.proof, 'the invoice')
  const proofHash = attachmentsHash([proof])
  checkSame(t, 'D2: recordEvidence anchors the invoice', d2.plan?.ops[0], {
    call: 'recordEvidence',
    agencyId: ARC,
    paymentId: payment.id,
    evidenceHash: proofHash,
  })
  t.check('D2: no money record', d2.plan?.records.length === 0)
  t.check(
    'D2: the ledger confirms it with its own event, no receipt hash',
    d2.settled?.records.length === 1 &&
      d2.settled.records[0]?.call === 'recordEvidence' &&
      d2.settled.records[0].opId === payment.id &&
      d2.settled.records[0].verified.receiptHash === undefined,
  )
  const anchored = must(
    w.state.payments.find((p) => p.id === payment.id),
    'the outside payment',
  )
  t.check(
    'D2: the payment shows the anchored invoice',
    anchored.proofVerified?.status === 'confirmed' &&
      anchored.proofVerified.evidenceHash === proofHash &&
      anchored.proofVerified.contractPolicy === 'Invoice fingerprinted · anchored once',
  )
  const paidReceipt = must(
    w.state.receipts.find((r) => r.id === payment.receiptId),
    'the payment receipt',
  )
  t.check(
    'D2: the receipt lists the invoice, and keeps what the payment recorded',
    paidReceipt.evidenceIds.includes(proof.id) && paidReceipt.verified.evidenceHash === null,
  )
  checkSame(t, 'D2: the Investors hear about it', notifiedUsers(d2), INVESTORS)
  t.check(
    "D2: 'Invoice uploaded', pointing to the receipt",
    d2.notifications.every(
      (n) => n.title === 'Invoice uploaded' && n.href === `/receipts/${payment.receiptId}`,
    ),
  )
  t.check(
    'D2: no longer waiting for its invoice',
    !outsidePaymentsWithoutProof(w.state, ARC, w.now).some((s) => s.payment.id === payment.id),
  )
  t.check(
    'D2: the activity shows it',
    d2.activity.some((a) => a.type === 'payment_proof_added'),
  )

  // D3. Once only, as a file, for outside payments only, by an Agency Admin.
  const second = w.refuse(
    U.maya,
    'addPaymentProof',
    { paymentId: payment.id, proof: file('d3-again.pdf') },
    'invalid_state',
    'D3 a second invoice',
  )
  t.check(
    'D3: it says the payment already has its invoice',
    second === 'This payment already has its invoice.',
    second,
  )
  const vendorPayment = must(
    w.state.payments.find(
      (p) => p.agencyId === ARC && p.recipient.kind === 'destination' && p.status === 'completed',
    ),
    'a vendor payment of Arc',
  )
  const inside = w.refuse(
    U.maya,
    'addPaymentProof',
    { paymentId: vendorPayment.id, proof: file('d3-vendor.pdf') },
    'validation',
    'D3 an invoice for a payment made inside Viatik',
  )
  t.check(
    'D3: it says only outside payments take an invoice here',
    inside === 'Only payments made outside Viatik take an invoice here.',
    inside,
  )
  w.refuse(
    U.alex,
    'addPaymentProof',
    { paymentId: payment.id, proof: file('d3-member.pdf') },
    'forbidden',
    'D3 a Member adds the invoice',
  )
  w.refuse(
    U.elena,
    'addPaymentProof',
    { paymentId: payment.id, proof: file('d3-investor.pdf') },
    'forbidden',
    'D3 the Investor adds the invoice',
  )

  // D4. The invoice with the payment: it travels with payOutside.
  await w.gather(U.maya, ACC.arcOperations, usd(50))
  const d4 = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcOperations },
      to: TOOL,
      payee: 'Figma',
      amount: usd(50),
      category: 'software',
      memo: 'Figma seat, October',
      proof: file('d4-figma-invoice.pdf'),
    },
    'D4 Maya pays Figma with its invoice',
    { ops: ['payOutside'] },
  )
  const withInvoice = d4.result
  const invoiceHash = attachmentsHash([must(withInvoice.proof, 'the Figma invoice')])
  const d4Op = d4.plan?.ops[0]
  t.check(
    'D4: payOutside carries the invoice fingerprint',
    invoiceHash !== null && d4Op?.call === 'payOutside' && d4Op.evidenceHash === invoiceHash,
  )
  t.check('D4: so does its record', d4.plan?.records[0]?.evidenceHash === invoiceHash)
  t.check(
    'D4: and its receipt',
    w.state.receipts.find((r) => r.id === withInvoice.receiptId)?.verified.evidenceHash === invoiceHash,
  )
  t.check(
    'D4: nothing to wait for',
    !outsidePaymentsWithoutProof(w.state, ARC, w.now).some((s) => s.payment.id === withInvoice.id),
  )
  t.check(
    'D4: the Investors are not told an invoice is pending',
    d4.notifications.every((n) => !n.body.includes('Invoice pending')),
  )
  t.check(
    'D4: the ledger knows its invoice',
    ledgerSnapshot(w.state).outside.get(`${ARC}|${withInvoice.id}`)?.evidenceHash === invoiceHash,
  )
  w.refuse(
    U.maya,
    'addPaymentProof',
    { paymentId: withInvoice.id, proof: file('d4-again.pdf') },
    'invalid_state',
    'D4 another invoice for it',
  )
  w.refuse(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcOperations },
      to: TOOL,
      payee: 'Figma',
      amount: cents(accountBalance(w.state, ACC.arcOperations) + 1),
      category: 'software',
      memo: 'More seats',
    },
    'insufficient_funds',
    'D4 more than the account holds',
  )

  // D5. A budget limited to approved vendors never pays an address.
  const outside = (
    source: { kind: 'account'; accountId: Id } | { kind: 'budget'; budgetId: Id },
    value: Cents,
  ) => ({
    agencyId: ARC,
    source,
    to: TOOL,
    payee: 'Linear',
    amount: value,
    category: 'software' as const,
    memo: 'Linear seats',
  })
  const message = w.refuse(
    U.maya,
    'payOutside',
    outside({ kind: 'budget', budgetId: B.arcTools }, usd(20)),
    'policy_rejected',
    'D5 from Tools, which only pays its vendors',
  )
  t.check(
    'D5: it says to pay from an account instead',
    message.includes('Pay from an account instead.'),
    message,
  )

  // D6. An open budget: its limits hold.
  const team = budgetOf(w.state, B.arcTeam)
  w.refuse(
    U.maya,
    'payOutside',
    outside({ kind: 'budget', budgetId: B.arcTeam }, cents(team.perOperationLimit + usd(100))),
    'policy_rejected',
    'D6 above the per-operation limit of Team payments',
  )
  await w.run(
    U.maya,
    'setBudgetPaused',
    { budgetId: B.arcTeam, paused: true },
    'D6 Maya pauses Team payments',
    {
      ops: ['setBudgetPaused'],
    },
  )
  w.refuse(
    U.maya,
    'payOutside',
    outside({ kind: 'budget', budgetId: B.arcTeam }, usd(20)),
    'policy_rejected',
    'D6 from a paused budget',
  )
  await w.run(U.maya, 'setBudgetPaused', { budgetId: B.arcTeam, paused: false }, 'D6 Maya resumes it', {
    ops: ['setBudgetPaused'],
  })
  await w.fund(U.maya, B.arcTeam, team.perOperationLimit)
  const fromBudget = team.perOperationLimit
  const d6 = await w.run(
    U.maya,
    'payOutside',
    outside({ kind: 'budget', budgetId: B.arcTeam }, fromBudget),
    'D6 Maya pays Linear from Team payments, up to its limit',
    { ops: ['payOutside'] },
  )
  const d6Op = d6.plan?.ops[0]
  t.check(
    'D6: paid from the budget, which draws on its source account',
    d6Op?.call === 'payOutside' &&
      d6Op.sourceId === B.arcTeam &&
      d6.result.budgetId === B.arcTeam &&
      d6.result.sourceAccountId === team.sourceAccountId,
  )
  const teamAccount = must(
    w.state.accounts.find((a) => a.id === team.sourceAccountId),
    "Team payments' account",
  )
  t.check(
    'D6: the receipt names the account and the budget',
    d6.receipts[0]?.fromLabel === `${teamAccount.name} · ${team.name}`,
    d6.receipts[0]?.fromLabel,
  )
  const leftInTeam = budgetUsage(w.state, team, w.now).available
  if (leftInTeam < team.perOperationLimit)
    w.refuse(
      U.maya,
      'payOutside',
      outside({ kind: 'budget', budgetId: B.arcTeam }, cents(leftInTeam + 1)),
      'insufficient_funds',
      'D6 more than the budget has left',
    )

  // D7. Above the exception threshold there is no Investor path: refused.
  // Lumen's Operations account first holds more than the threshold: it could pay it.
  const lumenThreshold = must(governingAgreement(w.state, LUMEN), "Lumen's agreement").spendingPolicy
    .exceptionThreshold
  await w.gather(U.ren, ACC.lumenOperations, cents(lumenThreshold + usd(1)))
  const above = w.refuse(
    U.ren,
    'payOutside',
    {
      agencyId: LUMEN,
      source: { kind: 'account', accountId: ACC.lumenOperations },
      to: TOOL,
      payee: 'Datadog',
      amount: cents(lumenThreshold + 1),
      category: 'cloud',
      memo: 'Annual plan',
    },
    'limit_exceeded',
    'D7 Ren pays above the exception threshold',
  )
  t.check(
    'D7: it names the threshold, as the ledger does',
    above === `Above the Investor's exception threshold of ${usdText(lumenThreshold)}.`,
    above,
  )

  // D8. Only an Agency Admin of this Agency.
  const small = outside({ kind: 'account', accountId: ACC.arcOperations }, usd(5))
  w.refuse(U.alex, 'payOutside', small, 'forbidden', 'D8 a Member pays outside Viatik')
  w.refuse(U.elena, 'payOutside', small, 'forbidden', 'D8 the Investor pays outside Viatik')
  w.refuse(U.ren, 'payOutside', small, 'forbidden', "D8 another Agency's Admin pays from Arc")
  w.refuse(
    U.maya,
    'payOutside',
    outside({ kind: 'account', accountId: ACC.lumenOperations }, usd(5)),
    'forbidden',
    "D8 Maya pays from Lumen's account",
  )
  w.refuse(
    U.maya,
    'payOutside',
    outside({ kind: 'budget', budgetId: B.lumenPayroll }, usd(5)),
    'forbidden',
    "D8 Maya pays from Lumen's budget",
  )

  // D9. A usable address and the rest of the input.
  w.refuse(U.maya, 'payOutside', { ...small, to: '0x123' }, 'validation', 'D9 not an address')
  w.refuse(U.maya, 'payOutside', { ...small, to: ZERO_ADDRESS }, 'validation', 'D9 the zero address')
  const mistyped = TOOL.replace(/[a-f]/, (letter) => letter.toUpperCase())
  w.refuse(
    U.maya,
    'payOutside',
    { ...small, to: mistyped },
    'validation',
    'D9 a mistyped address (bad checksum)',
  )
  w.refuse(U.maya, 'payOutside', { ...small, payee: ' ' }, 'validation', 'D9 no payee')
  w.refuse(U.maya, 'payOutside', { ...small, amount: cents(0) }, 'validation', 'D9 nothing to pay')
  w.refuse(
    U.maya,
    'payOutside',
    { ...small, proof: link('Invoice', 'https://example.com/invoice') },
    'validation',
    'D9 a link instead of the invoice file',
  )
}

// ─── E. Returning capital ────────────────────────────────────────────────────

async function returnToInvestor(t: Checker) {
  const w = new World(t, 'engine-e')
  const vault = DEMO.vaults.portfolio
  const vaultBefore = vaultBalance(w.state, vault)
  await w.gather(U.maya, ACC.arcReserve, usd(1000))
  const reserveBefore = accountBalance(w.state, ACC.arcReserve)
  const bookedBefore = bookedTotal(w.state)
  const portfolioBefore = portfolioCapital(w.state, DEMO.portfolio, w.now)
  const arcBefore = agencyCapital(w.state, ARC, w.now).states.returned
  const agreementBefore = agreementCapital(w.state, DEMO.agreements.arc).returned
  const amount = usd(1000)

  const e1 = await w.run(
    U.maya,
    'returnToInvestor',
    { agencyId: ARC, accountId: ACC.arcReserve, amount, note: 'Reserve not needed this quarter' },
    'E1 Maya returns part of the Reserve to the Investor',
    { ops: ['returnCapital'] },
  )
  const receipt = e1.result
  checkSame(t, 'E1: returnCapital under the agreement that governs Arc', e1.plan?.ops[0], {
    call: 'returnCapital',
    opId: receipt.operationId,
    fromAccountId: ACC.arcReserve,
    portfolioVaultId: vault,
    agreementId: DEMO.agreements.arc,
    amount,
    evidenceHash: null,
  })
  checkSame(t, 'E1: the record goes from the Reserve to the Portfolio Vault', e1.plan?.records, [
    {
      opId: receipt.operationId,
      kind: 'capital_return',
      amount,
      from: { id: ACC.arcReserve },
      to: { id: vault },
      evidenceHash: null,
    },
  ])
  const movement = e1.movements[0]
  t.check(
    'E1: a capital return movement, attributed to the agreement',
    movement?.kind === 'capital_return' && movement.agreementId === DEMO.agreements.arc,
  )
  t.check('E1: the Portfolio Vault grows by it', vaultBalance(w.state, vault) - vaultBefore === amount)
  t.check('E1: the Reserve pays it', reserveBefore - accountBalance(w.state, ACC.arcReserve) === amount)
  t.check('E1: the money stays on the ledger', bookedTotal(w.state) === bookedBefore)
  const portfolioAfter = portfolioCapital(w.state, DEMO.portfolio, w.now)
  t.check(
    "E1: the portfolio's Returned is no longer zero",
    portfolioAfter.returned - portfolioBefore.returned === amount &&
      portfolioAfter.states.returned - portfolioBefore.states.returned === amount &&
      portfolioAfter.returned > 0,
    `${portfolioBefore.returned} → ${portfolioAfter.returned}`,
  )
  t.check("E1: so is Arc's", agencyCapital(w.state, ARC, w.now).states.returned - arcBefore === amount)
  t.check(
    "E1: and the agreement's",
    agreementCapital(w.state, DEMO.agreements.arc).returned - agreementBefore === amount,
  )
  t.check(
    'E1: a capital return receipt with the note',
    receipt.kind === 'capital_return' &&
      receipt.description === 'Reserve not needed this quarter' &&
      receipt.toLabel.endsWith('· Portfolio Vault'),
    `${receipt.kind} ${receipt.description} ${receipt.toLabel}`,
  )
  checkSame(t, 'E1: the Investors hear about it', notifiedUsers(e1), INVESTORS)
  t.check(
    "E1: 'Capital returned', pointing to the vaults",
    e1.notifications.every(
      (n) => n.title === 'Capital returned' && n.href === `/investor/${DEMO.portfolio}/vaults`,
    ),
  )
  t.check(
    'E1: no document on the ledger',
    w.state.receipts.find((r) => r.id === receipt.id)?.verified.evidenceHash === null,
  )
  t.check(
    'E1: the activity shows it',
    e1.activity.some((a) => a.type === 'capital_returned'),
  )

  // E2. Only from this Agency's accounts, by its Admins, within the balance.
  const back = { agencyId: ARC, accountId: ACC.arcReserve, amount: usd(1) }
  w.refuse(
    U.maya,
    'returnToInvestor',
    { ...back, amount: cents(accountBalance(w.state, ACC.arcReserve) + 1) },
    'insufficient_funds',
    'E2 more than the account holds',
  )
  w.refuse(U.maya, 'returnToInvestor', { ...back, accountId: B.arcTeam }, 'not_found', 'E2 from a budget')
  w.refuse(
    U.maya,
    'returnToInvestor',
    { ...back, accountId: DEMO.vaults.arcFunding },
    'not_found',
    'E2 from the funding vault',
  )
  w.refuse(
    U.maya,
    'returnToInvestor',
    { ...back, accountId: ACC.lumenOperations },
    'forbidden',
    "E2 from another Agency's account",
  )
  w.refuse(
    U.maya,
    'returnToInvestor',
    { ...back, agencyId: LUMEN, accountId: ACC.lumenOperations },
    'forbidden',
    'E2 for an Agency Maya does not run',
  )
  w.refuse(U.alex, 'returnToInvestor', back, 'forbidden', 'E2 by a Member')
  w.refuse(U.elena, 'returnToInvestor', back, 'forbidden', 'E2 by the Investor')
  w.refuse(U.maya, 'returnToInvestor', { ...back, amount: cents(0) }, 'validation', 'E2 nothing to return')

  // E3. Not limited by the exception threshold.
  const lumenThreshold = must(governingAgreement(w.state, LUMEN), "Lumen's agreement").spendingPolicy
    .exceptionThreshold
  await w.gather(U.ren, ACC.lumenOperations, cents(lumenThreshold + usd(1)))
  const lumenAll = accountBalance(w.state, ACC.lumenOperations)
  t.check('E3: Lumen Operations holds more than the exception threshold', lumenAll > lumenThreshold)
  const e3 = await w.run(
    U.ren,
    'returnToInvestor',
    { agencyId: LUMEN, accountId: ACC.lumenOperations, amount: lumenAll },
    'E3 Ren returns all of it, above the exception threshold',
    { ops: ['returnCapital'] },
  )
  const e3Op = e3.plan?.ops[0]
  t.check(
    "E3: under Lumen's agreement, for the whole amount",
    e3Op?.call === 'returnCapital' && e3Op.agreementId === DEMO.agreements.lumen && e3Op.amount === lumenAll,
  )
  t.check(
    'E3: without a note, the receipt says what it is',
    e3.result.description === 'Capital returned to the Investor',
  )

  // E4. The Investor can take out the larger vault.
  const whole = vaultBalance(w.state, vault)
  const e4 = await w.run(
    U.elena,
    'withdrawFunds',
    { portfolioId: DEMO.portfolio, amount: whole, to: WALLET },
    'E4 Elena withdraws the whole Portfolio Vault',
    { ops: ['withdraw'] },
  )
  t.check(
    'E4: more than the vault held before the returns',
    e4.plan?.ops[0]?.call === 'withdraw' && whole > vaultBefore && vaultBalance(w.state, vault) === 0,
  )

  // E5. With no agreement governing the Agency, the return names none and still counts as Returned.
  // (No command ends an agreement yet: its completion is written into the state here.)
  const w5 = new World(t, 'engine-e5')
  must(
    w5.state.agreements.find((a) => a.id === DEMO.agreements.arc),
    "Arc's agreement",
  ).status = 'completed'
  t.check('E5: Arc has no agreement in force', governingAgreement(w5.state, ARC) === undefined)
  const returnedBefore = {
    portfolio: portfolioCapital(w5.state, DEMO.portfolio, w5.now).returned,
    agency: agencyCapital(w5.state, ARC, w5.now).states.returned,
    agreement: agreementCapital(w5.state, DEMO.agreements.arc).returned,
  }
  const e5 = await w5.run(
    U.maya,
    'returnToInvestor',
    { agencyId: ARC, accountId: ACC.arcReserve, amount: usd(100) },
    'E5 Maya returns capital with no agreement in force',
    { ops: ['returnCapital'] },
  )
  const e5Op = e5.plan?.ops[0]
  t.check(
    'E5: no agreement named, on the ledger or the movement',
    e5Op?.call === 'returnCapital' && e5Op.agreementId === null && e5.movements[0]?.agreementId === undefined,
  )
  t.check(
    "E5: the portfolio's and Arc's Returned count it; the old agreement's does not",
    portfolioCapital(w5.state, DEMO.portfolio, w5.now).returned - returnedBefore.portfolio === usd(100) &&
      agencyCapital(w5.state, ARC, w5.now).states.returned - returnedBefore.agency === usd(100) &&
      agreementCapital(w5.state, DEMO.agreements.arc).returned === returnedBefore.agreement,
  )
}

// ─── F. Visibility ───────────────────────────────────────────────────────────

async function visibility(t: Checker) {
  const w = new World(t, 'engine-f')
  const team = budgetOf(w.state, B.arcTeam)
  await w.run(
    U.maya,
    'assignAllowance',
    { budgetId: B.arcTeam, holder: { kind: 'member', userId: U.alex }, periodLimit: team.periodLimit },
    'F setup: Alex may spend from Team payments',
    { ops: ['setAllowance'] },
  )
  await w.fund(U.maya, B.arcTeam, usd(80))
  await w.gather(U.maya, ACC.arcReserve, usd(30))
  const fromBudget = (
    await w.run(
      U.maya,
      'payOutside',
      {
        agencyId: ARC,
        source: { kind: 'budget', budgetId: B.arcTeam },
        to: TOOL,
        payee: 'Linear',
        amount: usd(80),
        category: 'software',
        memo: 'Linear seats',
      },
      'F setup: Maya pays Linear from Team payments',
      { ops: ['payOutside'] },
    )
  ).result
  const fromAccount = (
    await w.run(
      U.maya,
      'payOutside',
      {
        agencyId: ARC,
        source: { kind: 'account', accountId: ACC.arcReserve },
        to: TOOL,
        payee: 'Anthropic',
        amount: usd(30),
        category: 'ai_services',
        memo: 'Claude Teams',
      },
      'F setup: Maya pays Anthropic from the Reserve',
      { ops: ['payOutside'] },
    )
  ).result
  await w.run(
    U.alex,
    'withdrawBalance',
    { agencyId: ARC, amount: usd(25), to: WALLET },
    'F setup: Alex withdraws part of his balance',
    {
      ops: ['withdrawMemberBalance'],
    },
  )
  const saved = (
    await w.run(
      U.alex,
      'addPayoutAddress',
      { label: 'My wallet', address: WALLET },
      'F setup: Alex saves his wallet',
      {
        ops: [],
      },
    )
  ).result
  const advances = async (userId: Id, key: string) =>
    w.run(
      userId,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTools,
        type: 'funds',
        amount: usd(15),
        category: 'software',
        purpose: 'Stickers for the booth',
        idempotencyKey: `smoke-f-${key}`,
      },
      `F setup: ${key} asks for money for purchases`,
      { ops: ['requestPayment'] },
    )
  await w.fund(U.maya, B.arcTools, usd(30))
  await advances(U.alex, 'alex')
  await advances(U.priya, 'priya')

  const outsideIds = [fromBudget.id, fromAccount.id]
  for (const viewer of [U.maya, U.jordan, U.elena, U.marcus]) {
    const view = w.view(viewer)
    const payments = view.payments.filter((p) => outsideIds.includes(p.id))
    const movements = view.movements.filter((m) => m.refId && outsideIds.includes(m.refId))
    t.check(
      `F: ${viewer} sees where both outside payments went`,
      payments.length === 2 &&
        payments.every((p) => p.recipient.kind === 'address' && p.recipient.address === TOOL) &&
        movements.length === 2 &&
        movements.every((m) => m.to.kind === 'external' && m.to.address === TOOL),
    )
  }
  const alexView = w.view(U.alex)
  t.check('F: Alex sees no outside payment', !alexView.payments.some((p) => p.recipient.kind === 'address'))
  const alexMovement = alexView.movements.find((m) => m.refId === fromBudget.id)
  checkSame(t, 'F: Alex sees what his budget paid, with the payee only', alexMovement?.to, {
    kind: 'external',
    label: 'Linear',
  })
  t.check(
    'F: Alex does not see what the Reserve paid',
    !alexView.movements.some((m) => m.refId === fromAccount.id),
  )
  // Its receipt: the payee and a short address for the Agency's Admins and Investors, the payee only for Alex.
  const outsideReceipt = (state: ViatikState) => state.receipts.find((r) => r.operationId === fromBudget.id)
  const toolShort = shortAddress(TOOL)
  t.check(
    'F: Alex sees the receipt of what his budget paid, to the payee only',
    outsideReceipt(alexView)?.kind === 'outside_payment' && outsideReceipt(alexView)?.toLabel === 'Linear',
    outsideReceipt(alexView)?.toLabel,
  )
  for (const viewer of [U.maya, U.elena]) {
    t.check(
      `F: ${viewer} sees it with the short address`,
      outsideReceipt(w.view(viewer))?.toLabel === `Linear · ${toolShort}`,
      outsideReceipt(w.view(viewer))?.toLabel,
    )
  }
  t.check(
    "F: not even the short address appears in Alex's view",
    !JSON.stringify(alexView).includes(toolShort),
  )
  t.check(
    "F: the outside address appears nowhere in Alex's view",
    !JSON.stringify(alexView).toLowerCase().includes(TOOL.toLowerCase()),
  )
  // (The seed gives Priya access to Team payments too; Sofia has none.)
  const sofiaView = w.view(U.sofia)
  t.check(
    'F: Sofia, without access to Team payments, sees neither',
    !sofiaView.movements.some((m) => m.refId && outsideIds.includes(m.refId)),
  )
  const renView = w.view(U.ren)
  t.check(
    'F: another Agency sees nothing of them',
    !renView.payments.some((p) => outsideIds.includes(p.id)) &&
      !renView.movements.some((m) => m.refId && outsideIds.includes(m.refId)) &&
      !renView.receipts.some((r) => outsideIds.includes(r.operationId)) &&
      !JSON.stringify(renView).toLowerCase().includes(TOOL.toLowerCase()),
  )

  // A person's withdrawal: only they see the address.
  const withdrawalOf = (state: ViatikState) =>
    state.movements.find(
      (m) =>
        m.kind === 'withdrawal' &&
        m.from.kind === 'recipient' &&
        m.from.recipient.kind === 'member' &&
        m.from.recipient.userId === U.alex,
    )
  const ownWithdrawal = withdrawalOf(alexView)
  t.check(
    'F: Alex sees where his withdrawal went',
    ownWithdrawal?.to.kind === 'external' && ownWithdrawal.to.address === WALLET,
  )
  for (const viewer of [U.maya, U.elena]) {
    const seen = withdrawalOf(w.view(viewer))
    t.check(
      `F: ${viewer} sees only a short label of Alex's withdrawal`,
      seen?.to.kind === 'external' && !seen.to.address && seen.to.label.includes('…'),
    )
  }

  // Saved payout addresses: the owner and the Admins of their Agencies (unchanged rule).
  const sees = (viewer: Id) => w.view(viewer).payoutAddresses.some((a) => a.id === saved.id)
  t.check('F: Alex sees his saved address', sees(U.alex))
  t.check("F: Arc's Admins see it", sees(U.maya) && sees(U.jordan))
  t.check(
    'F: the Investor, another Agency and another Member do not',
    !sees(U.elena) && !sees(U.ren) && !sees(U.priya),
  )

  // Accountability on what each person sees.
  const people = (viewer: Id) =>
    accountabilityByPerson(w.view(viewer), ARC, w.now)
      .map((p) => p.userId)
      .sort()
  t.check(
    'F: Alex sees only his own money to justify',
    same(people(U.alex), [U.alex]),
    JSON.stringify(people(U.alex)),
  )
  t.check('F: Priya sees only hers', same(people(U.priya), [U.priya]), JSON.stringify(people(U.priya)))
  t.check(
    'F: the Admin sees both',
    [U.alex, U.priya].every((id) => people(U.maya).includes(id)),
    JSON.stringify(people(U.maya)),
  )

  // Alex holds Tools too: Priya's money for purchases from it reads "Team member", with no receipt.
  const priyaFromTools = w.state.movements.find(
    (m) =>
      m.kind === 'payment' &&
      m.from.kind === 'budget' &&
      m.from.budgetId === B.arcTools &&
      m.to.kind === 'recipient' &&
      m.to.recipient.kind === 'member' &&
      m.to.recipient.userId === U.priya,
  )
  const seenByAlex = alexView.movements.find((m) => m.id === priyaFromTools?.id)
  t.check(
    "F: Alex sees what Tools paid Priya as paid to 'Team member', without its receipt",
    priyaFromTools !== undefined &&
      seenByAlex?.amount === priyaFromTools.amount &&
      same(seenByAlex.from, priyaFromTools.from) &&
      same(seenByAlex.to, { kind: 'external', label: 'Team member' }) &&
      !seenByAlex.receiptId &&
      !alexView.receipts.some((r) => r.id === priyaFromTools.receiptId),
    JSON.stringify(seenByAlex),
  )
  memberViewChecks(t, 'F', w.state, w.now)
}

// ─── G. Reminders ────────────────────────────────────────────────────────────

async function reminders(t: Checker) {
  const w = new World(t, 'engine-g')
  const monthly = {
    agencyId: ARC,
    title: 'Pay Claude Teams and upload the invoice',
    payee: 'Anthropic',
    amount: usd(30),
    category: 'ai_services' as const,
    dayOfMonth: 5,
    sourceAccountId: ACC.arcOperations,
  }
  w.refuse(U.alex, 'createReminder', monthly, 'forbidden', 'G a Member creates a reminder')
  w.refuse(U.elena, 'createReminder', monthly, 'forbidden', 'G the Investor creates a reminder')
  w.refuse(
    U.maya,
    'createReminder',
    { ...monthly, dayOfMonth: 31 },
    'validation',
    'G day 31 (not every month has it)',
  )
  w.refuse(U.maya, 'createReminder', { ...monthly, dayOfMonth: 0 }, 'schema', 'G day 0')
  w.refuse(U.maya, 'createReminder', { ...monthly, amount: cents(0) }, 'validation', 'G a zero amount')
  w.refuse(
    U.maya,
    'createReminder',
    { ...monthly, sourceAccountId: ACC.lumenOperations },
    'forbidden',
    "G paid from another Agency's account",
  )
  const created = await w.run(U.maya, 'createReminder', monthly, 'G1 Maya creates a monthly reminder', {
    ops: [],
  })
  const reminder = created.result
  t.check(
    'G1: stored, active',
    w.state.reminders.some((r) => r.id === reminder.id && r.status === 'active'),
  )
  t.check('G1: nobody is notified', created.notifications.length === 0)
  t.check(
    'G1: the activity shows it',
    created.activity.some((a) => a.type === 'reminder_created'),
  )
  const today = new Date(w.now)
  const thisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 5)).toISOString()
  const lateAlready = Date.parse(w.now) > Date.parse(thisMonth)
  const due = remindersDue(w.state, ARC, w.now).find((d) => d.reminder.id === reminder.id)
  t.check(
    `G1: due on the 5th of the month it was created, ${lateAlready ? 'already late' : 'not late yet'}`,
    due?.dueAt === thisMonth && due.overdue === lateAlready,
    due?.dueAt,
  )
  t.check('G1: Members do not see reminders', w.view(U.alex).reminders.length === 0)
  t.check(
    'G1: the Investor does',
    w.view(U.elena).reminders.some((r) => r.id === reminder.id),
  )
  t.check('G1: another Agency does not', !w.view(U.ren).reminders.some((r) => r.id === reminder.id))

  await w.gather(U.maya, ACC.arcOperations, usd(30))
  const paid = await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcOperations },
      to: TOOL,
      payee: 'Anthropic',
      amount: usd(30),
      category: 'ai_services',
      memo: 'Claude Teams, October',
      reminderId: reminder.id,
    },
    'G2 Maya pays it outside Viatik',
    { ops: ['payOutside'] },
  )
  t.check('G2: the payment answers the reminder', paid.result.reminderId === reminder.id)
  const next = remindersDue(w.state, ARC, w.now).find((d) => d.reminder.id === reminder.id)
  const nextMonth = new Date(Date.UTC(Number(w.now.slice(0, 4)), Number(w.now.slice(5, 7)), 5)).toISOString()
  t.check(
    'G2: next due on the 5th of next month, not late',
    next?.dueAt === nextMonth && !next.overdue && next.lastPayment?.id === paid.result.id,
    next?.dueAt,
  )

  await w.run(
    U.maya,
    'setReminderStatus',
    { reminderId: reminder.id, status: 'paused' },
    'G3 Maya pauses it',
    { ops: [] },
  )
  w.refuse(
    U.maya,
    'setReminderStatus',
    { reminderId: reminder.id, status: 'paused' },
    'invalid_state',
    'G3 pausing it again',
  )
  w.refuse(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcOperations },
      to: TOOL,
      payee: 'Anthropic',
      amount: usd(30),
      category: 'ai_services',
      memo: 'Claude Teams',
      reminderId: reminder.id,
    },
    'invalid_state',
    'G3 paying a paused reminder',
  )
  t.check(
    'G3: a paused reminder is not due',
    !remindersDue(w.state, ARC, w.now).some((d) => d.reminder.id === reminder.id),
  )
  w.refuse(
    U.alex,
    'setReminderStatus',
    { reminderId: reminder.id, status: 'active' },
    'forbidden',
    'G3 a Member resumes it',
  )
  await w.run(
    U.maya,
    'setReminderStatus',
    { reminderId: reminder.id, status: 'active' },
    'G3 Maya resumes it',
    { ops: [] },
  )
  const archived = await w.run(
    U.maya,
    'setReminderStatus',
    { reminderId: reminder.id, status: 'archived' },
    'G3 Maya archives it',
    { ops: [] },
  )
  t.check(
    'G3: the activity shows the change',
    archived.activity.some((a) => a.type === 'reminder_updated'),
  )
  w.refuse(
    U.maya,
    'setReminderStatus',
    { reminderId: reminder.id, status: 'active' },
    'invalid_state',
    'G3 archived is final',
  )
  const lumenReminder = await w.run(
    U.ren,
    'createReminder',
    { ...monthly, agencyId: LUMEN, sourceAccountId: ACC.lumenOperations },
    "G3 Ren creates Lumen's own reminder",
    { ops: [] },
  )
  w.refuse(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: ACC.arcOperations },
      to: TOOL,
      payee: 'Anthropic',
      amount: usd(30),
      category: 'ai_services',
      memo: 'Claude Teams',
      reminderId: lumenReminder.result.id,
    },
    'forbidden',
    "G3 paying another Agency's reminder",
  )
  t.check(
    "G3: Arc's Admins do not see Lumen's reminder",
    !w.view(U.maya).reminders.some((r) => r.id === lumenReminder.result.id),
  )

  // Receipt reminders: only people with money to justify, at most once a day each. (In Arc Studio the
  // seed already has some: Lumen Labs has nobody.)
  const nobody = w.refuse(
    U.ren,
    'remindReceipts',
    { agencyId: LUMEN },
    'invalid_state',
    'G4 nobody in Lumen Labs has receipts to send',
  )
  t.check("G4: it says 'Nobody has receipts to send.'", nobody === 'Nobody has receipts to send.', nobody)

  await w.fund(U.maya, B.arcTools, usd(30))
  for (const [userId, key] of [
    [U.alex, 'alex'],
    [U.priya, 'priya'],
  ] as const) {
    await w.run(
      userId,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTools,
        type: 'funds',
        amount: usd(15),
        category: 'software',
        purpose: 'Cables',
        idempotencyKey: `smoke-g-${key}`,
      },
      `G4 ${key} asks for money for purchases`,
      { ops: ['requestPayment'] },
    )
  }
  const owing = accountabilityByPerson(w.state, ARC, w.now)
    .filter((p) => p.pending > 0)
    .map((p) => p.userId)
    .sort()
  w.refuse(U.alex, 'remindReceipts', { agencyId: ARC }, 'forbidden', 'G4 a Member sends reminders')
  w.refuse(U.elena, 'remindReceipts', { agencyId: ARC }, 'forbidden', 'G4 the Investor sends reminders')
  w.refuse(
    U.maya,
    'remindReceipts',
    { agencyId: ARC, userId: U.sofia },
    'invalid_state',
    'G4 reminding someone with nothing pending',
  )
  const g4 = await w.run(
    U.maya,
    'remindReceipts',
    { agencyId: ARC },
    'G4 Maya reminds everyone who owes receipts',
    {
      ops: [],
    },
  )
  checkSame(t, 'G4: exactly the people with money to justify', [...g4.result.notified].sort(), owing)
  t.check(
    'G4: Alex and Priya among them',
    [U.alex, U.priya].every((id) => owing.includes(id)),
  )
  checkSame(t, 'G4: each of them is notified', notifiedUsers(g4), owing)
  t.check(
    'G4: "Receipts needed", pointing to their expenses',
    g4.notifications.every((n) => n.title === 'Receipts needed' && n.href === `/member/${ARC}/expenses`),
  )
  t.check(
    'G4: one activity per person reminded',
    owing.every((id) => g4.activity.some((a) => a.type === 'receipts_reminded' && a.subjectUserId === id)),
  )
  t.check('G4: when Alex was last reminded', lastReminded(w.state, ARC, U.alex) === w.now)
  w.refuse(U.maya, 'remindReceipts', { agencyId: ARC }, 'invalid_state', 'G5 everyone again at once')
  const tooSoon = w.refuse(
    U.maya,
    'remindReceipts',
    { agencyId: ARC, userId: U.alex },
    'invalid_state',
    'G5 Alex again at once',
  )
  t.check(
    `G5: it says ${REMIND_EVERY_HOURS} hours`,
    tooSoon.includes(`less than ${REMIND_EVERY_HOURS} hours ago`),
    tooSoon,
  )
  w.later(REMIND_EVERY_HOURS - 1)
  w.refuse(
    U.maya,
    'remindReceipts',
    { agencyId: ARC, userId: U.alex },
    'invalid_state',
    'G5 Alex again an hour too soon',
  )
  w.later(2)
  const g5 = await w.run(
    U.maya,
    'remindReceipts',
    { agencyId: ARC, userId: U.alex },
    'G5 Alex again the next day',
    {
      ops: [],
    },
  )
  checkSame(t, 'G5: only Alex', g5.result.notified, [U.alex])
  const g5b = await w.run(U.maya, 'remindReceipts', { agencyId: ARC }, 'G5 Maya reminds everyone again', {
    ops: [],
  })
  t.check(
    'G5: everyone but Alex, reminded a moment ago',
    !g5b.result.notified.includes(U.alex) && g5b.result.notified.includes(U.priya),
    JSON.stringify(g5b.result.notified),
  )
  w.refuse(
    U.maya,
    'remindReceipts',
    { agencyId: ARC, userId: U.maya },
    'invalid_state',
    'G5 Maya reminds herself',
  )

  // A month later the reminder says some of it is overdue.
  w.later(24 * (JUSTIFY_WITHIN_DAYS + 1))
  const g6 = await w.run(
    U.maya,
    'remindReceipts',
    { agencyId: ARC, userId: U.alex },
    'G6 Maya reminds Alex a month later',
    {
      ops: [],
    },
  )
  t.check(
    'G6: it says some of it is overdue',
    g6.notifications.some(
      (n) => n.userId === U.alex && n.body.endsWith('still needs receipts, some overdue.'),
    ),
    g6.notifications[0]?.body,
  )
}

// ─── I. The first smoke's checks ─────────────────────────────────────────────

async function firstSmoke(t: Checker) {
  const w = new World(t, 'engine-i')
  const portfolio = must(w.state.portfolios[0], 'the portfolio')
  const vault = must(
    w.state.vaults.find((v) => v.portfolioId === portfolio.id && v.kind === 'portfolio'),
    'the Portfolio Vault',
  )
  const start = vaultBalance(w.state, vault.id)
  const amount = usd(10_000)

  // The Investor withdraws from the Portfolio Vault.
  const withdrawal = await w.run(
    U.elena,
    'withdrawFunds',
    { portfolioId: portfolio.id, amount, to: WALLET },
    'I Elena withdraws from the Portfolio Vault',
  )
  t.check(
    'withdrawFunds lowers the Portfolio Vault by the amount',
    start - vaultBalance(w.state, vault.id) === amount,
  )
  const mv = withdrawal.movements.at(-1)
  t.check(
    'the movement is a withdrawal to the address',
    mv?.kind === 'withdrawal' && mv.to.kind === 'external' && mv.to.address === WALLET,
  )
  t.check('a withdrawal receipt exists', withdrawal.result.kind === 'withdrawal')
  w.refuse(
    U.elena,
    'withdrawFunds',
    { portfolioId: portfolio.id, amount: cents(vaultBalance(w.state, vault.id) + 1), to: WALLET },
    'insufficient_funds',
    'withdrawing more than the vault holds is refused',
  )
  w.refuse(
    U.maya,
    'withdrawFunds',
    { portfolioId: portfolio.id, amount, to: WALLET },
    'forbidden',
    'an Admin cannot withdraw the Portfolio Vault',
  )
  w.refuse(
    U.elena,
    'withdrawFunds',
    { portfolioId: portfolio.id, amount, to: '0x123' },
    'validation',
    'a bad address is refused',
  )
  w.refuse(
    U.elena,
    'withdrawFunds',
    { portfolioId: portfolio.id, amount, to: ZERO_ADDRESS },
    'validation',
    'the zero address is refused',
  )
  // A wrong checksum (one letter flipped in case) is a typo, not an address.
  w.refuse(
    U.elena,
    'withdrawFunds',
    { portfolioId: portfolio.id, amount, to: WALLET.replace('A', 'a') },
    'validation',
    'a mistyped (bad checksum) address is refused',
  )

  // The settlement plan and the mock ledger.
  const plan = must(withdrawal.plan, 'the withdrawal plan')
  t.check('the plan has one withdraw operation', plan.ops.length === 1 && plan.ops[0]?.call === 'withdraw')
  t.check('nothing is left uncovered', plan.uncovered.length === 0)
  const planned = plan.records[0]?.to
  t.check(
    'the planned record ends at the address',
    plan.records[0]?.kind === 'withdrawal' &&
      Boolean(planned && 'address' in planned && planned.address === WALLET),
  )
  t.check('the mock ledger settles it', withdrawal.settled?.status === 'completed')
  // The mock ledger refuses what the contract would: a funding vault named as a Portfolio Vault.
  const fundingVault = must(
    withdrawal.before.vaults.find((v) => v.kind === 'funding'),
    'a funding vault',
  )
  const bad = structuredClone(plan)
  const badOp = bad.ops[0]
  if (badOp?.call === 'withdraw') badOp.vaultId = fundingVault.id
  const refused = await w.settleCrafted(bad, withdrawal.before)
  t.check(
    'the mock ledger refuses to withdraw from a funding vault',
    refused.status === 'failed',
    refused.error?.message,
  )

  // A Member withdraws what the agency paid them.
  const held = memberHeld(w.state, ARC, U.alex)
  if (held <= 0) throw new Error('Alex holds nothing in the seed')
  const part = cents(Math.min(held, usd(100)))
  const mw = await w.run(
    U.alex,
    'withdrawBalance',
    { agencyId: ARC, amount: part, to: WALLET },
    'I Alex withdraws part of his balance',
  )
  t.check('withdrawBalance lowers what Alex holds', memberHeld(w.state, ARC, U.alex) === held - part)
  t.check(
    'the plan is a withdrawMemberBalance',
    mw.plan?.ops.length === 1 &&
      mw.plan.ops[0]?.call === 'withdrawMemberBalance' &&
      mw.plan.uncovered.length === 0,
  )
  t.check(
    'the mock ledger settles the Member withdrawal',
    mw.settled?.status === 'completed',
    mw.settled?.error?.message,
  )
  w.refuse(
    U.alex,
    'withdrawBalance',
    { agencyId: ARC, amount: cents(memberHeld(w.state, ARC, U.alex) + 1), to: WALLET },
    'insufficient_funds',
    'a Member cannot withdraw more than they hold',
  )
  w.refuse(
    U.elena,
    'withdrawBalance',
    { agencyId: ARC, amount: part, to: WALLET },
    'forbidden',
    'the Investor cannot withdraw a Member balance',
  )

  // What others see of where it went.
  const memberWithdrawal = (viewer: Id) =>
    w.view(viewer).movements.find((m) => m.kind === 'withdrawal' && m.from.kind === 'recipient')
  const seenByAlex = memberWithdrawal(U.alex)
  const seenByMaya = memberWithdrawal(U.maya)
  const seenByElena = memberWithdrawal(U.elena)
  t.check(
    'Alex sees the full address',
    seenByAlex?.to.kind === 'external' && seenByAlex.to.address === WALLET,
  )
  t.check(
    'the Admin sees only the short label',
    seenByMaya?.to.kind === 'external' && !seenByMaya.to.address && seenByMaya.to.label.includes('…'),
  )
  t.check(
    'the Investor sees only the short label',
    seenByElena?.to.kind === 'external' && !seenByElena.to.address,
  )
  const seenOwn = w.view(U.elena).movements.find((m) => m.kind === 'withdrawal' && m.from.kind === 'vault')
  t.check(
    'Elena sees the full address of her own withdrawal',
    seenOwn?.to.kind === 'external' && seenOwn.to.address === WALLET,
  )
  t.check(
    'the Admin does not see portfolio withdrawals',
    !w.view(U.maya).movements.some((m) => m.kind === 'withdrawal' && m.from.kind === 'vault'),
  )

  // Saved addresses.
  const a1 = await w.run(
    U.alex,
    'addPayoutAddress',
    { label: 'My wallet', address: WALLET.toLowerCase() },
    'I Alex saves an address',
  )
  t.check('a saved address is stored checksummed', a1.result.address === WALLET)
  w.refuse(
    U.alex,
    'addPayoutAddress',
    { label: 'Again', address: WALLET },
    'invalid_state',
    'the same address cannot be saved twice',
  )
  t.check(
    'the Admin of the agency sees Alex saved addresses',
    w.view(U.maya).payoutAddresses.some((a) => a.id === a1.result.id),
  )
  t.check('the Investor does not', !w.view(U.elena).payoutAddresses.some((a) => a.id === a1.result.id))
  w.refuse(
    U.maya,
    'removePayoutAddress',
    { addressId: a1.result.id },
    'forbidden',
    'somebody else cannot remove it',
  )
  await w.run(U.alex, 'removePayoutAddress', { addressId: a1.result.id }, 'I Alex removes it')
  t.check('the owner removes it', !w.state.payoutAddresses.some((a) => a.id === a1.result.id))

  // Providers: edit, pause, archive.
  const dest = must(
    w.state.destinations.find((d) => d.agencyId === ARC && d.status === 'approved'),
    'an approved provider of Arc',
  )
  const upd = await w.run(
    U.maya,
    'updateDestination',
    { destinationId: dest.id, name: `${dest.name} Inc.`, website: '' },
    'I Maya edits a provider',
  )
  t.check(
    'the Admin edits a provider',
    upd.result.name === `${dest.name} Inc.` && upd.result.website === undefined,
  )
  w.refuse(
    U.alex,
    'updateDestination',
    { destinationId: dest.id, name: 'x' },
    'forbidden',
    'a Member cannot edit a provider',
  )
  const paused = await w.run(
    U.maya,
    'setDestinationStatus',
    { destinationId: dest.id, status: 'paused' },
    'I Maya pauses it',
  )
  t.check('the Admin pauses it', paused.result.status === 'paused')
  w.refuse(
    U.maya,
    'setDestinationStatus',
    { destinationId: dest.id, status: 'paused' },
    'invalid_state',
    'pausing twice is refused',
  )
  const budget = must(
    w.state.budgets.find((b) => b.agencyId === ARC && b.status === 'active'),
    'an active budget of Arc',
  )
  w.refuse(
    U.maya,
    'sendPayment',
    {
      agencyId: ARC,
      recipient: { kind: 'destination', destinationId: dest.id },
      accountId: budget.sourceAccountId,
      budgetId: budget.id,
      amount: usd(10),
      category: dest.category,
      memo: 'test',
      type: 'vendor',
    },
    'invalid_state',
    'a paused provider cannot be paid',
  )
  const back = await w.run(
    U.maya,
    'setDestinationStatus',
    { destinationId: dest.id, status: 'approved' },
    'I Maya restores it',
  )
  t.check('and restored', back.result.status === 'approved')

  // Nobody pays themselves: an Admin requests payment for work, which another Admin reviews.
  await w.gather(U.maya, ACC.arcOperations, usd(100))
  const toSelf = {
    agencyId: ARC,
    type: 'team' as const,
    recipient: { kind: 'member' as const, userId: U.maya },
    accountId: ACC.arcOperations,
    amount: usd(20),
    category: 'team' as const,
    memo: 'October team payment',
  }
  const selfMessage = w.refuse(U.maya, 'sendPayment', toSelf, 'forbidden', 'I an Admin cannot pay herself')
  t.check(
    'I it says another Agency Admin has to pay her',
    selfMessage === 'You cannot pay yourself. Another Agency Admin has to pay you.',
    selfMessage,
  )
  w.refuse(
    U.maya,
    'sendPayment',
    { ...toSelf, scheduledFor: plusHours(w.now, 2) },
    'forbidden',
    'I nor schedule a payment to herself',
  )
  w.refuse(
    U.maya,
    'sendTeamPayments',
    {
      agencyId: ARC,
      accountId: ACC.arcOperations,
      memo: 'October team payment',
      items: [
        { userId: U.alex, amount: usd(10) },
        { userId: U.maya, amount: usd(10) },
      ],
    },
    'forbidden',
    'I nor be part of a team payment (nobody in that batch is paid)',
  )
  const team = await w.run(
    U.maya,
    'sendTeamPayments',
    {
      agencyId: ARC,
      accountId: ACC.arcOperations,
      memo: 'October team payment',
      items: [
        { userId: U.alex, amount: usd(10) },
        { userId: U.jordan, amount: usd(10) },
      ],
    },
    'I Maya pays Alex and Jordan, another Agency Admin, in one batch',
    { ops: ['pay', 'pay'] },
  )
  t.check(
    'I the batch pays both, Admin included',
    team.result.length === 2 && team.result.every((p) => p.batchId === team.result[0]?.batchId),
  )
  const arcPeople = w.state.memberships
    .filter((m) => m.scope.kind === 'agency' && m.scope.agencyId === ARC && m.status === 'active')
    .map((m) => m.userId)
  checkSame(
    t,
    'I Send payment and Pay team list everyone active in the Agency but the Admin paying',
    payablePeople(w.state, ARC, U.maya)
      .map((m) => m.userId)
      .sort(),
    arcPeople.filter((id) => id !== U.maya).sort(),
  )
  t.check(
    'I that includes the other Admin and the Members',
    [U.jordan, U.alex, U.priya].every((id) =>
      payablePeople(w.state, ARC, U.maya).some((m) => m.userId === id),
    ),
  )

  // Providers: the payment reference is an optional note, and adding one only changes Viatik's records.
  const acme = await w.run(
    U.maya,
    'addDestination',
    {
      agencyId: ARC,
      name: 'Acme Tools',
      kind: 'service',
      category: 'software',
      settlementLabel: ' Customer no. 77 ',
    },
    'I Maya adds a provider with a payment reference',
    { ops: [] },
  )
  t.check(
    'the Admin adds an approved provider, with its reference trimmed',
    acme.result.status === 'approved' &&
      acme.result.settlementLabel === 'Customer no. 77' &&
      w.state.destinations.some((d) => d.id === acme.result.id),
    JSON.stringify(acme.result),
  )
  const bare = await w.run(
    U.maya,
    'addDestination',
    { agencyId: ARC, name: 'Bare Tools', kind: 'vendor', category: 'software' },
    'I Maya adds a provider without a payment reference',
    { ops: [] },
  )
  t.check('a provider needs no payment reference', bare.result.settlementLabel === '')
  const blank = await w.run(
    U.maya,
    'addDestination',
    { agencyId: ARC, name: 'Blank Tools', kind: 'vendor', category: 'software', settlementLabel: '   ' },
    'I Maya adds a provider with a blank payment reference',
  )
  t.check('a blank payment reference is saved empty', blank.result.settlementLabel === '')
  const cleared = await w.run(
    U.maya,
    'updateDestination',
    { destinationId: acme.result.id, settlementLabel: '' },
    'I Maya clears the payment reference',
    { ops: [] },
  )
  t.check('the Admin clears a payment reference', cleared.result.settlementLabel === '')
  const long = w.refuseRaw(
    U.maya,
    'updateDestination',
    { destinationId: acme.result.id, settlementLabel: 'R'.repeat(81) },
    'validation',
    'I the engine refuses a payment reference longer than 80 characters',
    { skipSchema: true },
  )
  t.check(
    'the engine names the field a payment reference',
    long === 'Payment reference must be 80 characters or fewer.',
    long,
  )
  const provider = { agencyId: ARC, name: 'Long Tools', kind: 'vendor', category: 'software' }
  w.refuseRaw(
    U.maya,
    'addDestination',
    { ...provider, name: 'N'.repeat(81) },
    'schema',
    'I a provider name longer than 80 characters (API)',
  )
  w.refuseRaw(
    U.maya,
    'addDestination',
    { ...provider, settlementLabel: 'R'.repeat(81) },
    'schema',
    'I a payment reference longer than 80 characters (API)',
  )
  w.refuseRaw(
    U.maya,
    'updateDestination',
    { destinationId: acme.result.id, name: 'N'.repeat(81) },
    'schema',
    'I a new provider name longer than 80 characters (API)',
  )
}

// ─── J. Labels, statuses, the seed, the schemas ──────────────────────────────

async function labelsAndSeed(t: Checker) {
  t.check(
    'J: "Money for purchases" names the request and its payment',
    requestTypeLabel.funds === 'Money for purchases' && paymentTypeLabel.advance === 'Money for purchases',
  )
  t.check('J: "Payment for work"', requestTypeLabel.work === 'Payment for work')
  t.check(
    'J: the new receipt kinds have their names',
    receiptKindLabel.outside_payment === 'Outside payment receipt' &&
      receiptKindLabel.capital_return === 'Capital return receipt',
  )
  // Vault asset details, the Portfolio card and Verified details all read the asset from here.
  t.check(
    'J: the network names the settlement asset: TestUSD on testnet (for USDC), USDC on mainnet',
    MONAD_NETWORKS.testnet.asset.symbol === 'TestUSD' &&
      MONAD_NETWORKS.testnet.asset.standsInFor === 'USDC' &&
      MONAD_NETWORKS.mainnet.asset.symbol === 'USDC' &&
      MONAD_NETWORKS.mainnet.asset.standsInFor === undefined,
    JSON.stringify([MONAD_NETWORKS.testnet.asset, MONAD_NETWORKS.mainnet.asset]),
  )
  checkSame(t, 'J: invoice statuses', proofStatus, {
    missing: { label: 'Invoice pending', tone: 'warning' },
    attached: { label: 'Invoice attached', tone: 'success' },
    overdue: { label: 'Invoice overdue', tone: 'danger' },
  })
  checkSame(t, 'J: justification statuses', Object.keys(justificationStatus).sort(), [
    'justified',
    'overdue',
    'pending',
  ])
  checkSame(t, 'J: reminder statuses', Object.keys(reminderStatus).sort(), ['active', 'archived', 'paused'])

  // What the Agency reads after accepting matches each release model: only a milestone needs a
  // request (its evidence); otherwise the Investor releases, and sees the tranche ready to release.
  checkSame(
    t,
    'J: every release model says what the Agency does next',
    Object.keys(agencyNextTranche).sort(),
    [...Object.keys(releaseModelLabel).sort()],
  )
  t.check(
    'J: a Manual agreement never tells the Agency to request its first tranche now',
    !agencyNextTranche.manual.includes('request the first tranche now') &&
      agencyNextTranche.manual.startsWith('The Investor releases') &&
      agencyNextTranche.milestone.startsWith('Submit evidence'),
  )
  t.check(
    'J: an available tranche without a milestone reads "Ready to release" to the Investor only',
    trancheStatusFor({ status: 'available', releaseCondition: 'manual' }, 'investor').label ===
      'Ready to release' &&
      trancheStatusFor({ status: 'available', releaseCondition: 'manual' }, 'agency').label ===
        'Available to request' &&
      trancheStatusFor({ status: 'available', releaseCondition: 'milestone' }, 'investor').label ===
        'Available to request',
  )

  const w = new World(t, 'engine-j')
  // Nothing moves unreleased capital back by itself: the seeded terms do not promise it.
  t.check(
    'J: no seeded return condition promises an automatic return to the Portfolio Vault',
    w.state.agreements.every(
      (a) =>
        !/returns to the Portfolio Vault (if|at)/.test(a.spendingPolicy.returnConditions) &&
        a.spendingPolicy.returnConditions.length > 0,
    ),
    JSON.stringify(w.state.agreements.map((a) => a.spendingPolicy.returnConditions)),
  )
  const tools = budgetOf(w.state, B.arcTools)
  const lines = describeBudgetPolicy(tools, { destinationNames: ['Vertex Cloud', 'Canvasly'] })
  t.check(
    "J: a budget's vendor list reads as limiting vendor payments only",
    lines.includes('Vendor payments can only go to Vertex Cloud and Canvasly.'),
    lines.join(' | '),
  )

  // A Member's own limits: one payment is capped by their allowance's per-payment limit when it is
  // lower than the budget's, and the rules they read say so.
  const alexOn = (budgetId: Id) =>
    must(
      w.state.allowances.find(
        (a) =>
          a.budgetId === budgetId &&
          a.status === 'active' &&
          a.holder.kind === 'member' &&
          a.holder.userId === U.alex,
      ),
      `Alex's allowance on ${budgetId}`,
    )
  const team = budgetOf(w.state, B.arcTeam)
  const alexTeam = alexOn(B.arcTeam)
  t.check(
    "J: Alex's cap on Team payments is his allowance's, below the budget's",
    alexTeam.perOperationLimit !== undefined &&
      alexTeam.perOperationLimit < team.perOperationLimit &&
      perPaymentCap(team, alexTeam) === alexTeam.perOperationLimit,
    `${perPaymentCap(team, alexTeam)}`,
  )
  t.check(
    'J: an allowance with no cap of its own follows the budget’s',
    perPaymentCap(tools, alexOn(B.arcTools)) === tools.perOperationLimit &&
      perPaymentCap(tools) === tools.perOperationLimit,
  )
  const teamLines = describeBudgetPolicy(team, { allowance: alexTeam })
  t.check(
    'J: Alex reads his own per-payment cap, and that every payment is reviewed',
    teamLines.includes(`A single payment cannot exceed ${usdText(perPaymentCap(team, alexTeam))}.`) &&
      teamLines.includes('Every payment needs an Agency Admin approval.'),
    teamLines.join(' | '),
  )
  const lowCap = describeBudgetPolicy(tools, { allowance: { perOperationLimit: usd(100) } })
  t.check(
    'J: with a cap at or below the automatic limit, everything within the limits approves itself but work',
    lowCap.includes(`A single payment cannot exceed ${usdText(usd(100))}.`) &&
      lowCap.includes(
        'Payments within these limits are approved automatically, except payment for work, which an Agency Admin always reviews.',
      ),
    lowCap.join(' | '),
  )
  const belowException = describeBudgetPolicy(tools, {
    allowance: { perOperationLimit: usd(100) },
    exceptionThreshold: usd(60),
  })
  t.check(
    "J: …and with the Investor's exception threshold below that cap, payments above it go to the Investor",
    belowException.includes(
      `Payments up to ${usdText(usd(60))} are approved automatically, except payment for work, which an Agency Admin always reviews. Payments above ${usdText(usd(60))} go to the Investor.`,
    ) &&
      same(
        describeBudgetPolicy(tools, {
          allowance: { perOperationLimit: usd(100) },
          exceptionThreshold: usd(100),
        }),
        lowCap,
      ),
    belowException.join(' | '),
  )
  const toolsLines = describeBudgetPolicy(tools, { allowance: alexOn(B.arcTools) })
  t.check(
    'J: with a cap above the automatic limit, the limit is named',
    toolsLines.includes(
      `Payments up to ${usdText(tools.approvalThreshold)} are approved automatically. Anything above needs an Agency Admin.`,
    ),
    toolsLines.join(' | '),
  )
  t.check(
    'J: without an allowance (an Admin reading the budget) the automatic limit is always named',
    describeBudgetPolicy(tools).includes(
      `Payments up to ${usdText(tools.approvalThreshold)} are approved automatically. Anything above needs an Agency Admin.`,
    ),
  )
  const overCap = preview(w, U.alex, {
    agencyId: ARC,
    budgetId: B.arcTeam,
    type: 'work',
    amount: cents(perPaymentCap(team, alexTeam) + usd(1)),
    category: 'team',
    purpose: 'Design sprint',
    idempotencyKey: 'smoke-j-over-cap',
  })
  t.check(
    "J: the engine refuses Alex's request above his cap, naming the same number",
    overCap.outcome === 'rejected' &&
      overCap.reason?.rule === 'per_operation_limit' &&
      Boolean(overCap.reason.message.includes(usdText(perPaymentCap(team, alexTeam)))),
    `${overCap.outcome}: ${overCap.reason?.message}`,
  )

  // Verified details hide a simulated record's stand-in account, transaction, block and receipt
  // hash, so every record the seed carries must say it is simulated.
  const seededRecords = [
    ...w.state.receipts.map((r) => [r.id, r.verified] as const),
    ...w.state.payments.map((p) => [p.id, p.proofVerified] as const),
    ...w.state.requests.map((r) => [r.id, r.ledger] as const),
    ...w.state.tranches.map((tr) => [tr.id, tr.requestVerified] as const),
    ...w.state.milestones.map((m) => [m.id, m.submissionVerified] as const),
    ...w.state.schedules.flatMap((s) => [[s.id, s.ledger] as const, [s.id, s.changeLedger] as const]),
  ].filter(([, details]) => details !== undefined)
  const notSimulated = seededRecords.filter(([, details]) => details?.simulated !== true)
  t.check(
    'J: every seeded record with verified details is flagged simulated',
    seededRecords.length > 0 && notSimulated.length === 0,
    notSimulated.map(([id]) => id).join(', '),
  )

  // The seed is built the way the engine would have built it.
  const completed = w.state.requests.filter((r) => r.paymentId)
  const wrongDestination = w.state.requests.filter((r) =>
    paysRequester(r.type)
      ? !(
          r.destination.kind === 'member' &&
          r.requester.kind === 'user' &&
          r.destination.userId === r.requester.userId
        )
      : r.destination.kind !== 'destination',
  )
  t.check(
    'J: seeded requests pay the requester or a vendor, by type',
    wrongDestination.length === 0,
    wrongDestination.map((r) => r.id).join(', '),
  )
  const wrongType = completed.filter(
    (r) => w.state.payments.find((p) => p.id === r.paymentId)?.type !== paymentTypeOf(r),
  )
  t.check(
    'J: seeded payments have the type the engine gives them',
    completed.length > 0 && wrongType.length === 0,
    wrongType.map((r) => r.id).join(', '),
  )
  const documenting = new Set(
    completed
      .filter((r) => r.type === 'vendor_payment' || r.type === 'reimbursement')
      .map((r) => r.paymentId),
  )
  // Receipts added later to money for purchases (addExpense) are not created when it is paid.
  const advanceIds = new Set(w.state.payments.filter((p) => p.type === 'advance').map((p) => p.id))
  const strayExpenses = w.state.expenses.filter(
    (e) =>
      e.paymentId &&
      completed.some((r) => r.paymentId === e.paymentId) &&
      !documenting.has(e.paymentId) &&
      !(advanceIds.has(e.paymentId) && e.receipt?.kind === 'file'),
  )
  t.check(
    'J: seeded expenses only document vendor payments and reimbursements (or justify money for purchases)',
    strayExpenses.length === 0,
    strayExpenses.map((e) => e.id).join(', '),
  )

  // What the API refuses because the engine's input types are narrow.
  const payment = {
    agencyId: ARC,
    type: 'vendor',
    recipient: { kind: 'destination', destinationId: D.vertex },
    accountId: ACC.arcOperations,
    amount: usd(5),
    category: 'cloud',
    memo: 'Hosting',
  }
  w.refuseRaw(
    U.maya,
    'sendPayment',
    { ...payment, type: 'advance' },
    'schema',
    'J sendPayment cannot make money for purchases',
  )
  w.refuseRaw(
    U.maya,
    'sendPayment',
    { ...payment, recipient: { kind: 'address', payee: 'Linear', address: TOOL } },
    'schema',
    'J sendPayment cannot pay an address (that is payOutside, with its own rules)',
  )
  w.refuse(
    U.sofia,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTravel,
      type: 'reimbursement',
      amount: usd(10),
      category: 'travel',
      purpose: 'Taxi',
      merchant: 'M'.repeat(81),
      attachments: [file('j-taxi.pdf')],
      idempotencyKey: 'smoke-j-merchant',
    },
    'schema',
    'J a merchant longer than 80 characters (request)',
  )
  await w.fund(U.maya, B.arcTools, usd(20))
  const advance = await w.run(
    U.alex,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,

      type: 'funds',
      amount: usd(20),
      category: 'software',
      purpose: 'Adapters',
      idempotencyKey: 'smoke-j-funds',
    },
    'J setup: Alex asks for money for purchases',
    { ops: ['requestPayment'] },
  )
  w.refuse(
    U.alex,
    'addExpense',
    {
      agencyId: ARC,
      paymentId: must(advance.result.paymentId, 'the advance'),
      merchant: 'M'.repeat(81),
      amount: usd(5),
      category: 'software',
      spentAt: dayBefore(w.now),
      receipt: file('j-receipt.pdf'),
    },
    'validation',
    'J a merchant longer than 80 characters (receipt)',
  )
  seededReferences(t)
}

/**
 * The seeded providers' payment references read as references, and a world saved with the
 * labels the seed used before (a card, an account) is relabelled on read: exact seeded values
 * only, once.
 */
function seededReferences(t: Checker) {
  const seed = new World(t, 'engine-j-references').state
  const references = seed.destinations.map((d) => d.settlementLabel)
  t.check(
    'J: every seeded provider has a customer number as its payment reference',
    references.length === 11 && references.every((r) => /^Customer no\. \w{4}$/.test(r)),
    references.join(', '),
  )
  t.check(
    'J: the upgrade leaves the seeded references as they are',
    JSON.stringify(upgradeState(structuredClone(seed)).destinations) === JSON.stringify(seed.destinations),
  )

  const relabel = (labels: Partial<Record<keyof typeof D, string>>) => {
    const world = structuredClone(seed)
    for (const [key, label] of Object.entries(labels) as [keyof typeof D, string][]) {
      const id = D[key]
      must(
        world.destinations.find((d) => d.id === id),
        id,
      ).settlementLabel = label
    }
    return world
  }
  // The labels every seeded provider had before.
  const legacy = relabel({
    vertex: 'USDC account •• 4821',
    canvasly: 'Card on file •• 1107',
    tasklane: 'Card on file •• 1107',
    pagecraft: 'Card on file •• 1107',
    pulse: 'USDC account •• 9f3a',
    northwind: 'USDC account •• 7730',
    atlas: 'USDC account •• 2204',
    harbor: 'USDC account •• 5518',
    stratus: 'USDC account •• 3190',
    codepath: 'Card on file •• 6612',
    sentinel: 'USDC account •• 8045',
  })
  const upgraded = upgradeState(structuredClone(legacy))
  t.check(
    'J: a world saved with the old seeded labels reads with the new references',
    JSON.stringify(upgraded.destinations) === JSON.stringify(seed.destinations),
    upgraded.destinations.map((d) => d.settlementLabel).join(', '),
  )
  const twice = upgradeState(structuredClone(upgraded))
  t.check(
    'J: upgrading the references again changes nothing',
    JSON.stringify(twice) === JSON.stringify(upgraded),
  )

  // What an Admin typed, even close to a seeded label, is not a seeded value.
  const typed = relabel({
    vertex: 'Card on file •• 9999',
    canvasly: 'card on file •• 1107',
    tasklane: 'Card on file •• 1107 (team card)',
    pagecraft: 'USDC account 4821',
    pulse: 'constructor',
    northwind: '',
  })
  const kept = upgradeState(structuredClone(typed))
  t.check(
    'J: only exact seeded values are relabelled; anything else an Admin typed stays',
    JSON.stringify(kept.destinations) === JSON.stringify(typed.destinations),
    kept.destinations.map((d) => d.settlementLabel).join(', '),
  )
}

// ─── K. Review fixes ─────────────────────────────────────────────────────────

/**
 * K1. The request form decides on what the Member sees (no agreements), and still reaches the
 * server's decision around the exception threshold: their Agency carries the threshold.
 */
async function memberPreview(t: Checker) {
  const w = new World(t, 'engine-k1')
  const tools = budgetOf(w.state, B.arcTools)
  const room = Math.min(
    allowanceLeft(w, B.arcTools, U.daniel),
    tools.approvalThreshold,
    tools.perOperationLimit,
  )
  // Three requests below must fit what Daniel may still ask: at the threshold, and twice just above it.
  const threshold = usd(Math.floor(room / 400))
  if (threshold < usd(5)) throw new Error(`Daniel has only ${room} cents left on Tools this month`)
  // (No command changes a threshold yet: the Investor's change is written into the state here, as in C8.)
  must(governingAgreement(w.state, ARC), "Arc's agreement").spendingPolicy.exceptionThreshold = threshold

  const danielView = w.view(U.daniel)
  t.check('K1: Daniel sees no agreement', danielView.agreements.length === 0)
  t.check(
    'K1: …yet his Agency carries the exception threshold that governs it',
    danielView.agencies.find((a) => a.id === ARC)?.exceptionThreshold === threshold,
    JSON.stringify(danielView.agencies.find((a) => a.id === ARC)?.exceptionThreshold),
  )
  t.check(
    'K1: the full state, Admins and Investors read it from the agreement only',
    [w.state, w.view(U.maya), w.view(U.elena)].every((state) =>
      state.agencies.every((a) => a.exceptionThreshold === undefined),
    ),
  )

  // H5: a Member's Settings name the agreement that funds their Agency and how many people are in
  // it, from what their Agency carries; never the agreement's terms, nor who is in the team.
  const arcTeam = w.state.memberships.filter(
    (m) => m.status === 'active' && m.scope.kind === 'agency' && m.scope.agencyId === ARC,
  ).length
  const danielArc = danielView.agencies.find((a) => a.id === ARC)
  t.check(
    "K1: Daniel's Agency carries the title and status of the agreement that funds it, and its headcount",
    danielArc?.fundingAgreement?.title === agencyFundingAgreement(w.state, ARC)?.title &&
      agencyFundingAgreement(w.state, ARC)?.id === governingAgreement(w.state, ARC)?.id &&
      danielArc?.fundingAgreement?.status === 'active' &&
      danielArc?.teamSize === arcTeam &&
      arcTeam > 1,
    JSON.stringify({ agreement: danielArc?.fundingAgreement, team: danielArc?.teamSize, arcTeam }),
  )
  t.check(
    'K1: the full state, Admins and Investors carry neither',
    [w.state, w.view(U.maya), w.view(U.elena)].every((state) =>
      state.agencies.every((a) => a.fundingAgreement === undefined && a.teamSize === undefined),
    ),
  )
  t.check(
    "K1: a Member's Settings show the same agreement and team as an Admin's",
    JSON.stringify(agencyAgreementSummary(w.view(U.alex), ARC)) ===
      JSON.stringify(agencyAgreementSummary(w.view(U.maya), ARC)) &&
      agencyTeamSize(w.view(U.alex), ARC) === agencyTeamSize(w.view(U.maya), ARC),
    JSON.stringify({
      alex: [agencyAgreementSummary(w.view(U.alex), ARC), agencyTeamSize(w.view(U.alex), ARC)],
      maya: [agencyAgreementSummary(w.view(U.maya), ARC), agencyTeamSize(w.view(U.maya), ARC)],
    }),
  )

  const ask = (type: RequestType, amount: Cents, key: string): RequestPaymentInput => ({
    agencyId: ARC,
    budgetId: B.arcTools,
    type,
    amount,
    category: 'software',
    purpose: type === 'work' ? 'Tooling migration' : 'Test devices',
    ...(type === 'work' ? { attachments: [file(`k1-${key}.pdf`)] } : {}),
    idempotencyKey: `smoke-k1-${key}`,
  })
  const above = cents(threshold + usd(1))
  await w.fund(U.maya, B.arcTools, cents(above + threshold))
  const cases: {
    label: string
    input: RequestPaymentInput
    outcome: PolicyDecision['outcome']
    rule?: string
    expect: Expect
  }[] = [
    {
      label: 'K1 payment for work just above the threshold',
      input: ask('work', above, 'work-above'),
      outcome: 'rejected',
      rule: 'exception_threshold',
      expect: { ops: [], settle: 'failed', error: 'policy_rejected', keep: true },
    },
    {
      label: 'K1 money for purchases just above the threshold',
      input: ask('funds', above, 'funds-above'),
      outcome: 'needs_approval',
      rule: 'exception_threshold',
      expect: { ops: ['requestPayment'] },
    },
    {
      label: 'K1 payment for work at the threshold',
      input: ask('work', threshold, 'work-at'),
      outcome: 'needs_approval',
      rule: 'work_review',
      expect: { ops: [] },
    },
    {
      label: 'K1 money for purchases at the threshold',
      input: ask('funds', threshold, 'funds-at'),
      outcome: 'approved',
      expect: { ops: ['requestPayment'] },
    },
  ]
  const sent = new Map<string, PaymentRequest>()
  for (const c of cases) {
    const previewed = preview(w, U.daniel, c.input)
    const step = await w.run(U.daniel, 'requestPayment', c.input, c.label, c.expect)
    const { decision } = step.result
    samePreview(t, c.label, previewed, decision)
    t.check(
      `${c.label}: ${c.outcome}${c.rule ? ` (${c.rule})` : ''}`,
      decision.outcome === c.outcome && (c.rule === undefined || decision.reason?.rule === c.rule),
      `${decision.outcome}/${decision.reason?.rule}`,
    )
    sent.set(c.input.idempotencyKey, step.result)
  }
  const fundsAbove = must(sent.get('smoke-k1-funds-above'), 'the request above the threshold')
  const workAt = must(sent.get('smoke-k1-work-at'), 'the work at the threshold')
  t.check(
    "K1: on Daniel's own view the money above the threshold is the Investor's to decide",
    isException(w.view(U.daniel), fundsAbove),
  )
  t.check("K1: …and his payment for work is still the Agency Admins'", !isException(w.view(U.daniel), workAt))
}

/**
 * K2. A receipt justifies money once per Agency (an advance, a reimbursement, a vendor expense),
 * and a receipt dated before the money was requested does not justify it.
 */
async function receiptsUsedOnce(t: Checker) {
  const w = new World(t, 'engine-k2')
  const tools = budgetOf(w.state, B.arcTools)
  const left = allowanceLeft(w, B.arcTools, U.daniel)
  if (left < usd(120)) throw new Error(`Daniel has only ${left} cents left on Tools this month`)
  await w.fund(U.maya, B.arcTools, usd(120))
  const funds = await w.run(
    U.daniel,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'funds',
      amount: usd(60),
      category: 'software',
      purpose: 'Workshop supplies',
      idempotencyKey: 'smoke-k2-funds',
    },
    'K2 Daniel gets money for purchases',
    { ops: ['requestPayment'] },
  )
  const advanceId = must(funds.result.paymentId, 'the advance')
  const shared = file('k2-shared-receipt.pdf')
  const adapter: RequestPaymentInput = {
    agencyId: ARC,
    budgetId: B.arcTools,
    type: 'reimbursement',
    amount: usd(20),
    category: 'software',
    purpose: 'USB-C adapter',
    merchant: 'Corner shop',
    spentAt: dayBefore(w.now, 1),
    attachments: [shared],
    idempotencyKey: 'smoke-k2-reimbursement',
  }
  const paidBack = await w.run(U.daniel, 'requestPayment', adapter, 'K2 Daniel is paid back for an adapter', {
    ops: ['requestPayment'],
  })
  const retry = await w.run(
    U.daniel,
    'requestPayment',
    adapter,
    'K2 the same reimbursement sent again with its key',
    { ops: [] },
  )
  t.check(
    'K2: a retry with the same key returns the first request (its receipt is not "already used")',
    retry.result.id === paidBack.result.id,
  )

  const receipt = (name: string, amount: Cents): CommandInput<'addExpense'> => ({
    agencyId: ARC,
    paymentId: advanceId,
    merchant: 'Hardware store',
    amount,
    category: 'software',
    spentAt: dayBefore(w.now),
    receipt: file(name),
  })
  const reused = w.refuse(
    U.daniel,
    'addExpense',
    { ...receipt('unused.pdf', usd(20)), receipt: shared },
    'validation',
    "K2 the reimbursement's receipt also justifies the advance",
  )
  t.check(
    "K2: it says 'This file was already used as a receipt or invoice.'",
    reused === 'This file was already used as a receipt or invoice.',
    reused,
  )
  const backdated = w.refuse(
    U.daniel,
    'addExpense',
    { ...receipt('k2-old-purchase.pdf', usd(10)), spentAt: dayBefore(w.now, 1) },
    'validation',
    'K2 a receipt dated the day before the money was requested',
  )
  t.check(
    "K2: it says 'The receipt is dated before you requested this money.'",
    backdated === 'The receipt is dated before you requested this money.',
    backdated,
  )
  await w.run(
    U.daniel,
    'addExpense',
    receipt('k2-own.pdf', usd(15)),
    'K2 a receipt of its own, dated today',
    {
      ops: [],
    },
  )
  const twice = w.refuse(
    U.daniel,
    'addExpense',
    receipt('k2-own.pdf', usd(5)),
    'validation',
    'K2 the same receipt on the advance twice',
  )
  t.check(
    'K2: refused as already used',
    twice === 'This file was already used as a receipt or invoice.',
    twice,
  )
  w.refuse(
    U.daniel,
    'requestPayment',
    { ...adapter, attachments: [file('k2-own.pdf')], idempotencyKey: 'smoke-k2-reimburse-own' },
    'validation',
    'K2 a receipt that justifies an advance, reimbursed',
  )
  w.refuse(
    U.priya,
    'requestPayment',
    { ...adapter, attachments: [shared], idempotencyKey: 'smoke-k2-priya' },
    'validation',
    "K2 Priya reimbursed with Daniel's receipt",
  )

  // A file attached to a request still in play is taken; once the request is cancelled it is free.
  const work = await w.run(
    U.daniel,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'work',
      amount: usd(10),
      category: 'software',
      purpose: 'Setup help',
      attachments: [file('k2-invoice.pdf')],
      idempotencyKey: 'smoke-k2-work',
    },
    'K2 Daniel asks to be paid for work, with an invoice',
    { ops: [] },
  )
  w.refuse(
    U.daniel,
    'addExpense',
    receipt('k2-invoice.pdf', usd(5)),
    'validation',
    'K2 a file attached to a request still waiting',
  )
  await w.run(U.daniel, 'cancelRequest', { requestId: work.result.id }, 'K2 Daniel cancels that request', {
    ops: [],
  })
  await w.run(
    U.daniel,
    'addExpense',
    receipt('k2-invoice.pdf', usd(5)),
    'K2 the file of a cancelled request justifies the advance',
    { ops: [] },
  )

  // A vendor payment's expense takes its receipt later: a used one is refused there too.
  const vendor = must(
    w.state.destinations.find((d) => d.id === tools.allowedDestinationIds[0]),
    'a Tools vendor',
  )
  const vendorCategory = tools.allowedCategories.includes(vendor.category) ? vendor.category : 'software'
  const bought = await w.run(
    U.daniel,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'vendor_payment',
      destinationId: vendor.id,
      amount: usd(12),
      category: vendorCategory,
      purpose: 'Icon pack',
      idempotencyKey: 'smoke-k2-vendor',
    },
    `K2 Daniel pays ${vendor.name}`,
    { ops: ['requestPayment'] },
  )
  const vendorExpense = must(
    w.state.expenses.find((e) => e.paymentId === bought.result.paymentId),
    'the vendor expense',
  )
  t.check('K2: the vendor expense waits for its receipt', !vendorExpense.receipt)
  w.refuse(
    U.daniel,
    'attachReceipt',
    { expenseId: vendorExpense.id, receipt: shared },
    'validation',
    'K2 a used receipt attached to the vendor expense',
  )
  await w.run(
    U.daniel,
    'attachReceipt',
    { expenseId: vendorExpense.id, receipt: file('k2-icon-pack.pdf') },
    'K2 the vendor expense gets its own receipt',
    { ops: [] },
  )
  t.check(
    'K2: what the advance still waits for counts only the receipts it took',
    advanceStanding(
      w.state,
      must(
        w.state.payments.find((p) => p.id === advanceId),
        'the advance',
      ),
      w.now,
    ).pending === usd(60 - 15 - 5),
  )

  // Every request's files back the money it asks for: a used receipt is refused on every type.
  const withUsedReceipt = (type: RequestType, extra: Partial<RequestPaymentInput> = {}) =>
    w.refuse(
      U.daniel,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTools,
        type,
        amount: usd(5),
        category: 'software',
        purpose: 'Something a receipt already justifies',
        attachments: [file('k2-own.pdf')],
        idempotencyKey: `smoke-k2-used-${type}`,
        ...extra,
      },
      'validation',
      `K2 ${requestTypeLabel[type]} with a receipt that justifies an advance`,
    )
  const usedByVendor = withUsedReceipt('vendor_payment', {
    destinationId: vendor.id,
    category: vendorCategory,
  })
  t.check(
    "K2: the vendor payment hears 'This file was already used as a receipt or invoice.'",
    usedByVendor === 'This file was already used as a receipt or invoice.',
    usedByVendor,
  )
  const usedByWork = withUsedReceipt('work')
  t.check(
    'K2: …and so does the payment for work',
    usedByWork === 'This file was already used as a receipt or invoice.',
    usedByWork,
  )
  const usedByFunds = withUsedReceipt('funds')
  t.check(
    'K2: …and so does the money for purchases',
    usedByFunds === 'This file was already used as a receipt or invoice.',
    usedByFunds,
  )

  // A file attached when requesting money for purchases (a quote) may justify that same money, and only it.
  const quote = file('k2-quote.pdf')
  const quoted = await w.run(
    U.daniel,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'funds',
      amount: usd(8),
      category: 'software',
      purpose: 'Cable ties, as quoted',
      attachments: [quote],
      idempotencyKey: 'smoke-k2-quoted',
    },
    'K2 Daniel gets money for purchases with a quote attached',
    { ops: ['requestPayment'] },
  )
  const quotedAdvance = must(
    w.state.payments.find((p) => p.id === quoted.result.paymentId),
    'the quoted money for purchases',
  )
  const elsewhere = w.refuse(
    U.daniel,
    'addExpense',
    { ...receipt('unused.pdf', usd(5)), receipt: quote },
    'validation',
    'K2 that quote on his other money for purchases',
  )
  t.check(
    'K2: …refused as already used',
    elsewhere === 'This file was already used as a receipt or invoice.',
    elsewhere,
  )
  await w.run(
    U.daniel,
    'addExpense',
    { ...receipt('unused.pdf', usd(8)), paymentId: quotedAdvance.id, receipt: quote },
    'K2 the quote justifies the money it was attached to',
    { ops: [] },
  )
  t.check('K2: …which it settles', advanceStanding(w.state, quotedAdvance, w.now).settled)

  // An outside payment's invoice is used too, sent with the payment or added later.
  await w.gather(U.maya, ACC.arcReserve, usd(20))
  const outside = (memo: string, proof?: EvidenceDraft): CommandInput<'payOutside'> => ({
    agencyId: ARC,
    source: { kind: 'account', accountId: ACC.arcReserve },
    to: TOOL.toLowerCase(),
    payee: 'Linear',
    amount: usd(10),
    category: 'software',
    memo,
    ...(proof ? { proof } : {}),
  })
  await w.run(
    U.maya,
    'payOutside',
    outside('Linear, October', file('k2-linear-october.pdf')),
    'K2 Maya pays Linear outside Viatik, with its invoice',
    { ops: ['payOutside'] },
  )
  const invoiceLater = await w.run(
    U.maya,
    'payOutside',
    outside('Linear, November'),
    'K2 Maya pays Linear outside Viatik, invoice to follow',
    { ops: ['payOutside'] },
  )
  await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: invoiceLater.result.id, proof: file('k2-linear-november.pdf') },
    'K2 Maya adds that invoice',
    { ops: ['recordEvidence'] },
  )
  for (const [name, when] of [
    ['k2-linear-october.pdf', 'sent with the payment'],
    ['k2-linear-november.pdf', 'added later'],
  ] as const) {
    const message = w.refuse(
      U.daniel,
      'addExpense',
      receipt(name, usd(5)),
      'validation',
      `K2 an outside payment's invoice (${when}) as Daniel's receipt`,
    )
    t.check(
      `K2: …refused as already used (${when})`,
      message === 'This file was already used as a receipt or invoice.',
      message,
    )
  }
  w.refuse(
    U.daniel,
    'requestPayment',
    { ...adapter, attachments: [file('k2-linear-october.pdf')], idempotencyKey: 'smoke-k2-linear' },
    'validation',
    "K2 an outside payment's invoice reimbursed",
  )

  // Bills and outside payments take part too: a bill's invoice is used once, and an invoice cannot
  // be a file someone already used.
  const vertexBill = await w.run(
    U.maya,
    'addBill',
    {
      agencyId: ARC,
      destinationId: D.vertex,
      number: 'K2-001',
      issueDate: dayBefore(w.now, 2),
      dueDate: dayBefore(w.now, -10),
      amount: usd(12),
      category: 'cloud',
      accountId: ACC.arcOperations,
      document: file('k2-vertex-bill.pdf'),
    },
    'K2 Maya adds a Vertex Cloud bill with its invoice',
    { ops: [] },
  )
  t.check('K2: the bill is stored', vertexBill.result.document.name === 'k2-vertex-bill.pdf')
  const billReimbursed = w.refuse(
    U.daniel,
    'requestPayment',
    { ...adapter, attachments: [file('k2-vertex-bill.pdf')], idempotencyKey: 'smoke-k2-vertex-bill' },
    'validation',
    "K2 a bill's invoice reimbursed to Daniel",
  )
  t.check(
    "K2: …refused as already used (a bill's invoice)",
    billReimbursed === 'This file was already used as a receipt or invoice.',
    billReimbursed,
  )
  w.refuse(
    U.maya,
    'addBill',
    {
      agencyId: ARC,
      destinationId: D.vertex,
      number: 'K2-002',
      issueDate: dayBefore(w.now, 2),
      dueDate: dayBefore(w.now, -10),
      amount: usd(12),
      category: 'cloud',
      accountId: ACC.arcOperations,
      document: file('k2-linear-october.pdf'),
    },
    'validation',
    "K2 an outside payment's invoice used again as a bill",
  )
  w.refuse(
    U.maya,
    'payOutside',
    outside('Vertex again', file('k2-vertex-bill.pdf')),
    'validation',
    "K2 a bill's invoice used again as an outside payment's invoice",
  )
  const noInvoiceYet = await w.run(
    U.maya,
    'payOutside',
    outside('Linear, December'),
    'K2 Maya pays Linear outside Viatik again, invoice to follow',
    { ops: ['payOutside'] },
  )
  const billAsProof = w.refuse(
    U.maya,
    'addPaymentProof',
    { paymentId: noInvoiceYet.result.id, proof: file('k2-vertex-bill.pdf') },
    'validation',
    "K2 a bill's invoice added later to an outside payment",
  )
  t.check(
    "K2: …refused as already used (a bill's invoice as a later invoice)",
    billAsProof === 'This file was already used as a receipt or invoice.',
    billAsProof,
  )
}

/**
 * K3. Payment for work is paid under an id taken from its request: two Agency Admins preparing
 * the approval plan the same `pay`, and the server's conflict keys (src/server/conflicts.ts) see
 * every command that touches it while one is waiting to be signed.
 */
async function workPaidOnce(t: Checker) {
  const w = new World(t, 'engine-k3')
  await w.fund(U.maya, B.arcTools, usd(40))
  const asked = await w.run(
    U.daniel,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'work',
      amount: usd(40),
      category: 'software',
      purpose: 'Laptop setup for new hires',
      attachments: [file('k3-work.pdf')],
      idempotencyKey: 'smoke-k3-work',
    },
    'K3 Daniel asks to be paid for work',
    { ops: [] },
  )
  const request = asked.result
  const payId = workPaymentId(request.id)

  const maya = prepare(w, U.maya, 'approveRequest', { requestId: request.id })
  const jordan = prepare(w, U.jordan, 'approveRequest', { requestId: request.id })
  const mayaPay = maya.plan?.ops[0]
  t.check(
    "K3: Maya's approval pays under the request's own payment id",
    mayaPay?.call === 'pay' && mayaPay.paymentId === payId && payId === `pay_${request.id}`,
    JSON.stringify(mayaPay),
  )
  checkSame(t, 'K3: Jordan, preparing it too, plans the very same `pay`', jordan.plan?.ops, maya.plan?.ops)
  t.check('K3: the id passes the API id rules', isApiId(payId), payId)

  // The server's guard, on Maya's approval waiting to be signed.
  const open = maya.open()
  t.check(
    "K3: the server sees Jordan's approval touch Maya's open one",
    sharesAny(jordan.held, open) && jordan.held.has(`payment:${payId}`),
    [...jordan.held].join(', '),
  )
  const declined = prepare(w, U.jordan, 'declineRequest', {
    requestId: request.id,
    reason: 'Paid in payroll',
  })
  t.check('K3: …and a decline of it, saved at once', sharesAny(declined.held, open))
  const cancelled = prepare(w, U.daniel, 'cancelRequest', { requestId: request.id })
  t.check('K3: …and Daniel cancelling it', sharesAny(cancelled.held, open))
  const allowance = must(
    w.state.allowances.find(
      (a) =>
        a.budgetId === B.arcTools &&
        a.status === 'active' &&
        a.holder.kind === 'member' &&
        a.holder.userId === U.daniel,
    ),
    "Daniel's Tools allowance",
  )
  const revoked = prepare(w, U.maya, 'revokeAllowance', { allowanceId: allowance.id })
  t.check(
    "K3: …and revoking Daniel's spending access, which cancels it",
    revoked.out.state.requests.find((r) => r.id === request.id)?.status === 'cancelled' &&
      sharesAny(revoked.held, open),
  )
  await w.fund(U.maya, B.arcTools, usd(15))
  const unrelated = prepare(w, U.alex, 'requestPayment', {
    agencyId: ARC,
    budgetId: B.arcTools,
    type: 'funds',
    amount: usd(15),
    category: 'software',
    purpose: 'Cables',
    idempotencyKey: 'smoke-k3-unrelated',
  })
  t.check("K3: …but not Alex's own request", !sharesAny(unrelated.held, open))

  const paid = await w.run(U.maya, 'approveRequest', { requestId: request.id }, "K3 Maya's approval lands", {
    ops: ['pay'],
  })
  t.check('K3: the payment carries that id', paid.result.payment.id === payId)
  const late = simulateLedger(must(jordan.plan, "Jordan's plan"), w.state, w.now)
  t.check(
    "K3: Jordan's identical `pay`, landing after it, is refused by the demo ledger",
    late.status === 'reverted' && late.error.code === 'already_processed',
    late.status === 'reverted' ? `${late.error.code}: ${late.error.message}` : late.status,
  )
  w.refuse(
    U.jordan,
    'approveRequest',
    { requestId: request.id },
    'invalid_state',
    'K3 Jordan approves it once it is paid',
  )
}

/**
 * K4. A return says which money it gives back. Against money for purchases (`paymentId`) it
 * settles that money, up to what is still pending and still in the Viatik balance, as before.
 * Without one it is "Other money": it settles nothing, and gives back at most what the Viatik
 * balance holds beyond what the person's open money for purchases still has pending. Nothing is
 * linked automatically. While other money waits to be signed, the server holds the person's
 * balance (a withdrawal landing first would lower the cap below what the ledger checks).
 */
async function returnsSayWhichMoney(t: Checker) {
  const w = new World(t, 'engine-k4')
  const left = allowanceLeft(w, B.arcTools, U.alex)
  if (left < usd(70)) throw new Error(`Alex has only ${left} cents left on Tools this month`)
  await w.fund(U.maya, B.arcTools, usd(70))
  const ask = (amount: Cents, key: string, purpose: string) =>
    w.run(
      U.alex,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTools,
        type: 'funds',
        amount,
        category: 'software',
        purpose,
        idempotencyKey: `smoke-k4-${key}`,
      },
      `K4 Alex gets money for purchases: ${purpose}`,
      { ops: ['requestPayment'] },
    )
  await ask(usd(40), 'older', 'A conference badge')
  w.later(1)
  await ask(usd(30), 'newer', 'A USB hub')
  const alex = { agencyId: ARC, userId: U.alex }
  const openOf = () => advancesOf(w.state, alex, w.now).filter((s) => s.pending > 0)
  const pendingOf = () => new Map(openOf().map((s) => [s.payment.id, s.pending]))
  const pendingTotal = () => sum(openOf(), (s) => s.pending)
  const otherMoney = () => otherMoneyReturnable(w.state, alex, w.now)
  const newer = must(openOf()[0], "Alex's newest money for purchases").payment
  const older = must(openOf().at(-1), "Alex's oldest money for purchases").payment

  // Other money: the Viatik balance beyond what his money for purchases still has pending.
  const cap = otherMoney()
  t.check(
    'K4: other money is what his Viatik balance holds beyond what his money for purchases has pending',
    newer.id !== older.id && cap === clampToZero(cents(memberHeld(w.state, ARC, U.alex) - pendingTotal())),
    `${cap} of ${memberHeld(w.state, ARC, U.alex)} held, ${pendingTotal()} pending`,
  )
  t.check('K4: …the same on what Alex sees', otherMoneyReturnable(w.view(U.alex), alex, w.now) === cap)
  if (cap < usd(10)) throw new Error(`Alex holds only ${cap} cents beyond his money for purchases`)
  const above = w.refuse(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: cents(cap + 1) },
    'limit_exceeded',
    'K4 Alex returns a cent more than his other money',
  )
  t.check(
    'K4: it says to return it against his money for purchases first',
    above ===
      `Return it against your money for purchases first. You can return up to ${usdText(cap)} as other money.`,
    above,
  )

  // While other money waits to be signed, the server holds his Viatik balance, not his money for purchases.
  const otherReturn = prepare(w, U.alex, 'returnUnusedFunds', { agencyId: ARC, amount: usd(5) })
  const open = otherReturn.open()
  const balanceKey = `balance:${ARC}:${U.alex}`
  t.check(
    "K4: while other money waits, the server holds Alex's Viatik balance in Arc",
    open.has(balanceKey),
    [...open].join(', '),
  )
  t.check(
    'K4: …and none of his money for purchases',
    openOf().every((s) => !open.has(`payment:${s.payment.id}`)),
  )
  const withdrawal = prepare(w, U.alex, 'withdrawBalance', { agencyId: ARC, amount: usd(5), to: WALLET })
  t.check('K4: …so a withdrawal of his waits for it', sharesAny(withdrawal.held, open))
  t.check(
    'K4: …and other money waits for a withdrawal of his',
    sharesAny(otherReturn.held, withdrawal.open()),
  )
  const more = prepare(w, U.alex, 'returnUnusedFunds', { agencyId: ARC, amount: usd(3) })
  t.check('K4: …and so does more other money', sharesAny(more.held, open))
  const receipt = prepare(w, U.alex, 'addExpense', {
    agencyId: ARC,
    paymentId: newer.id,
    merchant: 'Electronics shop',
    amount: usd(5),
    category: 'software',
    spentAt: dayBefore(w.now),
    receipt: file('k4-hub.pdf'),
  })
  t.check(
    'K4: a receipt on his money for purchases does not wait (it only raises the cap)',
    !sharesAny(receipt.held, open),
  )
  const rest = prepare(w, U.alex, 'returnUnusedFunds', {
    agencyId: ARC,
    amount: usd(5),
    paymentId: newer.id,
  })
  t.check(
    'K4: nor does returning the rest of it (his balance and its pending go down alike)',
    !sharesAny(rest.held, open) && !sharesAny(otherReturn.held, rest.open()),
  )
  const priyaWithdrawal = prepare(w, U.priya, 'withdrawBalance', {
    agencyId: ARC,
    amount: usd(5),
    to: WALLET,
  })
  t.check("K4: nor Priya's withdrawal", !sharesAny(priyaWithdrawal.held, open))

  // Why: a withdrawal landing first lowers the cap, and the ledger, which only checks the balance,
  // would still take the return the engine then refuses (its confirmation would not fit).
  await w.run(
    U.alex,
    'withdrawBalance',
    { agencyId: ARC, amount: cents(cap - usd(4)), to: WALLET },
    'K4 Alex withdraws all but 4.00 of his other money',
    { ops: ['withdrawMemberBalance'] },
  )
  t.check('K4: 4.00 of other money is left', otherMoney() === usd(4), `${otherMoney()}`)
  const landed = simulateLedger(must(otherReturn.plan, 'the plan of the other money'), w.state, w.now)
  t.check(
    'K4: the ledger alone would still take the 5.00 prepared before (why the server holds the balance)',
    landed.status === 'completed',
    landed.status === 'reverted' ? `${landed.error.code}: ${landed.error.message}` : landed.status,
  )
  w.refuse(
    U.alex,
    'returnUnusedFunds',
    otherReturn.input,
    'limit_exceeded',
    'K4 the same 5.00 of other money, run again once the withdrawal landed',
  )

  // Against money for purchases, as before: it settles that one, and other money stays as it was.
  const newerCap = returnableFor(w.state, advanceStanding(w.state, newer, w.now))
  const tooMuch = w.refuse(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: cents(newerCap + 1), paymentId: newer.id },
    'limit_exceeded',
    'K4 Alex returns more than his USB hub money has pending',
  )
  t.check(
    'K4: …up to what it has pending',
    tooMuch === `You can return up to ${usdText(newerCap)} of this money.`,
    tooMuch,
  )
  const otherBefore = otherMoney()
  const pendingBefore = pendingOf()
  const back = usd(10)
  const input: CommandInput<'returnUnusedFunds'> = { agencyId: ARC, amount: back, paymentId: newer.id }
  const k4 = await w.run(U.alex, 'returnUnusedFunds', input, 'K4 Alex returns 10.00 of his USB hub money', {
    ops: ['returnToAgency'],
  })
  t.check(
    'K4: the return settles that money',
    k4.movements.length === 1 && k4.movements[0]?.settlesPaymentId === newer.id,
    k4.movements.map((m) => m.settlesPaymentId).join(', '),
  )
  t.check(
    "K4: …whose pending goes down by what came back, and the other's does not",
    [...pendingOf()].every(
      ([id, pending]) => pending === (pendingBefore.get(id) ?? 0) - (id === newer.id ? back : 0),
    ),
  )
  t.check(
    'K4: the receipt says which money came back',
    k4.receipts[0]?.description === `Unused money returned · ${newer.memo}`,
    k4.receipts[0]?.description,
  )
  t.check(
    'K4: logged as unused money returned',
    k4.activity.some((a) => a.type === 'advance_returned'),
  )
  checkSame(t, "K4: the Agency Admins hear 'Unused money returned'", notifiedUsers(k4), ADMINS)
  t.check(
    'K4: …with that title',
    k4.notifications.every((n) => n.title === 'Unused money returned'),
  )
  const settledHeld = heldByCommand('returnUnusedFunds', input, k4.plan, k4.before, k4.after)
  t.check(
    'K4: the server sees the money it settles in what it changed, and not his balance',
    settledHeld.has(`payment:${newer.id}`) && !settledHeld.has(balanceKey),
    [...settledHeld].join(', '),
  )
  t.check('K4: other money stays as it was', otherMoney() === otherBefore, `${otherMoney()}`)

  // Other money, up to all of it: a plain return, settling nothing.
  const pendingBeforePlain = pendingOf()
  const plainInput: CommandInput<'returnUnusedFunds'> = { agencyId: ARC, amount: otherMoney() }
  const plain = await w.run(U.alex, 'returnUnusedFunds', plainInput, 'K4 Alex returns all his other money', {
    ops: ['returnToAgency'],
  })
  t.check(
    'K4: a plain return, settling nothing',
    plain.movements.length === 1 &&
      plain.movements.every((m) => m.settlesPaymentId === undefined) &&
      same([...pendingOf()], [...pendingBeforePlain]),
  )
  t.check(
    'K4: its receipt names no money for purchases',
    plain.receipts[0]?.description === 'Unused funds returned to the Agency',
    plain.receipts[0]?.description,
  )
  t.check(
    "K4: the Admins hear 'Funds returned'",
    plain.notifications.length > 0 && plain.notifications.every((n) => n.title === 'Funds returned'),
  )
  t.check(
    'K4: the server sees no money for purchases in what it changed',
    ![...heldByCommand('returnUnusedFunds', plainInput, plain.plan, plain.before, plain.after)].some((key) =>
      key.startsWith('payment:'),
    ),
  )
  t.check(
    'K4: nothing is left beyond what is pending',
    otherMoney() === 0 && memberHeld(w.state, ARC, U.alex) === pendingTotal(),
  )
  const none = w.refuse(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: usd(1) },
    'limit_exceeded',
    'K4 Alex returns other money with none left',
  )
  t.check(
    "K4: it says 'Choose which money for purchases you are returning.'",
    none === 'Choose which money for purchases you are returning.',
    none,
  )
  await w.run(
    U.alex,
    'returnUnusedFunds',
    { agencyId: ARC, amount: advanceStanding(w.state, older, w.now).pending, paymentId: older.id },
    'K4 …while the rest of his conference badge money still goes back',
    { ops: ['returnToAgency'] },
  )
  t.check('K4: which settles it', advanceStanding(w.state, older, w.now).settled)

  // With nothing pending, other money is everything received, as before.
  t.check(
    'K4 setup: Priya has no money for purchases pending',
    advancesOf(w.state, { agencyId: ARC, userId: U.priya }, w.now).every((s) => s.pending === 0),
  )
  const priyaHeld = clampToZero(cents(memberHeld(w.state, ARC, U.priya)))
  const all = w.refuse(
    U.priya,
    'returnUnusedFunds',
    { agencyId: ARC, amount: cents(priyaHeld + 1) },
    'insufficient_funds',
    'K4 Priya returns more than she holds',
  )
  t.check(
    'K4: …up to what she received from the Agency',
    all === `You can return up to ${usdText(priyaHeld)} received from this Agency.`,
    all,
  )
}

/**
 * K5. A request for money that paid a vendor, sent before money for purchases paid the
 * requester, keeps its Expense when it is approved now.
 */
async function olderVendorFunds(t: Checker) {
  const w = new World(t, 'engine-k5')
  const travel = budgetOf(w.state, B.arcTravel)
  const amount = cents(travel.approvalThreshold + usd(50))
  if (amount > allowanceLeft(w, B.arcTravel, U.sofia)) throw new Error('Sofia has too little left on Travel')
  await w.fund(U.maya, B.arcTravel, amount)
  const sent = await w.run(
    U.sofia,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTravel,
      type: 'vendor_payment',
      destinationId: D.northwind,
      amount,
      category: 'travel',
      purpose: 'Group rail tickets',
      attachments: [file('k5-quote.pdf')],
      idempotencyKey: 'smoke-k5-vendor',
    },
    'K5 setup: Sofia asks to pay Northwind, above what Travel approves by itself',
    { ops: ['requestPayment'] },
  )
  t.check('K5 setup: it waits for an Agency Admin', sent.result.status === 'needs_approval')
  // Before Phase B, money for purchases paid a vendor. No command makes one now: written into the state.
  const older = must(
    w.state.requests.find((r) => r.id === sent.result.id),
    'the request',
  )
  older.type = 'funds'
  const k5 = await w.run(
    U.maya,
    'approveRequest',
    { requestId: older.id },
    'K5 Maya approves an older request for money that pays a vendor',
    { ops: ['approvePayment'] },
  )
  const { payment } = k5.result
  t.check(
    'K5: paid to Northwind, as a tool payment',
    payment.type === 'tool' &&
      payment.recipient.kind === 'destination' &&
      payment.recipient.destinationId === D.northwind,
    `${payment.type} ${JSON.stringify(payment.recipient)}`,
  )
  const expense = w.state.expenses.find((e) => e.paymentId === payment.id)
  t.check(
    "K5: it keeps its Expense, Sofia's, with the request's file",
    Boolean(
      expense &&
      expense.userId === U.sofia &&
      expense.amount === amount &&
      expense.receipt?.id === older.attachments[0]?.id,
    ),
    JSON.stringify(expense),
  )
  t.check(
    'K5: and it is not money to justify',
    !advancesOf(w.state, { agencyId: ARC, userId: U.sofia }, w.now).some((s) => s.payment.id === payment.id),
  )
}

/** An id the API's schemas accept (the `paymentId` of a return is one). */
/**
 * K6. The server's conflict keys (src/server/conflicts.ts) for what the ledger cannot tell apart:
 * two operations bringing the same file while one waits to be signed (the engine checks a receipt
 * only against the state, which the waiting one is not in yet), and a bill paid and reconciled at
 * once.
 */
async function filesAndBillsHeld(t: Checker) {
  const w = new World(t, 'engine-k6')
  const left = allowanceLeft(w, B.arcTools, U.daniel)
  if (left < usd(60)) throw new Error(`Daniel has only ${left} cents left on Tools this month`)
  await w.fund(U.maya, B.arcTools, usd(60))
  const funds = await w.run(
    U.daniel,
    'requestPayment',
    {
      agencyId: ARC,
      budgetId: B.arcTools,
      type: 'funds',
      amount: usd(30),
      category: 'software',
      purpose: 'Cables and adapters',
      idempotencyKey: 'smoke-k6-funds',
    },
    'K6 Daniel gets money for purchases',
    { ops: ['requestPayment'] },
  )
  const advanceId = must(funds.result.paymentId, 'the advance')
  const shared = file('k6-shared-receipt.pdf')
  const receiptKey = `receipt:${must(shared.sha256, 'its fingerprint')}`
  const reimbursement = (key: string, attachments: EvidenceDraft[]): RequestPaymentInput => ({
    agencyId: ARC,
    budgetId: B.arcTools,
    type: 'reimbursement',
    amount: usd(10),
    category: 'software',
    purpose: 'Keyboard',
    merchant: 'Corner shop',
    spentAt: dayBefore(w.now, 1),
    attachments,
    idempotencyKey: `smoke-k6-${key}`,
  })

  // Two reimbursements with the same receipt: the first waits to be signed.
  const first = prepare(w, U.daniel, 'requestPayment', reimbursement('first', [shared]))
  const open = first.open()
  t.check(
    'K6: a reimbursement waiting to be signed holds its receipt',
    open.has(receiptKey),
    [...open].join(', '),
  )
  const second = prepare(w, U.daniel, 'requestPayment', reimbursement('second', [shared]))
  t.check(
    'K6: the engine alone takes a second one with that receipt (the first is not in the state yet)',
    second.plan?.ops.some((op) => op.call === 'requestPayment') ?? false,
  )
  t.check(
    'K6: …but the server sees it bring the same file',
    sharesAny(second.held, open) && second.held.has(receiptKey),
  )
  const expense = prepare(w, U.daniel, 'addExpense', {
    agencyId: ARC,
    paymentId: advanceId,
    merchant: 'Corner shop',
    amount: usd(10),
    category: 'software',
    spentAt: dayBefore(w.now),
    receipt: shared,
  })
  t.check('K6: …and a receipt with that file on his money for purchases', sharesAny(expense.held, open))
  const another = prepare(w, U.daniel, 'requestPayment', reimbursement('another', [file('k6-other.pdf')]))
  t.check('K6: a request with another file does not wait', !sharesAny(another.held, open))
  const linked = prepare(
    w,
    U.daniel,
    'requestPayment',
    reimbursement('linked', [file('k6-own.pdf'), link('Order page', 'https://example.com/orders/k6')]),
  )
  t.check(
    'K6: a link brings no file key, only the file does',
    [...linked.held].filter((key) => key.startsWith('receipt:')).length === 1,
    [...linked.held].join(', '),
  )

  // The same file as an outside payment's invoice, sent with it or added later.
  await w.gather(U.maya, ACC.arcReserve, usd(20))
  const outside = (memo: string, proof?: EvidenceDraft): CommandInput<'payOutside'> => ({
    agencyId: ARC,
    source: { kind: 'account', accountId: ACC.arcReserve },
    to: TOOL.toLowerCase(),
    payee: 'Linear',
    amount: usd(10),
    category: 'software',
    memo,
    ...(proof ? { proof } : {}),
  })
  const withInvoice = prepare(w, U.maya, 'payOutside', outside('Linear, October', shared))
  t.check('K6: an outside payment with that file as its invoice waits too', sharesAny(withInvoice.held, open))
  t.check(
    'K6: …and, waiting itself, holds it against a reimbursement',
    sharesAny(second.held, withInvoice.open()),
  )
  const invoiceLater = await w.run(
    U.maya,
    'payOutside',
    outside('Linear, November'),
    'K6 Maya pays Linear outside Viatik, invoice to follow',
    { ops: ['payOutside'] },
  )
  const proof = prepare(w, U.maya, 'addPaymentProof', { paymentId: invoiceLater.result.id, proof: shared })
  t.check(
    'K6: …and so does that file added later as an invoice',
    sharesAny(proof.held, open) && sharesAny(second.held, proof.open()),
  )

  // A bill paid and reconciled at once (a bill of its own: which seed bills are unpaid depends on the date).
  const vertex = must(
    w.state.destinations.find((d) => d.id === D.vertex),
    'Vertex Cloud',
  )
  const added = await w.run(
    U.maya,
    'addBill',
    {
      agencyId: ARC,
      destinationId: vertex.id,
      number: 'K6-001',
      issueDate: dayBefore(w.now, 2),
      dueDate: dayBefore(w.now, -10),
      amount: usd(25),
      category: vertex.category,
      accountId: ACC.arcOperations,
      document: file('k6-vertex-bill.pdf'),
    },
    'K6 Maya adds a Vertex Cloud bill, paid from Operations',
    { ops: [] },
  )
  const bill = added.result
  await w.gather(U.maya, bill.accountId, bill.amount)
  const paying = prepare(w, U.maya, 'payBill', { billId: bill.id })
  const billOpen = paying.open()
  t.check(
    `K6: Maya paying bill ${bill.number}, waiting to be signed, holds it`,
    billOpen.has(`bill:${bill.id}`),
    [...billOpen].join(', '),
  )
  await w.gather(U.jordan, bill.accountId, bill.amount)
  const byHand = await w.run(
    U.jordan,
    'sendPayment',
    {
      agencyId: ARC,
      type: 'vendor',
      recipient: { kind: 'destination', destinationId: bill.destinationId },
      accountId: bill.accountId,
      amount: bill.amount,
      category: bill.category,
      memo: `Bill ${bill.number}, paid by hand`,
    },
    'K6 Jordan pays the same vendor that amount by hand',
  )
  const reconcile = prepare(w, U.jordan, 'reconcile', {
    agencyId: ARC,
    paymentId: byHand.result.id,
    billId: bill.id,
  })
  t.check(
    "K6: Jordan reconciling the bill with that payment waits for Maya's",
    sharesAny(reconcile.held, billOpen) && reconcile.held.has(`bill:${bill.id}`),
    [...reconcile.held].join(', '),
  )
  const paymentOnly = prepare(w, U.jordan, 'reconcile', { agencyId: ARC, paymentId: byHand.result.id })
  t.check('K6: …but reconciling the payment alone does not', !sharesAny(paymentOnly.held, billOpen))
  await w.run(U.jordan, 'reconcile', reconcile.input, 'K6 Jordan reconciles the bill', { ops: [] })
  w.refuse(
    U.maya,
    'payBill',
    { billId: bill.id },
    'invalid_state',
    "K6 Maya's payment of the bill, run again once it is reconciled (its confirmation would not fit)",
  )
}

// ─── K7. Bills paid from a budget ────────────────────────────────────────────

/**
 * K7. Add bill offers the budgets that can pay the vendor (and picks it when only one can), never
 * starts on an empty account, and a bill paid from a budget keeps the budget's own account.
 */
async function billsFromBudgets(t: Checker) {
  const w = new World(t, 'engine-k7')
  const vendorOf = (id: Id) =>
    must(
      w.state.destinations.find((d) => d.id === id),
      `vendor ${id}`,
    )
  const fitting = (id: Id) =>
    budgetsForVendor(w.state, ARC, vendorOf(id), vendorOf(id).category)
      .map((b) => b.id)
      .sort()
  checkSame(t, 'K7 Vertex Cloud: only Tools and software can pay it, so it is picked', fitting(D.vertex), [
    B.arcTools,
  ])
  const canvasly = fitting(D.canvasly)
  t.check(
    'K7 Canvasly: Tools and software and an open budget for software can, so none is picked',
    canvasly.length > 1 && canvasly.includes(B.arcTools) && canvasly.includes(B.arcPurchases),
    canvasly.join(', '),
  )
  checkSame(t, 'K7 Atlas Legal: no budget can pay it', fitting(D.atlas), [])
  t.check(
    'K7 a budget whose vendor list does not name the vendor is left out',
    !budgetsForVendor(w.state, ARC, vendorOf(D.vertex), 'travel').some((b) => b.id === B.arcTravel),
  )

  // Never an empty account by default.
  const start = must(defaultBillAccount(w.state, ARC), 'the default account')
  t.check(
    'K7 the default account holds money',
    accountBalance(w.state, start.id) > 0 ||
      w.state.accounts.every((a) => a.agencyId !== ARC || accountBalance(w.state, a.id) === 0),
    `${start.name}: ${accountBalance(w.state, start.id)}`,
  )
  if (accountBalance(w.state, ACC.arcVendors) === 0)
    t.check('K7 an empty Vendors account is not the default', start.id !== ACC.arcVendors)
  await w.gather(U.maya, ACC.arcVendors, usd(50))
  t.check(
    'K7 the Vendors account is the default once it holds money',
    defaultBillAccount(w.state, ARC)?.id === ACC.arcVendors,
  )

  // The engine: a bill paid from a budget is stored with the budget's account.
  const bill = (n: number, budgetId?: Id) => ({
    agencyId: ARC,
    destinationId: D.vertex,
    number: `K7-00${n}`,
    issueDate: dayBefore(w.now, 2),
    dueDate: dayBefore(w.now, -10),
    amount: usd(15),
    category: 'cloud' as const,
    accountId: ACC.arcOperations,
    ...(budgetId ? { budgetId } : {}),
    document: file(`k7-vertex-${n}.pdf`),
  })
  const fromTools = await w.run(
    U.maya,
    'addBill',
    bill(1, B.arcTools),
    'K7 Maya adds a Vertex bill on Tools and software',
    { ops: [] },
  )
  t.check(
    "K7 it keeps the budget and the budget's own account, not the one sent",
    fromTools.result.budgetId === B.arcTools && fromTools.result.accountId === ACC.arcVendors,
    `${fromTools.result.budgetId} / ${fromTools.result.accountId}`,
  )
  w.refuse(
    U.maya,
    'addBill',
    bill(2, B.arcTravel),
    'policy_rejected',
    'K7 a bill on a budget whose vendor list does not name the vendor',
  )
  w.refuse(U.maya, 'addBill', bill(3, B.lumenInfra), 'forbidden', 'K7 a bill on a budget of another Agency')
  const plain = await w.run(U.maya, 'addBill', bill(4), 'K7 Maya adds a Vertex bill with no budget', {
    ops: [],
  })
  t.check(
    'K7 with no budget it keeps the account chosen',
    plain.result.budgetId === undefined && plain.result.accountId === ACC.arcOperations,
  )
  await w.fund(U.maya, B.arcTools, usd(15))
  const paid = await w.run(
    U.maya,
    'payBill',
    { billId: fromTools.result.id },
    'K7 Maya pays the bill from Tools and software',
    { ops: ['pay'] },
  )
  const vendors = must(
    w.state.accounts.find((a) => a.id === ACC.arcVendors),
    'the Vendors account',
  )
  t.check(
    'K7 its receipt names the account the money came from',
    paid.receipts.some((r) => r.fromLabel === `${vendors.name} · ${budgetOf(w.state, B.arcTools).name}`),
    paid.receipts.map((r) => r.fromLabel).join(', '),
  )
}

// ─── L. The seed's demo story ────────────────────────────────────────────────

/**
 * Addresses an outside payment of the seed must never use: the ledger (v3 and the superseded v2),
 * TestUSD and the keeper on Monad Testnet, USDC, and the smoke's own.
 */
const NOT_A_PAYEE = [
  '0x4BB74305A0e4ad5d55652B9d32b15d86d3E42908',
  '0xf3e82D8608F688483695A70694f267374300193C',
  '0xE14D62136Bcc0C668755f69F04Cfa97b079BB246',
  USDC.testnet,
  USDC.mainnet,
  WALLET,
  TOOL,
  ZERO_ADDRESS,
].map((address) => address.toLowerCase())

/** The seed's placeholders, derived from a hash: nobody holds their keys. */
const PLACEHOLDER_OF: Record<string, string> = {
  [DEMO.outsideAddresses.anthropic]: 'viatik:demo:anthropic-claude-teams',
  [DEMO.outsideAddresses.figma]: 'viatik:demo:figma',
}

/**
 * L. What the demo shows at the seed's `now`, read through the engine's read models: money to
 * justify per person, payment for work, payments outside Viatik with and without their invoice, the
 * monthly reminder, capital returned, the notifications that tell it, files used once, balances
 * never negative while it happens, and the story going on through real commands.
 */
async function seedStory(t: Checker) {
  const w = new World(t, 'engine-l')
  const s = w.state
  const now = w.now
  const daysAgo = (at: ISODate | undefined) => (Date.parse(now) - Date.parse(at ?? now)) / DAY_MS
  const within = (at: ISODate | undefined, from: number, to: number) =>
    daysAgo(at) >= from && daysAgo(at) <= to
  const notes = (userId: Id, title: string) =>
    s.notifications.filter((n) => n.userId === userId && n.title === title)

  // L1. Money for purchases: one advance each, in the three states.
  const single = (userId: Id) => {
    const all = advancesOf(s, { agencyId: ARC, userId }, now)
    t.check(`L1: ${userName(s, userId)} has one money for purchases`, all.length === 1, String(all.length))
    return must(all[0], `${userId}'s money for purchases`)
  }
  const alex = single(U.alex)
  const priya = single(U.priya)
  const daniel = single(U.daniel)
  t.check(
    'L1: Alex’s is under two weeks old (about 11 days), partly justified with a receipt, not overdue',
    within(alex.payment.completedAt, 10, 12) &&
      alex.justified > 0 &&
      alex.pending > 0 &&
      alex.returned === 0 &&
      !alex.overdue,
    JSON.stringify({ age: daysAgo(alex.payment.completedAt), j: alex.justified, p: alex.pending }),
  )
  const in18Days = addDays(now, 18)
  t.check(
    'L1: …and Alex is still not overdue 18 days after the seed (the demo has that long)',
    !advanceStanding(s, alex.payment, in18Days).overdue &&
      accountabilityByPerson(s, ARC, in18Days).every((p) => p.userId !== U.alex || p.overdueCount === 0),
    alex.dueAt,
  )
  t.check(
    'L1: Priya’s is 3–4 weeks old and fully justified: receipts and the unused rest given back',
    within(priya.payment.completedAt, 21, 28) &&
      priya.settled &&
      priya.justified > 0 &&
      priya.returned > 0 &&
      priya.justified + priya.returned === priya.amount &&
      priya.returns.every((m) => isGiveBack(m) && m.settlesPaymentId === priya.payment.id),
    JSON.stringify({ j: priya.justified, r: priya.returned, a: priya.amount }),
  )
  t.check(
    'L1: Daniel’s is about 40 days old, nothing justified, overdue',
    within(daniel.payment.completedAt, 39, 41) &&
      daniel.justified === 0 &&
      daniel.pending === daniel.amount &&
      daniel.overdue,
  )
  t.check(
    'L1: every receipt of them is a file, on the advance’s budget',
    [alex, priya].every((a) =>
      a.expenses.every((e) => e.receipt?.kind === 'file' && e.budgetId === a.payment.budgetId),
    ),
  )
  const people = accountabilityByPerson(s, ARC, now)
  const mostOverdue = people[0]
  t.check(
    'L1: per person, Daniel (overdue) comes first, then Alex; Priya has nothing open',
    mostOverdue?.userId === U.daniel &&
      mostOverdue.overdueCount === 1 &&
      people.some((p) => p.userId === U.alex && p.pending === alex.pending && p.overdue === 0) &&
      !people.some((p) => p.userId === U.priya),
    JSON.stringify(people.map((p) => [p.userId, p.pending, p.overdue])),
  )
  const arc = agencyAccountability(s, ARC, now)
  t.check(
    'L1: Arc Studio’s totals: pending, overdue, one person overdue',
    arc.pending === alex.pending + daniel.pending &&
      arc.overdue === daniel.pending &&
      arc.peopleOverdue === 1,
    JSON.stringify({ pending: arc.pending, overdue: arc.overdue, people: arc.peopleOverdue }),
  )
  const reminded = lastReminded(s, ARC, U.daniel)
  t.check(
    'L1: Maya reminded Daniel about two days ago',
    within(reminded, 1, 3) &&
      s.activity.some(
        (a) =>
          a.type === 'receipts_reminded' &&
          a.subjectUserId === U.daniel &&
          a.actor.kind === 'user' &&
          a.actor.userId === U.maya,
      ),
    reminded,
  )
  t.check(
    "L1: …and Daniel was told 'Receipts needed', some overdue, pointing to his expenses",
    notes(U.daniel, 'Receipts needed').some(
      (n) =>
        n.createdAt === reminded &&
        n.href === `/member/${ARC}/expenses` &&
        n.body === `${usdText(daniel.pending)} from Arc Studio still needs receipts, some overdue.`,
    ),
  )
  const advances = [alex, priya, daniel]
  t.check(
    'L1: each was asked from a budget where its person has spending access, and approved by policy',
    advances.every((a) => {
      const request = a.request
      const budget = s.budgets.find((b) => b.id === a.payment.budgetId)
      return (
        request?.type === 'funds' &&
        request.decision.outcome === 'approved' &&
        Boolean(budget?.allowedCategories.includes(request.category)) &&
        s.allowances.some(
          (x) =>
            x.budgetId === budget?.id &&
            x.status === 'active' &&
            x.holder.kind === 'member' &&
            x.holder.userId === a.userId,
        )
      )
    }),
  )

  // L2. Payment for work and a reimbursement, for Alex.
  t.check(
    'L2: Alex, Priya and Daniel may ask for payment for work from Team payments',
    [U.alex, U.priya, U.daniel].every((userId) =>
      s.allowances.some(
        (a) =>
          a.budgetId === B.arcTeam &&
          a.status === 'active' &&
          a.holder.kind === 'member' &&
          a.holder.userId === userId,
      ),
    ),
  )
  const works = s.requests.filter(
    (r) => r.type === 'work' && r.requester.kind === 'user' && r.requester.userId === U.alex,
  )
  const paidWork = must(
    works.find((r) => r.status === 'completed'),
    "Alex's paid work",
  )
  const waitingWork = must(
    works.find((r) => r.status === 'needs_approval'),
    "Alex's waiting work",
  )
  const workPayment = must(
    s.payments.find((p) => p.id === paidWork.paymentId),
    'the payment for work',
  )
  t.check(
    'L2: paid work: a team payment under the request’s own id, approved by Maya, from Team payments to Alex',
    workPayment.id === workPaymentId(paidWork.id) &&
      workPayment.type === 'team' &&
      workPayment.approvedBy === U.maya &&
      paidWork.approvedBy === U.maya &&
      workPayment.budgetId === B.arcTeam &&
      same(workPayment.recipient, { kind: 'member', userId: U.alex }) &&
      within(workPayment.completedAt, 13, 16),
    JSON.stringify({ id: workPayment.id, type: workPayment.type, age: daysAgo(workPayment.completedAt) }),
  )
  t.check(
    'L2: …with no expense, and nothing to justify',
    !s.expenses.some((e) => e.paymentId === workPayment.id),
  )
  t.check(
    'L2: the other waits for an Agency Admin, in their queue, and on the ledger nowhere',
    waitingWork.decision.reason?.rule === 'work_review' &&
      adminApprovals(s, ARC).mine.some((r) => r.id === waitingWork.id) &&
      !investorApprovals(s, DEMO.portfolio).exceptions.some((r) => r.id === waitingWork.id) &&
      !ledgerSnapshot(s).requests.has(waitingWork.id),
  )
  const team = budgetOf(s, B.arcTeam)
  t.check(
    'L2: Team payments holds what the waiting work asks, so an Admin can pay it',
    budgetUsage(s, team, now).available >= waitingWork.amount,
  )
  const reimbursement = must(
    s.requests.find(
      (r) =>
        r.type === 'reimbursement' &&
        r.status === 'completed' &&
        r.requester.kind === 'user' &&
        r.requester.userId === U.alex,
    ),
    "Alex's reimbursement",
  )
  const reimbursed = must(
    s.payments.find((p) => p.id === reimbursement.paymentId),
    'the reimbursement payment',
  )
  const reimbursementExpense = s.expenses.find((e) => e.paymentId === reimbursed.id)
  const reimbursementFile = reimbursement.attachments.find((a) => a.kind === 'file')
  t.check(
    'L2: the reimbursement: its merchant and receipt file, an Expense with that receipt, into Alex’s balance',
    reimbursed.type === 'reimbursement' &&
      Boolean(reimbursement.merchant) &&
      reimbursementExpense !== undefined &&
      reimbursementExpense.merchant === reimbursement.merchant &&
      reimbursementExpense.receipt?.id === reimbursementFile?.id &&
      same(reimbursed.recipient, { kind: 'member', userId: U.alex }) &&
      Boolean(
        s.receipts
          .find((r) => r.id === reimbursed.receiptId)
          ?.evidenceIds.includes(reimbursementFile?.id ?? ''),
      ),
  )

  // L3. Payments outside Viatik, and the monthly reminder.
  const outside = s.payments.filter(isOutsidePayment)
  const payee = (p: (typeof outside)[number]) => (p.recipient.kind === 'address' ? p.recipient.payee : '')
  const claude = must(
    outside.find((p) => payee(p) === 'Anthropic · Claude Teams'),
    'Claude Teams',
  )
  const figma = must(
    outside.find((p) => payee(p) === 'Figma'),
    'Figma',
  )
  t.check(
    'L3: two payments outside Viatik, by Maya, from an Arc Studio account',
    outside.length === 2 &&
      outside.every(
        (p) =>
          p.agencyId === ARC &&
          p.status === 'completed' &&
          p.budgetId === undefined &&
          s.accounts.some((a) => a.id === p.sourceAccountId && a.agencyId === ARC) &&
          p.createdBy.kind === 'user' &&
          p.createdBy.userId === U.maya,
      ),
  )
  const addresses = outside.map((p) => (p.recipient.kind === 'address' ? (p.recipient.address ?? '') : ''))
  t.check(
    'L3: their addresses are checksummed placeholders nobody holds, never the ledger’s, TestUSD’s or a person’s',
    addresses.every(
      (address) =>
        parseAddress(address) === address &&
        PLACEHOLDER_OF[address] !== undefined &&
        getAddress(slice(keccak256(stringToHex(PLACEHOLDER_OF[address] ?? '')), 12)) === address &&
        !NOT_A_PAYEE.includes(address.toLowerCase()),
    ) && new Set(addresses).size === addresses.length,
    addresses.join(', '),
  )
  t.check(
    'L3: each has an outside payment receipt and a movement to its payee and address',
    outside.every((p) => {
      const receipt = s.receipts.find((r) => r.id === p.receiptId)
      const movement = s.movements.find((m) => m.refId === p.id)
      const address = p.recipient.kind === 'address' ? p.recipient.address : undefined
      return (
        receipt?.kind === 'outside_payment' &&
        receipt.toLabel === `${payee(p)} · ${shortAddress(address ?? '')}` &&
        movement?.kind === 'payment' &&
        same(movement.to, { kind: 'external', label: payee(p), address })
      )
    }),
  )
  const claudePaidAt = must(claude.completedAt, 'its date')
  t.check(
    'L3: Claude Teams, two to three weeks ago, has its invoice from the next day, anchored once and listed on its receipt',
    within(claudePaidAt, 13, 21) &&
      claude.proof?.kind === 'file' &&
      within(claude.proof.addedAt, daysAgo(claudePaidAt) - 1.5, daysAgo(claudePaidAt) - 0.5) &&
      claude.proofVerified?.evidenceHash === attachmentsHash([claude.proof]) &&
      Boolean(s.receipts.find((r) => r.id === claude.receiptId)?.evidenceIds.includes(claude.proof.id)),
  )
  const pendingInvoices = outsidePaymentsWithoutProof(s, ARC, now)
  const pendingInvoice = pendingInvoices[0]
  t.check(
    'L3: Figma, about ten days ago, has none: its invoice is overdue',
    within(figma.completedAt, 9, 11) &&
      !figma.proof &&
      pendingInvoices.length === 1 &&
      pendingInvoice?.payment.id === figma.id &&
      pendingInvoice.overdue &&
      pendingInvoice.dueAt === addDays(must(figma.completedAt, 'its date'), PROOF_WITHIN_DAYS) &&
      arc.proofOverdue === 1,
  )
  const reminder = must(s.reminders[0], 'the monthly reminder')
  const due = remindersDue(s, ARC, now)
  const paidMonth = new Date(claudePaidAt)
  const nextDue = new Date(
    Date.UTC(paidMonth.getUTCFullYear(), paidMonth.getUTCMonth() + 1, reminder.dayOfMonth),
  ).toISOString()
  t.check(
    'L3: one active monthly reminder to pay Claude Teams, answered by that payment',
    s.reminders.length === 1 &&
      reminder.agencyId === ARC &&
      reminder.status === 'active' &&
      reminder.title === 'Pay Claude Teams and upload the invoice' &&
      reminder.payee === 'Anthropic · Claude Teams' &&
      reminder.payee === payee(claude) &&
      reminder.sourceAccountId === claude.sourceAccountId &&
      reminder.dayOfMonth >= 1 &&
      reminder.dayOfMonth <= 28 &&
      claude.reminderId === reminder.id &&
      within(reminder.createdAt, daysAgo(claudePaidAt) + 1, daysAgo(claudePaidAt) + 7),
    JSON.stringify({ payee: reminder.payee, created: reminder.createdAt, paid: claudePaidAt }),
  )
  // Its day is the one 14 days from now (1–28), and the payment was on that day the month before.
  const dueDay = Math.min(28, Math.max(1, new Date(Date.parse(now) + 14 * DAY_MS).getUTCDate()))
  t.check(
    'L3: its day of the month is the one 14 days from now (1–28), the day Claude Teams was paid',
    reminder.dayOfMonth === dueDay && paidMonth.getUTCDate() === dueDay,
    JSON.stringify({ day: reminder.dayOfMonth, expected: dueDay, paid: claudePaidAt }),
  )
  const next = due[0]
  t.check(
    'L3: next due on its day of the month after that payment',
    due.length === 1 &&
      next?.lastPayment?.id === claude.id &&
      next.dueAt === nextDue &&
      next.overdue === Date.parse(now) > Date.parse(nextDue),
    JSON.stringify(due.map((d) => [d.dueAt, d.overdue])),
  )
  const dueIn = (Date.parse(next?.dueAt ?? now) - Date.parse(now)) / DAY_MS
  t.check(
    'L3: …which is about two weeks from now: not overdue at the seed',
    next?.overdue === false && dueIn >= 10 && dueIn <= 14,
    JSON.stringify({ dueAt: next?.dueAt, days: dueIn }),
  )
  const alexView = w.view(U.alex)
  t.check(
    'L3: Alex sees neither payment nor the reminder; Maya and Elena see both addresses',
    !alexView.payments.some(isOutsidePayment) &&
      alexView.reminders.length === 0 &&
      [U.maya, U.elena].every((viewer) => {
        const view = w.view(viewer)
        return (
          view.reminders.some((r) => r.id === reminder.id) &&
          outside.every((p) => view.payments.some((x) => x.id === p.id && same(x.recipient, p.recipient)))
        )
      }),
  )

  // L4. Capital returned to the Investor.
  const returns = s.movements.filter((m) => m.kind === 'capital_return')
  const back = must(returns[0], 'the capital return')
  t.check(
    'L4: Lumen Labs returned 5,000 to the Portfolio Vault a few days ago, under its agreement',
    returns.length === 1 &&
      back.amount === usd(5_000) &&
      back.agencyId === LUMEN &&
      same(back.from, { kind: 'account', accountId: ACC.lumenOperations }) &&
      same(back.to, { kind: 'vault', vaultId: DEMO.vaults.portfolio }) &&
      back.agreementId === governingAgreement(s, LUMEN)?.id &&
      within(back.createdAt, 2, 4) &&
      s.receipts.find((r) => r.id === back.receiptId)?.kind === 'capital_return',
  )
  t.check(
    'L4: Returned is 5,000 for the portfolio, Lumen Labs and its agreement; 0 for Arc Studio',
    portfolioCapital(s, DEMO.portfolio, now).returned === usd(5_000) &&
      portfolioCapital(s, DEMO.portfolio, now).states.returned === usd(5_000) &&
      agencyCapital(s, LUMEN, now).states.returned === usd(5_000) &&
      agreementCapital(s, DEMO.agreements.lumen).returned === usd(5_000) &&
      agencyCapital(s, ARC, now).states.returned === 0,
  )
  const arcMoves = s.movements.filter((m) => m.agencyId === ARC)
  t.check(
    'L4: Arc Studio’s Spent is its payments minus what people gave back',
    agencyCapital(s, ARC, now).states.spent ===
      sum(
        arcMoves.filter((m) => m.kind === 'payment'),
        (m) => m.amount,
      ) -
        sum(arcMoves.filter(isGiveBack), (m) => m.amount),
  )

  // L5. The notifications that tell it, with the engine's texts and links.
  const balance = `/member/${ARC}/payments`
  t.check(
    "L5: Alex: 'Money for your purchase', 'Payment for your work', 'Reimbursement paid'",
    notes(U.alex, 'Money for your purchase').some(
      (n) => n.href === balance && n.body.includes(`within ${JUSTIFY_WITHIN_DAYS} days`),
    ) &&
      notes(U.alex, 'Payment for your work').some(
        (n) => n.href === balance && n.body === `${usdText(workPayment.amount)} is in your Viatik balance.`,
      ) &&
      notes(U.alex, 'Reimbursement paid').some(
        (n) =>
          n.href === balance && n.body === `${usdText(reimbursed.amount)} is back in your Viatik balance.`,
      ),
  )
  const alexReceipt = must(alex.expenses[0], "Alex's receipt")
  t.check(
    "L5: Maya and Jordan: 'Receipt uploaded' for Alex's receipt, pointing to his page",
    ADMINS.every((admin) =>
      notes(admin, 'Receipt uploaded').some(
        (n) =>
          n.href === `/agency/${ARC}/team/${U.alex}` &&
          n.body ===
            `${userName(s, U.alex)} added a ${usdText(alexReceipt.amount)} receipt from ${alexReceipt.merchant}.`,
      ),
    ),
  )
  t.check(
    "L5: …and 'Request needs approval' for his waiting work",
    ADMINS.every((admin) =>
      notes(admin, 'Request needs approval').some(
        (n) => n.href === `/agency/${ARC}/approvals` && n.body.includes(waitingWork.purpose),
      ),
    ),
  )
  t.check(
    "L5: the Investors: 'Paid outside Viatik' twice (Figma's invoice pending), 'Invoice uploaded', 'Capital returned'",
    INVESTORS.every(
      (investor) =>
        outside.every((p) =>
          notes(investor, 'Paid outside Viatik').some((n) => n.href === `/receipts/${p.receiptId}`),
        ) &&
        notes(investor, 'Paid outside Viatik').some(
          (n) => n.href === `/receipts/${figma.receiptId}` && n.body.endsWith(' Invoice pending.'),
        ) &&
        notes(investor, 'Invoice uploaded').some((n) => n.href === `/receipts/${claude.receiptId}`) &&
        notes(investor, 'Capital returned').some(
          (n) =>
            n.href === `/investor/${DEMO.portfolio}/vaults` &&
            n.body === `Lumen Labs returned ${usdText(usd(5_000))} to the Portfolio Vault.`,
        ),
    ),
  )
  const receiptsMissing = notes(U.alex, 'Receipts missing')
  const toldAt = receiptsMissing[0]?.createdAt ?? now
  // What Alex was missing when he was told: an expense made later is not in it.
  const missing = missingReceipts(s, { agencyId: ARC, userId: U.alex }).filter(
    (e) => Date.parse(e.createdAt) <= Date.parse(toldAt),
  )
  t.check(
    "L5: 'Receipts missing' only counts vendor payments without a receipt, made by the time it was sent",
    missing.length > 0 &&
      missing.every((e) => s.payments.find((p) => p.id === e.paymentId)?.type !== 'advance') &&
      receiptsMissing.length === 1 &&
      (receiptsMissing[0]?.body.startsWith(`${missing.length} vendor payments`) ||
        (missing.length === 1 && receiptsMissing[0]?.body.startsWith('A vendor payment'))) === true,
    `${receiptsMissing[0]?.body} (${missing.length} by ${toldAt})`,
  )

  // L6. Every file backs one thing per Agency: no fingerprint is used twice.
  const files = new Map<Id, { agencyId: Id; sha256: string }>()
  const fileOf = (agencyId: Id, evidence: Evidence | undefined) => {
    if (evidence?.kind === 'file') files.set(evidence.id, { agencyId, sha256: evidence.sha256 })
  }
  for (const e of s.expenses) fileOf(e.agencyId, e.receipt)
  for (const r of s.requests) for (const a of r.attachments) fileOf(r.agencyId, a)
  for (const p of s.payments) fileOf(p.agencyId, p.proof)
  for (const b of s.bills) fileOf(b.agencyId, b.document)
  const fingerprints = new Map<string, number>()
  for (const { agencyId, sha256 } of files.values())
    fingerprints.set(`${agencyId}|${sha256}`, (fingerprints.get(`${agencyId}|${sha256}`) ?? 0) + 1)
  const reused = [...fingerprints].filter(([, count]) => count > 1).map(([key]) => key)
  t.check(
    'L6: no file fingerprint is used twice in an Agency (receipts, request files, invoices, bills)',
    files.size > 0 && reused.length === 0,
    reused.join(', '),
  )

  // L7. While the story happens (its last 60 days), no balance is ever negative.
  const negative = negativeSince(s, plusHours(now, -24 * 60))
  t.check(
    'L7: replayed in time order, no account, budget, vault or Viatik balance goes negative in the last 60 days',
    negative.length === 0,
    negative.slice(0, 3).join(' | '),
  )

  // L8. The story goes on through real commands.
  const l8 = await w.run(
    U.maya,
    'approveRequest',
    { requestId: waitingWork.id },
    "L8 Maya approves Alex's waiting payment for work",
    { ops: ['pay'] },
  )
  t.check(
    'L8: paid under its own id, from Team payments to Alex',
    l8.result.payment.id === workPaymentId(waitingWork.id) && l8.plan?.ops[0]?.call === 'pay',
  )
  await w.run(
    U.maya,
    'addPaymentProof',
    { paymentId: figma.id, proof: file('l8-figma-invoice.pdf') },
    "L8 Maya adds Figma's invoice",
    { ops: ['recordEvidence'] },
  )
  t.check('L8: no invoice is pending any more', outsidePaymentsWithoutProof(w.state, ARC, w.now).length === 0)
  w.refuse(
    U.maya,
    'addPaymentProof',
    { paymentId: claude.id, proof: file('l8-claude-again.pdf') },
    'invalid_state',
    'L8 a second invoice for Claude Teams',
  )
  await w.run(
    U.alex,
    'addExpense',
    {
      agencyId: ARC,
      paymentId: alex.payment.id,
      merchant: 'Field Supply Co',
      amount: advanceStanding(w.state, alex.payment, w.now).pending,
      category: 'equipment',
      spentAt: dayBefore(w.now),
      receipt: file('l8-field-supply.pdf'),
    },
    'L8 Alex adds a receipt for the rest of his money for purchases',
    { ops: [] },
  )
  t.check('L8: Alex’s is settled', advanceStanding(w.state, alex.payment, w.now).settled)
  const remindedAgain = await w.run(
    U.maya,
    'remindReceipts',
    { agencyId: ARC },
    'L8 Maya reminds everyone who still owes receipts',
    { ops: [] },
  )
  checkSame(
    t,
    'L8: only Daniel is left (reminded two days ago, so again now)',
    remindedAgain.result.notified,
    [U.daniel],
  )
  await w.gather(U.maya, must(reminder.sourceAccountId, 'its account'), must(reminder.amount, 'its amount'))
  await w.run(
    U.maya,
    'payOutside',
    {
      agencyId: ARC,
      source: { kind: 'account', accountId: must(reminder.sourceAccountId, 'its account') },
      to: must(claude.recipient.kind === 'address' ? claude.recipient.address : undefined, 'its address'),
      payee: payee(claude),
      amount: must(reminder.amount, 'its amount'),
      category: reminder.category,
      memo: 'Claude Teams, this month',
      reminderId: reminder.id,
    },
    'L8 Maya pays this month’s Claude Teams from the reminder',
    { ops: ['payOutside'] },
  )
  t.check(
    'L8: the reminder is next due the month after',
    remindersDue(w.state, ARC, w.now)[0]?.lastPayment?.completedAt === w.now,
  )

  // L9. What each Member sees: nobody else's pay, budgets that add up, their Admins' names.
  memberViewChecks(t, 'L9 (the seed)', s, now)
  memberViewChecks(t, 'L9 (after L8)', w.state, w.now)
  const alexSees = scopeStateForUser(s, U.alex)
  t.check(
    "L9: Alex reads who approved his payment for work: 'Maya Chen', not 'Former teammate'",
    userName(alexSees, must(paidWork.approvedBy, 'its approver')) === 'Maya Chen' &&
      userName(alexSees, must(workPayment.approvedBy, 'its approver')) === 'Maya Chen',
  )
  const teamPaid = (state: ViatikState) =>
    state.movements.filter(
      (m) => m.kind === 'payment' && m.from.kind === 'budget' && m.from.budgetId === B.arcTeam,
    )
  const otherPay = teamPaid(alexSees).filter((m) => m.to.kind === 'external')
  t.check(
    "L9: Alex sees Team payments pay others as 'Team member', with no receipt, as often and as much as it did",
    otherPay.length > 0 &&
      otherPay.every((m) => same(m.to, { kind: 'external', label: 'Team member' }) && !m.receiptId) &&
      teamPaid(alexSees).length === teamPaid(s).length &&
      sum(teamPaid(alexSees), (m) => m.amount) === sum(teamPaid(s), (m) => m.amount),
    `${otherPay.length} of ${teamPaid(s).length}`,
  )
}

/** The Agencies a person sees only as a Member (not as their Admin or their Investor). */
function memberOnlyAgencies(state: ViatikState, userId: Id): Set<Id> {
  const mine = state.memberships.filter((m) => m.userId === userId && m.status === 'active')
  const portfolios = new Set(mine.flatMap((m) => (m.scope.kind === 'portfolio' ? [m.scope.portfolioId] : [])))
  const full = new Set([
    ...state.agencies.filter((a) => portfolios.has(a.portfolioId)).map((a) => a.id),
    ...mine.flatMap((m) =>
      m.role === 'agency_admin' && m.scope.kind === 'agency' ? [m.scope.agencyId] : [],
    ),
  ])
  return new Set(
    mine.flatMap((m) =>
      m.role === 'member' && m.scope.kind === 'agency' && !full.has(m.scope.agencyId)
        ? [m.scope.agencyId]
        : [],
    ),
  )
}

/**
 * Every Member's view of `state` (scopeStateForUser), in the Agencies they see only as a Member:
 * no movement or receipt names another person or another person's pay (what a budget they hold
 * paid someone else reads "Team member", amount and budget kept); every budget they hold shows
 * the usage it has on the full state; their own movements, payments, money for purchases,
 * receipts and balance are exactly the full state's; and of the people around them they read
 * their Agency Admins' names and titles only, never another Member.
 */
function memberViewChecks(t: Checker, label: string, state: ViatikState, now: ISODate) {
  const active = state.memberships.filter((m) => m.status === 'active')
  const viewers = [...new Set(active.filter((m) => m.role === 'member').map((m) => m.userId))].sort()
  const problems = {
    movements: [] as string[],
    kept: [] as string[],
    receipts: [] as string[],
    named: [] as string[],
    usage: [] as string[],
    own: [] as string[],
    admins: [] as string[],
    people: [] as string[],
  }
  const anonymous = { kind: 'external', label: 'Team member' }
  let looked = 0
  for (const viewer of viewers) {
    const agencies = memberOnlyAgencies(state, viewer)
    if (agencies.size === 0) continue
    looked += 1
    const view = scopeStateForUser(state, viewer)
    const inScope = (agencyId: Id | undefined) => agencyId !== undefined && agencies.has(agencyId)
    const isPerson = (end: Location, which: (id: Id) => boolean) =>
      end.kind === 'recipient' && end.recipient.kind === 'member' && which(end.recipient.userId)
    const isMine = (end: Location) => isPerson(end, (id) => id === viewer)
    const isOther = (end: Location) => isPerson(end, (id) => id !== viewer)
    const ownMove = (m: Movement) => isMine(m.from) || isMine(m.to)
    const admins = active
      .filter((m) => m.role === 'agency_admin' && m.scope.kind === 'agency' && agencies.has(m.scope.agencyId))
      .map((m) => m.userId)
    const portfolios = new Set(state.agencies.filter((a) => agencies.has(a.id)).map((a) => a.portfolioId))
    const investors = active
      .filter(
        (m) => m.role === 'investor' && m.scope.kind === 'portfolio' && portfolios.has(m.scope.portfolioId),
      )
      .map((m) => m.userId)
    // Everyone the viewer must not read about: the other Members, and other Agencies' Admins.
    const others = state.users.filter(
      (u) => u.id !== viewer && !admins.includes(u.id) && !investors.includes(u.id),
    )
    const othersPay = new Set(
      state.payments
        .filter((p) => inScope(p.agencyId) && p.recipient.kind === 'member' && p.recipient.userId !== viewer)
        .map((p) => p.id),
    )
    const othersReceipts = new Set(
      [
        ...state.payments.filter((p) => othersPay.has(p.id)).map((p) => p.receiptId),
        ...state.movements
          .filter((m) => inScope(m.agencyId) && !ownMove(m) && (isOther(m.from) || isOther(m.to)))
          .map((m) => m.receiptId),
      ].filter((id): id is Id => Boolean(id)),
    )
    const namesIn = (value: unknown) => {
      const text = JSON.stringify(value)
      return others.filter((u) => text.includes(`"${u.id}"`) || text.includes(u.name)).map((u) => u.name)
    }

    // Nobody else's pay, in movements and receipts.
    for (const m of view.movements) {
      if (!inScope(m.agencyId)) continue
      if (
        isOther(m.from) ||
        isOther(m.to) ||
        (m.refId !== undefined && othersPay.has(m.refId)) ||
        (m.receiptId !== undefined && othersReceipts.has(m.receiptId)) ||
        namesIn(m).length > 0
      )
        problems.movements.push(`${viewer} ${m.id}`)
    }
    for (const r of view.receipts) {
      if (!inScope(r.agencyId)) continue
      if (othersPay.has(r.operationId) || othersReceipts.has(r.id) || namesIn(r).length > 0)
        problems.receipts.push(`${viewer} ${r.number}`)
    }
    const named = namesIn(view)
    if (named.length > 0) problems.named.push(`${viewer}: ${[...new Set(named)].join(', ')}`)

    // What a budget they hold paid (or got back from) someone else is still there, anonymous.
    const held = new Set(view.budgets.filter((b) => inScope(b.agencyId)).map((b) => b.id))
    const throughHeld = (m: Movement) =>
      (m.from.kind === 'budget' && held.has(m.from.budgetId)) ||
      (m.to.kind === 'budget' && held.has(m.to.budgetId))
    for (const m of state.movements) {
      if (!inScope(m.agencyId) || ownMove(m) || !throughHeld(m) || !(isOther(m.from) || isOther(m.to)))
        continue
      const shown = view.movements.find((x) => x.id === m.id)
      const ok =
        shown !== undefined &&
        shown.kind === m.kind &&
        shown.amount === m.amount &&
        shown.createdAt === m.createdAt &&
        same(shown.from, isOther(m.from) ? anonymous : m.from) &&
        same(shown.to, isOther(m.to) ? anonymous : m.to) &&
        shown.receiptId === undefined &&
        shown.refId === undefined
      if (!ok) problems.kept.push(`${viewer} ${m.id}`)
    }

    // The budgets they hold add up as they do for the Agency.
    for (const budget of view.budgets) {
      if (!inScope(budget.agencyId)) continue
      const full = must(
        state.budgets.find((b) => b.id === budget.id),
        budget.id,
      )
      const mine = budgetUsage(view, budget, now)
      const theirs = budgetUsage(state, full, now)
      if (!same(mine, theirs)) problems.usage.push(`${viewer} ${budget.name}: ${differences(mine, theirs)}`)
    }

    // Their own money, untouched.
    for (const agencyId of agencies) {
      const ownOf = (from: ViatikState) => {
        const movements = from.movements.filter((m) => m.agencyId === agencyId && ownMove(m))
        return {
          movements,
          receipts: movements.map((m) => from.receipts.find((r) => r.id === m.receiptId) ?? null),
          payments: from.payments.filter(
            (p) => p.agencyId === agencyId && p.recipient.kind === 'member' && p.recipient.userId === viewer,
          ),
          advances: advancesOf(from, { agencyId, userId: viewer }, now),
          held: memberHeld(from, agencyId, viewer),
        }
      }
      const mine = ownOf(view)
      const theirs = ownOf(state)
      for (const key of Object.keys(theirs) as (keyof typeof theirs)[])
        if (!same(mine[key], theirs[key])) problems.own.push(`${viewer} ${agencyId} ${key}`)
    }

    // Their Agency Admins' names and titles, nothing else; no other Member.
    for (const adminId of admins) {
      const full = state.users.find((u) => u.id === adminId)
      const shown = view.users.find((u) => u.id === adminId)
      const nameOnly =
        investors.includes(adminId) ||
        (shown?.email === '' && shown.timeZone === '' && shown.locale === '' && shown.createdAt === '')
      if (
        !full ||
        !shown ||
        shown.name !== full.name ||
        shown.title !== full.title ||
        userName(view, adminId) !== full.name ||
        !nameOnly ||
        Object.keys(shown).sort().join() !== Object.keys(full).sort().join()
      )
        problems.admins.push(`${viewer} ${adminId}`)
    }
    const allowed = new Set([viewer, ...admins, ...investors])
    const extra = view.users.filter((u) => !allowed.has(u.id)).map((u) => u.name)
    if (extra.length > 0) problems.people.push(`${viewer}: ${extra.join(', ')}`)
  }

  const report = (list: string[]) => `${list.length}: ${list.slice(0, 4).join(' | ')}`
  t.check(`${label}: there are Members to look at`, looked >= 3, String(looked))
  t.check(
    `${label}: no movement a Member sees names another person or their pay, or carries its receipt`,
    problems.movements.length === 0,
    report(problems.movements),
  )
  t.check(
    `${label}: …each one a budget they hold paid someone else is there, as 'Team member', amount kept`,
    problems.kept.length === 0,
    report(problems.kept),
  )
  t.check(
    `${label}: no receipt a Member sees names another person or is another person's pay`,
    problems.receipts.length === 0,
    report(problems.receipts),
  )
  t.check(
    `${label}: no other Member (or other Agency's Admin) is named or referenced anywhere in a Member's view`,
    problems.named.length === 0,
    report(problems.named),
  )
  t.check(
    `${label}: every budget a Member holds shows the usage it has for the Agency`,
    problems.usage.length === 0,
    report(problems.usage),
  )
  t.check(
    `${label}: a Member's own movements, payments, money for purchases, receipts and balance are unchanged`,
    problems.own.length === 0,
    report(problems.own),
  )
  t.check(
    `${label}: a Member reads their Agency Admins' names and titles, and nothing else about them`,
    problems.admins.length === 0,
    report(problems.admins),
  )
  t.check(
    `${label}: a Member's people are themselves, their Agency Admins and its Investors only`,
    problems.people.length === 0,
    report(problems.people),
  )
}

/** The keys two records differ in (a failed check's detail). */
function differences(a: object, b: object): string {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => !same(left[key], right[key]))
    .map((key) => `${key} ${JSON.stringify(left[key])} vs ${JSON.stringify(right[key])}`)
    .join('; ')
}

/** Balances replayed in time order: where one goes below zero after `since`. */
function negativeSince(state: ViatikState, since: ISODate): string[] {
  const keyOf = (location: Location, agencyId?: Id): string | null => {
    switch (location.kind) {
      case 'vault':
        return `vault:${location.vaultId}`
      case 'account':
        return `account:${location.accountId}`
      case 'budget':
        return `budget:${location.budgetId}`
      case 'recipient':
        return location.recipient.kind === 'member' ? `member:${agencyId}:${location.recipient.userId}` : null
      default:
        return null
    }
  }
  const balances = new Map<string, number>()
  const problems: string[] = []
  const ordered = [...state.movements].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
  for (const m of ordered) {
    const from = keyOf(m.from, m.agencyId)
    const to = keyOf(m.to, m.agencyId)
    if (from) {
      const next = (balances.get(from) ?? 0) - m.amount
      balances.set(from, next)
      if (next < 0 && Date.parse(m.createdAt) >= Date.parse(since))
        problems.push(`${m.createdAt} ${m.kind} leaves ${from} at ${next}`)
    }
    if (to) balances.set(to, (balances.get(to) ?? 0) + m.amount)
  }
  return problems
}

function isApiId(value: Id): boolean {
  try {
    parseCommandInput('returnUnusedFunds', { agencyId: ARC, amount: usd(1), paymentId: value })
    return true
  } catch {
    return false
  }
}

/** The payment type a request becomes when paid (the engine's capture). */
function paymentTypeOf(request: PaymentRequest): PaymentType {
  if (request.requester.kind === 'ai_agent') return 'automation'
  if (request.type === 'reimbursement') return 'reimbursement'
  if (request.destination.kind === 'member') {
    if (request.type === 'funds') return 'advance'
    if (request.type === 'work') return 'team'
  }
  return 'tool'
}

// ─── M. A funding agreement's lifecycle ──────────────────────────────────────

/**
 * Lumen's scheduled agreement is funded to its commitment and released to its last tranche: it
 * then reads Completed everywhere, yet keeps its status (no state on Monad ends an agreement) and
 * keeps governing Lumen's exception threshold, also once a second agreement is in force.
 */
async function agreementLifecycle(t: Checker) {
  const w = new World(t, 'engine-m')
  const LUMEN_AGREEMENT = DEMO.agreements.lumen
  const lumenAgreement = () =>
    must(
      w.state.agreements.find((a) => a.id === LUMEN_AGREEMENT),
      "Lumen's agreement",
    )
  const titled = (notifications: { userId: Id; title: string }[], title: string) =>
    notifications.length > 0 && notifications.every((n) => n.userId === U.ren && n.title === title)

  // M1. Elena funds what is left of the commitment.
  const unfunded = agreementCapital(w.state, LUMEN_AGREEMENT).unfunded
  t.check("M1: Lumen's commitment is not fully funded in the seed", unfunded > 0, String(unfunded))
  const portfolioVault = DEMO.vaults.portfolio
  if (vaultBalance(w.state, portfolioVault) < unfunded)
    await w.run(
      U.elena,
      'addFunds',
      { portfolioId: DEMO.portfolio, amount: unfunded, source: 'Treasury' },
      'M1 setup: Elena adds funds',
      { ops: ['deposit'] },
    )
  await w.run(
    U.elena,
    'fundAgreement',
    { agreementId: LUMEN_AGREEMENT, amount: unfunded },
    "M1 Elena funds the rest of Lumen's commitment",
    { ops: ['fundAgreement'] },
  )

  // M2. Ren requests Tranche 3 into Operations, and Elena releases it: not the last one.
  await w.run(
    U.ren,
    'requestTranche',
    { trancheId: DEMO.tranches.lumen3, destinationAccountId: ACC.lumenOperations },
    'M2 Ren requests Tranche 3',
    { ops: ['requestTranche'] },
  )
  t.check(
    'M2: Tranche 3 is not the last one to release',
    !isLastTranche(
      w.state,
      must(
        w.state.tranches.find((tr) => tr.id === DEMO.tranches.lumen3),
        'Tranche 3',
      ),
    ),
  )
  const m2 = await w.run(
    U.elena,
    'releaseTranche',
    { trancheId: DEMO.tranches.lumen3 },
    'M2 Elena releases Tranche 3',
    { ops: ['releaseTranche'] },
  )
  t.check(
    'M2: Ren is told "Funding released"',
    titled(m2.notifications, 'Funding released'),
    JSON.stringify(m2.notifications.map((n) => n.title)),
  )
  t.check(
    'M2: Tranche 4 is available, and the agreement still reads Active',
    w.state.tranches.find((tr) => tr.id === DEMO.tranches.lumen4)?.status === 'available' &&
      !isFullyReleased(w.state, LUMEN_AGREEMENT) &&
      agreementBadge(w.state, lumenAgreement()).label === 'Active',
  )

  // M3. Elena releases Tranche 4 without a request (Scheduled: none is needed). It is the last one.
  const operationsBefore = accountBalance(w.state, ACC.lumenOperations)
  const m3 = await w.run(
    U.elena,
    'releaseTranche',
    { trancheId: DEMO.tranches.lumen4 },
    'M3 Elena releases the last tranche, which nobody requested: no agreement-status operation',
    { ops: ['releaseTranche'] },
  )
  t.check(
    'M3: it lands in Operations',
    accountBalance(w.state, ACC.lumenOperations) - operationsBefore === usd(15_000),
  )
  t.check(
    'M3: Ren is told it was the final tranche of the agreement',
    titled(m3.notifications, 'Final tranche released') &&
      m3.notifications.every((n) =>
        n.body.endsWith(`That was the last tranche of ${lumenAgreement().title}.`),
      ),
    JSON.stringify(m3.notifications.map((n) => [n.title, n.body])),
  )
  const capital = agreementCapital(w.state, LUMEN_AGREEMENT)
  t.check(
    'M3: nothing is left to fund or release, and nothing stays in the Funding Vault',
    capital.remainingCommitment === 0 &&
      capital.inFundingVault === 0 &&
      capital.unfunded === 0 &&
      vaultBalance(w.state, DEMO.vaults.lumenFunding) === 0,
    JSON.stringify(capital),
  )
  t.check(
    'M3: it reads Completed, but its status is still active and it still governs Lumen',
    isFullyReleased(w.state, LUMEN_AGREEMENT) &&
      lumenAgreement().status === 'active' &&
      agreementDisplayStatus(w.state, lumenAgreement()) === 'completed' &&
      agreementBadge(w.state, lumenAgreement()).label === 'Completed' &&
      governingAgreement(w.state, LUMEN)?.id === LUMEN_AGREEMENT,
  )
  w.refuse(
    U.elena,
    'fundAgreement',
    { agreementId: LUMEN_AGREEMENT, amount: usd(1) },
    'limit_exceeded',
    'M3 funding 1 USD more',
  )
  // H5: a Member's Settings show it Completed too, from what their Agency carries.
  t.check(
    "M3: Noah's Agency carries it as completed, like Ren's Settings show it",
    w.view(U.noah).agencies.find((a) => a.id === LUMEN)?.fundingAgreement?.status === 'completed' &&
      agencyAgreementSummary(w.view(U.noah), LUMEN)?.status === 'completed' &&
      agencyAgreementSummary(w.view(U.ren), LUMEN)?.status === 'completed',
    JSON.stringify(agencyAgreementSummary(w.view(U.noah), LUMEN)),
  )

  // M4. A second agreement for Lumen: created, accepted, funded and released. The first one, in
  // force first, keeps governing: its threshold applies, on the engine and on the ledger.
  const created = await w.run(
    U.elena,
    'createAgreement',
    {
      portfolioId: DEMO.portfolio,
      agencyId: LUMEN,
      title: 'Second year',
      purpose: 'Operating capital for a second year.',
      committed: usd(6_000),
      releaseModel: 'manual',
      startDate: w.now,
      endDate: plusHours(w.now, 24 * 365),
      tranches: [
        { name: 'Tranche 1', amount: usd(4_000), releaseCondition: 'manual' },
        { name: 'Tranche 2', amount: usd(2_000), releaseCondition: 'manual' },
      ],
      spendingPolicy: {
        allowedCategories: ['team', 'cloud'],
        exceptionThreshold: usd(2_000),
        reportingCadence: 'monthly',
        returnConditions: 'Unreleased capital stays in the Funding Vault until the parties agree on it.',
      },
      evidenceRequirements: 'A monthly spend report.',
    },
    'M4 Elena creates a second agreement for Lumen, with a lower threshold',
    { ops: ['createAgreement'] },
  )
  const second = created.result.id
  t.check(
    'M4: Lumen lists the new agreement first, the completed one last',
    agreementsOf(w.state, LUMEN)
      .map((a) => a.id)
      .join() === [second, LUMEN_AGREEMENT].join(),
  )
  const waiting = [U.ren, U.noah].map((userId) => agencyAgreementSummary(w.view(userId), LUMEN))
  t.check(
    'M4: while it waits for acceptance, Ren and Noah both still see the first one, Completed',
    waiting.every((summary) => summary?.title === lumenAgreement().title && summary.status === 'completed'),
    JSON.stringify(waiting),
  )
  await w.run(U.ren, 'acceptAgreement', { agreementId: second }, 'M4 Ren accepts it', {
    ops: ['acceptAgreement'],
  })
  t.check(
    'M4: the running agreement comes first; the first one still governs, with its own threshold',
    agreementsOf(w.state, LUMEN)[0]?.id === second &&
      governingAgreement(w.state, LUMEN)?.id === LUMEN_AGREEMENT &&
      exceptionThresholdOf(w.state, LUMEN) === lumenAgreement().spendingPolicy.exceptionThreshold &&
      exceptionThresholdOf(w.state, LUMEN)! > usd(3_000),
  )
  await w.gather(U.ren, ACC.lumenOperations, usd(3_000))
  await w.run(
    U.ren,
    'sendPayment',
    {
      agencyId: LUMEN,
      type: 'vendor',
      recipient: { kind: 'destination', destinationId: D.stratus },
      accountId: ACC.lumenOperations,
      amount: usd(3_000),
      category: 'cloud',
      memo: 'Hosting, second year',
    },
    "M4 Ren pays 3,000 USD, above the new agreement's threshold: no exception, and the ledger agrees",
    { ops: ['pay'] },
  )
  await w.run(
    U.elena,
    'fundAgreement',
    { agreementId: second, amount: usd(4_000) },
    'M4 Elena funds the first tranche of the second agreement',
    { ops: ['fundAgreement'] },
  )
  const m4 = await w.run(
    U.elena,
    'releaseTranche',
    {
      trancheId: must(
        w.state.tranches.find((tr) => tr.agreementId === second && tr.index === 1),
        'Tranche 1',
      ).id,
    },
    'M4 Elena releases it (Manual: no request needed)',
    { ops: ['releaseTranche'] },
  )
  // Settings name the same agreement for every role: the running one with tranches left, not the
  // first one (Completed), which still governs.
  const summaries = [U.ren, U.noah, U.elena].map((userId) => agencyAgreementSummary(w.view(userId), LUMEN))
  t.check(
    'M4: Ren, Noah and Elena all see "Second year · Active" in Settings',
    summaries.every((summary) => summary?.title === 'Second year' && summary.status === 'active') &&
      agencyFundingAgreement(w.state, LUMEN)?.id === second,
    JSON.stringify(summaries),
  )
  t.check(
    "M4: …while Noah's Agency still carries the first agreement's exception threshold",
    w.view(U.noah).agencies.find((a) => a.id === LUMEN)?.exceptionThreshold ===
      lumenAgreement().spendingPolicy.exceptionThreshold,
  )
  t.check(
    'M4: not the last tranche: "Funding released", and the agreement reads Active',
    titled(m4.notifications, 'Funding released') &&
      agreementBadge(
        w.state,
        must(
          w.state.agreements.find((a) => a.id === second),
          'the second agreement',
        ),
      ).label === 'Active',
  )
}

// ─── N. Funding never exceeds what can still be released ─────────────────────

/**
 * Only a release moves money out of a Funding Vault, and a rejected tranche never releases. Arc's
 * agreement (4 × 25,000, 50,000 funded, Tranche 1 released) loses Tranche 2 to a rejection: the
 * engine then funds only what the tranches left can release, so no new capital is stranded, and
 * the pooled vault still pays the later tranches down to zero.
 */
async function fundingCap(t: Checker) {
  const w = new World(t, 'engine-n')
  const ARC_AGREEMENT = DEMO.agreements.arc
  const before = agreementCapital(w.state, ARC_AGREEMENT)
  t.check(
    "N: Arc's seeded agreement can take its whole unfunded commitment while every tranche is in play",
    before.fundable === before.unfunded && before.releasable === usd(75_000),
    JSON.stringify(before),
  )

  // N0. The engine funds less than the ledger checks, so the server holds the agreement while a
  // funding of it, or a rejection of one of its milestones, waits to be signed.
  const elenaFunds = prepare(w, U.elena, 'fundAgreement', { agreementId: ARC_AGREEMENT, amount: usd(1_000) })
  const marcusFunds = prepare(w, U.marcus, 'fundAgreement', {
    agreementId: ARC_AGREEMENT,
    amount: usd(1_000),
  })
  const fundingOpen = elenaFunds.open()
  t.check(
    "N0: Marcus's funding of the agreement waits for Elena's",
    sharesAny(marcusFunds.held, fundingOpen) && marcusFunds.held.has(`agreement:${ARC_AGREEMENT}`),
    [...marcusFunds.held].join(', '),
  )
  const rejection = prepare(w, U.elena, 'requestMilestoneChanges', {
    milestoneId: DEMO.milestones.arc2,
    note: 'The prototype misses the agreed scope.',
    reject: true,
  })
  t.check(
    'N0: …and so does a rejection of one of its milestones, both ways',
    sharesAny(rejection.held, fundingOpen) && sharesAny(marcusFunds.held, rejection.open()),
    [...rejection.held].join(', '),
  )
  const changes = prepare(w, U.elena, 'requestMilestoneChanges', {
    milestoneId: DEMO.milestones.arc2,
    note: 'Please add the test plan.',
  })
  t.check(
    'N0: a request for changes, which leaves the cap as it was, does not wait',
    !sharesAny(changes.held, fundingOpen),
    [...changes.held].join(', '),
  )
  const lumenFunds = prepare(w, U.marcus, 'fundAgreement', {
    agreementId: DEMO.agreements.lumen,
    amount: usd(1_000),
  })
  t.check(
    "N0: a funding of Lumen's agreement does not wait for one of Arc's",
    !sharesAny(lumenFunds.held, fundingOpen) && !sharesAny(elenaFunds.held, lumenFunds.open()),
    [...lumenFunds.held].join(', '),
  )

  // N1. Elena rejects the milestone of Tranche 2, under review.
  await w.run(
    U.elena,
    'requestMilestoneChanges',
    { milestoneId: DEMO.milestones.arc2, note: 'The prototype misses the agreed scope.', reject: true },
    'N1 Elena rejects the Prototype milestone',
    { ops: ['requestChanges'] },
  )
  const capital = agreementCapital(w.state, ARC_AGREEMENT)
  t.check(
    'N1: Tranches 3 and 4 are left to release, and 25,000 of them is already in the Funding Vault',
    capital.releasable === usd(50_000) &&
      capital.inFundingVault === usd(25_000) &&
      capital.fundable === usd(25_000) &&
      capital.unfunded === usd(50_000),
    JSON.stringify(capital),
  )

  // N2. The commitment would allow 50,000 more; only 25,000 can still be released.
  const vault = DEMO.vaults.portfolio
  if (vaultBalance(w.state, vault) < usd(50_000))
    await w.run(
      U.elena,
      'addFunds',
      { portfolioId: DEMO.portfolio, amount: usd(50_000), source: 'Treasury' },
      'N2 setup: Elena adds funds',
      { ops: ['deposit'] },
    )
  const message = w.refuse(
    U.elena,
    'fundAgreement',
    { agreementId: ARC_AGREEMENT, amount: usd(50_000) },
    'limit_exceeded',
    'N2 funding the whole commitment left',
  )
  t.check(
    'N2: it says how much can still be funded',
    message === `Only ${usdText(usd(25_000))} more can be funded: that is what the tranches left still need.`,
    message,
  )
  const beyond = w.refuse(
    U.elena,
    'fundAgreement',
    { agreementId: ARC_AGREEMENT, amount: usd(60_000) },
    'limit_exceeded',
    'N2 funding beyond the commitment',
  )
  t.check(
    'N2: …and beyond the commitment, it offers only what can be funded',
    beyond ===
      `Funded capital cannot exceed the ${usdText(usd(100_000))} commitment. You can add up to ${usdText(usd(25_000))}.`,
    beyond,
  )
  await w.run(
    U.elena,
    'fundAgreement',
    { agreementId: ARC_AGREEMENT, amount: usd(25_000) },
    'N2 Elena funds what the tranches left can release',
    { ops: ['fundAgreement'] },
  )
  const full = w.refuse(
    U.elena,
    'fundAgreement',
    { agreementId: ARC_AGREEMENT, amount: usd(1) },
    'limit_exceeded',
    'N2 then 1 USD more',
  )
  t.check(
    'N2: …because every tranche left is funded',
    full === 'Every tranche left is already funded. Nothing more can be funded under this agreement.',
    full,
  )

  // N3. Maya submits evidence for Tranches 3 and 4, and Elena releases both: the vault ends empty.
  const releaseWithEvidence = async (milestoneId: Id, trancheId: Id, label: string) => {
    await w.run(
      U.maya,
      'submitMilestoneEvidence',
      {
        milestoneId,
        evidence: [file(`${label} report.pdf`)],
        note: `${label} is done.`,
        destinationAccountId: ACC.arcOperations,
      },
      `N3 Maya submits the ${label} evidence`,
      { ops: ['requestTranche'] },
    )
    return w.run(U.elena, 'releaseTranche', { trancheId }, `N3 Elena releases the ${label} tranche`, {
      ops: ['releaseTranche'],
    })
  }
  await releaseWithEvidence(DEMO.milestones.arc3, DEMO.tranches.arc3, 'Beta')
  const lastRelease = await releaseWithEvidence(DEMO.milestones.arc4, DEMO.tranches.arc4, 'Launch')
  const after = agreementCapital(w.state, ARC_AGREEMENT)
  t.check(
    'N3: the Funding Vault ends at zero, with nothing stranded',
    vaultBalance(w.state, DEMO.vaults.arcFunding) === 0 &&
      after.inFundingVault === 0 &&
      after.fundable === 0 &&
      after.funded === usd(75_000) &&
      after.released === usd(75_000),
    JSON.stringify(after),
  )
  t.check(
    'N3: with Tranche 2 rejected, the agreement still reads Completed, and the Admins hear of its final tranche',
    isFullyReleased(w.state, ARC_AGREEMENT) &&
      agreementBadge(
        w.state,
        must(
          w.state.agreements.find((a) => a.id === ARC_AGREEMENT),
          "Arc's agreement",
        ),
      ).label === 'Completed' &&
      same(notifiedUsers(lastRelease), ADMINS) &&
      lastRelease.notifications.every((n) => n.title === 'Final tranche released'),
    JSON.stringify(lastRelease.notifications.map((n) => [n.userId, n.title])),
  )
}

// ─── O. Notifications that ask for a decision ────────────────────────────────

/**
 * A notification that asks for a decision names what it is about: a request, a milestone, a
 * tranche or an agreement to accept. Once anyone decides it, it is read for everyone it went to;
 * other notifications, the follow-ups that only tell included, stay as they were.
 */
async function decidedNotifications(t: Checker) {
  const w = new World(t, 'engine-o')
  const ASKING = new Set([
    'Request needs approval',
    'Exception needs your decision',
    'Milestone ready for review',
    'Tranche requested',
    'New funding agreement',
  ])
  type Kind = NotificationSubject['kind']
  const about = (kind: Kind, id: Id) =>
    w.state.notifications.filter((n) => n.subject?.kind === kind && n.subject.id === id)
  const shown = (kind: Kind, id: Id) =>
    JSON.stringify(about(kind, id).map((n) => [n.userId, n.title, n.readAt ?? 'unread']))
  /** Every notification about it went to exactly `userIds` and is read, some of them just now. */
  const readFor = (kind: Kind, id: Id, userIds: Id[]) => {
    const notes = about(kind, id)
    return (
      same([...new Set(notes.map((n) => n.userId))].sort(), [...userIds].sort()) &&
      notes.every((n) => n.readAt) &&
      notes.some((n) => n.readAt === w.now)
    )
  }
  /** A step's new notifications went to exactly `userIds`, unread, each naming `kind` `id`. */
  const asked = (step: { notifications: Notification[] }, kind: Kind, id: Id, userIds: Id[]) =>
    same(notifiedUsers(step), [...userIds].sort()) &&
    step.notifications.every((n) => same(n.subject, { kind, id }) && !n.readAt)

  // O1. In the seed, what asks for a decision names something still waiting for it.
  const waiting = ({ kind, id }: NotificationSubject) =>
    kind === 'request'
      ? w.state.requests.find((r) => r.id === id)?.status === 'needs_approval'
      : kind === 'milestone'
        ? w.state.milestones.find((m) => m.id === id)?.status === 'ready_for_review'
        : kind === 'tranche'
          ? w.state.tranches.find((tr) => tr.id === id)?.status === 'under_review'
          : w.state.agreements.find((a) => a.id === id)?.status === 'pending_acceptance'
  const asking = w.state.notifications.filter((n) => !n.readAt && ASKING.has(n.title))
  t.check(
    'O1: every unread notification of the seed that asks for a decision names one still waiting',
    asking.length > 0 && asking.every((n) => n.subject !== undefined && waiting(n.subject)),
    JSON.stringify(asking.map((n) => [n.userId, n.title, n.subject])),
  )
  t.check(
    'O1: …and the ones that only tell name nothing',
    w.state.notifications.every((n) => ASKING.has(n.title) || n.subject === undefined),
  )

  // O2. An Agency Admin approves a request: read for both Admins, and nothing else is.
  const askForWork = async (label: string, key: string, userId: Id = U.alex): Promise<Id> => {
    const step = await w.run(
      userId,
      'requestPayment',
      {
        agencyId: ARC,
        budgetId: B.arcTeam,
        type: 'work',
        amount: usd(100),
        category: 'team',
        purpose: 'Pilot support',
        attachments: [file(`o-${key}.pdf`)],
        idempotencyKey: `smoke-o-${key}`,
      },
      label,
      { ops: [] },
    )
    const id = step.result.id
    t.check(
      `${label}: both Agency Admins are asked, about that request`,
      step.result.status === 'needs_approval' && asked(step, 'request', id, ADMINS),
      shown('request', id),
    )
    w.later(1)
    return id
  }
  await w.fund(U.maya, B.arcTeam, usd(100))
  const approved = await askForWork('O2 Alex asks to be paid for his work', 'approve')
  const otherUnread = w.state.notifications.filter(
    (n) => !n.readAt && ADMINS.some((admin) => admin === n.userId) && n.subject?.id !== approved,
  )
  await w.run(U.maya, 'approveRequest', { requestId: approved }, 'O2 Maya approves it', { ops: ['pay'] })
  t.check(
    'O2: it is read for Maya and for Jordan, who did not decide it',
    readFor('request', approved, ADMINS),
    shown('request', approved),
  )
  t.check(
    "O2: the Admins' other unread notifications stay unread, other requests' among them",
    otherUnread.some((n) => n.subject?.kind === 'request') &&
      otherUnread.every((n) => !w.state.notifications.find((m) => m.id === n.id)?.readAt),
    JSON.stringify(otherUnread.map((n) => [n.userId, n.title])),
  )

  // O3–O6. Declined, cancelled by the requester, or cancelled with the requester's access.
  const declined = await askForWork('O3 Alex asks again', 'decline')
  await w.run(
    U.jordan,
    'declineRequest',
    { requestId: declined, reason: 'Paid in the payroll' },
    'O3 Jordan declines it',
    { ops: [] },
  )
  t.check(
    'O3: declined, it is read for both Admins',
    readFor('request', declined, ADMINS),
    shown('request', declined),
  )
  const cancelled = await askForWork('O4 Alex asks once more', 'cancel')
  await w.run(U.alex, 'cancelRequest', { requestId: cancelled }, 'O4 Alex cancels it', { ops: [] })
  t.check(
    'O4: cancelled, it is read for both Admins',
    readFor('request', cancelled, ADMINS),
    shown('request', cancelled),
  )
  const revoked = await askForWork('O5 Alex asks for more', 'revoke')
  const alexTeam = must(
    w.state.allowances.find(
      (a) =>
        a.budgetId === B.arcTeam &&
        a.status === 'active' &&
        a.holder.kind === 'member' &&
        a.holder.userId === U.alex,
    ),
    "Alex's Team payments allowance",
  )
  await w.run(
    U.maya,
    'revokeAllowance',
    { allowanceId: alexTeam.id },
    "O5 Maya revokes Alex's spending access to Team payments",
    { ops: ['setAllowance'] },
  )
  t.check(
    'O5: the request it cancels is read for both Admins',
    w.state.requests.find((r) => r.id === revoked)?.status === 'cancelled' &&
      readFor('request', revoked, ADMINS),
    shown('request', revoked),
  )
  const removed = await askForWork('O6 Priya asks to be paid for her work', 'remove', U.priya)
  const priya = must(
    w.state.memberships.find(
      (m) =>
        m.userId === U.priya &&
        m.status === 'active' &&
        m.scope.kind === 'agency' &&
        m.scope.agencyId === ARC,
    ),
    "Priya's membership",
  )
  await w.run(U.maya, 'revokeMembership', { membershipId: priya.id }, 'O6 Maya removes Priya from the Agency')
  t.check(
    'O6: the request her removal cancels is read for both Admins',
    w.state.requests.find((r) => r.id === removed)?.status === 'cancelled' &&
      readFor('request', removed, ADMINS),
    shown('request', removed),
  )

  // O7. Exceptions, the Investor's to decide: the seeded one declined, a new one approved.
  const audit = must(
    w.state.requests.find(
      (r) => r.agencyId === LUMEN && r.status === 'needs_approval' && isException(w.state, r),
    ),
    "Lumen's security audit",
  )
  w.later(1)
  await w.run(
    U.elena,
    'declineRequest',
    { requestId: audit.id, reason: 'Next quarter' },
    "O7 Elena declines Lumen's security audit",
    { ops: ['closeRequest'] },
  )
  t.check(
    "O7: her seeded 'Exception needs your decision' is read",
    readFor('request', audit.id, [U.elena]) &&
      about('request', audit.id).every((n) => n.title === 'Exception needs your decision'),
    shown('request', audit.id),
  )
  t.check(
    "O7: Ren's 'Exception sent to Investor' only told him, and stays unread",
    w.state.notifications.some(
      (n) => n.userId === U.ren && n.title === 'Exception sent to Investor' && !n.readAt,
    ),
  )
  const threshold = must(governingAgreement(w.state, LUMEN), "Lumen's agreement").spendingPolicy
    .exceptionThreshold
  const exceptionAsk: RequestPaymentInput = {
    agencyId: LUMEN,
    budgetId: B.lumenSecurity,
    type: 'funds',
    amount: cents(threshold + usd(1)),
    category: 'legal',
    purpose: 'Penetration test',
    idempotencyKey: 'smoke-o-exception',
  }
  await w.fund(U.ren, B.lumenSecurity, exceptionAsk.amount)
  const exception = await w.run(
    U.ren,
    'requestPayment',
    exceptionAsk,
    'O7 Ren asks for money above the exception threshold',
    { ops: ['requestPayment'] },
  )
  const exceptionId = exception.result.id
  t.check(
    'O7: both Investors are asked, about that request',
    asked(exception, 'request', exceptionId, INVESTORS),
    shown('request', exceptionId),
  )
  w.later(1)
  await w.run(U.elena, 'approveRequest', { requestId: exceptionId }, 'O7 Elena approves it', {
    ops: ['approvePayment'],
  })
  t.check(
    'O7: it is read for Elena and for Marcus',
    readFor('request', exceptionId, INVESTORS),
    shown('request', exceptionId),
  )

  // O8. Milestones: released, sent back for changes, rejected.
  /** Setup: the agreement holds what releasing the tranche needs. */
  const fundRelease = async (agreementId: Id, trancheId: Id, label: string) => {
    const tranche = must(
      w.state.tranches.find((tr) => tr.id === trancheId),
      label,
    )
    const capital = agreementCapital(w.state, agreementId)
    const need = cents(capital.released + tranche.amount - capital.funded)
    if (need <= 0) return
    if (vaultBalance(w.state, DEMO.vaults.portfolio) < need)
      await w.run(
        U.elena,
        'addFunds',
        { portfolioId: DEMO.portfolio, amount: need, source: 'Treasury' },
        `${label} setup: Elena adds funds`,
        { ops: ['deposit'] },
      )
    await w.run(
      U.elena,
      'fundAgreement',
      { agreementId, amount: need },
      `${label} setup: Elena funds the agreement`,
      { ops: ['fundAgreement'] },
    )
  }
  await fundRelease(DEMO.agreements.arc, DEMO.tranches.arc2, 'O8')
  await w.run(
    U.elena,
    'releaseTranche',
    { trancheId: DEMO.tranches.arc2 },
    'O8 Elena approves the Prototype milestone and releases Tranche 2',
    { ops: ['releaseTranche'] },
  )
  t.check(
    "O8: her seeded 'Milestone ready for review' is read",
    readFor('milestone', DEMO.milestones.arc2, [U.elena]),
    shown('milestone', DEMO.milestones.arc2),
  )
  const submit = async (milestoneId: Id, label: string) => {
    const step = await w.run(
      U.maya,
      'submitMilestoneEvidence',
      {
        milestoneId,
        evidence: [file(`o-${label}.pdf`)],
        note: `${label} is done.`,
        destinationAccountId: ACC.arcOperations,
      },
      `O8 Maya submits the ${label} evidence`,
      { ops: ['requestTranche'] },
    )
    t.check(
      `O8: both Investors are asked to review the ${label} evidence, about that milestone`,
      asked(step, 'milestone', milestoneId, INVESTORS),
      shown('milestone', milestoneId),
    )
    w.later(1)
  }
  await submit(DEMO.milestones.arc3, 'Beta')
  await w.run(
    U.elena,
    'requestMilestoneChanges',
    { milestoneId: DEMO.milestones.arc3, note: 'Add the beta test results.' },
    'O8 Elena asks for changes to the Beta milestone',
    { ops: ['requestChanges'] },
  )
  t.check(
    'O8: sent back for changes, it is read for both Investors',
    readFor('milestone', DEMO.milestones.arc3, INVESTORS),
    shown('milestone', DEMO.milestones.arc3),
  )
  await submit(DEMO.milestones.arc3, 'Beta v2')
  await fundRelease(DEMO.agreements.arc, DEMO.tranches.arc3, 'O8')
  await w.run(U.elena, 'releaseTranche', { trancheId: DEMO.tranches.arc3 }, 'O8 Elena releases Tranche 3', {
    ops: ['releaseTranche'],
  })
  t.check(
    'O8: released, what was submitted again is read for both Investors too',
    readFor('milestone', DEMO.milestones.arc3, INVESTORS),
    shown('milestone', DEMO.milestones.arc3),
  )
  await submit(DEMO.milestones.arc4, 'Launch')
  await w.run(
    U.elena,
    'requestMilestoneChanges',
    { milestoneId: DEMO.milestones.arc4, note: 'The launch misses the agreed scope.', reject: true },
    'O8 Elena rejects the Launch milestone',
    { ops: ['requestChanges'] },
  )
  t.check(
    'O8: rejected, it is read for both Investors',
    readFor('milestone', DEMO.milestones.arc4, INVESTORS),
    shown('milestone', DEMO.milestones.arc4),
  )

  // O9. A tranche requested without a milestone, then released.
  const requested = await w.run(
    U.ren,
    'requestTranche',
    { trancheId: DEMO.tranches.lumen3, destinationAccountId: ACC.lumenOperations },
    "O9 Ren requests Lumen's Tranche 3",
    { ops: ['requestTranche'] },
  )
  t.check(
    'O9: both Investors are asked, about that tranche',
    asked(requested, 'tranche', DEMO.tranches.lumen3, INVESTORS),
    shown('tranche', DEMO.tranches.lumen3),
  )
  w.later(1)
  await fundRelease(DEMO.agreements.lumen, DEMO.tranches.lumen3, 'O9')
  await w.run(U.elena, 'releaseTranche', { trancheId: DEMO.tranches.lumen3 }, 'O9 Elena releases it', {
    ops: ['releaseTranche'],
  })
  t.check(
    'O9: it is read for both Investors',
    readFor('tranche', DEMO.tranches.lumen3, INVESTORS),
    shown('tranche', DEMO.tranches.lumen3),
  )

  // O10. An agreement waiting for acceptance, then accepted.
  const created = await w.run(
    U.elena,
    'createAgreement',
    {
      portfolioId: DEMO.portfolio,
      agencyId: LUMEN,
      title: 'Second year',
      purpose: 'Operating capital for a second year.',
      committed: usd(6_000),
      releaseModel: 'manual',
      startDate: w.now,
      endDate: plusHours(w.now, 24 * 365),
      tranches: [{ name: 'Tranche 1', amount: usd(6_000), releaseCondition: 'manual' }],
      spendingPolicy: {
        allowedCategories: ['team', 'cloud'],
        exceptionThreshold: usd(2_000),
        reportingCadence: 'monthly',
        returnConditions: 'Unreleased capital stays in the Funding Vault until the parties agree on it.',
      },
      evidenceRequirements: 'A monthly spend report.',
    },
    'O10 Elena offers Lumen a second agreement',
    { ops: ['createAgreement'] },
  )
  const agreementId = created.result.id
  const lumenAdmins = notifiedUsers(created)
  t.check(
    "O10: Lumen's Admins are asked to accept it, about that agreement",
    lumenAdmins.includes(U.ren) && asked(created, 'agreement', agreementId, lumenAdmins),
    shown('agreement', agreementId),
  )
  w.later(1)
  const accepted = await w.run(U.ren, 'acceptAgreement', { agreementId }, 'O10 Ren accepts it', {
    ops: ['acceptAgreement'],
  })
  t.check(
    'O10: it is read for them',
    readFor('agreement', agreementId, lumenAdmins),
    shown('agreement', agreementId),
  )
  t.check(
    "O10: the Investors' 'Agreement accepted' only tells, and stays unread",
    same(notifiedUsers(accepted), INVESTORS) &&
      accepted.notifications.every((n) => n.title === 'Agreement accepted' && !n.subject && !n.readAt),
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function budgetOf(state: ViatikState, budgetId: Id): Budget {
  return must(
    state.budgets.find((b) => b.id === budgetId),
    `budget ${budgetId}`,
  )
}

/** What a person can still ask for from a budget this period: their allowance and the budget's limit. */
function allowanceLeft(w: World, budgetId: Id, userId: Id): Cents {
  const budget = budgetOf(w.state, budgetId)
  const allowance = must(
    w.state.allowances.find(
      (a) =>
        a.budgetId === budgetId &&
        a.status === 'active' &&
        a.holder.kind === 'member' &&
        a.holder.userId === userId,
    ),
    `${userId}'s allowance on ${budgetId}`,
  )
  const holderLeft = allowance.periodLimit - holderSpentInPeriod(w.state, budget, allowance.holder, w.now)
  const budgetLeft = budget.periodLimit - budgetUsage(w.state, budget, w.now).committedThisPeriod
  return cents(Math.max(0, Math.min(holderLeft, budgetLeft)))
}

/**
 * A command as the server prepares it: run by a person on the world as it is (with an id seed of
 * its own) and planned; nothing is kept. `held` is what it holds as a new command
 * (`heldByCommand`); `open()` what it holds once stored as an operation waiting to be signed
 * (`heldByOperation`, read on the world as it is when called; it must move money).
 */
function prepare<N extends CommandName>(w: World, userId: Id, name: N, input: CommandInput<N>) {
  const ctx = w.context(userId)
  const out = runCommand(w.state, ctx, name, input)
  const plan = planSettlement({ before: w.state, after: out.state, actor: ctx.actor })
  return {
    input,
    out,
    plan,
    held: heldByCommand(name, input, plan, w.state, out.state),
    open: () => heldByOperation(name, input, must(plan, `the plan of ${name}`), w.state),
  }
}

/** What a person still has to justify in an Agency. */
function personPending(state: ViatikState, agencyId: Id, userId: Id, now: string): number {
  return accountabilityByPerson(state, agencyId, now).find((p) => p.userId === userId)?.pending ?? 0
}

/**
 * The decision the request form shows before sending, computed as the form does: `previewPolicy`
 * on what the person sees of the world (`w.view`), never the full state the server decides on.
 */
function preview(w: World, userId: Id, input: RequestPaymentInput): PolicyDecision {
  return execute(w.view(userId), { actor: { kind: 'user', userId }, now: w.now }, (tx) =>
    previewPolicy(tx, {
      budgetId: input.budgetId,
      type: input.type,
      amount: input.amount,
      category: input.category,
      destinationId: input.destinationId ?? null,
    }),
  ).result
}

function samePreview(t: Checker, label: string, previewed: PolicyDecision, decided: PolicyDecision) {
  t.check(
    `${label}: the form's preview reaches the same decision`,
    previewed.outcome === decided.outcome && previewed.reason?.rule === decided.reason?.rule,
    `preview ${previewed.outcome}/${previewed.reason?.rule}, request ${decided.outcome}/${decided.reason?.rule}`,
  )
}

import { decodeFunctionData, encodeErrorResult, zeroHash, type Hex } from 'viem'

import {
  keeperFailureSeed,
  keeperRunSeed,
  keeperTotals,
  noteFailure,
  noteReminders,
  runDueOnMock,
  runRowReplaceable,
  SYSTEM,
} from '@/data/keeper'
import { applySettlement, planSettlement } from '@/data/settlement'
import { DomainError, execute, runCommand } from '@/domain/engine'
import { runScheduledPayment } from '@/domain/engine/system'
import { DEMO } from '@/domain/fixtures'
import { upgradeState } from '@/domain/migrate'
import { usd, type Cents } from '@/domain/money'
import { subjectFor } from '@/domain/permissions'
import {
  dayIn,
  dueSchedules,
  isUnscheduledPayment,
  nextRunNumber,
  remindersToNotify,
  scheduleActions,
  scheduleRunPaymentId,
  scheduleState,
  upcomingPayments,
} from '@/domain/schedules'
import { accountBalance, memberHeld } from '@/domain/selectors'
import type { Id, ISODate, Payment, ViatikState } from '@/domain/types'
import { encodePlan } from '@/ledger/encode'
import { ledgerId, witnessesOf } from '@/ledger/ids'
import { KEEPER_ACTOR, MockLedgerAdapter } from '@/ledger/mock'
import { ledgerErrorOf } from '@/ledger/revert'
import type { LedgerOp, SettlementPlan } from '@/ledger/types'
import { heldByCommand, heldByOperation } from '@/server/conflicts'
import { parseCommandInput } from '@/server/schemas'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'

import {
  added,
  checkSame,
  crafted,
  ledgerInvariants,
  must,
  plusHours,
  SMOKE_CHAIN,
  World,
  type Checker,
} from './harness'

/**
 * Scheduled payments and the keeper (Phase F): schedules created, paused,
 * resumed and cancelled by people (plans, the mock ledger agreeing, the
 * contract's rules), due runs paid by the keeper (a system command whose plan
 * the keeper signs), a run that cannot pay noted once per run, a monthly
 * reminder told once per due day, the upgrade that forgets payments
 * scheduled before schedules existed, what each person sees, and the conflict
 * keys that keep a run and a person's change apart.
 */

const { users: U, agencies: A, accounts: ACC, budgets: B, destinations: DST } = DEMO
const ARC = A.arc
const MINUTE = 1 / 60

export default async function schedules(t: Checker) {
  await t.scenario('F1. Scheduling a payment: plans, rules and refusals', () => creating(t))
  await t.scenario('F2. Pause, resume, cancel: the Admin, the Investor and the ledger', () => managing(t))
  await t.scenario('F3. The keeper runs a due payment: plan, mock settle, receipt', () => keeperRuns(t))
  await t.scenario('F4. Recurring-ready: runs, catch-up and skipped dates', () => recurring(t))
  await t.scenario('F5. A run that cannot pay is noted once per run', () => failures(t))
  await t.scenario('F6. Bills: schedule, reschedule, pay now', () => bills(t))
  await t.scenario('F7. Stopped when the Admin who authorized it leaves', () => stopped(t))
  await t.scenario('F8. Monthly reminders told once per due day, in the Agency’s time zone', () =>
    reminders(t),
  )
  await t.scenario('F9. A keeper pass on the demo ledger', () => mockPass(t))
  await t.scenario('F10. Payments scheduled before schedules existed', () => phantoms(t))
  await t.scenario('F11. Who sees what, and conflict keys', () => visibilityAndConflicts(t))
  await t.scenario('F12. Hand-made plans the ledger refuses, calldata and reverts', () => ledgerRules(t))
  await t.scenario('F13. A run that fails again after a resume needs attention again', () =>
    failsAfterResume(t),
  )
  await t.scenario('F14. A Member never sees a stopped schedule as their next payment', () =>
    memberAndStopped(t),
  )
  await t.scenario('F15. A pass answers for its own Agencies; a run row is replaced only if it failed', () =>
    passTotals(t),
  )
  await t.scenario('F16. Payments from before schedules: scheduled again (replaced) or dismissed', () =>
    unscheduled(t),
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** `minutes` from the world's clock, as the form sends it. */
const inMinutes = (w: World, minutes: number): ISODate => plusHours(w.now, minutes * MINUTE)

const scheduleOf = (w: World, id: Id) =>
  must(
    w.state.schedules.find((s) => s.id === id),
    `schedule ${id}`,
  )

/** Moves the world's clock to `iso`. */
function at(w: World, iso: ISODate) {
  w.now = new Date(Date.parse(iso)).toISOString()
}

type KeeperStep = {
  plan: SettlementPlan | null
  payment?: Payment
  error?: string
}

/**
 * The keeper's run of a schedule, as the server does it on the demo ledger:
 * the system command (twice, for determinism), its plan, the mock ledger
 * signed as the keeper, applySettlement and the ledger invariants.
 */
async function keeperRun(t: Checker, w: World, scheduleId: Id, label: string): Promise<KeeperStep> {
  const before = w.state
  const schedule = scheduleOf(w, scheduleId)
  const ctx = { actor: SYSTEM, now: w.now, idSeed: keeperRunSeed(scheduleId, nextRunNumber(schedule)) }
  let out: { state: ViatikState; result: Payment }
  try {
    out = execute(before, ctx, (tx) => runScheduledPayment(tx, { scheduleId }))
  } catch (error) {
    if (error instanceof DomainError) return { plan: null, error: `${error.code}: ${error.message}` }
    throw error
  }
  const again = execute(before, ctx, (tx) => runScheduledPayment(tx, { scheduleId }))
  t.check(
    `${label}: the same run on the same state gives the same state`,
    JSON.stringify(again.state) === JSON.stringify(out.state),
  )
  const plan = planSettlement({ before, after: out.state, actor: SYSTEM })
  t.check(
    `${label}: one runSchedule, signed by the keeper`,
    plan?.signer === 'keeper' &&
      plan.signerUserId === null &&
      plan.ops.length === 1 &&
      plan.ops[0]?.call === 'runSchedule' &&
      plan.uncovered.length === 0,
    JSON.stringify(plan?.ops),
  )
  const record = plan?.records[0]
  t.check(
    `${label}: it records a payment with no evidence`,
    plan?.records.length === 1 && record?.kind === 'payment' && record.evidenceHash === null,
    JSON.stringify(plan?.records),
  )
  if (!plan) return { plan }
  const settled = await new MockLedgerAdapter({ latencyMs: 0, now: () => w.now }).settle(plan, { before })
  if (settled.status !== 'completed')
    return { plan, error: `${settled.error?.code}: ${settled.error?.message}` }
  applySettlement(before, out.state, plan, settled)
  const problems = ledgerInvariants(before, out.state, plan, settled, w.now)
  t.check(`${label}: ledger invariants hold`, problems.length === 0, problems.join('; '))
  w.state = out.state
  return { plan, payment: out.result }
}

/** Schedules a payment from the Arc Studio tools budget to a vendor. */
async function scheduleVendor(w: World, minutes: number, label: string, amount: Cents = usd(40)) {
  await w.fund(U.maya, B.arcTools, usd(400))
  const step = await w.run(
    U.maya,
    'schedulePayment',
    {
      agencyId: ARC,
      type: 'tool',
      recipient: { kind: 'destination', destinationId: DST.canvasly },
      accountId: ACC.arcVendors,
      budgetId: B.arcTools,
      amount,
      category: 'software',
      memo: 'Canvasly seats',
      firstRunAt: inMinutes(w, minutes),
    },
    label,
    { ops: ['createSchedule'] },
  )
  return step.result
}

/** Schedules a payment from Arc Studio's Operations account to Alex's Viatik balance. */
async function scheduleAlex(
  w: World,
  minutes: number,
  label: string,
  extra: { runs?: number; intervalSeconds?: number; amount?: Cents } = {},
) {
  await w.gather(U.maya, ACC.arcOperations, usd(500))
  const step = await w.run(
    U.maya,
    'schedulePayment',
    {
      agencyId: ARC,
      type: 'team',
      recipient: { kind: 'member', userId: U.alex },
      accountId: ACC.arcOperations,
      amount: extra.amount ?? usd(25),
      category: 'team',
      memo: 'Design sprint',
      firstRunAt: inMinutes(w, minutes),
      ...(extra.runs ? { runs: extra.runs } : {}),
      ...(extra.intervalSeconds ? { intervalSeconds: extra.intervalSeconds } : {}),
    },
    label,
    { ops: ['createSchedule'] },
  )
  return step
}

// ─── F1. Creating ────────────────────────────────────────────────────────────

async function creating(t: Checker) {
  const w = new World(t, 'f1')
  await w.fund(U.maya, B.arcTools, usd(400))
  const before = w.state
  const step = await w.run(
    U.maya,
    'schedulePayment',
    {
      agencyId: ARC,
      type: 'tool',
      recipient: { kind: 'destination', destinationId: DST.canvasly },
      accountId: ACC.arcVendors,
      budgetId: B.arcTools,
      amount: usd(40),
      category: 'software',
      memo: 'Canvasly seats',
      firstRunAt: inMinutes(w, 5),
    },
    'F1 Maya schedules Canvasly in 5 minutes',
    { ops: ['createSchedule'] },
  )
  const schedule = step.result
  const fresh = added(before.schedules, w.state.schedules)
  t.check(
    'F1 one schedule; no payment, money movement or receipt yet',
    fresh.length === 1 &&
      w.state.payments.length === before.payments.length &&
      step.movements.length === 0 &&
      step.receipts.length === 0,
  )
  t.check(
    'F1 its creation is witnessed by ScheduleCreated, with no record',
    step.plan?.records.length === 0 &&
      JSON.stringify(witnessesOf(step.plan!)) ===
        JSON.stringify([{ events: ['ScheduleCreated'], id: schedule.id }]),
  )
  t.check(
    'F1 the schedule mirrors the input: one run, no interval, active, first run in whole seconds',
    schedule.runs === 1 &&
      schedule.runsLeft === 1 &&
      schedule.intervalSeconds === 0 &&
      schedule.status === 'active' &&
      schedule.firstRunAt === schedule.nextRunAt &&
      Date.parse(schedule.firstRunAt) % 1000 === 0 &&
      schedule.budgetId === B.arcTools &&
      schedule.sourceAccountId === ACC.arcVendors,
    JSON.stringify(schedule),
  )
  const stored = scheduleOf(w, schedule.id)
  t.check(
    'F1 the ledger’s record of its creation is kept (verified, no receipt)',
    stored.ledger?.status === 'confirmed' && stored.ledger.receiptHash === undefined,
    JSON.stringify(stored.ledger),
  )
  t.check('F1 it shows as scheduled', scheduleState(w.state, stored, w.now) === 'scheduled')
  const upcoming = upcomingPayments(w.state, { agencyId: ARC })
  checkSame(
    t,
    'F1 its next run is an upcoming payment with the id it will have',
    upcoming.map((p) => [p.id, p.status, p.scheduledFor]),
    [[scheduleRunPaymentId(schedule.id, 1), 'scheduled', schedule.nextRunAt]],
  )

  // sendPayment with a future date is a schedule; with a past one it pays now.
  const viaSend = await w.run(
    U.maya,
    'sendPayment',
    {
      agencyId: ARC,
      type: 'tool',
      recipient: { kind: 'destination', destinationId: DST.canvasly },
      accountId: ACC.arcVendors,
      budgetId: B.arcTools,
      amount: usd(10),
      category: 'software',
      memo: 'Canvasly add-on',
      scheduledFor: inMinutes(w, 60),
    },
    'F1 sendPayment dated in an hour',
    { ops: ['createSchedule'] },
  )
  t.check(
    'F1 sendPayment dated later returns a schedule, and stores no “scheduled” payment',
    'runsLeft' in viaSend.result && !w.state.payments.some((p) => p.status === 'scheduled'),
  )
  await w.run(
    U.maya,
    'sendPayment',
    {
      agencyId: ARC,
      type: 'tool',
      recipient: { kind: 'destination', destinationId: DST.canvasly },
      accountId: ACC.arcVendors,
      budgetId: B.arcTools,
      amount: usd(10),
      category: 'software',
      memo: 'Canvasly add-on',
      scheduledFor: plusHours(w.now, -24),
    },
    'F1 sendPayment dated yesterday pays now',
    { ops: ['pay'] },
  )

  // Paying a person: notified that it is scheduled.
  const toAlex = await scheduleAlex(w, 30, 'F1 Maya schedules Alex in 30 minutes')
  t.check(
    'F1 Alex is told it is scheduled',
    toAlex.notifications.some((n) => n.userId === U.alex && n.title === 'Payment scheduled'),
  )

  const base = {
    agencyId: ARC,
    type: 'tool' as const,
    recipient: { kind: 'destination' as const, destinationId: DST.canvasly },
    accountId: ACC.arcVendors,
    budgetId: B.arcTools,
    amount: usd(20),
    category: 'software' as const,
    memo: 'Canvasly',
    firstRunAt: inMinutes(w, 30),
  }
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, firstRunAt: inMinutes(w, 0.5) },
    'validation',
    'F1 less than a minute ahead',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, firstRunAt: plusHours(w.now, -1) },
    'validation',
    'F1 in the past',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, firstRunAt: plusHours(w.now, 24 * 400) },
    'validation',
    'F1 more than a year ahead',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, runs: 13, intervalSeconds: 3600 },
    'validation',
    'F1 13 runs',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, intervalSeconds: 3600 },
    'validation',
    'F1 one run that repeats',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, runs: 2, intervalSeconds: 30 },
    'validation',
    'F1 repeats under a minute',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, amount: usd(600) },
    'policy_rejected',
    'F1 above the budget’s per-operation limit',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, recipient: { kind: 'destination', destinationId: DST.northwind } },
    'policy_rejected',
    'F1 a vendor the budget does not pay',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...base, budgetId: undefined, accountId: ACC.arcOperations, amount: usd(10_001) },
    'limit_exceeded',
    'F1 above the Investor’s exception threshold',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    {
      ...base,
      recipient: { kind: 'member', userId: U.noah },
      budgetId: undefined,
      accountId: ACC.arcOperations,
    },
    'forbidden',
    'F1 a person of another Agency',
  )
  w.refuse(U.alex, 'schedulePayment', base, 'forbidden', 'F1 a Member cannot schedule')
  w.refuse(U.elena, 'schedulePayment', base, 'forbidden', 'F1 the Investor cannot schedule')
  // Too little money today: the form blocks it, and so does the engine.
  const poorest = w.state.accounts
    .filter((a) => a.agencyId === ARC && a.status === 'active')
    .map((a) => ({ account: a, balance: accountBalance(w.state, a.id) }))
    .filter((a) => a.balance + 100 <= usd(10_000))
    .sort((a, b) => a.balance - b.balance)[0]
  if (poorest) {
    w.refuse(
      U.maya,
      'schedulePayment',
      {
        ...base,
        budgetId: undefined,
        accountId: poorest.account.id,
        amount: (poorest.balance + 100) as Cents,
      },
      'insufficient_funds',
      'F1 more than the account holds today',
    )
  } else t.note('no Arc account under the exception threshold to test insufficient funds')
  // Only payBill links a bill: the API drops one a caller names.
  const parsed = parseCommandInput('schedulePayment', { ...base, billId: 'bill_named_by_caller' })
  t.check('F1 the schema drops a bill named by the caller', !('billId' in parsed), JSON.stringify(parsed))
}

// ─── F2. Pause, resume, cancel ───────────────────────────────────────────────

async function managing(t: Checker) {
  const w = new World(t, 'f2')
  const schedule = await scheduleVendor(w, 120, 'F2 Maya schedules Canvasly in 2 hours')

  const paused = await w.run(U.maya, 'pauseSchedule', { scheduleId: schedule.id }, 'F2 Maya pauses it', {
    ops: ['setScheduleStatus'],
  })
  const pauseOp = paused.plan?.ops[0]
  t.check(
    'F2 the plan pauses it, witnessed by ScheduleStatusChanged(paused)',
    pauseOp?.call === 'setScheduleStatus' &&
      pauseOp.status === 'paused' &&
      JSON.stringify(witnessesOf(paused.plan!)[0]) ===
        JSON.stringify({ events: ['ScheduleStatusChanged'], id: schedule.id, args: { status: 'paused' } }),
  )
  t.check(
    'F2 paused by an Admin; its change is verified',
    scheduleOf(w, schedule.id).status === 'paused' &&
      scheduleOf(w, schedule.id).pausedByInvestor === false &&
      scheduleOf(w, schedule.id).changeLedger?.status === 'confirmed',
  )
  w.refuse(U.maya, 'pauseSchedule', { scheduleId: schedule.id }, 'invalid_state', 'F2 pausing it twice')
  t.check('F2 a paused schedule is not upcoming', upcomingPayments(w.state, { agencyId: ARC }).length === 0)

  // Paused past its date: on resume a single run is due at once.
  w.later(3)
  await w.run(
    U.jordan,
    'resumeSchedule',
    { scheduleId: schedule.id },
    'F2 Jordan resumes it after its date',
    {
      ops: ['setScheduleStatus'],
    },
  )
  t.check(
    'F2 a one-off resumed after its date is due now (the ledger’s arithmetic, mirrored)',
    scheduleOf(w, schedule.id).nextRunAt ===
      new Date(Math.floor(Date.parse(w.now) / 1000) * 1000).toISOString() &&
      scheduleState(w.state, scheduleOf(w, schedule.id), w.now) === 'due',
    scheduleOf(w, schedule.id).nextRunAt,
  )

  // The Investor pauses: only the Investor resumes.
  await w.run(U.elena, 'pauseSchedule', { scheduleId: schedule.id }, 'F2 Elena (Investor) pauses it', {
    ops: ['setScheduleStatus'],
  })
  const byInvestor = scheduleOf(w, schedule.id)
  t.check('F2 marked as paused by the Investor', byInvestor.pausedByInvestor === true)
  const maya = scheduleActions(w.state, subjectFor(w.state, U.maya), byInvestor)
  const elena = scheduleActions(w.state, subjectFor(w.state, U.elena), byInvestor)
  t.check(
    'F2 scheduleActions: Maya may cancel but not resume, and is told why; Elena may resume',
    !maya.resume && maya.cancel && Boolean(maya.resumeBlocked) && elena.resume && elena.cancel,
    JSON.stringify({ maya, elena }),
  )
  w.refuse(
    U.maya,
    'resumeSchedule',
    { scheduleId: schedule.id },
    'forbidden',
    'F2 Maya resumes the Investor’s pause',
  )
  w.refuse(
    U.alex,
    'pauseSchedule',
    { scheduleId: schedule.id },
    'forbidden',
    'F2 a Member cannot manage schedules',
  )
  await w.run(U.elena, 'resumeSchedule', { scheduleId: schedule.id }, 'F2 Elena resumes it', {
    ops: ['setScheduleStatus'],
  })

  const cancelled = await w.run(U.maya, 'cancelSchedule', { scheduleId: schedule.id }, 'F2 Maya cancels it', {
    ops: ['setScheduleStatus'],
  })
  t.check(
    'F2 cancelled for good',
    scheduleOf(w, schedule.id).status === 'cancelled' &&
      cancelled.plan?.ops[0]?.call === 'setScheduleStatus' &&
      (cancelled.plan.ops[0] as Extract<LedgerOp, { call: 'setScheduleStatus' }>).status === 'cancelled',
  )
  w.refuse(U.maya, 'cancelSchedule', { scheduleId: schedule.id }, 'invalid_state', 'F2 cancelling it twice')
  w.refuse(
    U.maya,
    'resumeSchedule',
    { scheduleId: schedule.id },
    'invalid_state',
    'F2 resuming a cancelled one',
  )
  const run = await keeperRun(t, w, schedule.id, 'F2 keeper on a cancelled schedule')
  t.check(
    'F2 the keeper does not run a cancelled schedule',
    Boolean(run.error?.startsWith('invalid_state')),
    run.error,
  )

  // A Member's payment: they are told when it is cancelled.
  const toAlex = await scheduleAlex(w, 30, 'F2 Maya schedules Alex')
  const cancel = await w.run(
    U.elena,
    'cancelSchedule',
    { scheduleId: toAlex.result.id },
    'F2 Elena cancels Alex’s',
    {
      ops: ['setScheduleStatus'],
    },
  )
  t.check(
    'F2 the Investor’s cancellation tells Alex and the Agency’s Admins',
    cancel.notifications.some((n) => n.userId === U.alex && n.title === 'Scheduled payment cancelled') &&
      cancel.notifications.some((n) => n.userId === U.maya) &&
      cancel.notifications.some((n) => n.userId === U.jordan),
    cancel.notifications.map((n) => `${n.userId}:${n.title}`).join(', '),
  )
}

// ─── F3. The keeper runs it ──────────────────────────────────────────────────

async function keeperRuns(t: Checker) {
  const w = new World(t, 'f3')
  const vendor = await scheduleVendor(w, 5, 'F3 Maya schedules Canvasly in 5 minutes')
  const alex = (await scheduleAlex(w, 5, 'F3 Maya schedules Alex in 5 minutes')).result

  const early = await keeperRun(t, w, vendor.id, 'F3 before it is due')
  t.check(
    'F3 not due yet: the engine refuses, nothing is planned',
    Boolean(early.error?.startsWith('invalid_state')),
    early.error,
  )
  t.check('F3 nothing is due yet', dueSchedules(w.state, w.now).length === 0)

  w.later(6 * MINUTE)
  checkSame(
    t,
    'F3 both are due',
    dueSchedules(w.state, w.now)
      .map((s) => s.id)
      .sort(),
    [vendor.id, alex.id].sort(),
  )
  const held = memberHeld(w.state, ARC, U.alex)
  const paid = await keeperRun(t, w, alex.id, 'F3 the keeper pays Alex')
  const payment = must(paid.payment, 'the run’s payment')
  t.check(
    'F3 a completed payment under the run’s id, linked to its schedule',
    payment.id === scheduleRunPaymentId(alex.id, 1) &&
      payment.status === 'completed' &&
      payment.scheduleId === alex.id &&
      payment.scheduleRun === 1 &&
      payment.createdBy.kind === 'user' &&
      payment.createdBy.userId === U.maya,
    JSON.stringify(payment),
  )
  t.check('F3 Alex’s Viatik balance grew by the amount', memberHeld(w.state, ARC, U.alex) === held + usd(25))
  const receipt = must(
    w.state.receipts.find((r) => r.id === payment.receiptId),
    'the run’s receipt',
  )
  t.check(
    'F3 its receipt is the keeper’s, verified on the (mock) ledger',
    receipt.verified.status === 'confirmed' && receipt.policyLabel.includes('Scheduled by'),
    receipt.policyLabel,
  )
  const done = scheduleOf(w, alex.id)
  t.check(
    'F3 the schedule completed: no run left, the payment listed',
    done.status === 'completed' && done.runsLeft === 0 && done.paymentIds.join() === payment.id,
  )
  t.check(
    'F3 Alex is told the money arrived, Maya that it was paid',
    w.state.notifications.some((n) => n.userId === U.alex && n.title === 'Payment received') &&
      w.state.notifications.some((n) => n.userId === U.maya && n.title === 'Scheduled payment paid'),
  )
  const twice = await keeperRun(t, w, alex.id, 'F3 the same schedule again')
  t.check('F3 a completed schedule is not run again', Boolean(twice.error), twice.error)
  // The same run applied twice (a recovery racing a confirmation) is refused by its ids.
  const rerun = (() => {
    try {
      execute(w.state, { actor: SYSTEM, now: w.now, idSeed: keeperRunSeed(alex.id, 1) }, (tx) =>
        runScheduledPayment(tx, { scheduleId: alex.id }),
      )
      return 'accepted'
    } catch (error) {
      return error instanceof DomainError ? error.code : 'crash'
    }
  })()
  t.check('F3 the same run again is refused', rerun === 'invalid_state' || rerun === 'already_applied', rerun)

  await keeperRun(t, w, vendor.id, 'F3 the keeper pays Canvasly')
  t.check('F3 nothing left due', dueSchedules(w.state, w.now).length === 0)
  t.check(
    'F3 a person cannot run it: the system command refuses a user',
    (() => {
      try {
        execute(w.state, { actor: { kind: 'user', userId: U.maya }, now: w.now }, (tx) =>
          runScheduledPayment(tx, { scheduleId: vendor.id }),
        )
        return false
      } catch (error) {
        return error instanceof DomainError && error.code === 'forbidden'
      }
    })(),
  )
}

// ─── F4. Recurring ───────────────────────────────────────────────────────────

async function recurring(t: Checker) {
  const w = new World(t, 'f4')
  const created = await scheduleAlex(w, 120, 'F4 Maya schedules Alex 3 times, hourly', {
    runs: 3,
    intervalSeconds: 3600,
  })
  const schedule = created.result
  const first = schedule.firstRunAt
  at(w, plusHours(first, 0.1))
  await keeperRun(t, w, schedule.id, 'F4 run 1')
  t.check(
    'F4 after run 1: two left, next one interval on',
    scheduleOf(w, schedule.id).runsLeft === 2 && scheduleOf(w, schedule.id).nextRunAt === plusHours(first, 1),
  )
  // The keeper was away for two intervals: the ledger pays the missed dates one by one.
  at(w, plusHours(first, 2.5))
  await keeperRun(t, w, schedule.id, 'F4 run 2 (late)')
  t.check(
    'F4 still due after a late run (catch-up)',
    dueSchedules(w.state, w.now).some((s) => s.id === schedule.id),
  )
  await keeperRun(t, w, schedule.id, 'F4 run 3 (catch-up)')
  t.check(
    'F4 completed after three runs, three payments',
    scheduleOf(w, schedule.id).status === 'completed' && scheduleOf(w, schedule.id).paymentIds.length === 3,
  )

  // Paused across dates: on resume they are skipped, not paid, and the runs left stay.
  const second = await scheduleAlex(w, 120, 'F4 Maya schedules Alex 4 times, hourly', {
    runs: 4,
    intervalSeconds: 3600,
  })
  const start = second.result.firstRunAt
  await w.run(U.maya, 'pauseSchedule', { scheduleId: second.result.id }, 'F4 paused', {
    ops: ['setScheduleStatus'],
  })
  at(w, plusHours(start, 3.5))
  await w.run(
    U.maya,
    'resumeSchedule',
    { scheduleId: second.result.id },
    'F4 resumed 3.5 hours after its date',
    {
      ops: ['setScheduleStatus'],
    },
  )
  const resumed = scheduleOf(w, second.result.id)
  t.check(
    'F4 dates that passed are skipped: next one is the first after now; 4 runs still left',
    resumed.nextRunAt === plusHours(start, 4) && resumed.runsLeft === 4 && resumed.status === 'active',
    `${resumed.nextRunAt} ${resumed.runsLeft}`,
  )
}

// ─── F5. Failures ────────────────────────────────────────────────────────────

async function failures(t: Checker) {
  const w = new World(t, 'f5')
  const schedule = await scheduleVendor(w, 5, 'F5 Maya schedules Canvasly in 5 minutes')
  await w.run(
    U.maya,
    'setBudgetPaused',
    { budgetId: B.arcTools, paused: true },
    'F5 the tools budget is paused',
    {
      ops: ['setBudgetPaused'],
    },
  )
  w.later(10 * MINUTE)
  const refused = await keeperRun(t, w, schedule.id, 'F5 the keeper tries the run')
  t.check(
    'F5 the engine refuses it (paused budget): nothing planned',
    Boolean(refused.error?.startsWith('policy_rejected')),
    refused.error,
  )

  const before = w.state
  const first = noteFailure(w.state, w.now, scheduleOf(w, schedule.id), {
    code: 'policy_rejected',
    message: 'This budget is paused. New payments are on hold.',
  })
  t.check('F5 noted the first time', first.noted)
  w.state = first.state
  const told = added(before.notifications, w.state.notifications)
  checkSame(
    t,
    'F5 the Agency’s Admins are told once',
    told.map((n) => n.userId).sort(),
    [U.jordan, U.maya].sort(),
  )
  t.check(
    'F5 it needs attention, with the reason, and stays due',
    scheduleState(w.state, scheduleOf(w, schedule.id), w.now) === 'needs_attention' &&
      scheduleOf(w, schedule.id).failure?.run === 1 &&
      scheduleOf(w, schedule.id).status === 'active',
  )
  t.check(
    'F5 an activity says it could not be paid',
    added(before.activity, w.state.activity).some((a) => a.type === 'schedule_failed'),
  )
  w.later(10 * MINUTE)
  const again = noteFailure(w.state, w.now, scheduleOf(w, schedule.id), {
    code: 'policy_rejected',
    message: 'This budget is paused. New payments are on hold.',
  })
  t.check('F5 the same failure on the next pass changes nothing', !again.noted && again.state === w.state)
  const other = noteFailure(w.state, w.now, scheduleOf(w, schedule.id), {
    code: 'insufficient_funds',
    message: 'Tools and software has 0.00 USD available.',
  })
  t.check(
    'F5 another reason for the same run updates it without telling anyone again',
    !other.noted &&
      other.state.schedules.find((s) => s.id === schedule.id)?.failure?.code === 'insufficient_funds' &&
      other.state.notifications.length === w.state.notifications.length,
  )
  w.state = other.state
  t.check(
    'F5 a failure is seeded by run and reason',
    keeperFailureSeed(schedule.id, 1, 'policy_rejected') === `keeper-failed:${schedule.id}:1:policy_rejected`,
  )

  await w.run(U.maya, 'setBudgetPaused', { budgetId: B.arcTools, paused: false }, 'F5 the budget resumes', {
    ops: ['setBudgetPaused'],
  })
  await keeperRun(t, w, schedule.id, 'F5 the next pass pays it')
  t.check(
    'F5 paid: the failure is cleared and it completed',
    scheduleOf(w, schedule.id).failure === undefined && scheduleOf(w, schedule.id).status === 'completed',
  )
}

// ─── F6. Bills ───────────────────────────────────────────────────────────────

async function bills(t: Checker) {
  const w = new World(t, 'f6')
  const bill = must(
    w.state.bills.find((b) => b.destinationId === DST.tasklane && b.status === 'to_pay'),
    'the Tasklane bill to pay',
  )
  await w.fund(U.maya, B.arcTools, usd(400))
  // A date that is already past (a clock behind the server's) is refused, never paid now.
  w.refuse(
    U.maya,
    'payBill',
    { billId: bill.id, scheduledFor: plusHours(w.now, -1) },
    'validation',
    'F6 scheduling the bill in the past',
  )
  t.check(
    'F6 the refused date paid nothing',
    w.state.bills.find((b) => b.id === bill.id)?.status === 'to_pay',
  )
  const scheduled = await w.run(
    U.maya,
    'payBill',
    { billId: bill.id, scheduledFor: inMinutes(w, 60) },
    'F6 Maya schedules the Tasklane bill in an hour',
    { ops: ['createSchedule'] },
  )
  const first = must(scheduled.result.schedule, 'the bill’s schedule')
  const afterFirst = must(
    w.state.bills.find((b) => b.id === bill.id),
    'bill',
  )
  t.check(
    'F6 the bill is scheduled by its schedule, no payment yet',
    afterFirst.status === 'scheduled' &&
      afterFirst.scheduleId === first.id &&
      afterFirst.scheduledFor === first.nextRunAt &&
      !afterFirst.paymentId &&
      first.billId === bill.id,
  )
  const rescheduled = await w.run(
    U.maya,
    'payBill',
    { billId: bill.id, scheduledFor: inMinutes(w, 120) },
    'F6 Maya reschedules it: cancel and create in one transaction',
    { ops: ['setScheduleStatus', 'createSchedule'] },
  )
  const second = must(rescheduled.result.schedule, 'the new schedule')
  t.check(
    'F6 the first schedule is cancelled, the bill follows the second',
    scheduleOf(w, first.id).status === 'cancelled' &&
      w.state.bills.find((b) => b.id === bill.id)?.scheduleId === second.id,
  )
  await w.run(U.maya, 'payBill', { billId: bill.id }, 'F6 Maya pays it now instead', {
    ops: ['pay', 'setScheduleStatus'],
  })
  const paid = must(
    w.state.bills.find((b) => b.id === bill.id),
    'bill',
  )
  t.check(
    'F6 paid now: its schedule is cancelled, the bill is paid',
    paid.status === 'paid' && Boolean(paid.paymentId) && scheduleOf(w, second.id).status === 'cancelled',
  )

  // A scheduled bill the keeper pays.
  const other = must(
    w.state.bills.find((b) => b.status === 'to_pay' && b.destinationId === DST.vertex),
    'the Vertex bill to pay',
  )
  await w.gather(U.maya, other.accountId, other.amount)
  const viaKeeper = await w.run(
    U.maya,
    'payBill',
    { billId: other.id, budgetId: null, scheduledFor: inMinutes(w, 5) },
    'F6 Maya schedules the Vertex bill from its account',
    { ops: ['createSchedule'] },
  )
  w.later(10 * MINUTE)
  const run = await keeperRun(
    t,
    w,
    must(viaKeeper.result.schedule, 'schedule').id,
    'F6 the keeper pays the bill',
  )
  const settled = must(
    w.state.bills.find((b) => b.id === other.id),
    'bill',
  )
  t.check(
    'F6 the bill is paid by the run’s payment',
    settled.status === 'paid' && settled.paymentId === run.payment?.id && !settled.scheduledFor,
    JSON.stringify(settled),
  )
}

// ─── F7. Stopped ─────────────────────────────────────────────────────────────

async function stopped(t: Checker) {
  const w = new World(t, 'f7')
  const schedule = await scheduleVendor(w, 5, 'F7 Maya schedules Canvasly')
  const maya = must(
    w.state.memberships.find(
      (m) =>
        m.userId === U.maya && m.scope.kind === 'agency' && m.scope.agencyId === ARC && m.status === 'active',
    ),
    'Maya’s membership',
  )
  const removed = await w.run(
    U.jordan,
    'revokeMembership',
    { membershipId: maya.id },
    'F7 Jordan removes Maya',
  )
  t.check('F7 her role goes on the ledger', removed.calls.includes('revokeRole'), removed.calls.join(', '))
  w.later(10 * MINUTE)
  t.check('F7 it shows as stopped', scheduleState(w.state, scheduleOf(w, schedule.id), w.now) === 'stopped')
  t.check('F7 the keeper leaves it out', !dueSchedules(w.state, w.now).some((s) => s.id === schedule.id))
  t.check('F7 it is not an upcoming payment', upcomingPayments(w.state, { agencyId: ARC }).length === 0)
  const run = await keeperRun(t, w, schedule.id, 'F7 the keeper tries anyway')
  t.check('F7 the engine refuses it (its Admin left)', Boolean(run.error?.startsWith('forbidden')), run.error)
  await w.run(U.jordan, 'cancelSchedule', { scheduleId: schedule.id }, 'F7 Jordan cancels it', {
    ops: ['setScheduleStatus'],
  })
}

// ─── F8. Monthly reminders ───────────────────────────────────────────────────

async function reminders(t: Checker) {
  const w = new World(t, 'f8')
  at(w, '2026-10-08T12:00:00.000Z')
  const created = await w.run(
    U.maya,
    'createReminder',
    {
      agencyId: ARC,
      title: 'Pay Figma',
      payee: 'Figma',
      amount: usd(45),
      category: 'software',
      dayOfMonth: 10,
    },
    'F8 Maya adds a monthly payment due on the 10th',
  )
  const reminderId = created.result.id
  const told = (state: ViatikState) =>
    state.notifications
      .filter((n) => n.body.startsWith('Pay Figma:'))
      .map((n) => n.userId)
      .sort()

  // Arc Studio is in Singapore (UTC+8): its 10th starts at 16:00 UTC on the 9th.
  at(w, '2026-10-09T15:30:00.000Z')
  t.check('F8 Singapore’s day is still the 9th at 15:30 UTC', dayIn(w.now, 'Asia/Singapore') === '2026-10-09')
  t.check(
    'F8 not due yet in the Agency’s time zone',
    !remindersToNotify(w.state, w.now, ARC).some((n) => n.reminder.id === reminderId),
  )
  at(w, '2026-10-09T16:30:00.000Z')
  t.check('F8 UTC is still on the 9th', dayIn(w.now, undefined) === '2026-10-09')
  const notice = remindersToNotify(w.state, w.now, ARC).find((n) => n.reminder.id === reminderId)
  t.check(
    'F8 due on its day in Singapore',
    notice?.dueDay === '2026-10-10' && notice.overdue === false,
    JSON.stringify(notice),
  )
  const counts = new Map()
  const first = noteReminders(w.state, w.now, counts, ARC)
  checkSame(t, 'F8 both Arc Admins are told once', told(first), [U.jordan, U.maya].sort())
  t.check(
    'F8 titled due today',
    first.notifications.some(
      (n) => n.body.startsWith('Pay Figma:') && n.title === 'Monthly payment due today',
    ),
  )
  w.state = first
  w.later(3)
  const again = noteReminders(w.state, w.now, new Map(), ARC)
  t.check('F8 a later pass the same day tells nobody again', told(again).length === 2)
  at(w, '2026-10-13T09:00:00.000Z')
  const later = noteReminders(w.state, w.now, new Map(), ARC)
  t.check('F8 still unpaid days later: not told again for that due day', told(later).length === 2)

  // Told late (the keeper was down on the day): once, as overdue.
  const fresh = new World(t, 'f8-late')
  at(fresh, '2026-10-08T12:00:00.000Z')
  const late = await fresh.run(
    U.maya,
    'createReminder',
    { agencyId: ARC, title: 'Pay Figma', payee: 'Figma', category: 'software', dayOfMonth: 10 },
    'F8 another world: the same monthly payment',
  )
  at(fresh, '2026-10-12T12:00:00.000Z')
  const overdue = noteReminders(fresh.state, fresh.now, new Map(), ARC)
  t.check(
    'F8 first told after its day: titled overdue',
    overdue.notifications.some(
      (n) =>
        n.body.startsWith('Pay Figma:') &&
        n.title === 'Monthly payment overdue' &&
        n.href.includes('tab=monthly'),
    ) && late.result.id.length > 0,
  )
  t.check(
    'F8 a time zone that does not exist reads as UTC',
    dayIn('2026-10-09T23:30:00.000Z', 'Mars/Olympus') === '2026-10-09',
  )
}

// ─── F9. A pass on the demo ledger ───────────────────────────────────────────

async function mockPass(t: Checker) {
  const w = new World(t, 'f9')
  const good = await scheduleAlex(w, 5, 'F9 Maya schedules Alex')
  const bad = await scheduleVendor(w, 5, 'F9 Maya schedules Canvasly')
  await w.run(
    U.maya,
    'setBudgetPaused',
    { budgetId: B.arcTools, paused: true },
    'F9 the tools budget is paused',
    {
      ops: ['setBudgetPaused'],
    },
  )
  w.later(10 * MINUTE)
  const first = await runDueOnMock(w.state, { now: w.now, trigger: 'manual', agencyId: ARC, by: U.maya })
  t.check(
    'F9 one paid, one could not be paid',
    first.answer.paid === 1 && first.answer.failed === 1 && first.answer.status === 'done',
    JSON.stringify(first.answer),
  )
  w.state = first.state
  t.check(
    'F9 the pass is recorded for Arc Studio, by Maya, manual',
    w.state.keeper?.agencies[ARC]?.trigger === 'manual' &&
      w.state.keeper.agencies[ARC]?.by === U.maya &&
      w.state.keeper.agencies[ARC]?.paid === 1 &&
      w.state.keeper.lastAutomaticAt === undefined,
    JSON.stringify(w.state.keeper),
  )
  t.check(
    'F9 Alex was paid; Canvasly needs attention',
    scheduleOf(w, good.result.id).status === 'completed' &&
      scheduleState(w.state, scheduleOf(w, bad.id), w.now) === 'needs_attention',
  )
  const notified = w.state.notifications.length
  w.later(10 * MINUTE)
  const second = await runDueOnMock(w.state, { now: w.now, trigger: 'automatic' })
  t.check(
    'F9 the next (automatic) pass tries again without telling anyone again',
    second.answer.failed === 1 &&
      second.answer.paid === 0 &&
      second.state.notifications.length === notified &&
      second.state.keeper?.lastAutomaticAt === w.now &&
      Object.keys(second.state.keeper?.agencies ?? {}).length === w.state.agencies.length,
    JSON.stringify(second.answer),
  )
  w.state = second.state
  t.check(
    'F9 the mock pass keeps the ledger books (genesis still builds)',
    ledgerInvariants(w.state, w.state, null, null, w.now).length === 0,
  )
}

// ─── F10. Phantom schedules ──────────────────────────────────────────────────

async function phantoms(t: Checker) {
  const w = new World(t, 'f10')
  t.check('F10 the seed has no bill marked scheduled', !w.state.bills.some((b) => b.status === 'scheduled'))
  t.check(
    'F10 the seeded Tasklane bill is to pay',
    w.state.bills.some((b) => b.destinationId === DST.tasklane && b.status === 'to_pay'),
  )
  t.check(
    'F10 the seed has no payment marked scheduled',
    !w.state.payments.some((p) => p.status === 'scheduled'),
  )

  // A world saved before Phase F: a bill and a payment "scheduled" that nothing would ever pay.
  const old = structuredClone(w.state) as ViatikState
  delete (old as Partial<ViatikState>).schedules
  const bill = must(
    old.bills.find((b) => b.status === 'to_pay'),
    'a bill to pay',
  )
  const legacy = (id: Id, extra: Partial<Payment>): Payment => ({
    id,
    agencyId: ARC,
    type: 'tool',
    sourceAccountId: ACC.arcVendors,
    recipient: { kind: 'destination', destinationId: bill.destinationId },
    amount: bill.amount,
    category: bill.category,
    memo: 'Scheduled before schedules existed',
    status: 'scheduled',
    createdBy: { kind: 'user', userId: U.maya },
    scheduledFor: plusHours(w.now, 48),
    ...extra,
  })
  old.payments.push(legacy('pay_legacy_bill', { billId: bill.id }), legacy('pay_legacy_alone', {}))
  Object.assign(bill, {
    status: 'scheduled',
    paymentId: 'pay_legacy_bill',
    scheduledFor: plusHours(w.now, 48),
  })
  const phantomBill = must(
    old.bills.find((b) => b.status === 'to_pay' && b.id !== bill.id),
    'another bill',
  )
  Object.assign(phantomBill, { status: 'scheduled', scheduledFor: plusHours(w.now, 24) })

  const upgraded = upgradeState(structuredClone(old))
  const billAfter = must(
    upgraded.bills.find((b) => b.id === bill.id),
    'bill',
  )
  t.check(
    'F10 a bill waiting on a phantom payment goes back to to pay, and that payment is dropped',
    billAfter.status === 'to_pay' &&
      !billAfter.paymentId &&
      !billAfter.scheduledFor &&
      !upgraded.payments.some((p) => p.id === 'pay_legacy_bill'),
    JSON.stringify(billAfter),
  )
  t.check(
    'F10 a bill scheduled with no payment at all goes back to to pay',
    upgraded.bills.find((b) => b.id === phantomBill.id)?.status === 'to_pay',
  )
  const alone = must(
    upgraded.payments.find((p) => p.id === 'pay_legacy_alone'),
    'the other phantom payment',
  )
  t.check(
    'F10 any other phantom payment stays, never paid, as action required (isUnscheduledPayment)',
    alone.status === 'action_required' && isUnscheduledPayment(alone),
  )
  t.check(
    'F10 schedules are added empty',
    Array.isArray(upgraded.schedules) && upgraded.schedules.length === 0,
  )
  const twice = upgradeState(structuredClone(upgraded))
  t.check('F10 upgrading again changes nothing', JSON.stringify(twice) === JSON.stringify(upgraded))
  const view = upgradeState(structuredClone(old))
  t.check(
    'F10 nothing shows as scheduled any more',
    upcomingPayments(view).length === 0 && !view.payments.some((p) => p.status === 'scheduled'),
  )

  // A real scheduled bill is left alone by the upgrade.
  await w.fund(U.maya, B.arcTools, usd(400))
  const tasklane = must(
    w.state.bills.find((b) => b.destinationId === DST.tasklane && b.status === 'to_pay'),
    'Tasklane bill',
  )
  await w.run(
    U.maya,
    'payBill',
    { billId: tasklane.id, scheduledFor: inMinutes(w, 60) },
    'F10 a real scheduled bill',
    {
      ops: ['createSchedule'],
    },
  )
  const kept = upgradeState(structuredClone(w.state))
  t.check(
    'F10 a bill with a live schedule stays scheduled',
    kept.bills.find((b) => b.id === tasklane.id)?.status === 'scheduled',
  )
}

// ─── F11. Visibility and conflicts ───────────────────────────────────────────

async function visibilityAndConflicts(t: Checker) {
  const w = new World(t, 'f11')
  const toAlex = await scheduleAlex(w, 5, 'F11 Maya schedules Alex')
  const vendor = await scheduleVendor(w, 5, 'F11 Maya schedules Canvasly')
  w.state = noteFailure(w.state, w.now, scheduleOf(w, toAlex.result.id), {
    code: 'insufficient_funds',
    message: 'Operations has 1.00 USD available.',
  }).state
  w.state.keeper = {
    lastAutomaticAt: w.now,
    agencies: {
      [ARC]: { at: w.now, trigger: 'automatic', paid: 1, failed: 0, waiting: 0, reminders: 0 },
      [A.lumen]: { at: w.now, trigger: 'automatic', paid: 0, failed: 0, waiting: 0, reminders: 0 },
    },
  }
  const alex = w.view(U.alex)
  const priya = w.view(U.priya)
  const elena = w.view(U.elena)
  const ren = w.view(U.ren)
  t.check(
    'F11 Alex sees the schedule that pays him, without why a run failed',
    alex.schedules.length === 1 &&
      alex.schedules[0]?.id === toAlex.result.id &&
      alex.schedules[0]?.failure === undefined,
    JSON.stringify(alex.schedules),
  )
  t.check('F11 Priya sees none', priya.schedules.length === 0)
  t.check(
    'F11 the Investor sees both, with the failure',
    elena.schedules.length === 2 && elena.schedules.some((s) => s.failure?.code === 'insufficient_funds'),
  )
  t.check('F11 Lumen’s Admin sees none of Arc’s', ren.schedules.length === 0)
  t.check(
    'F11 keeper status: Arc’s pass for Arc’s people, Lumen’s for Lumen’s, the timer for everyone',
    Object.keys(elena.keeper?.agencies ?? {}).length === 3 - 1 &&
      Object.keys(ren.keeper?.agencies ?? {}).join() === A.lumen &&
      Object.keys(alex.keeper?.agencies ?? {}).length === 0 &&
      alex.keeper?.lastAutomaticAt === w.now,
    JSON.stringify({ elena: elena.keeper, ren: ren.keeper, alex: alex.keeper }),
  )
  t.check(
    'F11 Alex reads it as scheduled (he cannot tell its Admin’s role, nor its failure)',
    scheduleState(alex, alex.schedules[0]!, w.now) === 'scheduled',
  )

  // Conflict keys: a person's change and the keeper's run of the same schedule hold the same key.
  const before = w.state
  const pause = runCommand(
    before,
    { actor: { kind: 'user', userId: U.maya }, now: w.now, idSeed: 'f11:pause' },
    'pauseSchedule',
    { scheduleId: vendor.id },
  )
  const pausePlan = planSettlement({ before, after: pause.state, actor: { kind: 'user', userId: U.maya } })
  const held = heldByCommand('pauseSchedule', { scheduleId: vendor.id }, pausePlan, before, pause.state)
  t.check('F11 pausing holds schedule:<id>', held.has(`schedule:${vendor.id}`), [...held].join(', '))
  const runPlan: SettlementPlan = {
    ...crafted(U.maya, [
      { call: 'runSchedule', scheduleId: vendor.id, paymentId: scheduleRunPaymentId(vendor.id, 1) },
    ]),
    signerUserId: null,
    signer: 'keeper',
  }
  const keeperHeld = heldByOperation('keeper:runScheduledPayment', { scheduleId: vendor.id }, runPlan, before)
  t.check(
    'F11 the keeper’s run holds the same schedule key and its payment',
    keeperHeld.has(`schedule:${vendor.id}`) &&
      keeperHeld.has(`payment:${scheduleRunPaymentId(vendor.id, 1)}`),
  )
}

// ─── F12. The ledger's own rules ─────────────────────────────────────────────

async function ledgerRules(t: Checker) {
  const w = new World(t, 'f12')
  const schedule = await scheduleVendor(w, 30, 'F12 Maya schedules Canvasly in 30 minutes')
  const run: LedgerOp = {
    call: 'runSchedule',
    scheduleId: schedule.id,
    paymentId: scheduleRunPaymentId(schedule.id, 1),
  }
  const record = {
    opId: scheduleRunPaymentId(schedule.id, 1),
    kind: 'payment' as const,
    amount: schedule.amount,
    from: { id: B.arcTools },
    to: { id: DST.canvasly },
    evidenceHash: null,
  }
  const asKeeper = (ops: LedgerOp[], records = [record]): SettlementPlan => ({
    ...crafted(U.maya, ops, records),
    signerUserId: null,
    signer: 'keeper',
  })
  const refusedWith = async (label: string, plan: SettlementPlan, code: string) => {
    const result = await w.settleCrafted(plan)
    t.check(
      `${label}: refused (${code})`,
      result.status === 'failed' && result.error?.code === code,
      `${result.error?.code}: ${result.error?.message}`,
    )
  }
  await refusedWith('F12 a person sends runSchedule', crafted(U.maya, [run], [record]), 'not_authorized')
  await refusedWith('F12 the keeper before it is due', asKeeper([run]), 'not_due')
  w.later(1)
  const completed = await w.settleCrafted(asKeeper([run]))
  t.check(
    'F12 the keeper once it is due: the mock pays it',
    completed.status === 'completed',
    completed.error?.message,
  )
  await refusedWith(
    'F12 the keeper with a record that differs from what the ledger pays',
    asKeeper([run], [{ ...record, amount: (record.amount + 1) as Cents }]),
    'rule_drift',
  )

  await w.run(U.maya, 'pauseSchedule', { scheduleId: schedule.id }, 'F12 paused', {
    ops: ['setScheduleStatus'],
  })
  await refusedWith('F12 the keeper while it is paused', asKeeper([run]), 'schedule_paused')
  await w.run(
    U.elena,
    'resumeSchedule',
    { scheduleId: schedule.id },
    'F12 the Investor resumes an Admin’s pause',
    {
      ops: ['setScheduleStatus'],
    },
  )
  await w.run(U.elena, 'pauseSchedule', { scheduleId: schedule.id }, 'F12 the Investor pauses it', {
    ops: ['setScheduleStatus'],
  })
  await refusedWith(
    'F12 an Admin resumes the Investor’s pause on the ledger',
    crafted(U.maya, [{ call: 'setScheduleStatus', scheduleId: schedule.id, status: 'active' }]),
    'not_authorized',
  )
  const create = (overrides: Partial<Extract<LedgerOp, { call: 'createSchedule' }>>): LedgerOp => ({
    call: 'createSchedule',
    scheduleId: 'sched_crafted',
    sourceId: B.arcTools,
    destinationId: DST.canvasly,
    memberUserId: null,
    amount: usd(10),
    firstRunAt: plusHours(w.now, 1),
    intervalSeconds: 0,
    runs: 1,
    ...overrides,
  })
  await refusedWith('F12 a Member creates a schedule', crafted(U.alex, [create({})]), 'not_authorized')
  await refusedWith(
    'F12 a first run in the past',
    crafted(U.maya, [create({ firstRunAt: plusHours(w.now, -1) })]),
    'invalid_state',
  )
  await refusedWith(
    'F12 a vendor and a Member at once',
    crafted(U.maya, [create({ memberUserId: U.alex })]),
    'invalid_state',
  )
  // The contract lets one run carry an interval (it never repeats); the app refuses it before the ledger.
  const oneRun = await w.settleCrafted(crafted(U.maya, [create({ intervalSeconds: 120 })]))
  t.check(
    'F12 one run with an interval: the ledger accepts it, as the contract does',
    oneRun.status === 'completed',
    oneRun.error?.message,
  )
  await refusedWith(
    'F12 repeats faster than a minute',
    crafted(U.maya, [create({ runs: 2, intervalSeconds: 59 })]),
    'invalid_state',
  )
  await refusedWith(
    'F12 53 runs',
    crafted(U.maya, [create({ runs: 53, intervalSeconds: 60 })]),
    'invalid_state',
  )
  await refusedWith(
    'F12 the same id twice',
    crafted(U.maya, [create({ scheduleId: schedule.id })]),
    'already_processed',
  )
  await refusedWith(
    'F12 above the per-operation limit',
    crafted(U.maya, [create({ amount: usd(501) })]),
    'limit_exceeded',
  )
  await refusedWith(
    'F12 a vendor the budget does not pay',
    crafted(U.maya, [create({ destinationId: DST.northwind })]),
    'destination_not_allowed',
  )

  // Calldata: createSchedule as the contract reads it, inside the multicall.
  const op = create({ memberUserId: U.alex, destinationId: null, sourceId: ACC.arcOperations }) as Extract<
    LedgerOp,
    { call: 'createSchedule' }
  >
  const { calls } = encodePlan([op], SMOKE_CHAIN)
  const decoded = decodeFunctionData({ abi: viatikLedgerAbi, data: calls[0]! }) as unknown as {
    functionName: string
    args: readonly [
      {
        id: Hex
        source: Hex
        destination: Hex
        member: string
        amount: bigint
        firstRunAt: bigint
        interval: number
        runs: number
      },
    ]
  }
  const input = decoded.args[0]
  t.check(
    'F12 createSchedule calldata: ids, the Member’s account, units, seconds, one run',
    decoded.functionName === 'createSchedule' &&
      input.id === ledgerId('smoke', 'sched_crafted') &&
      input.source === ledgerId('smoke', ACC.arcOperations) &&
      input.destination === zeroHash &&
      input.member.toLowerCase() === SMOKE_CHAIN.addressOf(U.alex)!.toLowerCase() &&
      input.amount === 10_000_000n &&
      input.firstRunAt === BigInt(Math.floor(Date.parse(op.firstRunAt) / 1000)) &&
      input.interval === 0 &&
      input.runs === 1,
    JSON.stringify(decoded, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)),
  )
  const statusCalls = encodePlan(
    (['paused', 'active', 'cancelled'] as const).map((status): LedgerOp => ({
      call: 'setScheduleStatus',
      scheduleId: schedule.id,
      status,
    })),
    SMOKE_CHAIN,
  ).calls.map(
    (data) => (decodeFunctionData({ abi: viatikLedgerAbi, data }) as { functionName: string }).functionName,
  )
  checkSame(t, 'F12 pause, resume and cancel call their functions', statusCalls, [
    'pauseSchedule',
    'resumeSchedule',
    'cancelSchedule',
  ])
  const runCall = decodeFunctionData({
    abi: viatikLedgerAbi,
    data: encodePlan([run], SMOKE_CHAIN).calls[0]!,
  }) as unknown as {
    functionName: string
    args: readonly [Hex, Hex]
  }
  t.check(
    'F12 runSchedule calldata: the schedule and the run’s payment id',
    runCall.functionName === 'runSchedule' &&
      runCall.args[0] === ledgerId('smoke', schedule.id) &&
      runCall.args[1] === ledgerId('smoke', scheduleRunPaymentId(schedule.id, 1)),
  )

  // The contract's schedule errors, decoded as the Monad adapter does, in the mock's words.
  const notDue = ledgerErrorOf(
    encodeErrorResult({ abi: viatikLedgerAbi, errorName: 'NotDue', args: [zeroHash, 123n] }),
  )
  const paused = ledgerErrorOf(
    encodeErrorResult({ abi: viatikLedgerAbi, errorName: 'SchedulePaused', args: [zeroHash] }),
  )
  t.check(
    'F12 NotDue and SchedulePaused decode to not_due and schedule_paused, with the mock’s words',
    notDue?.code === 'not_due' &&
      notDue.message === 'This scheduled payment is not due yet on the ledger.' &&
      paused?.code === 'schedule_paused' &&
      paused.message === 'This scheduled payment is paused.',
    JSON.stringify({ notDue, paused }),
  )
  t.check('F12 the mock’s keeper is the actor of keeper plans', KEEPER_ACTOR === 'keeper')
}

// ─── F13. Failing again after a resume ───────────────────────────────────────

async function failsAfterResume(t: Checker) {
  const w = new World(t, 'f13')
  const schedule = await scheduleVendor(w, 5, 'F13 Maya schedules Canvasly in 5 minutes')
  await w.run(U.maya, 'setBudgetPaused', { budgetId: B.arcTools, paused: true }, 'F13 the budget is paused', {
    ops: ['setBudgetPaused'],
  })
  w.later(10 * MINUTE)
  const reason = { code: 'policy_rejected', message: 'This budget is paused. New payments are on hold.' }
  const toldAttention = (state: ViatikState) =>
    state.notifications.filter((n) => n.title === 'Scheduled payment needs attention').length
  const shownIn = (state: ViatikState) =>
    scheduleState(
      state,
      must(
        state.schedules.find((s) => s.id === schedule.id),
        'schedule',
      ),
      w.now,
    )

  const first = noteFailure(w.state, w.now, scheduleOf(w, schedule.id), reason)
  t.check('F13 the first failure is noted and told', first.noted && toldAttention(first.state) === 2)
  w.state = first.state

  await w.run(U.maya, 'pauseSchedule', { scheduleId: schedule.id }, 'F13 Maya pauses it', {
    ops: ['setScheduleStatus'],
  })
  await w.run(U.maya, 'resumeSchedule', { scheduleId: schedule.id }, 'F13 Maya resumes it', {
    ops: ['setScheduleStatus'],
  })
  const resumed = scheduleOf(w, schedule.id)
  t.check(
    'F13 the resume clears the failure and counts itself; the run is due again',
    resumed.failure === undefined && resumed.resumes === 1 && shownIn(w.state) === 'due',
    JSON.stringify({ failure: resumed.failure, resumes: resumed.resumes }),
  )
  t.check(
    'F13 the failure after a resume has its own seed',
    keeperFailureSeed(schedule.id, 1, reason.code, 1) !== keeperFailureSeed(schedule.id, 1, reason.code) &&
      keeperFailureSeed(schedule.id, 1, reason.code, 0) === keeperFailureSeed(schedule.id, 1, reason.code),
  )

  // The keeper's next pass: the same run fails for the same reason.
  const pass = await runDueOnMock(w.state, { now: w.now, trigger: 'automatic' })
  t.check(
    'F13 the pass counts it as failed',
    pass.answer.failed === 1 && pass.answer.paid === 0,
    JSON.stringify(pass.answer),
  )
  const again = must(
    pass.state.schedules.find((s) => s.id === schedule.id),
    'schedule',
  )
  t.check(
    'F13 it needs attention again (not lost to the earlier notice)',
    shownIn(pass.state) === 'needs_attention' && again.failure?.code === reason.code,
    JSON.stringify(again.failure),
  )
  t.check('F13 the Admins are told again, once', toldAttention(pass.state) === 4)
  w.state = pass.state
  w.later(10 * MINUTE)
  const next = await runDueOnMock(w.state, { now: w.now, trigger: 'automatic' })
  t.check(
    'F13 it keeps failing: still needs attention, nobody told a third time',
    shownIn(next.state) === 'needs_attention' && toldAttention(next.state) === 4,
  )
  t.check(
    'F13 the pass that noted it changed the state; one that only failed again changes nothing but its record',
    pass.changed && next.changed === next.answer.reminders > 0,
    JSON.stringify({ first: pass.changed, next: next.changed, reminders: next.answer.reminders }),
  )

  // A world saved before resumes were counted: after its resume the failure's seed is already used.
  const old = structuredClone(first.state) as ViatikState
  const stale = must(
    old.schedules.find((s) => s.id === schedule.id),
    'schedule',
  )
  delete stale.failure
  delete stale.resumes
  t.check('F13 (old world) cleared by a resume, it shows as due', shownIn(old) === 'due')
  const collided = noteFailure(old, w.now, stale, reason)
  t.check(
    'F13 (old world) the seed collides: still noted, quietly (needs attention, nobody told again)',
    !collided.noted &&
      collided.state !== old &&
      shownIn(collided.state) === 'needs_attention' &&
      collided.state.notifications.length === old.notifications.length,
  )
}

// ─── F14. A Member and a stopped schedule ────────────────────────────────────

async function memberAndStopped(t: Checker) {
  const w = new World(t, 'f14')
  const toAlex = (await scheduleAlex(w, 60, 'F14 Maya schedules Alex in an hour')).result
  t.check(
    'F14 Alex sees it as his next payment',
    upcomingPayments(w.view(U.alex), { recipientUserId: U.alex }).some((p) => p.scheduleId === toAlex.id),
  )
  const maya = must(
    w.state.memberships.find(
      (m) =>
        m.userId === U.maya && m.scope.kind === 'agency' && m.scope.agencyId === ARC && m.status === 'active',
    ),
    'Maya’s membership',
  )
  await w.run(U.jordan, 'revokeMembership', { membershipId: maya.id }, 'F14 Jordan removes Maya')
  const alex = w.view(U.alex)
  t.check(
    'F14 the stopped schedule is left out of Alex’s view',
    !alex.schedules.some((s) => s.id === toAlex.id),
    JSON.stringify(alex.schedules.map((s) => s.id)),
  )
  t.check(
    'F14 so it is not his next payment',
    upcomingPayments(alex, { recipientUserId: U.alex }).length === 0,
  )
  const jordan = w.view(U.jordan)
  const theirs = must(
    jordan.schedules.find((s) => s.id === toAlex.id),
    'the schedule in Jordan’s view',
  )
  t.check('F14 the Agency Admin still sees it, stopped', scheduleState(jordan, theirs, w.now) === 'stopped')
  await w.run(U.jordan, 'cancelSchedule', { scheduleId: toAlex.id }, 'F14 Jordan cancels it', {
    ops: ['setScheduleStatus'],
  })
  t.check(
    'F14 once cancelled, Alex sees it in his history as cancelled',
    w.view(U.alex).schedules.some((s) => s.id === toAlex.id && s.status === 'cancelled') &&
      upcomingPayments(w.view(U.alex), { recipientUserId: U.alex }).length === 0,
  )
  // A schedule whose Admin still holds the role is still his next payment.
  const byJordan = (await scheduleAlexBy(w, U.jordan, 60, 'F14 Jordan schedules Alex')).result
  t.check(
    'F14 a schedule whose Admin is active is still his next payment',
    upcomingPayments(w.view(U.alex), { recipientUserId: U.alex }).some((p) => p.scheduleId === byJordan.id),
  )
}

/** As `scheduleAlex`, by another Admin of Arc Studio. */
async function scheduleAlexBy(w: World, adminId: Id, minutes: number, label: string) {
  await w.gather(adminId, ACC.arcOperations, usd(500))
  return w.run(
    adminId,
    'schedulePayment',
    {
      agencyId: ARC,
      type: 'team',
      recipient: { kind: 'member', userId: U.alex },
      accountId: ACC.arcOperations,
      amount: usd(25),
      category: 'team',
      memo: 'Design sprint',
      firstRunAt: inMinutes(w, minutes),
    },
    label,
    { ops: ['createSchedule'] },
  )
}

// ─── F15. What a pass answers, and the keeper's run rows ─────────────────────

async function passTotals(t: Checker) {
  const counts = new Map([
    [ARC, { paid: 1, failed: 0, waiting: 1, reminders: 0 }],
    [A.lumen, { paid: 2, failed: 1, waiting: 0, reminders: 1 }],
  ])
  checkSame(t, 'F15 a manual pass for Arc Studio answers for Arc Studio only', keeperTotals(counts, [ARC]), {
    paid: 1,
    failed: 0,
    waiting: 1,
    reminders: 0,
  })
  checkSame(
    t,
    'F15 an automatic pass answers for every Agency (one with nothing counts nothing)',
    keeperTotals(counts, [ARC, A.lumen, A.fieldwork]),
    { paid: 3, failed: 1, waiting: 1, reminders: 1 },
  )
  checkSame(t, 'F15 an Agency named twice is counted once', keeperTotals(counts, [ARC, ARC]).paid, 1)

  // The mock pass, pressed for one Agency while another Agency's run is due: it neither pays nor counts it.
  const w = new World(t, 'f15')
  const arc = (await scheduleAlex(w, 5, 'F15 Maya schedules Alex')).result
  w.later(10 * MINUTE)
  const lumenPass = await runDueOnMock(w.state, {
    now: w.now,
    trigger: 'manual',
    agencyId: A.lumen,
    by: U.ren,
  })
  t.check(
    'F15 a press for Lumen Labs pays nothing of Arc Studio’s and answers nothing',
    lumenPass.answer.paid === 0 &&
      lumenPass.answer.failed === 0 &&
      lumenPass.state.schedules.find((s) => s.id === arc.id)?.status === 'active',
    JSON.stringify(lumenPass.answer),
  )

  checkSame(
    t,
    'F15 a run row is replaced only when it failed',
    (['failed', 'pending', 'expired', 'done', 'diverged'] as const).map((status) =>
      runRowReplaceable(status),
    ),
    [true, false, false, false, false],
  )
  t.check('F15 a run with no row yet is stored', runRowReplaceable(undefined))
}

// ─── F16. Payments from before schedules ─────────────────────────────────────

async function unscheduled(t: Checker) {
  const w = new World(t, 'f16')
  const legacy = (id: Id): Payment => ({
    id,
    agencyId: ARC,
    type: 'tool',
    sourceAccountId: ACC.arcVendors,
    recipient: { kind: 'destination', destinationId: DST.canvasly },
    amount: usd(40),
    category: 'software',
    memo: 'Canvasly seats',
    status: 'scheduled',
    createdBy: { kind: 'user', userId: U.maya },
    scheduledFor: plusHours(w.now, 48),
  })
  const old = structuredClone(w.state) as ViatikState
  old.payments.push(legacy('pay_legacy_again'), legacy('pay_legacy_dismiss'))
  w.state = upgradeState(old)
  const notScheduled = () =>
    w.state.payments
      .filter((p) => p.agencyId === ARC && isUnscheduledPayment(p))
      .map((p) => p.id)
      .sort()
  checkSame(t, 'F16 two old payments show as not scheduled', notScheduled(), [
    'pay_legacy_again',
    'pay_legacy_dismiss',
  ])

  await w.fund(U.maya, B.arcTools, usd(400))
  const input = {
    agencyId: ARC,
    type: 'tool' as const,
    recipient: { kind: 'destination' as const, destinationId: DST.canvasly },
    accountId: ACC.arcVendors,
    budgetId: B.arcTools,
    amount: usd(40),
    category: 'software' as const,
    memo: 'Canvasly seats',
    firstRunAt: inMinutes(w, 60),
  }
  const completed = must(
    w.state.payments.find((p) => p.agencyId === ARC && p.status === 'completed'),
    'a completed Arc Studio payment',
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...input, replacesPaymentId: completed.id },
    'invalid_state',
    'F16 a paid payment cannot be replaced by a schedule',
  )
  const before = w.state
  const again = await w.run(
    U.maya,
    'schedulePayment',
    { ...input, replacesPaymentId: 'pay_legacy_again' },
    'F16 Maya schedules the old payment again',
    { ops: ['createSchedule'] },
  )
  t.check(
    'F16 the new schedule replaces the old payment, in the same command',
    w.state.schedules.some((s) => s.id === again.result.id && s.status === 'active') &&
      !w.state.payments.some((p) => p.id === 'pay_legacy_again'),
  )
  checkSame(t, 'F16 one old payment is left not scheduled (the badge counts one)', notScheduled(), [
    'pay_legacy_dismiss',
  ])
  t.check(
    'F16 scheduling it again holds the old payment while it is on its way',
    heldByCommand(
      'schedulePayment',
      { ...input, replacesPaymentId: 'pay_legacy_again' },
      again.plan,
      before,
      again.after,
    ).has('payment:pay_legacy_again'),
  )
  w.refuse(
    U.maya,
    'schedulePayment',
    { ...input, replacesPaymentId: 'pay_legacy_again' },
    'invalid_state',
    'F16 the same old payment scheduled again twice',
  )

  // Dismiss: an Agency Admin only, once, never a real payment.
  w.refuse(
    U.alex,
    'dismissUnscheduledPayment',
    { paymentId: 'pay_legacy_dismiss' },
    'forbidden',
    'F16 a Member cannot dismiss it',
  )
  w.refuse(
    U.elena,
    'dismissUnscheduledPayment',
    { paymentId: 'pay_legacy_dismiss' },
    'forbidden',
    'F16 the Investor cannot dismiss it',
  )
  w.refuse(
    U.jordan,
    'dismissUnscheduledPayment',
    { paymentId: completed.id },
    'invalid_state',
    'F16 a paid payment cannot be dismissed',
  )
  t.check(
    'F16 dismissing holds the payment',
    heldByCommand(
      'dismissUnscheduledPayment',
      { paymentId: 'pay_legacy_dismiss' },
      null,
      w.state,
      w.state,
    ).has('payment:pay_legacy_dismiss'),
  )
  const dismissed = await w.run(
    U.jordan,
    'dismissUnscheduledPayment',
    { paymentId: 'pay_legacy_dismiss' },
    'F16 Jordan dismisses the other one',
    { ops: [] },
  )
  t.check(
    'F16 dismissed: gone, offchain, with an activity',
    !w.state.payments.some((p) => p.id === 'pay_legacy_dismiss') &&
      dismissed.plan === null &&
      dismissed.activity.some((a) => a.summary.startsWith('Dismissed the never-paid')),
  )
  t.check('F16 nothing is left not scheduled', notScheduled().length === 0)
  w.refuse(
    U.jordan,
    'dismissUnscheduledPayment',
    { paymentId: 'pay_legacy_dismiss' },
    'not_found',
    'F16 dismissing it twice',
  )
}

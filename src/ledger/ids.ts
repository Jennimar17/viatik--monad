import { keccak256, stringToHex } from 'viem'

import type { Id } from '@/domain/types'

import type { Hash, LedgerOp, SettlementPlan } from './types'

/**
 * The ledger's id for a product id: keccak256 of `<namespace>:<id>`. The
 * namespace changes with every re-seed, because the seed reuses fixed ids.
 */
export function ledgerId(namespace: string, productId: Id): Hash {
  return keccak256(stringToHex(`${namespace}:${productId}`))
}

/** Product ids the contract records (`Recorded`) for a plan, in order. */
export function opIdsOf(plan: SettlementPlan): Id[] {
  return plan.records.map((record) => record.opId)
}

/** ViatikLedger events that prove an operation ran. */
export type LedgerEvent =
  | 'Recorded'
  | 'PortfolioCreated'
  | 'AgencyRegistered'
  | 'RoleSet'
  | 'LocationCreated'
  | 'AgreementCreated'
  | 'AgreementAccepted'
  | 'AgreementPausedSet'
  | 'TrancheRequested'
  | 'TrancheChangesRequested'
  | 'BudgetCreated'
  | 'BudgetRulesUpdated'
  | 'BudgetPausedSet'
  | 'AllowanceSet'
  | 'PaymentExecuted'
  | 'PaymentPending'
  | 'PaymentRejected'
  | 'RequestClosed'
  | 'EvidenceRecorded'
  | 'ScheduleCreated'
  | 'ScheduleStatusChanged'

/**
 * What proves one operation ran: one of `events`, carrying the indexed `id`
 * (and the person, for roles and allowances) and the values in `args`, so
 * that opposite operations (pause and resume, join and revoke) are told apart.
 */
export type Witness = {
  events: LedgerEvent[]
  id: Id
  userId?: Id
  args?: Record<string, string | number | boolean | null>
}

/**
 * One witness per operation, looked for in the logs of the transaction being
 * confirmed (never in older history). Only money operations leave a
 * `Recorded`; the others prove themselves with their own event. An operation
 * without its witness did not happen.
 */
export function witnessesOf(plan: SettlementPlan): Witness[] {
  return plan.ops.map(witnessOf)
}

function witnessOf(op: LedgerOp): Witness {
  const one = (event: LedgerEvent, id: Id, extra: Omit<Witness, 'events' | 'id'> = {}): Witness => ({
    events: [event],
    id,
    ...extra,
  })
  switch (op.call) {
    case 'createPortfolio':
      return one('PortfolioCreated', op.portfolioId)
    case 'registerAgency':
      return one('AgencyRegistered', op.agencyId)
    case 'join':
    case 'revokeRole':
      return one('RoleSet', op.scope.kind === 'portfolio' ? op.scope.portfolioId : op.scope.agencyId, {
        userId: op.userId,
        args: { role: op.call === 'join' ? op.role : 'none' },
      })
    case 'createAccount':
      return one('LocationCreated', op.accountId)
    case 'createAgreement':
      return one('AgreementCreated', op.agreementId)
    case 'acceptAgreement':
      return one('AgreementAccepted', op.agreementId)
    case 'setAgreementPaused':
      return one('AgreementPausedSet', op.agreementId, { args: { paused: op.paused } })
    case 'requestTranche':
      return one('TrancheRequested', op.trancheId, {
        args: { account: op.accountId, evidenceHash: op.evidenceHash },
      })
    case 'requestChanges':
      return one('TrancheChangesRequested', op.trancheId, { args: { rejected: op.reject } })
    case 'createBudget':
      return one('BudgetCreated', op.budgetId)
    case 'updateRules':
      return one('BudgetRulesUpdated', op.budgetId, {
        args: { perOperationLimit: op.perOperationLimit, approvalThreshold: op.approvalThreshold },
      })
    case 'setBudgetPaused':
      return one('BudgetPausedSet', op.budgetId, { args: { paused: op.paused } })
    case 'setAllowance':
      // Every value the event carries: another allowance change for the same person is not this one.
      return one('AllowanceSet', op.budgetId, {
        userId: op.userId,
        args: { active: op.active, perOperationLimit: op.perOperationLimit },
      })
    case 'closeRequest':
      return one('RequestClosed', op.requestId)
    case 'recordEvidence':
      // The invoice anchored for an outside payment: no money, so no `Recorded`.
      return one('EvidenceRecorded', op.paymentId, { args: { evidenceHash: op.evidenceHash } })
    case 'createSchedule':
      return one('ScheduleCreated', op.scheduleId)
    case 'setScheduleStatus':
      // Pausing, resuming and cancelling the same schedule are told apart by the status the event carries.
      return one('ScheduleStatusChanged', op.scheduleId, { args: { status: op.status } })
    case 'requestPayment':
      // Whatever the ledger decided, the request is named in one of these (the
      // second indexed topic of PaymentExecuted). The outcome is read from which
      // one it is and compared with the plan's records.
      return { events: ['PaymentExecuted', 'PaymentPending', 'PaymentRejected'], id: op.requestId }
    case 'releaseTranche':
      return one('Recorded', op.trancheId)
    case 'approvePayment':
    case 'pay':
    case 'payOutside':
    case 'runSchedule':
      return one('Recorded', op.paymentId)
    case 'deposit':
    case 'fundAgreement':
    case 'transfer':
    case 'allocate':
    case 'returnToAgency':
    case 'withdraw':
    case 'withdrawMemberBalance':
    case 'returnCapital':
      return one('Recorded', op.opId)
  }
}

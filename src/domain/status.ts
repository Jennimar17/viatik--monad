import type { ScheduleState } from './schedules'
import type {
  AgencyStatus,
  AgentStatus,
  AgreementStatus,
  BillStatus,
  BudgetStatus,
  MilestoneStatus,
  OperationStatus,
  ReminderStatus,
  RequestStatus,
  TrancheStatus,
} from './types'

/**
 * Human status language. Tones map to restrained semantic colors in the UI;
 * raw infrastructure states never appear outside Verified details.
 */
export type StatusTone = 'neutral' | 'info' | 'accent' | 'success' | 'warning' | 'danger'

export type StatusDescriptor = { label: string; tone: StatusTone }

export const agreementStatus: Record<AgreementStatus, StatusDescriptor> = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_acceptance: { label: 'Pending acceptance', tone: 'warning' },
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'info' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'Expired', tone: 'neutral' },
}

export const agencyStatus: Record<AgencyStatus, StatusDescriptor> = {
  onboarding: { label: 'Onboarding', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  frozen: { label: 'Frozen', tone: 'danger' },
  closed: { label: 'Closed', tone: 'neutral' },
}

export const trancheStatus: Record<TrancheStatus, StatusDescriptor> = {
  planned: { label: 'Planned', tone: 'neutral' },
  available: { label: 'Available to request', tone: 'info' },
  requested: { label: 'Requested', tone: 'accent' },
  under_review: { label: 'Under review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  released: { label: 'Released', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

export const milestoneStatus: Record<MilestoneStatus, StatusDescriptor> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  ready_for_review: { label: 'Ready for review', tone: 'warning' },
  changes_requested: { label: 'Changes requested', tone: 'danger' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
}

export const operationStatus: Record<OperationStatus, StatusDescriptor> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  preparing: { label: 'Preparing', tone: 'neutral' },
  waiting_for_confirmation: { label: 'Waiting for confirmation', tone: 'info' },
  processing: { label: 'Processing', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  action_required: { label: 'Action required', tone: 'warning' },
}

export const requestStatus: Record<RequestStatus, StatusDescriptor> = {
  needs_approval: { label: 'Needs approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  processing: { label: 'Processing', tone: 'accent' },
  completed: { label: 'Completed', tone: 'success' },
  rejected: { label: 'Outside budget rules', tone: 'danger' },
  declined: { label: 'Declined', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
}

/** A request's badge: like `requestStatus`, but a rejection by the Investor's exception threshold says so. */
export function requestStatusFor(request: {
  status: RequestStatus
  decision?: { reason?: { rule: string } }
}): StatusDescriptor {
  if (request.status === 'rejected' && request.decision?.reason?.rule === 'exception_threshold')
    return { label: 'Above exception threshold', tone: 'danger' }
  return requestStatus[request.status]
}

export const budgetStatus: Record<BudgetStatus, StatusDescriptor> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  expired: { label: 'Expired', tone: 'neutral' },
  closed: { label: 'Closed', tone: 'neutral' },
}

export const billStatus: Record<BillStatus | 'overdue', StatusDescriptor> = {
  to_pay: { label: 'To pay', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'accent' },
  paid: { label: 'Paid', tone: 'success' },
  reconciled: { label: 'Reconciled', tone: 'success' },
  overdue: { label: 'Overdue', tone: 'danger' },
}

export const agentStatus: Record<AgentStatus, StatusDescriptor> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  expired: { label: 'Expired', tone: 'neutral' },
}

/**
 * The invoice of a payment made outside Viatik. It is overdue when it is still
 * missing some days after the payment (src/domain/accountability.ts decides).
 */
export type ProofState = 'missing' | 'attached' | 'overdue'

export const proofStatus: Record<ProofState, StatusDescriptor> = {
  missing: { label: 'Invoice pending', tone: 'warning' },
  attached: { label: 'Invoice attached', tone: 'success' },
  overdue: { label: 'Invoice overdue', tone: 'danger' },
}

export const proofState = (payment: { proof?: unknown }, overdue: boolean): ProofState =>
  payment.proof ? 'attached' : overdue ? 'overdue' : 'missing'

/**
 * Money a person requested for purchases: pending until receipts (or what they
 * give back) cover it, overdue when that takes too long (src/domain/accountability.ts).
 */
export type JustificationState = 'pending' | 'overdue' | 'justified'

export const justificationStatus: Record<JustificationState, StatusDescriptor> = {
  pending: { label: 'Receipts pending', tone: 'info' },
  overdue: { label: 'Receipts overdue', tone: 'danger' },
  justified: { label: 'Justified', tone: 'success' },
}

export const justificationState = (standing: { settled: boolean; overdue: boolean }): JustificationState =>
  standing.settled ? 'justified' : standing.overdue ? 'overdue' : 'pending'

export const reminderStatus: Record<ReminderStatus, StatusDescriptor> = {
  active: { label: 'Active', tone: 'success' },
  paused: { label: 'Paused', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
}

/** A scheduled payment's badge, from `scheduleState` (src/domain/schedules.ts). */
export const scheduleStatus: Record<ScheduleState, StatusDescriptor> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  due: { label: 'Due · paying soon', tone: 'accent' },
  needs_attention: { label: 'Needs attention', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  completed: { label: 'Completed', tone: 'success' },
}

// ─── Transition guards ───────────────────────────────────────────────────────

const agreementTransitions: Record<AgreementStatus, AgreementStatus[]> = {
  draft: ['pending_acceptance', 'cancelled'],
  pending_acceptance: ['active', 'cancelled'],
  active: ['paused', 'completed', 'expired'],
  paused: ['active', 'cancelled', 'expired'],
  completed: [],
  cancelled: [],
  expired: [],
}

const trancheTransitions: Record<TrancheStatus, TrancheStatus[]> = {
  planned: ['available', 'cancelled'],
  available: ['requested', 'cancelled'],
  requested: ['under_review', 'cancelled'],
  under_review: ['approved', 'rejected', 'available'],
  approved: ['released'],
  released: [],
  rejected: ['available'],
  cancelled: [],
}

const milestoneTransitions: Record<MilestoneStatus, MilestoneStatus[]> = {
  not_started: ['in_progress'],
  in_progress: ['ready_for_review'],
  ready_for_review: ['approved', 'changes_requested', 'rejected'],
  changes_requested: ['ready_for_review'],
  approved: [],
  rejected: [],
}

const requestTransitions: Record<RequestStatus, RequestStatus[]> = {
  needs_approval: ['approved', 'declined', 'cancelled'],
  approved: ['processing', 'cancelled'],
  processing: ['completed', 'approved'],
  completed: [],
  rejected: [],
  declined: [],
  cancelled: [],
}

/** Paused and running reminders switch freely; archiving is final. */
const reminderTransitions: Record<ReminderStatus, ReminderStatus[]> = {
  active: ['paused', 'archived'],
  paused: ['active', 'archived'],
  archived: [],
}

function guard<S extends string>(table: Record<S, S[]>) {
  return (from: S, to: S) => table[from].includes(to)
}

export const canTransitionAgreement = guard(agreementTransitions)
export const canTransitionTranche = guard(trancheTransitions)
export const canTransitionMilestone = guard(milestoneTransitions)
export const canTransitionRequest = guard(requestTransitions)
export const canTransitionReminder = guard(reminderTransitions)

export class InvalidTransitionError extends Error {
  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot move from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export function assertTransition<S extends string>(
  entity: string,
  check: (from: S, to: S) => boolean,
  from: S,
  to: S,
): void {
  if (!check(from, to)) throw new InvalidTransitionError(entity, from, to)
}

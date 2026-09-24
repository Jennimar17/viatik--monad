import type {
  AgentStatus,
  AgreementStatus,
  BillStatus,
  BudgetStatus,
  MilestoneStatus,
  OperationStatus,
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

function guard<S extends string>(table: Record<S, S[]>) {
  return (from: S, to: S) => table[from].includes(to)
}

export const canTransitionAgreement = guard(agreementTransitions)
export const canTransitionTranche = guard(trancheTransitions)
export const canTransitionMilestone = guard(milestoneTransitions)
export const canTransitionRequest = guard(requestTransitions)

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

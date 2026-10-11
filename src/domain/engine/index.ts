import type { ViatikState } from '../types'
import { execute, type CommandContext, type Tx } from './core'
import * as funding from './funding'
import * as operations from './operations'
import * as outside from './outside'
import * as people from './people'
import * as schedules from './schedules'

/**
 * Every state-changing operation in the product. The mock data source (client)
 * and the API (server) both dispatch through this map, so behavior is
 * identical whichever side runs it.
 */
export const commands = {
  createPortfolio: funding.createPortfolio,
  createAgency: funding.createAgency,
  createAgreement: funding.createAgreement,
  acceptAgreement: funding.acceptAgreement,
  setAgreementPaused: funding.setAgreementPaused,
  addFunds: funding.addFunds,
  withdrawFunds: funding.withdrawFunds,
  fundAgreement: funding.fundAgreement,
  submitMilestoneEvidence: funding.submitMilestoneEvidence,
  requestTranche: funding.requestTranche,
  releaseTranche: funding.releaseTranche,
  requestMilestoneChanges: funding.requestMilestoneChanges,
  createAccount: operations.createAccount,
  openOperationsAccount: operations.openOperationsAccount,
  transferFunds: operations.transferFunds,
  createBudget: operations.createBudget,
  allocateToBudget: operations.allocateToBudget,
  updateBudgetRules: operations.updateBudgetRules,
  setBudgetPaused: operations.setBudgetPaused,
  assignAllowance: operations.assignAllowance,
  revokeAllowance: operations.revokeAllowance,
  requestPayment: operations.requestPayment,
  approveRequest: operations.approveRequest,
  declineRequest: operations.declineRequest,
  cancelRequest: operations.cancelRequest,
  sendPayment: operations.sendPayment,
  sendTeamPayments: operations.sendTeamPayments,
  addBill: operations.addBill,
  payBill: operations.payBill,
  reconcile: operations.reconcile,
  addExpense: operations.addExpense,
  attachReceipt: operations.attachReceipt,
  addDestination: operations.addDestination,
  returnUnusedFunds: operations.returnUnusedFunds,
  withdrawBalance: operations.withdrawBalance,
  addPayoutAddress: operations.addPayoutAddress,
  removePayoutAddress: operations.removePayoutAddress,
  updateDestination: operations.updateDestination,
  setDestinationStatus: operations.setDestinationStatus,
  payOutside: outside.payOutside,
  addPaymentProof: outside.addPaymentProof,
  returnToInvestor: outside.returnToInvestor,
  remindReceipts: outside.remindReceipts,
  createReminder: outside.createReminder,
  setReminderStatus: outside.setReminderStatus,
  schedulePayment: schedules.schedulePayment,
  pauseSchedule: schedules.pauseSchedule,
  resumeSchedule: schedules.resumeSchedule,
  cancelSchedule: schedules.cancelSchedule,
  dismissUnscheduledPayment: schedules.dismissUnscheduledPayment,
  invite: people.invite,
  acceptInvitation: people.acceptInvitation,
  cancelInvitation: people.cancelInvitation,
  revokeMembership: people.revokeMembership,
  createAgent: people.createAgent,
  updateAgentPolicy: people.updateAgentPolicy,
  setAgentPaused: people.setAgentPaused,
  markNotificationsRead: people.markNotificationsRead,
  updateProfile: people.updateProfile,
}

export type Commands = typeof commands
export type CommandName = keyof Commands
export type CommandInput<N extends CommandName> = Parameters<Commands[N]>[1]
export type CommandResult<N extends CommandName> = ReturnType<Commands[N]>

export function runCommand<N extends CommandName>(
  state: ViatikState,
  ctx: CommandContext,
  name: N,
  input: CommandInput<N>,
): { state: ViatikState; result: CommandResult<N> } {
  const command = commands[name] as unknown as (tx: Tx, input: CommandInput<N>) => CommandResult<N>
  return execute(state, ctx, (tx) => command(tx, input))
}

export { DomainError, execute, Tx, type CommandContext, type DomainErrorCode, type VerifyInput } from './core'
export { previewPolicy, workPaymentId } from './operations'
export type {
  AllowanceDraft,
  CreateBudgetInput,
  RequestPaymentInput,
  SendPaymentInput,
  AddBillInput,
} from './operations'
export type {
  CreateAgencyInput,
  CreateAgreementInput,
  CreatePortfolioInput,
  TrancheDraft,
  EvidenceDraft,
} from './funding'
export type {
  AddPaymentProofInput,
  CreateReminderInput,
  PayOutsideInput,
  RemindReceiptsInput,
  ReturnToInvestorInput,
  SetReminderStatusInput,
} from './outside'
export type { CreateAgentInput } from './people'
export type { DismissUnscheduledPaymentInput, ScheduleRefInput, SchedulePaymentInput } from './schedules'

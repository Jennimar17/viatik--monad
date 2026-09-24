import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import { agreementCapital, accountBalance, budgetAvailable } from '@/domain/selectors'
import type { Actor, Id, PaymentRequest, ViatikState } from '@/domain/types'
import type { LedgerAdapter, LedgerResult } from '@/ledger/types'

/**
 * Bridge between domain commands and the ledger. The engine decides what a
 * command means for the product; the ledger settles the money under the same
 * limits the contract enforces. A ledger rejection is authoritative.
 *
 * `plan` receives the state before and after running the command so every
 * ledger input is derived from real balances, not from what the UI sent.
 */
export type Settlement = {
  settle: (ledger: LedgerAdapter) => Promise<LedgerResult>
  /** Keep the engine's state even when the ledger rejects (e.g. a rejected request stays in history). */
  keepOnFailure?: boolean
}

type PlanArgs<N extends CommandName> = {
  name: N
  input: CommandInput<N>
  result: CommandResult<N>
  before: ViatikState
  after: ViatikState
  actor: Actor
  idempotencyKey: string
}

const actorId = (actor: Actor): Id =>
  actor.kind === 'user' ? actor.userId : actor.kind === 'ai_agent' ? actor.agentId : 'system'

/** Payments created by the command, each captured on the ledger. */
function newPayments(before: ViatikState, after: ViatikState) {
  const known = new Set(before.payments.map((p) => p.id))
  return after.payments.filter((p) => !known.has(p.id))
}

function captureAll(args: PlanArgs<CommandName>, base: { idempotencyKey: string; actorId: Id }) {
  return async (ledger: LedgerAdapter): Promise<LedgerResult | null> => {
    let last: LedgerResult | null = null
    for (const payment of newPayments(args.before, args.after)) {
      last = await ledger.capturePayment({
        ...base,
        idempotencyKey: `${base.idempotencyKey}:${payment.id}`,
        requestId: payment.requestId ?? payment.id,
        paymentId: payment.id,
        amount: payment.amount,
      })
      if (last.status === 'failed') return last
    }
    return last
  }
}

export function planSettlement<N extends CommandName>(args: PlanArgs<N>): Settlement | null {
  const { before, after, idempotencyKey } = args
  const base = { idempotencyKey, actorId: actorId(args.actor) }
  const input = args.input as Record<string, unknown>
  const generic = args as unknown as PlanArgs<CommandName>

  switch (args.name) {
    case 'fundAgreement': {
      const agreementId = input.agreementId as Id
      const agreement = before.agreements.find((a) => a.id === agreementId)
      if (!agreement) return null
      const capital = agreementCapital(before, agreementId)
      return {
        settle: (ledger) =>
          ledger.fundAgreement({
            ...base,
            agreementId,
            amount: input.amount as never,
            funded: capital.funded,
            committed: agreement.committed,
          }),
      }
    }

    case 'requestTranche':
      return {
        settle: (ledger) =>
          ledger.requestTranche({
            ...base,
            trancheId: input.trancheId as Id,
            agreementId: after.tranches.find((t) => t.id === input.trancheId)?.agreementId ?? '',
          }),
      }

    case 'submitMilestoneEvidence': {
      const milestone = after.milestones.find((m) => m.id === input.milestoneId)
      if (!milestone?.evidenceHash) return null
      return {
        settle: (ledger) =>
          ledger.submitMilestoneEvidence({
            ...base,
            milestoneId: milestone.id,
            evidenceHash: milestone.evidenceHash!,
          }),
      }
    }

    case 'releaseTranche': {
      const tranche = after.tranches.find((t) => t.id === input.trancheId)
      if (!tranche) return null
      const capital = agreementCapital(before, tranche.agreementId)
      return {
        settle: (ledger) =>
          ledger.releaseTranche({
            ...base,
            trancheId: tranche.id,
            agreementId: tranche.agreementId,
            destinationAccountId: tranche.destinationAccountId ?? '',
            amount: tranche.amount,
            funded: capital.funded,
            released: capital.released,
            requestedBy: tranche.requestedBy,
          }),
      }
    }

    case 'transferFunds': {
      const fromAccountId = input.fromAccountId as Id
      return {
        settle: (ledger) =>
          ledger.transfer({
            ...base,
            fromAccountId,
            toAccountId: input.toAccountId as Id,
            amount: input.amount as never,
            available: accountBalance(before, fromAccountId),
          }),
      }
    }

    case 'createBudget': {
      const budget = after.budgets.find((b) => !before.budgets.some((x) => x.id === b.id))
      if (!budget) return null
      return {
        settle: (ledger) =>
          ledger.createBudget({
            ...base,
            budgetId: budget.id,
            sourceAccountId: budget.sourceAccountId,
            allocation: input.allocation as never,
            perOperationLimit: budget.perOperationLimit,
            periodLimit: budget.periodLimit,
            approvalThreshold: budget.approvalThreshold,
            allowedDestinations: budget.allowedDestinationIds,
          }),
      }
    }

    case 'assignAllowance': {
      const allowance = after.allowances.find((a) => !before.allowances.some((x) => x.id === a.id))
      if (!allowance) return null
      return {
        settle: (ledger) =>
          ledger.setAllowance({
            ...base,
            budgetId: allowance.budgetId,
            holderId: allowance.holder.kind === 'member' ? allowance.holder.userId : allowance.holder.agentId,
            periodLimit: allowance.periodLimit,
            perOperationLimit: allowance.perOperationLimit,
          }),
      }
    }

    case 'requestPayment': {
      const request = args.result as PaymentRequest
      // Requests waiting for an Agency Admin are settled when approved.
      if (request.status === 'needs_approval') return null
      const budget = before.budgets.find((b) => b.id === request.budgetId)
      if (!budget || request.destination.kind !== 'destination') return null
      const allowance = before.allowances.find(
        (a) =>
          a.budgetId === budget.id &&
          a.status === 'active' &&
          ((a.holder.kind === 'member' &&
            request.requester.kind === 'user' &&
            a.holder.userId === request.requester.userId) ||
            (a.holder.kind === 'ai_agent' &&
              request.requester.kind === 'ai_agent' &&
              a.holder.agentId === request.requester.agentId)),
      )
      const perOperationLimit = Math.min(
        budget.perOperationLimit,
        allowance?.perOperationLimit ?? budget.perOperationLimit,
      ) as typeof budget.perOperationLimit
      const destinationId = request.destination.destinationId
      const capture = captureAll(generic, base)
      return {
        // The contract has the final word: a request the policy rejected is
        // submitted anyway so the ledger records the rejection.
        keepOnFailure: request.status === 'rejected',
        settle: async (adapter) => {
          const hold = await adapter.requestPayment({
            ...base,
            requestId: request.id,
            budgetId: budget.id,
            destinationId,
            amount: request.amount,
            perOperationLimit,
            allowedDestinations: budget.allowedDestinationIds,
            budgetAvailable: budgetAvailable(before, budget.id),
            budgetPaused: budget.status !== 'active',
          })
          if (hold.status === 'failed') return hold
          return (await capture(adapter)) ?? hold
        },
      }
    }

    case 'approveRequest': {
      const request = before.requests.find((r) => r.id === input.requestId)
      if (!request) return null
      const requestedBy = actorId(request.requester)
      return {
        settle: async (adapter) => {
          const approval = await adapter.approvePayment({ ...base, requestId: request.id, requestedBy })
          if (approval.status === 'failed') return approval
          return (await captureAll(generic, base)(adapter)) ?? approval
        },
      }
    }

    case 'sendPayment':
    case 'sendTeamPayments':
    case 'payBill':
      return {
        settle: async (adapter) =>
          (await captureAll(generic, base)(adapter)) ?? {
            status: 'completed',
            operationId: idempotencyKey,
          },
      }

    case 'setBudgetPaused':
      return {
        settle: (ledger) =>
          ledger.pauseBudget({ ...base, budgetId: input.budgetId as Id, paused: Boolean(input.paused) }),
      }

    case 'setAgentPaused':
      return {
        settle: (ledger) =>
          ledger.pauseAgent({ ...base, agentId: input.agentId as Id, paused: Boolean(input.paused) }),
      }

    default:
      return null
  }
}

import { formatUsd, type Cents } from '@/domain/money'
import type { Id, VerifiedDetails } from '@/domain/types'
import { simulatedVerification } from '@/domain/verification'

import type {
  ApprovePaymentInput,
  Balances,
  CapturePaymentInput,
  CreateAccountInput,
  CreateAgencyLedgerInput,
  CreateAgreementLedgerInput,
  CreateBudgetInput,
  FundAgreementInput,
  LedgerAdapter,
  LedgerError,
  LedgerResult,
  PauseAgentInput,
  PauseBudgetInput,
  ReleaseTrancheInput,
  RequestPaymentInput,
  RequestTrancheInput,
  SetAllowanceInput,
  StatusListener,
  SubmitMilestoneEvidenceInput,
  TransferInput,
} from './types'

const usd = (value: Cents) => formatUsd(value, { withCode: true })

type Options = {
  /** Simulated confirmation time. Monad finalizes in ~0.8 s; the mock stays close. */
  latencyMs?: number
  onStatus?: StatusListener
  now?: () => string
}

/**
 * Demo ledger. It enforces the same limits the contract will, so a request
 * that exceeds the rules is rejected by "the ledger" and not only by the UI.
 * Verified details are deterministic and flagged `simulated: true`.
 */
export class MockLedgerAdapter implements LedgerAdapter {
  readonly network = 'testnet' as const
  readonly simulated = true
  private readonly processed = new Map<string, LedgerResult>()
  private readonly verified = new Map<Id, VerifiedDetails>()

  constructor(private readonly options: Options = {}) {}

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  private async settle(
    input: { idempotencyKey: string; actorId: Id },
    operationId: Id,
    contractPolicy: string,
    guard?: () => LedgerError | null,
  ): Promise<LedgerResult> {
    const previous = this.processed.get(input.idempotencyKey)
    if (previous) return previous

    const emit = this.options.onStatus ?? (() => {})
    emit('preparing')
    const failure = guard?.()
    if (failure) {
      const result: LedgerResult = { status: 'failed', operationId, error: failure }
      emit('failed')
      return result
    }
    emit('waiting_for_confirmation')
    await sleep((this.options.latencyMs ?? 600) / 2)
    emit('processing')
    await sleep((this.options.latencyMs ?? 600) / 2)
    const details = simulatedVerification({
      operationId,
      account: input.actorId,
      timestamp: this.now(),
      contractPolicy,
    })
    this.verified.set(operationId, details)
    const result: LedgerResult = { status: 'completed', operationId, verified: details }
    this.processed.set(input.idempotencyKey, result)
    emit('completed')
    return result
  }

  createAgency(input: CreateAgencyLedgerInput) {
    return this.settle(input, input.agencyId, 'Agency registration')
  }

  createAgreement(input: CreateAgreementLedgerInput) {
    return this.settle(input, input.agreementId, 'Funding agreement commitment', () => {
      const total = input.tranches.reduce((sum, t) => sum + t.amount, 0)
      return total === input.committed
        ? null
        : fail('limit_exceeded', 'Tranches must add up to the commitment.')
    })
  }

  fundAgreement(input: FundAgreementInput) {
    return this.settle(
      input,
      `${input.agreementId}:${input.idempotencyKey}`,
      'Funded capital cannot exceed the agreement commitment',
      () =>
        input.funded + input.amount > input.committed
          ? fail('limit_exceeded', `Funding would exceed the ${usd(input.committed)} commitment.`)
          : null,
    )
  }

  requestTranche(input: RequestTrancheInput) {
    return this.settle(input, input.trancheId, 'Tranche request')
  }

  submitMilestoneEvidence(input: SubmitMilestoneEvidenceInput) {
    return this.settle(
      input,
      `${input.milestoneId}:evidence`,
      `Evidence hash ${input.evidenceHash.slice(0, 10)}…`,
    )
  }

  releaseTranche(input: ReleaseTrancheInput) {
    return this.settle(input, input.trancheId, 'Released capital cannot exceed funded capital', () => {
      if (input.requestedBy && input.requestedBy === input.actorId)
        return fail('not_authorized', 'The requester cannot release their own tranche.')
      if (input.released + input.amount > input.funded)
        return fail('insufficient_funds', 'Released capital cannot exceed funded capital.')
      return null
    })
  }

  createAccount(input: CreateAccountInput) {
    return this.settle(input, input.accountId, 'Agency account')
  }

  transfer(input: TransferInput) {
    return this.settle(
      input,
      `${input.fromAccountId}:${input.idempotencyKey}`,
      'Transfers stay inside the Agency',
      () =>
        input.amount > input.available
          ? fail('insufficient_funds', `Only ${usd(input.available)} is available.`)
          : null,
    )
  }

  createBudget(input: CreateBudgetInput) {
    return this.settle(
      input,
      input.budgetId,
      `Budget rules · per-operation limit ${usd(input.perOperationLimit)}`,
      () =>
        input.perOperationLimit > input.periodLimit
          ? fail('limit_exceeded', 'The per-operation limit cannot exceed the period limit.')
          : null,
    )
  }

  setAllowance(input: SetAllowanceInput) {
    return this.settle(input, `${input.budgetId}:${input.holderId}`, 'Spending allowance')
  }

  requestPayment(input: RequestPaymentInput) {
    return this.settle(
      input,
      input.requestId,
      `Payment hold · per-operation limit ${usd(input.perOperationLimit)}`,
      () => {
        if (input.budgetPaused) return fail('budget_paused', 'This budget is paused.')
        if (input.amount > input.perOperationLimit)
          return fail(
            'limit_exceeded',
            `The amount exceeds the per-operation limit of ${usd(input.perOperationLimit)}.`,
          )
        if (
          input.allowedDestinations.length > 0 &&
          !input.allowedDestinations.includes(input.destinationId)
        ) {
          return fail('destination_not_allowed', 'This payment destination is not approved for this budget.')
        }
        if (input.amount > input.budgetAvailable)
          return fail('insufficient_funds', 'The budget does not have enough available funds.')
        return null
      },
    )
  }

  approvePayment(input: ApprovePaymentInput) {
    return this.settle(input, `${input.requestId}:approval`, 'Separation of duties', () =>
      input.requestedBy === input.actorId
        ? fail('not_authorized', 'Nobody can approve their own request.')
        : null,
    )
  }

  capturePayment(input: CapturePaymentInput) {
    return this.settle(input, input.paymentId, 'Capture happens once per approved hold')
  }

  pauseBudget(input: PauseBudgetInput) {
    return this.settle(
      input,
      `${input.budgetId}:${input.paused ? 'pause' : 'resume'}:${input.idempotencyKey}`,
      'Paused budgets cannot create new holds',
    )
  }

  pauseAgent(input: PauseAgentInput) {
    return this.settle(
      input,
      `${input.agentId}:${input.paused ? 'pause' : 'resume'}:${input.idempotencyKey}`,
      'Automation emergency pause',
    )
  }

  async readBalances(): Promise<Balances> {
    // The mock derives balances from state; the Monad adapter reads them onchain.
    return { accounts: {}, budgets: {}, vaults: {}, readAt: this.now() }
  }

  async getVerifiedDetails(operationId: Id) {
    return this.verified.get(operationId) ?? null
  }
}

function fail(code: LedgerError['code'], message: string): LedgerError {
  return { code, message, retryable: false }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

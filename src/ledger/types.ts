import type { Cents } from '@/domain/money'
import type { Id, ISODate, VerifiedDetails } from '@/domain/types'

/**
 * Product-language boundary between Viatik and Monad. UI code never calls a
 * contract; it asks the ledger to do something people understand ("release
 * tranche", "capture payment") and gets back a human status.
 *
 * Only implementations of this interface know contract addresses, ABIs, RPC
 * endpoints, chain ids, gas sponsorship, smart-account details, user
 * operations, transaction hashes, and token decimals.
 */
export type LedgerStatus = 'preparing' | 'waiting_for_confirmation' | 'processing' | 'completed' | 'failed'

export type LedgerErrorCode =
  | 'limit_exceeded'
  | 'destination_not_allowed'
  | 'budget_paused'
  | 'insufficient_funds'
  | 'not_authorized'
  | 'already_processed'
  | 'network_unavailable'
  | 'sponsorship_unavailable'
  | 'not_configured'
  /** A budget rule the contract does not check rejected it; nothing was sent to the ledger. */
  | 'policy_rejected'
  | 'unknown'

export type LedgerError = { code: LedgerErrorCode; message: string; retryable: boolean }

export type LedgerResult = {
  status: LedgerStatus
  operationId: Id
  verified?: VerifiedDetails
  error?: LedgerError
}

/** Every operation carries an idempotency key so retries never double-spend. */
type Base = { idempotencyKey: string; actorId: Id }

export type CreateAgencyLedgerInput = Base & { agencyId: Id; portfolioId: Id }
export type CreateAgreementLedgerInput = Base & {
  agreementId: Id
  agencyId: Id
  committed: Cents
  tranches: { trancheId: Id; amount: Cents }[]
}
export type FundAgreementInput = Base & { agreementId: Id; amount: Cents; funded: Cents; committed: Cents }
export type RequestTrancheInput = Base & { trancheId: Id; agreementId: Id }
export type SubmitMilestoneEvidenceInput = Base & { milestoneId: Id; evidenceHash: string }
export type ReleaseTrancheInput = Base & {
  trancheId: Id
  agreementId: Id
  destinationAccountId: Id
  amount: Cents
  funded: Cents
  released: Cents
  requestedBy?: Id
}
export type CreateAccountInput = Base & { accountId: Id; agencyId: Id }
export type TransferInput = Base & { fromAccountId: Id; toAccountId: Id; amount: Cents; available: Cents }
export type CreateBudgetInput = Base & {
  budgetId: Id
  sourceAccountId: Id
  allocation: Cents
  perOperationLimit: Cents
  periodLimit: Cents
  approvalThreshold: Cents
  allowedDestinations: Id[]
}
export type SetAllowanceInput = Base & {
  budgetId: Id
  holderId: Id
  periodLimit: Cents
  perOperationLimit?: Cents
}
export type RequestPaymentInput = Base & {
  requestId: Id
  budgetId: Id
  destinationId: Id
  amount: Cents
  perOperationLimit: Cents
  allowedDestinations: Id[]
  budgetAvailable: Cents
  budgetPaused: boolean
}
export type ApprovePaymentInput = Base & { requestId: Id; requestedBy: Id }
export type CapturePaymentInput = Base & {
  requestId: Id
  paymentId: Id
  amount: Cents
  evidenceHash?: string
}
export type PauseBudgetInput = Base & { budgetId: Id; paused: boolean }
export type PauseAgentInput = Base & { agentId: Id; paused: boolean }

export type Balances = {
  accounts: Record<Id, Cents>
  budgets: Record<Id, Cents>
  vaults: Record<Id, Cents>
  readAt: ISODate
}

export interface LedgerAdapter {
  readonly network: 'testnet' | 'mainnet'
  readonly simulated: boolean
  createAgency(input: CreateAgencyLedgerInput): Promise<LedgerResult>
  createAgreement(input: CreateAgreementLedgerInput): Promise<LedgerResult>
  fundAgreement(input: FundAgreementInput): Promise<LedgerResult>
  requestTranche(input: RequestTrancheInput): Promise<LedgerResult>
  submitMilestoneEvidence(input: SubmitMilestoneEvidenceInput): Promise<LedgerResult>
  releaseTranche(input: ReleaseTrancheInput): Promise<LedgerResult>
  createAccount(input: CreateAccountInput): Promise<LedgerResult>
  transfer(input: TransferInput): Promise<LedgerResult>
  createBudget(input: CreateBudgetInput): Promise<LedgerResult>
  setAllowance(input: SetAllowanceInput): Promise<LedgerResult>
  requestPayment(input: RequestPaymentInput): Promise<LedgerResult>
  approvePayment(input: ApprovePaymentInput): Promise<LedgerResult>
  capturePayment(input: CapturePaymentInput): Promise<LedgerResult>
  pauseBudget(input: PauseBudgetInput): Promise<LedgerResult>
  pauseAgent(input: PauseAgentInput): Promise<LedgerResult>
  /** Authoritative balances, read directly from Monad (multicall), never from the database. */
  readBalances(input: { accountIds: Id[]; budgetIds: Id[]; vaultIds: Id[] }): Promise<Balances>
  getVerifiedDetails(operationId: Id): Promise<VerifiedDetails | null>
}

/** Optional progress hook so the UI can show Preparing → Processing → Completed. */
export type StatusListener = (status: LedgerStatus) => void

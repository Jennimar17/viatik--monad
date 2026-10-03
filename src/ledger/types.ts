import type { Cents } from '@/domain/money'
import type {
  Id,
  ISODate,
  LedgerReason,
  MembershipScope,
  Role,
  VerifiedDetails,
  ViatikState,
} from '@/domain/types'

/**
 * Product-language boundary between Viatik and Monad. UI code never calls a
 * contract; a command's settlement plan says what the ledger has to do
 * ("release this tranche", "pay this request") and gets back a human status.
 *
 * Only implementations of this interface know contract addresses, ABIs, RPC
 * endpoints, chain ids, gas sponsorship, smart-account details, user
 * operations, transaction hashes, and token decimals.
 */
export type LedgerStatus = 'preparing' | 'waiting_for_confirmation' | 'processing' | 'completed' | 'failed'

/** One code per contract error (`InsufficientFunds` → `insufficient_funds`), plus delivery problems. */
export type LedgerErrorCode =
  | 'limit_exceeded'
  | 'destination_not_allowed'
  | 'budget_paused'
  | 'insufficient_funds'
  | 'not_authorized'
  | 'already_processed'
  | 'agreement_paused'
  /** Something the operation relies on was never registered with the ledger. */
  | 'not_registered'
  | 'invalid_state'
  | 'network_unavailable'
  | 'sponsorship_unavailable'
  | 'not_configured'
  /** A budget rule the contract does not check rejected it; nothing was sent to the ledger. */
  | 'policy_rejected'
  /** The command moves money in a way no ledger operation settles yet. */
  | 'not_supported_onchain'
  /** The app's rules and the ledger's disagree about this operation; nothing was moved. */
  | 'rule_drift'
  | 'unknown'

export type LedgerError = { code: LedgerErrorCode; message: string; retryable: boolean }

export type Hash = `0x${string}`

/** What the ledger does with a payment request: pays it, waits for an approver, or records a rejection. */
export type RequestOutcome = 'executed' | 'pending' | 'rejected'

/**
 * One call to the ledger contract, in product ids and cents. People are
 * product user ids; the Monad adapter resolves them to their accounts. A
 * missing hash is recorded as zero.
 */
export type LedgerOp =
  | { call: 'createPortfolio'; portfolioId: Id; vaultId: Id }
  | { call: 'registerAgency'; agencyId: Id; portfolioId: Id; fundingVaultId: Id }
  | { call: 'join'; scope: MembershipScope; role: Role; userId: Id }
  | { call: 'revokeRole'; scope: MembershipScope; userId: Id }
  | { call: 'createAccount'; accountId: Id; agencyId: Id; isOperations: boolean }
  | { call: 'transfer'; opId: Id; fromAccountId: Id; toAccountId: Id; amount: Cents }
  | { call: 'deposit'; opId: Id; portfolioId: Id; vaultId: Id; amount: Cents }
  | {
      call: 'createAgreement'
      agreementId: Id
      agencyId: Id
      vaultId: Id
      committed: Cents
      exceptionThreshold: Cents
      tranches: { trancheId: Id; amount: Cents; milestone: boolean }[]
    }
  | { call: 'acceptAgreement'; agreementId: Id }
  | { call: 'setAgreementPaused'; agreementId: Id; paused: boolean }
  | { call: 'fundAgreement'; opId: Id; agreementId: Id; portfolioVaultId: Id; amount: Cents }
  | { call: 'requestTranche'; trancheId: Id; accountId: Id; evidenceHash: Hash | null }
  | { call: 'requestChanges'; trancheId: Id; reject: boolean }
  | { call: 'releaseTranche'; trancheId: Id; decisionHash: Hash | null }
  | {
      call: 'createBudget'
      budgetId: Id
      sourceAccountId: Id
      perOperationLimit: Cents
      approvalThreshold: Cents
      /** Empty: any destination. */
      allowedDestinationIds: Id[]
      allocation: Cents
    }
  /** Positive moves money from the budget's source account into it; negative returns it. */
  | { call: 'allocate'; opId: Id; budgetId: Id; delta: number }
  | {
      call: 'updateRules'
      budgetId: Id
      perOperationLimit: Cents
      approvalThreshold: Cents
      allowedDestinationIds: Id[]
    }
  | { call: 'setBudgetPaused'; budgetId: Id; paused: boolean }
  /** `perOperationLimit` 0: only the budget's limit applies. */
  | { call: 'setAllowance'; budgetId: Id; userId: Id; active: boolean; perOperationLimit: Cents }
  | {
      call: 'requestPayment'
      requestId: Id
      /** Claimed only when the ledger pays at once; a waiting or rejected request still reserves one. */
      paymentId: Id
      budgetId: Id
      destinationId: Id | null
      /** A reimbursement: the requester is paid into their Viatik balance. */
      memberUserId: Id | null
      amount: Cents
      evidenceHash: Hash | null
      /** What the app decided; the ledger must reach the same outcome. */
      expected: RequestOutcome
    }
  | { call: 'approvePayment'; requestId: Id; paymentId: Id }
  | { call: 'closeRequest'; requestId: Id }
  | {
      call: 'pay'
      paymentId: Id
      /** An account or a budget. */
      sourceId: Id
      destinationId: Id | null
      memberUserId: Id | null
      amount: Cents
      evidenceHash: Hash | null
    }
  | { call: 'returnToAgency'; opId: Id; agencyId: Id; amount: Cents }

export type LedgerCall = LedgerOp['call']

/** `ReceiptKind` in the contract. */
export type RecordKind =
  | 'deposit'
  | 'funding'
  | 'tranche_release'
  | 'transfer'
  | 'payment'
  | 'payment_pending'
  | 'payment_rejected'
  | 'return'
  | 'allocation'

/** One side of a record: a ledger location or payment destination (by product id), a Member, or none. */
export type RecordEnd = { id: Id } | { member: Id } | null

/**
 * What the ledger records for a money operation (`Recorded(opId, actor,
 * receiptHash)`), with the fields its receipt hash covers. Confirming a
 * transaction recomputes the hash from these and compares.
 */
export type PlannedRecord = {
  opId: Id
  kind: RecordKind
  amount: Cents
  from: RecordEnd
  to: RecordEnd
  /** Evidence (payments, tranche requests) or the Investor's decision (releases). */
  evidenceHash: Hash | null
}

/**
 * What a command needs from the ledger: one transaction that runs every
 * operation or none. The plan is data, so the mock can run it and the Monad
 * adapter can encode, simulate and later confirm it.
 */
export type SettlementPlan = {
  ops: LedgerOp[]
  /** The records the transaction must leave, in order. */
  records: PlannedRecord[]
  /** Who signs the transaction; null for automations and the system, which have no account. */
  signerUserId: Id | null
  /** Keep the engine's state even when the ledger refuses (a rejected request stays in history). */
  keepOnFailure: boolean
  /**
   * The engine rejected a payment request: the answer to give. Alone, it was
   * refused before the ledger (a rule the contract does not check). With a
   * `requestPayment` expected to be rejected, the ledger records the rejection
   * first and the answer follows.
   */
  refusal?: LedgerError
  /**
   * What the engine changed that no operation settles: money movements, or
   * new records missing what the ledger needs. The Monad ledger refuses these plans.
   */
  uncovered: Id[]
}

/**
 * One operation the ledger confirmed: a money operation (`Recorded(opId, …)`
 * onchain), or a tranche request (`TrancheRequested`), which records no money.
 */
export type LedgerRecord = {
  opId: Id
  call: LedgerCall
  outcome?: RequestOutcome
  /** A rejected request: why, and the limit or balance the ledger applied. */
  reason?: LedgerReason
  limit?: Cents
  verified: VerifiedDetails
}

export type SettlementResult = {
  status: 'completed' | 'failed'
  /** Also when it failed after recording a rejection, so the kept request can show it. */
  records: LedgerRecord[]
  error?: LedgerError
}

export type Balances = {
  accounts: Record<Id, Cents>
  budgets: Record<Id, Cents>
  vaults: Record<Id, Cents>
  /** Agency id → Member user id → their Viatik balance. */
  members: Record<Id, Record<Id, Cents>>
  /** Block the balances were read at; absent on the mock. */
  block?: number
  readAt: ISODate
}

/** Optional progress hook so the UI can show Preparing → Processing → Completed. */
export type StatusListener = (status: LedgerStatus) => void

export type SettleContext = {
  /** The state the command ran on; the mock reads the ledger's view from it. */
  before: ViatikState
  onStatus?: StatusListener
}

export interface LedgerAdapter {
  readonly network: 'testnet' | 'mainnet'
  readonly simulated: boolean
  /** Runs the plan as one transaction: every operation or none. */
  settle(plan: SettlementPlan, context: SettleContext): Promise<SettlementResult>
  /** Authoritative balances, read directly from Monad (multicall), never from the database. */
  readBalances(input: {
    accountIds: Id[]
    budgetIds: Id[]
    vaultIds: Id[]
    members?: { agencyId: Id; userId: Id }[]
  }): Promise<Balances>
}

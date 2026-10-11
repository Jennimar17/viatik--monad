import type { Cents } from './money'

/**
 * Core domain model. Money lives in Monad (authoritative ledger); everything
 * in this file is the product's view of it plus private offchain metadata.
 * Dates are ISO-8601 strings so state can be serialized as-is.
 */

export type ISODate = string
export type Id = string

// ─── People and scope ────────────────────────────────────────────────────────

/** The three human product roles. Agency is an entity, not a role. */
export type Role = 'investor' | 'agency_admin' | 'member'

export type User = {
  id: Id
  name: string
  email: string
  title: string
  timeZone: string
  locale: string
  createdAt: ISODate
}

export type MembershipScope = { kind: 'portfolio'; portfolioId: Id } | { kind: 'agency'; agencyId: Id }

export type MembershipStatus = 'active' | 'invited' | 'revoked'

export type Membership = {
  id: Id
  userId: Id
  role: Role
  scope: MembershipScope
  status: MembershipStatus
  invitedBy?: Id
  createdAt: ISODate
  revokedAt?: ISODate
}

/**
 * Who performed an action. AI Agents are programmatic resources managed by an
 * Agency Admin — never a human role — so they are a distinct actor kind.
 */
export type Actor = { kind: 'user'; userId: Id } | { kind: 'ai_agent'; agentId: Id } | { kind: 'system' }

export type Portfolio = {
  id: Id
  name: string
  organization: string
  baseCurrency: 'USD'
  timeZone: string
  createdAt: ISODate
}

export type AgencyType =
  | 'startup'
  | 'agency'
  | 'creative_studio'
  | 'software_team'
  | 'project_company'
  | 'contractor_collective'
  | 'grant_recipient'
  | 'venture_studio_project'

export type AgencyStatus = 'onboarding' | 'active' | 'frozen' | 'closed'

export type Agency = {
  id: Id
  portfolioId: Id
  name: string
  type: AgencyType
  description: string
  website?: string
  timeZone: string
  status: AgencyStatus
  createdAt: ISODate
  /** Scoped states only: the governing agreement's exception threshold, for viewers who cannot see agreements. */
  exceptionThreshold?: Cents
}

// ─── Funding ─────────────────────────────────────────────────────────────────

export type AgreementStatus =
  'draft' | 'pending_acceptance' | 'active' | 'paused' | 'completed' | 'cancelled' | 'expired'

export type ReleaseModel = 'milestone' | 'scheduled' | 'manual' | 'recurring'

export type SpendingCategory =
  | 'team'
  | 'contractors'
  | 'software'
  | 'cloud'
  | 'ai_services'
  | 'research'
  | 'marketing'
  | 'travel'
  | 'legal'
  | 'equipment'

export type SpendingPolicy = {
  allowedCategories: SpendingCategory[]
  /** Operations above this amount need Investor review as an exception. */
  exceptionThreshold: Cents
  reportingCadence: 'monthly' | 'quarterly' | 'per_milestone'
  returnConditions: string
}

export type FundingAgreement = {
  id: Id
  portfolioId: Id
  agencyId: Id
  title: string
  purpose: string
  committed: Cents
  releaseModel: ReleaseModel
  startDate: ISODate
  endDate: ISODate
  status: AgreementStatus
  spendingPolicy: SpendingPolicy
  evidenceRequirements: string
  /** Investor-side approver for exceptional operations. */
  createdBy: Id
  createdAt: ISODate
  frozenAt?: ISODate
}

export type TrancheStatus =
  'planned' | 'available' | 'requested' | 'under_review' | 'approved' | 'released' | 'rejected' | 'cancelled'

export type Tranche = {
  id: Id
  agreementId: Id
  index: number
  name: string
  amount: Cents
  releaseCondition: 'milestone' | 'scheduled' | 'manual'
  scheduledFor?: ISODate
  milestoneId?: Id
  status: TrancheStatus
  destinationAccountId?: Id
  requestedAt?: ISODate
  requestedBy?: Id
  releasedAt?: ISODate
  releasedBy?: Id
  receiptId?: Id
  /** The ledger's record of the Agency's request. */
  requestVerified?: VerifiedDetails
}

export type MilestoneStatus =
  'not_started' | 'in_progress' | 'ready_for_review' | 'changes_requested' | 'approved' | 'rejected'

export type Evidence = {
  id: Id
  kind: 'file' | 'link' | 'note'
  name: string
  url?: string
  mimeType?: string
  sizeBytes?: number
  /** Only the hash goes onchain; the document stays private. */
  sha256: string
  addedAt: ISODate
  addedBy: Id
}

export type MilestoneDecision = {
  outcome: 'approved' | 'changes_requested' | 'rejected'
  note?: string
  checkedCriteria: number[]
  decidedAt: ISODate
  decidedBy: Id
}

export type Milestone = {
  id: Id
  agreementId: Id
  trancheId: Id
  title: string
  description: string
  acceptanceCriteria: string[]
  dueDate: ISODate
  status: MilestoneStatus
  evidence: Evidence[]
  submissionNote?: string
  submittedAt?: ISODate
  submittedBy?: Id
  evidenceHash?: `0x${string}`
  decision?: MilestoneDecision
  /** The ledger's record of the latest evidence submission. */
  submissionVerified?: VerifiedDetails
}

export type VaultKind = 'portfolio' | 'funding' | 'agency_reserve' | 'yield'

export type Vault = {
  id: Id
  kind: VaultKind
  portfolioId: Id
  name: string
  agreementId?: Id
  agencyId?: Id
  asset: 'USDC'
  available: boolean
}

// ─── Operating capital ───────────────────────────────────────────────────────

export type AccountTemplate = 'operations' | 'people' | 'vendors' | 'taxes' | 'reserve' | 'project'

export type Account = {
  id: Id
  agencyId: Id
  template: AccountTemplate
  name: string
  purpose: string
  status: 'active' | 'frozen'
  createdAt: ISODate
}

export type BudgetTemplate = 'team_spend' | 'tools' | 'vendors' | 'travel' | 'project' | 'ai_automation'
export type BudgetPeriod = 'monthly' | 'quarterly' | 'one_time'
export type BudgetStatus = 'active' | 'paused' | 'expired' | 'closed'

export type Budget = {
  id: Id
  agencyId: Id
  sourceAccountId: Id
  name: string
  purpose: string
  template: BudgetTemplate
  period: BudgetPeriod
  /** Hard cap per single payment, enforced onchain. */
  perOperationLimit: Cents
  /** Total that may be spent in one period across all holders. */
  periodLimit: Cents
  /** Requests above this need an Agency Admin approval. */
  approvalThreshold: Cents
  allowedCategories: SpendingCategory[]
  allowedDestinationIds: Id[]
  expiresAt?: ISODate
  status: BudgetStatus
  createdBy: Id
  createdAt: ISODate
  pausedAt?: ISODate
}

export type AllowanceHolder = { kind: 'member'; userId: Id } | { kind: 'ai_agent'; agentId: Id }

/**
 * Permission to spend from an Agency budget. The money stays in the budget
 * until a payment is captured — unlike a payout, which transfers ownership.
 */
export type SpendingAllowance = {
  id: Id
  budgetId: Id
  holder: AllowanceHolder
  periodLimit: Cents
  perOperationLimit?: Cents
  status: 'active' | 'revoked'
  createdAt: ISODate
  revokedAt?: ISODate
}

export type PaymentDestination = {
  id: Id
  agencyId: Id
  name: string
  kind: 'vendor' | 'service' | 'contractor'
  category: SpendingCategory
  /** Generic, country-neutral settlement label. */
  settlementLabel: string
  website?: string
  /** Paused and archived destinations cannot be paid; `approved` ones can. */
  status: 'approved' | 'pending_review' | 'paused' | 'archived'
  addedAt: ISODate
}

// ─── Payments ────────────────────────────────────────────────────────────────

/** Human-readable operation lifecycle; raw chain states stay in Verified details. */
export type OperationStatus =
  | 'scheduled'
  | 'preparing'
  | 'waiting_for_confirmation'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'action_required'

/**
 * - funds: money into the requester's Viatik balance for purchases (an advance they justify with receipts).
 * - reimbursement: money back into the requester's Viatik balance for something they paid; carries its receipt.
 * - work: payment for work into the requester's Viatik balance; an Agency Admin always reviews it, and it
 *   reaches the ledger only when paid (`pay` from the budget).
 * - vendor_payment / automation: paid to an approved vendor.
 */
export type RequestType = 'funds' | 'vendor_payment' | 'reimbursement' | 'work' | 'automation'

export type RequestStatus =
  'needs_approval' | 'approved' | 'processing' | 'completed' | 'rejected' | 'declined' | 'cancelled'

export type PolicyOutcome = 'approved' | 'needs_approval' | 'rejected'

export type PolicyRuleId =
  | 'budget_active'
  | 'budget_not_expired'
  | 'holder_has_access'
  | 'destination_allowed'
  | 'category_allowed'
  | 'per_operation_limit'
  | 'period_limit'
  | 'budget_available'
  | 'agent_daily_cap'
  | 'agent_per_operation_max'
  | 'agent_active'
  | 'approval_threshold'
  | 'exception_threshold'
  /** Payment for work: always reviewed by an Agency Admin (non-blocking). */
  | 'work_review'

export type PolicyCheck = {
  rule: PolicyRuleId
  passed: boolean
  /** Plain-English explanation shown to the requester. */
  message: string
  /** When false, the rule only routes to approval instead of rejecting. */
  blocking: boolean
}

export type PolicyDecision = {
  outcome: PolicyOutcome
  checks: PolicyCheck[]
  /** The first failing blocking rule, or the approval reason. */
  reason?: PolicyCheck
  evaluatedAt: ISODate
}

export type RequestDestination = { kind: 'destination'; destinationId: Id } | { kind: 'member'; userId: Id }

export type PaymentRequest = {
  id: Id
  agencyId: Id
  budgetId: Id
  requester: Actor
  type: RequestType
  destination: RequestDestination
  amount: Cents
  category: SpendingCategory
  purpose: string
  attachments: Evidence[]
  /** Reimbursement: where the requester bought it. */
  merchant?: string
  /** Reimbursement: when the requester paid. */
  spentAt?: ISODate
  status: RequestStatus
  decision: PolicyDecision
  approvedBy?: Id
  declinedReason?: string
  decidedAt?: ISODate
  paymentId?: Id
  idempotencyKey: string
  createdAt: ISODate
  /** What the ledger recorded when the request was sent. Absent when it never reached the ledger. */
  ledger?: VerifiedDetails
}

export type PaymentType =
  | 'team'
  | 'contractor'
  | 'reimbursement'
  | 'vendor'
  | 'tool'
  | 'refund'
  | 'capital_return'
  | 'automation'
  /** Money a person requested for purchases: they justify it with receipts or return the rest. */
  | 'advance'

/** Who Viatik pays inside the product: an approved vendor or a person's Viatik balance. */
export type ViatikRecipient = { kind: 'destination'; destinationId: Id } | { kind: 'member'; userId: Id }

export type PaymentRecipient =
  | ViatikRecipient
  /**
   * Paid outside Viatik by an Agency Admin (a tool, a subscription). `address` is checksummed;
   * it is absent only for viewers who may not see it (visibility).
   */
  | { kind: 'address'; payee: string; address?: string }

export type Payment = {
  id: Id
  agencyId: Id
  type: PaymentType
  sourceAccountId: Id
  budgetId?: Id
  recipient: PaymentRecipient
  amount: Cents
  category: SpendingCategory
  memo: string
  status: OperationStatus
  createdBy: Actor
  approvedBy?: Id
  scheduledFor: ISODate
  completedAt?: ISODate
  requestId?: Id
  billId?: Id
  receiptId?: Id
  batchId?: Id
  /** Outside payments: the invoice, attached once (with the payment or later). */
  proof?: Evidence
  /** What the ledger recorded when the invoice was anchored after the payment (recordEvidence). */
  proofVerified?: VerifiedDetails
  /** The monthly reminder this payment answered. */
  reminderId?: Id
  /** A run of a scheduled payment: the schedule the keeper paid it for. */
  scheduleId?: Id
  /** Which run of that schedule it was (1 = the first). */
  scheduleRun?: number
}

export type BillStatus = 'to_pay' | 'scheduled' | 'paid' | 'reconciled'

export type Bill = {
  id: Id
  agencyId: Id
  destinationId: Id
  number: string
  issueDate: ISODate
  dueDate: ISODate
  amount: Cents
  category: SpendingCategory
  accountId: Id
  budgetId?: Id
  status: BillStatus
  document: Evidence
  notes?: string
  paymentId?: Id
  /** While scheduled: when its schedule is due (`Schedule.nextRunAt`). */
  scheduledFor?: ISODate
  /** The schedule that pays it (status `scheduled`), kept once it paid it. */
  scheduleId?: Id
  createdBy: Id
  createdAt: ISODate
}

export type Expense = {
  id: Id
  agencyId: Id
  userId: Id
  budgetId: Id
  merchant: string
  amount: Cents
  category: SpendingCategory
  spentAt: ISODate
  paymentId?: Id
  receipt?: Evidence
  createdAt: ISODate
}

/** Links a bill or expense to one canonical payment and its evidence. */
export type Reconciliation = {
  id: Id
  agencyId: Id
  paymentId: Id
  billId?: Id
  expenseId?: Id
  evidenceIds: Id[]
  receiptId: Id
  reconciledBy: Id
  reconciledAt: ISODate
}

// ─── Verification ────────────────────────────────────────────────────────────

/** Why the ledger rejected a payment request (its `Reason`), in product codes. */
export type LedgerReason =
  'budget_paused' | 'destination_not_allowed' | 'limit_exceeded' | 'insufficient_funds'

/**
 * The settlement record of one operation: the only place blockchain
 * terminology is allowed in the product. The optional fields are its
 * "Advanced" part.
 */
export type VerifiedDetails = {
  status: 'confirmed' | 'pending'
  network: string
  chainId: number
  account: string
  transaction: string
  block: number
  timestamp: ISODate
  /** The ledger's receipt hash; records without money (a tranche request) have none. */
  receiptHash?: string
  contractPolicy: string
  explorerUrl: string
  /** True while the ledger runs on the mock adapter. */
  simulated: boolean
  /** An example imported with the seeded story: not a Monad transaction of its own. */
  imported?: boolean
  /** The ledger contract that recorded it (real ledger only). */
  contract?: string
  /** The operation's id in the ledger, as recorded (real ledger only). */
  operationRef?: string
  /** What the ledger did with a payment request. */
  outcome?: 'executed' | 'pending' | 'rejected'
  /** Why the ledger rejected it, and the limit or balance it applied. */
  reason?: { code: LedgerReason; limit?: Cents }
  /** The documents' fingerprint the record carries; null when none were attached. */
  evidenceHash?: `0x${string}` | null
  /** The fingerprint of the Investor's decision, recorded with a release. */
  decisionHash?: `0x${string}`
}

export type ReceiptKind =
  | 'payment'
  | 'tranche_release'
  | 'deposit'
  | 'funding'
  | 'transfer'
  | 'allocation'
  | 'withdrawal'
  | 'outside_payment'
  | 'capital_return'

export type Receipt = {
  id: Id
  number: string
  kind: ReceiptKind
  amount: Cents
  fromLabel: string
  toLabel: string
  description: string
  policyLabel: string
  agencyId?: Id
  portfolioId: Id
  operationId: Id
  evidenceIds: Id[]
  issuedAt: ISODate
  verified: VerifiedDetails
}

// ─── Ledger movements (capital trail) ────────────────────────────────────────

export type Location =
  /**
   * Outside Viatik. `address` is where the money went: a withdrawal's only its owner sees in
   * full; an outside payment's, the Agency's Admins and its Investors.
   */
  | { kind: 'external'; label: string; address?: string }
  | { kind: 'vault'; vaultId: Id }
  | { kind: 'account'; accountId: Id }
  | { kind: 'budget'; budgetId: Id }
  | { kind: 'recipient'; recipient: ViatikRecipient }

export type MovementKind =
  | 'deposit'
  | 'fund_agreement'
  | 'release_tranche'
  | 'transfer'
  | 'allocate'
  | 'deallocate'
  | 'payment'
  | 'capital_return'
  | 'withdrawal'

/**
 * Every balance in the product is derived from these movements, so every
 * screen agrees. In production they mirror onchain events.
 */
export type Movement = {
  id: Id
  kind: MovementKind
  amount: Cents
  from: Location
  to: Location
  portfolioId: Id
  agencyId?: Id
  agreementId?: Id
  refId?: Id
  receiptId?: Id
  /** A give-back that settles an advance: the advance payment it returns money for. */
  settlesPaymentId?: Id
  createdAt: ISODate
}

// ─── Automations ─────────────────────────────────────────────────────────────

export type AgentStatus = 'active' | 'paused' | 'expired'

export type AiAgent = {
  id: Id
  agencyId: Id
  name: string
  purpose: string
  budgetId: Id
  dailyCap: Cents
  perOperationMax: Cents
  allowedDestinationIds: Id[]
  workingBalanceLimit: Cents
  expiresAt: ISODate
  status: AgentStatus
  managedBy: Id
  createdAt: ISODate
  pausedAt?: ISODate
}

export type AgentDecision = {
  id: Id
  agentId: Id
  destinationId: Id
  amount: Cents
  outcome: PolicyOutcome
  reason: string
  requestId?: Id
  at: ISODate
}

// ─── Activity and notifications ──────────────────────────────────────────────

export type ActivityType =
  | 'agreement_created'
  | 'agreement_paused'
  | 'agreement_frozen'
  | 'capital_deposited'
  | 'agreement_funded'
  | 'tranche_requested'
  | 'milestone_submitted'
  | 'milestone_changes_requested'
  | 'tranche_released'
  | 'account_created'
  | 'funds_transferred'
  | 'budget_created'
  | 'budget_paused'
  | 'budget_resumed'
  | 'allowance_assigned'
  | 'allowance_revoked'
  | 'payment_requested'
  | 'payment_approved'
  | 'payment_declined'
  | 'payment_completed'
  | 'policy_rejected'
  | 'bill_added'
  | 'bill_reconciled'
  | 'expense_added'
  | 'member_invited'
  | 'member_joined'
  | 'agent_created'
  | 'agent_paused'
  | 'agent_resumed'
  | 'agency_created'
  | 'portfolio_created'
  | 'funds_withdrawn'
  | 'destination_updated'
  | 'paid_outside'
  | 'payment_proof_added'
  | 'capital_returned'
  | 'receipt_added'
  | 'advance_returned'
  | 'receipts_reminded'
  | 'reminder_created'
  | 'reminder_updated'
  /** A payment scheduled for later (its runs are `payment_completed`). */
  | 'payment_scheduled'
  /** A scheduled payment paused, resumed or cancelled. */
  | 'schedule_updated'
  /** A due run of a scheduled payment could not be paid (it stays due). */
  | 'schedule_failed'

export type Activity = {
  id: Id
  type: ActivityType
  actor: Actor
  portfolioId: Id
  agencyId?: Id
  /** For Member visibility: personal activity only. */
  subjectUserId?: Id
  entity: { kind: string; id: Id }
  summary: string
  amount?: Cents
  createdAt: ISODate
}

/** A notification screens react to, besides showing it (absent on ordinary ones). */
export type NotificationKind = 'funds_arrived'

export type Notification = {
  id: Id
  userId: Id
  title: string
  body: string
  href: string
  createdAt: ISODate
  readAt?: ISODate
  /** `funds_arrived`: money reached the person's Viatik account (from Alchemy), so its balance is read again. */
  kind?: NotificationKind
}

export type Invitation = {
  id: Id
  code: string
  email: string
  name: string
  role: Role
  scope: MembershipScope
  invitedBy: Id
  createdAt: ISODate
  status: 'pending' | 'accepted' | 'expired'
}

// ─── Aggregate state ─────────────────────────────────────────────────────────

/** Everything the product knows, as one serializable snapshot. */
/** An address a person saved to send their money to (their own wallets, in practice). */
export type PayoutAddress = {
  id: Id
  userId: Id
  label: string
  address: string
  createdAt: ISODate
}

export type ReminderStatus = 'active' | 'paused' | 'archived'

/**
 * A monthly reminder for an Agency Admin: something Viatik cannot pay directly
 * (a tool, a subscription) that the Admin pays outside Viatik and documents with
 * its invoice. Due dates are derived (src/domain/accountability.ts); nothing is
 * scheduled and nothing reaches the ledger.
 */
export type Reminder = {
  id: Id
  agencyId: Id
  /** What to do, e.g. "Pay Claude Teams and upload the invoice". */
  title: string
  /** Who gets paid, e.g. "Anthropic". */
  payee: string
  /** The usual amount, when known. */
  amount?: Cents
  category: SpendingCategory
  cadence: 'monthly'
  /** The day of the month it is due (1–28). */
  dayOfMonth: number
  /** The account it is usually paid from. */
  sourceAccountId?: Id
  status: ReminderStatus
  createdBy: Id
  createdAt: ISODate
  updatedAt: ISODate
}

// ─── Scheduled payments ──────────────────────────────────────────────────────

/**
 * - active: the keeper pays each run once it is due (within minutes of its time).
 * - paused: nothing is paid; on resume, dates that passed are skipped, not paid.
 * - cancelled: stopped for good by an Agency Admin or the Investor.
 * - completed: every run was paid.
 */
export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | 'completed'

/** Why the latest attempt at a due run could not pay. The run stays due and is tried again. */
export type ScheduleFailure = {
  /** The run it concerns (1 = the first). */
  run: number
  /** A domain or ledger error code (`insufficient_funds`, `budget_paused`…). */
  code: string
  /** Product language, safe to show to the Agency's Admins and Investors. */
  message: string
  /** When this run first failed for this reason. */
  at: ISODate
}

/**
 * A payment an Agency Admin authorized once, from an account or a budget to a
 * vendor or a person's Viatik balance, for a later date (and possibly every
 * `intervalSeconds` after it, `runs` times). It mirrors the ledger's schedule
 * (`createSchedule`), whose id is this id; the keeper runs it when it is due,
 * and each run is an ordinary completed Payment (`scheduleId`, `scheduleRun`).
 */
export type Schedule = {
  id: Id
  agencyId: Id
  /** The account it pays from: a budget's source account when paying from a budget. */
  sourceAccountId: Id
  budgetId?: Id
  recipient: ViatikRecipient
  type: Exclude<PaymentType, 'advance'>
  amount: Cents
  category: SpendingCategory
  memo: string
  /** The bill it pays, when it was scheduled from one. */
  billId?: Id
  /** When the first run was due (whole seconds). */
  firstRunAt: ISODate
  /** When the next run is due; once completed, when the last one was due. */
  nextRunAt: ISODate
  /** Seconds between runs; 0 = a single run. */
  intervalSeconds: number
  runs: number
  runsLeft: number
  status: ScheduleStatus
  /** Whether the Investor paused it: then only the Investor resumes it. */
  pausedByInvestor?: boolean
  pausedBy?: Id
  pausedAt?: ISODate
  cancelledBy?: Id
  cancelledAt?: ISODate
  completedAt?: ISODate
  /** The Agency Admin who authorized it: if they lose the role, it stops. */
  createdBy: Id
  createdAt: ISODate
  /** The payments its runs made, oldest first. */
  paymentIds: Id[]
  /** The latest due run that could not be paid, while it is still that run. */
  failure?: ScheduleFailure
  /**
   * How many times it was resumed (absent: never). A resume clears the failure, so a run that
   * fails again after it is noted and told again (the keeper seeds each failure with this).
   */
  resumes?: number
  /** What the ledger recorded when it was created. */
  ledger?: VerifiedDetails
  /** What the ledger recorded for its last pause, resume or cancellation. */
  changeLedger?: VerifiedDetails
}

/** One pass of the keeper over an Agency (src/server/keeper.ts), as screens show it. */
export type KeeperRun = {
  at: ISODate
  /** `automatic`: the timer (Supabase Cron); `manual`: an Agency Admin pressed "Run due payments". */
  trigger: 'automatic' | 'manual'
  /** Manual runs: who pressed it. */
  by?: Id
  /** Runs paid in this pass. */
  paid: number
  /** Due runs that could not be paid (they stay due and are tried again). */
  failed: number
  /** Due runs left for the next pass (time ran out, or still confirming on Monad). */
  waiting: number
  /** Monthly payments whose due day was told to the Admins. */
  reminders: number
}

/** What the keeper last did, kept with the state so screens can say "Last run 4 min ago". */
export type KeeperStatus = {
  /** When the timer last ran the keeper (for every Agency). */
  lastAutomaticAt?: ISODate
  /** Per Agency: the last pass that looked at it, automatic or manual. */
  agencies: Record<Id, KeeperRun>
}

export type ViatikState = {
  version: number
  generatedAt: ISODate
  users: User[]
  memberships: Membership[]
  invitations: Invitation[]
  portfolios: Portfolio[]
  agencies: Agency[]
  agreements: FundingAgreement[]
  tranches: Tranche[]
  milestones: Milestone[]
  vaults: Vault[]
  accounts: Account[]
  budgets: Budget[]
  allowances: SpendingAllowance[]
  destinations: PaymentDestination[]
  requests: PaymentRequest[]
  payments: Payment[]
  bills: Bill[]
  expenses: Expense[]
  reconciliations: Reconciliation[]
  receipts: Receipt[]
  movements: Movement[]
  agents: AiAgent[]
  agentDecisions: AgentDecision[]
  activity: Activity[]
  notifications: Notification[]
  payoutAddresses: PayoutAddress[]
  reminders: Reminder[]
  schedules: Schedule[]
  /** What the keeper last did (absent until it first runs). */
  keeper?: KeeperStatus
}

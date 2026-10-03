import { attachmentsHash } from '@/domain/evidence'
import { formatUsd, type Cents } from '@/domain/money'
import type { Id, Location, MembershipScope, Role, ViatikState } from '@/domain/types'
import { simulatedVerification } from '@/domain/verification'

import type {
  Balances,
  Hash,
  LedgerAdapter,
  LedgerCall,
  LedgerError,
  LedgerErrorCode,
  LedgerOp,
  LedgerRecord,
  PlannedRecord,
  RecordEnd,
  RequestOutcome,
  SettleContext,
  SettlementPlan,
  SettlementResult,
} from './types'

const usd = (value: number) => formatUsd(value as Cents, { withCode: true })

/** TestUSD mints at most 1,000,000 USD per call; the ledger refuses larger deposits. */
const MAX_DEPOSIT = 100_000_000

type Options = {
  /** Simulated confirmation time of the one transaction. Monad finalizes in ~0.8 s; the mock stays close. */
  latencyMs?: number
  now?: () => string
}

/**
 * Demo ledger. It runs a settlement plan the way ViatikLedger would: the same
 * roles, checks in the same order, the same errors, all operations or none.
 * Its view of the ledger is read from the state the command ran on, so a
 * command the app accepts but the contract would refuse fails here too.
 * Verified details are deterministic and flagged `simulated: true`.
 */
export class MockLedgerAdapter implements LedgerAdapter {
  readonly network = 'testnet' as const
  readonly simulated = true

  constructor(private readonly options: Options = {}) {}

  private now() {
    return this.options.now?.() ?? new Date().toISOString()
  }

  async settle(plan: SettlementPlan, { before, onStatus }: SettleContext): Promise<SettlementResult> {
    const emit = onStatus ?? (() => {})
    emit('preparing')
    if (plan.uncovered.length > 0 && process.env.NODE_ENV !== 'production') {
      console.warn(
        `Settlement: ${plan.uncovered.length} movement(s) have no ledger operation`,
        plan.uncovered,
      )
    }
    if (plan.ops.length === 0) {
      if (plan.refusal) {
        emit('failed')
        return { status: 'failed', records: [], error: plan.refusal }
      }
      emit('completed')
      return { status: 'completed', records: [] }
    }

    // Simulate first, as the Monad adapter does: a revert sends nothing.
    let run: Run
    try {
      run = new LedgerView(before).run(plan, this.now())
    } catch (error) {
      if (!(error instanceof Revert)) throw error
      emit('failed')
      return { status: 'failed', records: [], error: error.error }
    }

    emit('waiting_for_confirmation')
    await sleep((this.options.latencyMs ?? 600) / 2)
    emit('processing')
    await sleep((this.options.latencyMs ?? 600) / 2)

    // A rejection the ledger recorded is a successful transaction that still answers no.
    if (run.rejected) {
      emit('failed')
      return {
        status: 'failed',
        records: run.records,
        error: plan.refusal ?? fail('limit_exceeded', 'The ledger rejected this payment.'),
      }
    }
    emit('completed')
    return { status: 'completed', records: run.records }
  }

  async readBalances(): Promise<Balances> {
    // The mock derives balances from state; the Monad adapter reads them onchain.
    return { accounts: {}, budgets: {}, vaults: {}, members: {}, readAt: this.now() }
  }
}

// ─── The contract, over the product state ───────────────────────────────────

type LedgerRole = 'investor' | 'admin' | 'member'
type LocationKind = 'portfolio_vault' | 'funding_vault' | 'account' | 'budget'
type AgreementState = 'pending' | 'active' | 'paused' | 'inactive'
type TrancheState = 'planned' | 'available' | 'requested' | 'released' | 'rejected'
type RequestState = 'pending' | 'executed' | 'rejected' | 'closed'

type Place = { kind: LocationKind; scope: Id; balance: number }
type AgreementView = {
  agency: Id
  vault: Id
  committed: number
  funded: number
  released: number
  exceptionThreshold: number
  status: AgreementState
}
type TrancheView = {
  agreement: Id
  amount: number
  index: number
  milestone: boolean
  status: TrancheState
  requestedBy?: Id
  destination?: Id
}
type BudgetView = {
  agency: Id
  sourceAccount: Id
  perOperationLimit: number
  approvalThreshold: number
  paused: boolean
  /** Empty: any destination. */
  destinations: Set<Id>
}
type RequestView = {
  budget: Id
  agency: Id
  requester: Id
  destination: Id | null
  member: Id | null
  amount: number
  evidenceHash: Hash | null
  status: RequestState
}

/** What a money operation leaves in the ledger's receipt, besides its id. */
type Written = Omit<PlannedRecord, 'opId'>

type Run = { records: LedgerRecord[]; rejected: boolean }

class Revert extends Error {
  constructor(readonly error: LedgerError) {
    super(error.message)
  }
}

function revert(code: LedgerErrorCode, message: string): never {
  throw new Revert(fail(code, message))
}

const ROLE: Record<Role, LedgerRole> = { investor: 'investor', agency_admin: 'admin', member: 'member' }

/** Why `requestPayment` records a rejection, in the contract's order of checks. */
type Reason = { code: LedgerErrorCode; message: string } | null

/** The ledger's storage, rebuilt from the state the command ran on. */
class LedgerView {
  private readonly scopes = new Map<Id, 'portfolio' | 'agency'>()
  private readonly agencyPortfolio = new Map<Id, Id>()
  private readonly roles = new Map<string, LedgerRole>()
  /** Allowances and requests granted before a revocation in this transaction stop counting. */
  private readonly revokedNow = new Set<string>()
  private readonly places = new Map<Id, Place>()
  private readonly vaultAgreement = new Map<Id, Id>()
  private readonly operations = new Map<Id, Id>()
  private readonly agreements = new Map<Id, AgreementView>()
  private readonly agencyAgreements = new Map<Id, Id[]>()
  private readonly tranches = new Map<Id, TrancheView>()
  private readonly budgets = new Map<Id, BudgetView>()
  private readonly allowances = new Map<string, number>()
  private readonly requests = new Map<Id, RequestView>()
  private readonly members = new Map<string, number>()
  private readonly processed = new Set<Id>()

  private actor: Id | null = null
  private records: LedgerRecord[] = []
  private written: PlannedRecord[] = []
  private rejected = false
  private now = ''

  constructor(state: ViatikState) {
    for (const portfolio of state.portfolios) this.scopes.set(portfolio.id, 'portfolio')
    for (const agency of state.agencies) {
      this.scopes.set(agency.id, 'agency')
      this.agencyPortfolio.set(agency.id, agency.portfolioId)
      // The first account opened as Operations stays the agency's for good, whatever its status.
      const operations = state.accounts.find((a) => a.agencyId === agency.id && a.template === 'operations')
      if (operations) this.operations.set(agency.id, operations.id)
    }
    for (const membership of state.memberships) {
      if (membership.status !== 'active') continue
      const scope = scopeId(membership.scope)
      const fits = (membership.role === 'investor') === (membership.scope.kind === 'portfolio')
      if (fits) this.roles.set(`${scope}|${membership.userId}`, ROLE[membership.role])
    }
    for (const vault of state.vaults) {
      if (vault.kind === 'portfolio') this.places.set(vault.id, place('portfolio_vault', vault.portfolioId))
      if (vault.kind === 'funding' && vault.agencyId) {
        this.places.set(vault.id, place('funding_vault', vault.agencyId))
        if (vault.agreementId) this.vaultAgreement.set(vault.id, vault.agreementId)
      }
    }
    for (const account of state.accounts) this.places.set(account.id, place('account', account.agencyId))
    for (const budget of state.budgets) {
      this.places.set(budget.id, place('budget', budget.agencyId))
      this.budgets.set(budget.id, {
        agency: budget.agencyId,
        sourceAccount: budget.sourceAccountId,
        perOperationLimit: budget.perOperationLimit,
        approvalThreshold: budget.approvalThreshold,
        paused: budget.status !== 'active',
        destinations: new Set(budget.allowedDestinationIds),
      })
      this.processed.add(budget.id)
    }

    for (const movement of state.movements) {
      this.adjust(movement.from, movement.agencyId, -movement.amount)
      this.adjust(movement.to, movement.agencyId, movement.amount)
      if (movement.refId) this.processed.add(movement.refId)
    }

    for (const agreement of state.agreements) {
      const vault = state.vaults.find((v) => v.kind === 'funding' && v.agreementId === agreement.id)
      let funded = 0
      let released = 0
      for (const m of state.movements) {
        if (m.agreementId !== agreement.id) continue
        if (m.kind === 'fund_agreement') funded += m.amount
        if (m.kind === 'release_tranche') released += m.amount
      }
      this.agreements.set(agreement.id, {
        agency: agreement.agencyId,
        vault: vault?.id ?? '',
        committed: agreement.committed,
        funded,
        released,
        exceptionThreshold: agreement.spendingPolicy.exceptionThreshold,
        status:
          agreement.status === 'pending_acceptance'
            ? 'pending'
            : agreement.status === 'active' || agreement.status === 'paused'
              ? agreement.status
              : 'inactive',
      })
      this.agencyAgreements.set(agreement.agencyId, [
        ...(this.agencyAgreements.get(agreement.agencyId) ?? []),
        agreement.id,
      ])
    }
    for (const tranche of state.tranches) {
      this.tranches.set(tranche.id, {
        agreement: tranche.agreementId,
        amount: tranche.amount,
        index: tranche.index,
        milestone: Boolean(tranche.milestoneId),
        status: trancheState(tranche.status),
        requestedBy: tranche.requestedBy,
        destination: tranche.destinationAccountId,
      })
    }
    for (const allowance of state.allowances) {
      if (allowance.status === 'active' && allowance.holder.kind === 'member')
        this.allowances.set(
          `${allowance.budgetId}|${allowance.holder.userId}`,
          allowance.perOperationLimit ?? 0,
        )
    }
    for (const request of state.requests) {
      this.processed.add(request.id)
      if (request.requester.kind !== 'user') continue
      this.requests.set(request.id, {
        budget: request.budgetId,
        agency: request.agencyId,
        requester: request.requester.userId,
        destination: request.destination.kind === 'destination' ? request.destination.destinationId : null,
        member: request.destination.kind === 'member' ? request.destination.userId : null,
        amount: request.amount,
        evidenceHash: attachmentsHash(request.attachments),
        status: requestState(request.status),
      })
    }
    for (const payment of state.payments) this.processed.add(payment.id)
    for (const receipt of state.receipts) this.processed.add(receipt.operationId)
  }

  run(plan: SettlementPlan, now: string): Run {
    this.actor = plan.signerUserId
    this.now = now
    for (const op of plan.ops) this.apply(op, plan)
    // What the ledger would record must be what the app planned: same ids, amounts and ends.
    if (!sameRecords(this.written, plan.records))
      revert(
        'rule_drift',
        'The ledger would record this operation differently from the app. Nothing was moved.',
      )
    return { records: this.records, rejected: this.rejected }
  }

  private apply(op: LedgerOp, plan: SettlementPlan) {
    switch (op.call) {
      case 'createPortfolio': {
        if (!op.portfolioId) revert('invalid_state', 'The portfolio has no id.')
        if (this.scopes.has(op.portfolioId))
          revert('already_processed', 'This portfolio is already registered.')
        this.newPlace(op.vaultId, 'portfolio_vault', op.portfolioId)
        this.scopes.set(op.portfolioId, 'portfolio')
        this.roles.set(`${op.portfolioId}|${this.caller()}`, 'investor')
        return
      }
      case 'registerAgency': {
        this.requireRole(op.portfolioId, 'investor')
        if (this.scopes.get(op.portfolioId) !== 'portfolio')
          revert('not_registered', 'The portfolio is not registered.')
        if (!op.agencyId) revert('invalid_state', 'The agency has no id.')
        if (this.scopes.has(op.agencyId)) revert('already_processed', 'This agency is already registered.')
        this.newPlace(op.fundingVaultId, 'funding_vault', op.agencyId)
        this.scopes.set(op.agencyId, 'agency')
        this.agencyPortfolio.set(op.agencyId, op.portfolioId)
        return
      }
      case 'join': {
        // The registrar's permit names the person who joins: only they can use it.
        if (op.userId !== this.caller()) revert('not_authorized', 'Only the invited person can accept.')
        const scope = scopeId(op.scope)
        const fits =
          (op.role === 'investor' && this.scopes.get(scope) === 'portfolio') ||
          (op.role !== 'investor' && this.scopes.get(scope) === 'agency')
        if (!fits) revert('not_registered', 'This workspace is not registered with the ledger.')
        if (this.roles.has(`${scope}|${op.userId}`))
          revert('invalid_state', 'This person already has a role here.')
        this.roles.set(`${scope}|${op.userId}`, ROLE[op.role])
        return
      }
      case 'revokeRole': {
        const scope = scopeId(op.scope)
        if (op.userId === this.caller()) revert('not_authorized', 'Nobody can remove their own role.')
        const kind = this.scopes.get(scope)
        if (kind === 'portfolio') this.requireRole(scope, 'investor')
        else if (kind === 'agency') this.requireManager(scope)
        else revert('not_registered', 'This workspace is not registered with the ledger.')
        if (!this.roles.has(`${scope}|${op.userId}`)) revert('invalid_state', 'This person has no role here.')
        this.roles.delete(`${scope}|${op.userId}`)
        this.revokedNow.add(`${scope}|${op.userId}`)
        return
      }
      case 'createAccount': {
        this.requireRole(op.agencyId, 'admin')
        this.newPlace(op.accountId, 'account', op.agencyId)
        // The first Operations account is the agency's; a second one is just an account.
        if (op.isOperations && !this.operations.has(op.agencyId))
          this.operations.set(op.agencyId, op.accountId)
        return
      }
      case 'transfer': {
        this.claim(op.opId)
        const from = this.placeOf(op.fromAccountId, 'account')
        this.requireRole(from.scope, 'admin')
        const to = this.placeOf(op.toAccountId, 'account')
        if (to.scope !== from.scope) revert('not_authorized', 'Transfers stay inside the Agency.')
        if (op.fromAccountId === op.toAccountId || op.amount === 0)
          revert('invalid_state', 'Choose two different accounts and an amount.')
        this.move(op.fromAccountId, op.toAccountId, op.amount)
        this.record(
          op.opId,
          'transfer',
          'Transfers stay inside the Agency',
          written('transfer', op.amount, { id: op.fromAccountId }, { id: op.toAccountId }),
        )
        return
      }
      case 'deposit': {
        this.claim(op.opId)
        this.requireRole(op.portfolioId, 'investor')
        const vault = this.placeOf(op.vaultId, 'portfolio_vault')
        if (vault.scope !== op.portfolioId)
          revert('invalid_state', 'This vault belongs to another portfolio.')
        if (op.amount === 0 || op.amount > MAX_DEPOSIT)
          revert('limit_exceeded', `A single deposit can be up to ${usd(MAX_DEPOSIT)}.`)
        vault.balance += op.amount
        this.record(
          op.opId,
          'deposit',
          'Portfolio Vault deposit',
          written('deposit', op.amount, null, { id: op.vaultId }),
        )
        return
      }
      case 'createAgreement': {
        if (this.scopes.get(op.agencyId) !== 'agency')
          revert('not_registered', 'The agency is not registered.')
        this.requireRole(this.portfolioOf(op.agencyId), 'investor')
        if (!op.agreementId) revert('invalid_state', 'The agreement has no id.')
        if (this.agreements.has(op.agreementId))
          revert('already_processed', 'This agreement is already registered.')
        if (op.tranches.length === 0) revert('invalid_state', 'Add at least one tranche.')
        this.bindVault(op.vaultId, op.agencyId, op.agreementId)
        let total = 0
        op.tranches.forEach((tranche, index) => {
          if (!tranche.trancheId || tranche.amount === 0 || this.tranches.has(tranche.trancheId))
            revert('invalid_state', 'Every tranche needs its own id and an amount.')
          this.tranches.set(tranche.trancheId, {
            agreement: op.agreementId,
            amount: tranche.amount,
            index: index + 1,
            milestone: tranche.milestone,
            status: index === 0 && !tranche.milestone ? 'available' : 'planned',
          })
          total += tranche.amount
        })
        if (op.committed === 0 || total !== op.committed)
          revert('limit_exceeded', 'Tranches must add up to the commitment.')
        this.agreements.set(op.agreementId, {
          agency: op.agencyId,
          vault: op.vaultId,
          committed: op.committed,
          funded: 0,
          released: 0,
          exceptionThreshold: op.exceptionThreshold,
          status: 'pending',
        })
        this.agencyAgreements.set(op.agencyId, [
          ...(this.agencyAgreements.get(op.agencyId) ?? []),
          op.agreementId,
        ])
        return
      }
      case 'acceptAgreement': {
        const agreement = this.agreementOf(op.agreementId)
        this.requireRole(agreement.agency, 'admin')
        if (agreement.status !== 'pending')
          revert('invalid_state', 'This agreement is not waiting for acceptance.')
        agreement.status = 'active'
        return
      }
      case 'setAgreementPaused': {
        const agreement = this.agreementOf(op.agreementId)
        this.requireRole(this.portfolioOf(agreement.agency), 'investor')
        if (agreement.status !== (op.paused ? 'active' : 'paused'))
          revert(
            'invalid_state',
            op.paused ? 'Only an active agreement can be paused.' : 'This agreement is not paused.',
          )
        agreement.status = op.paused ? 'paused' : 'active'
        return
      }
      case 'fundAgreement': {
        this.claim(op.opId)
        const agreement = this.agreementOf(op.agreementId)
        const portfolio = this.portfolioOf(agreement.agency)
        this.requireRole(portfolio, 'investor')
        const vault = this.placeOf(op.portfolioVaultId, 'portfolio_vault')
        if (vault.scope !== portfolio) revert('invalid_state', 'Fund it from this portfolio’s vault.')
        if (op.amount === 0) revert('invalid_state', 'Enter an amount.')
        const left = agreement.committed - agreement.funded
        if (op.amount > left)
          revert('limit_exceeded', `Funding would exceed the ${usd(agreement.committed)} commitment.`)
        this.move(op.portfolioVaultId, agreement.vault, op.amount)
        agreement.funded += op.amount
        this.record(
          op.opId,
          'fundAgreement',
          'Funded capital cannot exceed the agreement commitment',
          written('funding', op.amount, { id: op.portfolioVaultId }, { id: agreement.vault }),
        )
        return
      }
      case 'requestTranche': {
        const tranche = this.trancheOf(op.trancheId)
        const agreement = this.agreementOf(tranche.agreement)
        this.requireRole(agreement.agency, 'admin')
        this.requireActive(agreement)
        if (tranche.status !== 'planned' && tranche.status !== 'available')
          revert('invalid_state', 'This tranche cannot be requested right now.')
        if (tranche.milestone !== Boolean(op.evidenceHash))
          revert(
            'invalid_state',
            tranche.milestone ? 'A milestone tranche needs its evidence.' : 'This tranche has no milestone.',
          )
        const account = this.placeOf(op.accountId, 'account')
        if (account.scope !== agreement.agency)
          revert('not_authorized', 'Funds can only go to an account of this Agency.')
        tranche.status = 'requested'
        tranche.requestedBy = this.caller()
        tranche.destination = op.accountId
        return
      }
      case 'requestChanges': {
        const tranche = this.trancheOf(op.trancheId)
        const agreement = this.agreementOf(tranche.agreement)
        this.requireRole(this.portfolioOf(agreement.agency), 'investor')
        if (this.caller() === tranche.requestedBy)
          revert('not_authorized', 'Nobody can review their own request.')
        if (!tranche.milestone || tranche.status !== 'requested')
          revert('invalid_state', 'This milestone is not waiting for review.')
        tranche.status = op.reject ? 'rejected' : 'available'
        return
      }
      case 'releaseTranche': {
        const tranche = this.trancheOf(op.trancheId)
        const agreement = this.agreementOf(tranche.agreement)
        this.requireRole(this.portfolioOf(agreement.agency), 'investor')
        if (this.caller() === tranche.requestedBy)
          revert('not_authorized', 'The requester cannot release their own tranche.')
        this.requireActive(agreement)
        if (tranche.status === 'released') revert('already_processed', 'This tranche was already released.')
        let destination: Id
        if (tranche.status === 'requested' && tranche.destination) destination = tranche.destination
        else if (tranche.status === 'available' && !tranche.milestone) {
          destination =
            this.operations.get(agreement.agency) ??
            revert('not_registered', 'The Agency has no Operations account.')
        } else destination = revert('invalid_state', 'This tranche has not been requested yet.')
        if (tranche.amount > agreement.funded - agreement.released)
          revert('insufficient_funds', 'Released capital cannot exceed funded capital.')
        tranche.status = 'released'
        tranche.destination = destination
        agreement.released += tranche.amount
        this.move(agreement.vault, destination, tranche.amount)
        for (const next of this.tranches.values()) {
          if (
            next.agreement === tranche.agreement &&
            next.index === tranche.index + 1 &&
            next.status === 'planned' &&
            !next.milestone
          )
            next.status = 'available'
        }
        this.record(
          op.trancheId,
          'releaseTranche',
          'Released capital cannot exceed funded capital',
          written(
            'tranche_release',
            tranche.amount as Cents,
            { id: agreement.vault },
            { id: destination },
            op.decisionHash,
          ),
        )
        return
      }
      case 'createBudget': {
        const source = this.placeOf(op.sourceAccountId, 'account')
        this.requireRole(source.scope, 'admin')
        this.newPlace(op.budgetId, 'budget', source.scope)
        this.budgets.set(op.budgetId, {
          agency: source.scope,
          sourceAccount: op.sourceAccountId,
          perOperationLimit: op.perOperationLimit,
          approvalThreshold: op.approvalThreshold,
          paused: false,
          destinations: new Set(op.allowedDestinationIds),
        })
        if (op.allocation > 0) {
          this.claim(op.budgetId)
          this.move(op.sourceAccountId, op.budgetId, op.allocation)
          this.record(
            op.budgetId,
            'createBudget',
            `Budget rules · per-operation limit ${usd(op.perOperationLimit)}`,
            written('allocation', op.allocation, { id: op.sourceAccountId }, { id: op.budgetId }),
          )
        }
        return
      }
      case 'allocate': {
        this.claim(op.opId)
        const budget = this.budgetOf(op.budgetId)
        this.requireRole(budget.agency, 'admin')
        if (op.delta === 0) revert('invalid_state', 'Enter an amount.')
        const [from, to] =
          op.delta > 0 ? [budget.sourceAccount, op.budgetId] : [op.budgetId, budget.sourceAccount]
        const amount = Math.abs(op.delta) as Cents
        this.move(from, to, amount)
        this.record(
          op.opId,
          'allocate',
          'Budgets are funded from their source account',
          written('allocation', amount, { id: from }, { id: to }),
        )
        return
      }
      case 'updateRules': {
        const budget = this.budgetOf(op.budgetId)
        this.requireRole(budget.agency, 'admin')
        budget.perOperationLimit = op.perOperationLimit
        budget.approvalThreshold = op.approvalThreshold
        budget.destinations = new Set(op.allowedDestinationIds)
        return
      }
      case 'setBudgetPaused': {
        const budget = this.budgetOf(op.budgetId)
        this.requireManager(budget.agency)
        if (budget.paused === op.paused)
          revert('invalid_state', op.paused ? 'This budget is already paused.' : 'This budget is not paused.')
        budget.paused = op.paused
        return
      }
      case 'setAllowance': {
        const budget = this.budgetOf(op.budgetId)
        this.requireRole(budget.agency, 'admin')
        if (op.active && !this.inAgency(budget.agency, op.userId))
          revert('not_registered', 'Spending access is only for people in this Agency.')
        if (op.active) this.allowances.set(`${op.budgetId}|${op.userId}`, op.perOperationLimit)
        else this.allowances.delete(`${op.budgetId}|${op.userId}`)
        return
      }
      case 'requestPayment': {
        const requester = this.caller()
        const budget = this.budgetOf(op.budgetId)
        this.requireHolder(op.budgetId, budget, requester)
        if (op.memberUserId && (op.memberUserId !== requester || op.destinationId))
          revert('not_authorized', 'A reimbursement can only pay the person who asks.')
        if (op.amount === 0) revert('invalid_state', 'Enter an amount.')
        if (this.requests.has(op.requestId))
          revert('already_processed', 'This request was already submitted.')
        this.claim(op.requestId)
        const reason = this.check(
          op.budgetId,
          budget,
          requester,
          op.destinationId,
          op.memberUserId,
          op.amount,
        )
        const outcome: RequestOutcome = reason
          ? 'rejected'
          : op.amount > budget.approvalThreshold || op.amount > this.exceptionThreshold(budget.agency)
            ? 'pending'
            : 'executed'
        if (outcome !== op.expected) this.drift(op.expected, outcome, reason, plan)
        this.requests.set(op.requestId, {
          budget: op.budgetId,
          agency: budget.agency,
          requester,
          destination: op.destinationId,
          member: op.memberUserId,
          amount: op.amount,
          evidenceHash: op.evidenceHash,
          status: outcome,
        })
        const end = target(op.destinationId, op.memberUserId)
        if (outcome === 'rejected') {
          this.rejected = true
          this.record(
            op.requestId,
            'requestPayment',
            reason?.message ?? 'Outside the budget rules',
            written('payment_rejected', op.amount, { id: op.budgetId }, end, op.evidenceHash),
            'rejected',
          )
        } else if (outcome === 'pending') {
          this.record(
            op.requestId,
            'requestPayment',
            'Waiting for an approver',
            written('payment_pending', op.amount, { id: op.budgetId }, end, op.evidenceHash),
            'pending',
          )
        } else {
          this.claim(op.paymentId)
          this.payOut(op.budgetId, budget.agency, op.memberUserId, op.amount)
          this.record(
            op.paymentId,
            'requestPayment',
            perOperationLabel(budget),
            written('payment', op.amount, { id: op.budgetId }, end, op.evidenceHash),
            'executed',
          )
        }
        return
      }
      case 'approvePayment': {
        const pending = this.requests.get(op.requestId)
        if (!pending || pending.status !== 'pending')
          revert('invalid_state', 'This request is not waiting for approval.')
        if (this.caller() === pending.requester)
          revert('not_authorized', 'Nobody can approve their own request.')
        if (pending.amount > this.exceptionThreshold(pending.agency))
          this.requireRole(this.portfolioOf(pending.agency), 'investor')
        else this.requireRole(pending.agency, 'admin')
        const budget = this.budgetOf(pending.budget)
        this.requireHolder(pending.budget, budget, pending.requester)
        const reason = this.check(
          pending.budget,
          budget,
          pending.requester,
          pending.destination,
          pending.member,
          pending.amount,
        )
        if (reason) revert(reason.code, reason.message)
        this.claim(op.paymentId)
        pending.status = 'executed'
        this.payOut(pending.budget, pending.agency, pending.member, pending.amount)
        this.record(
          op.paymentId,
          'approvePayment',
          'Separation of duties',
          written(
            'payment',
            pending.amount as Cents,
            { id: pending.budget },
            target(pending.destination, pending.member),
            pending.evidenceHash,
          ),
        )
        return
      }
      case 'closeRequest': {
        const pending = this.requests.get(op.requestId)
        if (!pending || pending.status !== 'pending')
          revert('invalid_state', 'This request is not waiting for approval.')
        const declined = this.caller() !== pending.requester
        if (declined) {
          const admin = this.roles.get(`${pending.agency}|${this.caller()}`) === 'admin'
          const stale =
            this.revokedNow.has(`${pending.agency}|${pending.requester}`) ||
            !this.roles.has(`${pending.agency}|${pending.requester}`)
          const investor =
            this.roles.get(`${this.portfolioOf(pending.agency)}|${this.caller()}`) === 'investor' &&
            (stale || pending.amount > this.exceptionThreshold(pending.agency))
          if (!admin && !investor) revert('not_authorized', 'Only an Agency Admin can decline this request.')
        }
        pending.status = 'closed'
        return
      }
      case 'pay': {
        this.claim(op.paymentId)
        const source = this.places.get(op.sourceId)
        if (!source || (source.kind !== 'account' && source.kind !== 'budget'))
          revert('not_registered', 'The source of this payment is not registered.')
        const agency = source.scope
        this.requireRole(agency, 'admin')
        if (op.memberUserId && !this.inAgency(agency, op.memberUserId))
          revert('not_registered', 'Payouts are only for people in this Agency.')
        if (op.amount === 0 || (op.memberUserId && op.destinationId))
          revert('invalid_state', 'Pay either a person or a destination, with an amount.')
        if (source.kind === 'budget') {
          const budget = this.budgetOf(op.sourceId)
          if (budget.paused) revert('budget_paused', 'This budget is paused.')
          if (op.amount > budget.perOperationLimit)
            revert(
              'limit_exceeded',
              `The amount exceeds the per-operation limit of ${usd(budget.perOperationLimit)}.`,
            )
          if (!op.memberUserId && !allowed(budget, op.destinationId))
            revert('destination_not_allowed', 'This payment destination is not approved for this budget.')
        }
        const threshold = this.exceptionThreshold(agency)
        if (op.amount > threshold)
          revert('limit_exceeded', `Above the Investor's exception threshold of ${usd(threshold)}.`)
        this.payOut(op.sourceId, agency, op.memberUserId, op.amount)
        this.record(
          op.paymentId,
          'pay',
          'Payments follow the budget rules',
          written(
            'payment',
            op.amount,
            { id: op.sourceId },
            target(op.destinationId, op.memberUserId),
            op.evidenceHash,
          ),
        )
        return
      }
      case 'returnToAgency': {
        this.claim(op.opId)
        const role = this.roles.get(`${op.agencyId}|${this.caller()}`)
        if (role !== 'member' && role !== 'admin')
          revert('not_authorized', 'Only people in this Agency can return funds.')
        const operations =
          this.operations.get(op.agencyId) ??
          revert('not_registered', 'The Agency has no Operations account.')
        const key = `${op.agencyId}|${this.caller()}`
        const balance = this.members.get(key) ?? 0
        if (op.amount === 0 || op.amount > balance)
          revert('insufficient_funds', `Only ${usd(balance)} can be returned.`)
        this.members.set(key, balance - op.amount)
        this.placeOf(operations, 'account').balance += op.amount
        this.record(
          op.opId,
          'returnToAgency',
          'Returns go to the Agency’s Operations account',
          written('return', op.amount, { member: this.caller() }, { id: operations }),
        )
        return
      }
    }
  }

  /** `_check`: paused → destination (not for reimbursements) → per-operation limit → available. */
  private check(
    budgetId: Id,
    budget: BudgetView,
    holder: Id,
    destinationId: Id | null,
    member: Id | null,
    amount: number,
  ): Reason {
    if (budget.paused) return { code: 'budget_paused', message: 'This budget is paused.' }
    if (!member && !allowed(budget, destinationId))
      return {
        code: 'destination_not_allowed',
        message: 'This payment destination is not approved for this budget.',
      }
    const own = this.allowances.get(`${budgetId}|${holder}`) ?? 0
    const limit = own !== 0 && own < budget.perOperationLimit ? own : budget.perOperationLimit
    if (amount > limit)
      return {
        code: 'limit_exceeded',
        message: `The amount exceeds the per-operation limit of ${usd(limit)}.`,
      }
    const available = this.places.get(budgetId)?.balance ?? 0
    if (amount > available)
      return { code: 'insufficient_funds', message: `The budget has ${usd(available)} available.` }
    return null
  }

  /**
   * The app and the ledger disagree about a request. If the app rejected it
   * and the ledger would not, nothing is sent and the app's answer stands
   * (kept offchain). Any other disagreement stops the operation.
   */
  private drift(
    expected: RequestOutcome,
    outcome: RequestOutcome,
    reason: Reason,
    plan: SettlementPlan,
  ): never {
    if (expected === 'rejected' && plan.refusal) throw new Revert(plan.refusal)
    if (outcome === 'rejected' && reason) revert(reason.code, reason.message)
    return revert(
      'rule_drift',
      'The ledger and the app disagree about whether this payment needs approval. Nothing was moved.',
    )
  }

  private payOut(sourceId: Id, agency: Id, member: Id | null, amount: number) {
    const source = this.places.get(sourceId)!
    if (amount > source.balance) revert('insufficient_funds', `Only ${usd(source.balance)} is available.`)
    source.balance -= amount
    // A vendor payout leaves the ledger; a Member's lands in their Viatik balance.
    if (member)
      this.members.set(`${agency}|${member}`, (this.members.get(`${agency}|${member}`) ?? 0) + amount)
  }

  /** Spending access: a role in the agency and an active allowance granted since their last revocation. */
  private requireHolder(budgetId: Id, budget: BudgetView, holder: Id) {
    if (!this.inAgency(budget.agency, holder) || this.revokedNow.has(`${budget.agency}|${holder}`))
      revert('not_authorized', 'This person no longer has spending access to this budget.')
    if (!this.allowances.has(`${budgetId}|${holder}`))
      revert('not_authorized', 'This person does not have spending access to this budget.')
  }

  private inAgency(agency: Id, userId: Id) {
    const role = this.roles.get(`${agency}|${userId}`)
    return role === 'member' || role === 'admin'
  }

  /** `exceptionThresholdOf`: the first active or paused agreement of the agency, in creation order. */
  private exceptionThreshold(agency: Id) {
    for (const id of this.agencyAgreements.get(agency) ?? []) {
      const agreement = this.agreements.get(id)
      if (agreement && (agreement.status === 'active' || agreement.status === 'paused'))
        return agreement.exceptionThreshold
    }
    return Number.POSITIVE_INFINITY
  }

  private requireActive(agreement: AgreementView) {
    if (agreement.status === 'paused') revert('agreement_paused', 'The agreement is paused.')
    if (agreement.status !== 'active') revert('invalid_state', 'The agreement is not active.')
  }

  private requireRole(scope: Id, role: LedgerRole) {
    if (this.roles.get(`${scope}|${this.caller()}`) !== role)
      revert('not_authorized', 'The ledger did not accept this from your account.')
  }

  /** The agency's Admin, or the Investor of its portfolio. */
  private requireManager(agency: Id) {
    const admin = this.roles.get(`${agency}|${this.caller()}`) === 'admin'
    const investor = this.roles.get(`${this.portfolioOf(agency)}|${this.caller()}`) === 'investor'
    if (!admin && !investor) revert('not_authorized', 'The ledger did not accept this from your account.')
  }

  private bindVault(vaultId: Id, agency: Id, agreementId: Id) {
    const vault = this.places.get(vaultId)
    if (!vault) this.newPlace(vaultId, 'funding_vault', agency)
    else if (vault.kind !== 'funding_vault' || vault.scope !== agency || this.vaultAgreement.has(vaultId))
      revert('invalid_state', 'This funding vault is not free for a new agreement.')
    this.vaultAgreement.set(vaultId, agreementId)
  }

  private newPlace(id: Id, kind: LocationKind, scope: Id) {
    if (!id) revert('invalid_state', 'The ledger needs an id for this.')
    if (this.places.has(id)) revert('already_processed', 'The ledger already has this.')
    this.places.set(id, place(kind, scope))
  }

  private placeOf(id: Id, kind: LocationKind) {
    const found = this.places.get(id)
    if (!found || found.kind !== kind)
      return revert('not_registered', 'The ledger does not know this account yet.')
    return found
  }

  private agreementOf(id: Id) {
    return this.agreements.get(id) ?? revert('not_registered', 'The ledger does not know this agreement.')
  }

  private trancheOf(id: Id) {
    return this.tranches.get(id) ?? revert('not_registered', 'The ledger does not know this tranche.')
  }

  private budgetOf(id: Id) {
    return this.budgets.get(id) ?? revert('not_registered', 'The ledger does not know this budget.')
  }

  private portfolioOf(agency: Id) {
    return this.agencyPortfolio.get(agency) ?? ''
  }

  private caller(): Id {
    return this.actor ?? revert('not_authorized', 'Only a person can sign for the ledger.')
  }

  private claim(opId: Id) {
    if (this.processed.has(opId)) revert('already_processed', 'The ledger already recorded this operation.')
    this.processed.add(opId)
  }

  private move(from: Id, to: Id, amount: number) {
    const target = this.places.get(to)
    if (!target) revert('not_registered', 'The ledger does not know where this money goes.')
    const source = this.places.get(from)
    if (!source || amount > source.balance)
      revert('insufficient_funds', `Only ${usd(source?.balance ?? 0)} is available.`)
    source.balance -= amount
    target.balance += amount
  }

  /** Balances from movements: vaults, accounts and budgets, and what each Member holds per agency. */
  private adjust(location: Location, agencyId: Id | undefined, amount: number) {
    if (location.kind === 'recipient') {
      if (location.recipient.kind === 'member' && agencyId) {
        const key = `${agencyId}|${location.recipient.userId}`
        this.members.set(key, (this.members.get(key) ?? 0) + amount)
      }
      return
    }
    const id =
      location.kind === 'vault'
        ? location.vaultId
        : location.kind === 'account'
          ? location.accountId
          : location.kind === 'budget'
            ? location.budgetId
            : null
    const found = id ? this.places.get(id) : undefined
    if (found) found.balance += amount
  }

  private record(
    opId: Id,
    call: LedgerCall,
    contractPolicy: string,
    receipt: Written,
    outcome?: RequestOutcome,
  ) {
    this.written.push({ opId, ...receipt })
    this.records.push({
      opId,
      call,
      outcome,
      verified: simulatedVerification({
        operationId: opId,
        account: this.caller(),
        timestamp: this.now,
        contractPolicy,
      }),
    })
  }
}

function written(
  kind: Written['kind'],
  amount: Cents,
  from: RecordEnd,
  to: RecordEnd,
  evidenceHash: Hash | null = null,
): Written {
  return { kind, amount, from, to, evidenceHash }
}

/** `_target`: a Member's balance, a payment destination, or nothing named. */
function target(destinationId: Id | null, member: Id | null): RecordEnd {
  return member ? { member } : destinationId ? { id: destinationId } : null
}

/** Field by field, so a plan read back from storage (keys in another order) still matches. */
function sameRecords(a: readonly PlannedRecord[], b: readonly PlannedRecord[]) {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!
      return (
        x.opId === y.opId &&
        x.kind === y.kind &&
        x.amount === y.amount &&
        x.evidenceHash === y.evidenceHash &&
        sameEnd(x.from, y.from) &&
        sameEnd(x.to, y.to)
      )
    })
  )
}

function sameEnd(a: RecordEnd, b: RecordEnd) {
  if (a === null || b === null) return a === b
  return 'member' in a ? 'member' in b && a.member === b.member : 'id' in b && a.id === b.id
}

function place(kind: LocationKind, scope: Id): Place {
  return { kind, scope, balance: 0 }
}

function scopeId(scope: MembershipScope): Id {
  return scope.kind === 'portfolio' ? scope.portfolioId : scope.agencyId
}

function allowed(budget: BudgetView, destinationId: Id | null) {
  return budget.destinations.size === 0 || (destinationId !== null && budget.destinations.has(destinationId))
}

function perOperationLabel(budget: BudgetView) {
  return `Payment rules · per-operation limit ${usd(budget.perOperationLimit)}`
}

function trancheState(status: ViatikState['tranches'][number]['status']): TrancheState {
  switch (status) {
    case 'planned':
      return 'planned'
    case 'available':
      return 'available'
    case 'requested':
    case 'under_review':
    case 'approved':
      return 'requested'
    case 'released':
      return 'released'
    default:
      return 'rejected'
  }
}

function requestState(status: ViatikState['requests'][number]['status']): RequestState {
  switch (status) {
    case 'needs_approval':
      return 'pending'
    case 'approved':
    case 'processing':
    case 'completed':
      return 'executed'
    case 'rejected':
      return 'rejected'
    default:
      return 'closed'
  }
}

function fail(code: LedgerErrorCode, message: string): LedgerError {
  return { code, message, retryable: false }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

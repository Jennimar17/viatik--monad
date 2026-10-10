import { attachmentsHash } from '@/domain/evidence'
import type { Id, Location, MembershipScope, Role, ViatikState } from '@/domain/types'

import type { Hash } from './types'

/**
 * The ledger's storage as the product state implies it. The mock checks every
 * plan against it, and the genesis imports it into ViatikLedger, so both read
 * the same story the same way.
 */

export type LedgerRole = 'investor' | 'admin' | 'member'
export type LocationKind = 'portfolio_vault' | 'funding_vault' | 'account' | 'budget'
export type AgreementState = 'pending' | 'active' | 'paused' | 'inactive'
export type TrancheState = 'planned' | 'available' | 'requested' | 'released' | 'rejected'
export type RequestState = 'pending' | 'executed' | 'rejected' | 'closed'

export type Place = { kind: LocationKind; scope: Id; balance: number }
export type AgreementView = {
  agency: Id
  vault: Id
  committed: number
  funded: number
  released: number
  exceptionThreshold: number
  status: AgreementState
}
export type TrancheView = {
  agreement: Id
  amount: number
  index: number
  milestone: boolean
  status: TrancheState
  requestedBy?: Id
  destination?: Id
}
export type BudgetView = {
  agency: Id
  sourceAccount: Id
  perOperationLimit: number
  approvalThreshold: number
  paused: boolean
  /** Empty: any destination. */
  destinations: Set<Id>
}
export type RequestView = {
  budget: Id
  agency: Id
  requester: Id
  destination: Id | null
  member: Id | null
  amount: number
  evidenceHash: Hash | null
  status: RequestState
}

export type LedgerSnapshot = {
  scopes: Map<Id, 'portfolio' | 'agency'>
  agencyPortfolio: Map<Id, Id>
  /** `scope|userId` → role. */
  roles: Map<string, LedgerRole>
  places: Map<Id, Place>
  vaultAgreement: Map<Id, Id>
  /** Agency → its Operations account. */
  operations: Map<Id, Id>
  agreements: Map<Id, AgreementView>
  agencyAgreements: Map<Id, Id[]>
  tranches: Map<Id, TrancheView>
  budgets: Map<Id, BudgetView>
  /** `budgetId|userId` → per-operation limit (0: the budget's). */
  allowances: Map<string, number>
  requests: Map<Id, RequestView>
  /** `agencyId|userId` → what the Member holds. */
  members: Map<string, number>
  /**
   * `agencyId|paymentId` → a payment made outside Viatik (`payOutside`) and the
   * invoice anchored for it (null: none yet). The money already left the ledger.
   */
  outside: Map<string, { evidenceHash: Hash | null }>
  processed: Set<Id>
}

export const LEDGER_ROLE_OF: Record<Role, LedgerRole> = {
  investor: 'investor',
  agency_admin: 'admin',
  member: 'member',
}

export function ledgerSnapshot(state: ViatikState): LedgerSnapshot {
  const snapshot: LedgerSnapshot = {
    scopes: new Map(),
    agencyPortfolio: new Map(),
    roles: new Map(),
    places: new Map(),
    vaultAgreement: new Map(),
    operations: new Map(),
    agreements: new Map(),
    agencyAgreements: new Map(),
    tranches: new Map(),
    budgets: new Map(),
    allowances: new Map(),
    requests: new Map(),
    members: new Map(),
    outside: new Map(),
    processed: new Set(),
  }
  const { places } = snapshot

  for (const portfolio of state.portfolios) snapshot.scopes.set(portfolio.id, 'portfolio')
  for (const agency of state.agencies) {
    snapshot.scopes.set(agency.id, 'agency')
    snapshot.agencyPortfolio.set(agency.id, agency.portfolioId)
    // The first account opened as Operations stays the agency's for good, whatever its status.
    const operations = state.accounts.find((a) => a.agencyId === agency.id && a.template === 'operations')
    if (operations) snapshot.operations.set(agency.id, operations.id)
  }
  for (const membership of state.memberships) {
    if (membership.status !== 'active') continue
    const scope = scopeId(membership.scope)
    const fits = (membership.role === 'investor') === (membership.scope.kind === 'portfolio')
    if (fits) snapshot.roles.set(`${scope}|${membership.userId}`, LEDGER_ROLE_OF[membership.role])
  }
  for (const vault of state.vaults) {
    if (vault.kind === 'portfolio') places.set(vault.id, place('portfolio_vault', vault.portfolioId))
    if (vault.kind === 'funding' && vault.agencyId) {
      places.set(vault.id, place('funding_vault', vault.agencyId))
      if (vault.agreementId) snapshot.vaultAgreement.set(vault.id, vault.agreementId)
    }
  }
  for (const account of state.accounts) places.set(account.id, place('account', account.agencyId))
  for (const budget of state.budgets) {
    places.set(budget.id, place('budget', budget.agencyId))
    snapshot.budgets.set(budget.id, {
      agency: budget.agencyId,
      sourceAccount: budget.sourceAccountId,
      perOperationLimit: budget.perOperationLimit,
      approvalThreshold: budget.approvalThreshold,
      paused: budget.status !== 'active',
      destinations: new Set(budget.allowedDestinationIds),
    })
    snapshot.processed.add(budget.id)
  }

  for (const movement of state.movements) {
    adjustBalance(snapshot, movement.from, movement.agencyId, -movement.amount)
    adjustBalance(snapshot, movement.to, movement.agencyId, movement.amount)
    if (movement.refId) snapshot.processed.add(movement.refId)
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
    snapshot.agreements.set(agreement.id, {
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
    snapshot.agencyAgreements.set(agreement.agencyId, [
      ...(snapshot.agencyAgreements.get(agreement.agencyId) ?? []),
      agreement.id,
    ])
  }
  for (const tranche of state.tranches) {
    snapshot.tranches.set(tranche.id, {
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
      snapshot.allowances.set(
        `${allowance.budgetId}|${allowance.holder.userId}`,
        allowance.perOperationLimit ?? 0,
      )
  }
  for (const request of state.requests) {
    snapshot.processed.add(request.id)
    // Payment for work never exists on the ledger as a request: an Agency Admin pays it with `pay`.
    if (request.requester.kind !== 'user' || request.type === 'work') continue
    snapshot.requests.set(request.id, {
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
  for (const payment of state.payments) {
    snapshot.processed.add(payment.id)
    if (payment.recipient.kind === 'address' && payment.status === 'completed')
      snapshot.outside.set(`${payment.agencyId}|${payment.id}`, {
        evidenceHash: payment.proof ? attachmentsHash([payment.proof]) : null,
      })
  }
  for (const receipt of state.receipts) snapshot.processed.add(receipt.operationId)
  return snapshot
}

/**
 * Moves a balance in the snapshot: a ledger location, or what a Member holds in an agency.
 * Money that leaves the ledger (a vendor payout, an outside payment, a withdrawal) only
 * debits its source: an `external` end or a vendor holds nothing on the ledger.
 */
export function adjustBalance(
  snapshot: Pick<LedgerSnapshot, 'places' | 'members'>,
  location: Location,
  agencyId: Id | undefined,
  amount: number,
) {
  if (location.kind === 'recipient') {
    if (location.recipient.kind === 'member' && agencyId) {
      const key = `${agencyId}|${location.recipient.userId}`
      snapshot.members.set(key, (snapshot.members.get(key) ?? 0) + amount)
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
  const found = id ? snapshot.places.get(id) : undefined
  if (found) found.balance += amount
}

export function place(kind: LocationKind, scope: Id): Place {
  return { kind, scope, balance: 0 }
}

export function scopeId(scope: MembershipScope): Id {
  return scope.kind === 'portfolio' ? scope.portfolioId : scope.agencyId
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

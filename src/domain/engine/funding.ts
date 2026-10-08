import { parseAddress, shortAddress } from '../address'
import { evidenceSetHash } from '../evidence'
import { newId } from '../ids'
import { cents, sum, type Cents } from '../money'
import { activeOperationsAccount } from '../queries'
import { agreementCapital, vaultBalance } from '../selectors'
import { assertTransition, canTransitionMilestone, canTransitionTranche } from '../status'
import type {
  Agency,
  AgencyType,
  Evidence,
  FundingAgreement,
  Id,
  ISODate,
  Milestone,
  Portfolio,
  ReleaseModel,
  SpendingPolicy,
  Tranche,
} from '../types'
import {
  DomainError,
  evidenceFrom,
  requirePositive,
  requireText,
  usdText,
  type EvidenceDraft,
  type Tx,
} from './core'
import { ensureOperationsAccount } from './operations'

// ─── Portfolios ──────────────────────────────────────────────────────────────

export type CreatePortfolioInput = {
  name: string
  organization: string
  timeZone: string
  /** The creator's own name, when their sign-in did not provide one. */
  ownerName?: string
}

/**
 * A person with no workspace yet starts their own portfolio and becomes its
 * Investor. The portfolio comes with its vault, where capital is deposited.
 */
export function createPortfolio(tx: Tx, input: CreatePortfolioInput): Portfolio {
  const userId = tx.userId
  const owner = tx.state.users.find((u) => u.id === userId)
  if (!owner) {
    throw new DomainError('not_found', 'We could not find your profile. Sign in again to continue.')
  }
  if (input.ownerName !== undefined) owner.name = requireText(input.ownerName, 'Your name', 80)
  else if (!owner.name.trim()) throw new DomainError('validation', 'Enter your name.')
  const portfolio: Portfolio = {
    id: newId('pf'),
    name: requireText(input.name, 'Portfolio name', 80),
    organization: requireText(input.organization, 'Organization', 80),
    baseCurrency: 'USD',
    timeZone: input.timeZone || 'UTC',
    createdAt: tx.now,
  }
  tx.state.portfolios.push(portfolio)
  tx.state.vaults.push({
    id: newId('vault'),
    kind: 'portfolio',
    portfolioId: portfolio.id,
    name: `${portfolio.name} Vault`,
    asset: 'USDC',
    available: true,
  })
  tx.state.memberships.push({
    id: newId('mem'),
    userId,
    role: 'investor',
    scope: { kind: 'portfolio', portfolioId: portfolio.id },
    status: 'active',
    createdAt: tx.now,
  })
  tx.activity(
    'portfolio_created',
    `Created ${portfolio.name}`,
    { kind: 'portfolio', id: portfolio.id },
    {
      portfolioId: portfolio.id,
    },
  )
  return portfolio
}

// ─── Agencies ────────────────────────────────────────────────────────────────

export type CreateAgencyInput = {
  portfolioId: Id
  name: string
  type: AgencyType
  description: string
  website?: string
  timeZone: string
  admin: { name: string; email: string }
}

export function createAgency(tx: Tx, input: CreateAgencyInput): Agency {
  tx.authorize('create_agency', { portfolioId: input.portfolioId })
  const name = requireText(input.name, 'Agency name', 80)
  if (
    tx.state.agencies.some(
      (a) => a.portfolioId === input.portfolioId && a.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new DomainError('validation', 'An Agency with this name already exists in the portfolio.')
  }
  const agency: Agency = {
    id: newId('ag'),
    portfolioId: input.portfolioId,
    name,
    type: input.type,
    description: requireText(input.description, 'Description', 400),
    website: input.website?.trim() || undefined,
    timeZone: input.timeZone,
    status: 'onboarding',
    createdAt: tx.now,
  }
  tx.state.agencies.push(agency)
  tx.state.vaults.push({
    id: newId('vault'),
    kind: 'funding',
    portfolioId: input.portfolioId,
    agencyId: agency.id,
    name: `${agency.name} Funding Vault`,
    asset: 'USDC',
    available: true,
  })
  tx.state.invitations.push({
    id: newId('inv'),
    code: newId('join').replace('join_', ''),
    email: requireText(input.admin.email, 'Admin email', 120),
    name: requireText(input.admin.name, 'Admin name', 80),
    role: 'agency_admin',
    scope: { kind: 'agency', agencyId: agency.id },
    invitedBy: tx.userId,
    createdAt: tx.now,
    status: 'pending',
  })
  tx.activity(
    'agency_created',
    `Created the ${agency.name} Agency`,
    { kind: 'agency', id: agency.id },
    {
      portfolioId: input.portfolioId,
      agencyId: agency.id,
    },
  )
  return agency
}

// ─── Funding agreements ──────────────────────────────────────────────────────

export type TrancheDraft = {
  name: string
  amount: Cents
  releaseCondition: Tranche['releaseCondition']
  scheduledFor?: ISODate
  milestone?: { title: string; description: string; acceptanceCriteria: string[]; dueDate: ISODate }
}

export type CreateAgreementInput = {
  portfolioId: Id
  agencyId: Id
  title: string
  purpose: string
  committed: Cents
  releaseModel: ReleaseModel
  startDate: ISODate
  endDate: ISODate
  tranches: TrancheDraft[]
  spendingPolicy: SpendingPolicy
  evidenceRequirements: string
}

export function createAgreement(tx: Tx, input: CreateAgreementInput): FundingAgreement {
  tx.authorize('create_agreement', { portfolioId: input.portfolioId })
  const agency = tx.find('agencies', input.agencyId, 'Agency')
  if (agency.portfolioId !== input.portfolioId)
    throw new DomainError('forbidden', 'This Agency belongs to another portfolio.')
  requirePositive(input.committed, 'Commitment')
  if (input.tranches.length === 0) throw new DomainError('validation', 'Add at least one tranche.')
  const trancheTotal = sum(input.tranches, (t) => t.amount)
  if (trancheTotal !== input.committed) {
    throw new DomainError(
      'validation',
      `Tranches add up to ${usdText(trancheTotal)} but the commitment is ${usdText(input.committed)}.`,
    )
  }
  if (input.endDate <= input.startDate)
    throw new DomainError('validation', 'The end date must be after the start date.')

  const agreement: FundingAgreement = {
    id: newId('fa'),
    portfolioId: input.portfolioId,
    agencyId: input.agencyId,
    title: requireText(input.title, 'Agreement title', 100),
    purpose: requireText(input.purpose, 'Purpose', 500),
    committed: input.committed,
    releaseModel: input.releaseModel,
    startDate: input.startDate,
    endDate: input.endDate,
    status: 'pending_acceptance',
    spendingPolicy: input.spendingPolicy,
    evidenceRequirements: input.evidenceRequirements.trim(),
    createdBy: tx.userId,
    createdAt: tx.now,
  }
  tx.state.agreements.push(agreement)

  input.tranches.forEach((draft, index) => {
    requirePositive(draft.amount, `Tranche ${index + 1} amount`)
    // The ledger only knows whether a tranche has a milestone; the two must agree.
    if (Boolean(draft.milestone) !== (draft.releaseCondition === 'milestone'))
      throw new DomainError(
        'validation',
        `Tranche ${index + 1}: a milestone release needs a milestone, and only milestone releases have one.`,
      )
    const trancheId = newId('tr')
    let milestoneId: Id | undefined
    if (draft.milestone) {
      milestoneId = newId('ms')
      tx.state.milestones.push({
        id: milestoneId,
        agreementId: agreement.id,
        trancheId,
        title: requireText(draft.milestone.title, 'Milestone title', 100),
        description: draft.milestone.description.trim(),
        acceptanceCriteria: draft.milestone.acceptanceCriteria.map((c) => c.trim()).filter(Boolean),
        dueDate: draft.milestone.dueDate,
        status: index === 0 ? 'in_progress' : 'not_started',
        evidence: [],
      })
    }
    tx.state.tranches.push({
      id: trancheId,
      agreementId: agreement.id,
      index: index + 1,
      name: draft.name.trim() || `Tranche ${index + 1}`,
      amount: draft.amount,
      releaseCondition: draft.releaseCondition,
      scheduledFor: draft.scheduledFor,
      milestoneId,
      status: index === 0 && draft.releaseCondition !== 'milestone' ? 'available' : 'planned',
    })
  })

  if (!tx.state.vaults.some((v) => v.kind === 'funding' && v.agencyId === agency.id && !v.agreementId)) {
    tx.state.vaults.push({
      id: newId('vault'),
      kind: 'funding',
      portfolioId: input.portfolioId,
      agencyId: agency.id,
      agreementId: agreement.id,
      name: `${agency.name} Funding Vault`,
      asset: 'USDC',
      available: true,
    })
  } else {
    const vault = tx.state.vaults.find(
      (v) => v.kind === 'funding' && v.agencyId === agency.id && !v.agreementId,
    )
    if (vault) vault.agreementId = agreement.id
  }

  tx.activity(
    'agreement_created',
    `Created the ${agreement.title} agreement for ${agency.name}`,
    { kind: 'agreement', id: agreement.id },
    {
      portfolioId: input.portfolioId,
      agencyId: agency.id,
      amount: agreement.committed,
    },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: agency.id }),
    'New funding agreement',
    `${agreement.title} (${usdText(agreement.committed)}) is ready for your acceptance.`,
    `/agency/${agency.id}/funding?agreement=${agreement.id}`,
  )
  return agreement
}

export function acceptAgreement(tx: Tx, input: { agreementId: Id }) {
  const agreement = tx.find('agreements', input.agreementId, 'Funding agreement')
  tx.authorize('request_tranche', { agencyId: agreement.agencyId })
  if (agreement.status !== 'pending_acceptance')
    throw new DomainError('invalid_state', 'This agreement is not waiting for acceptance.')
  agreement.status = 'active'
  const agency = tx.find('agencies', agreement.agencyId, 'Agency')
  if (agency.status === 'onboarding') agency.status = 'active'
  tx.activity(
    'agreement_created',
    `Accepted the ${agreement.title} agreement`,
    { kind: 'agreement', id: agreement.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agreement.agencyId,
    },
  )
  // Released funding needs somewhere to land. (Phase 8: the ledger must
  // register accounts created as a side effect like this one.)
  ensureOperationsAccount(tx, agreement.agencyId)
  tx.notify(
    tx.holders('investor', { portfolioId: agreement.portfolioId }),
    'Agreement accepted',
    `${agency.name} accepted ${agreement.title}.`,
    `/investor/${agreement.portfolioId}/funding/${agreement.id}`,
  )
  return agreement
}

export function setAgreementPaused(tx: Tx, input: { agreementId: Id; paused: boolean }) {
  const agreement = tx.find('agreements', input.agreementId, 'Funding agreement')
  tx.authorize('freeze_agreement', { portfolioId: agreement.portfolioId })
  if (input.paused && agreement.status !== 'active')
    throw new DomainError('invalid_state', 'Only active agreements can be paused.')
  if (!input.paused && agreement.status !== 'paused')
    throw new DomainError('invalid_state', 'This agreement is not paused.')
  agreement.status = input.paused ? 'paused' : 'active'
  agreement.frozenAt = input.paused ? tx.now : undefined
  tx.activity(
    input.paused ? 'agreement_paused' : 'agreement_created',
    input.paused ? `Paused ${agreement.title}` : `Resumed ${agreement.title}`,
    { kind: 'agreement', id: agreement.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agreement.agencyId,
    },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: agreement.agencyId }),
    input.paused ? 'Agreement paused' : 'Agreement resumed',
    input.paused
      ? `${agreement.title} is paused. Tranche releases are on hold.`
      : `${agreement.title} is active again.`,
    `/agency/${agreement.agencyId}/funding?agreement=${agreement.id}`,
  )
  return agreement
}

// ─── Capital into vaults ─────────────────────────────────────────────────────

/** The settlement token mints at most 1,000,000 USD per deposit (TestUSD `MAX_MINT`). */
export const MAX_DEPOSIT = cents(100_000_000)

export function addFunds(tx: Tx, input: { portfolioId: Id; amount: Cents; source: string }) {
  tx.authorize('fund_agreement', { portfolioId: input.portfolioId })
  requirePositive(input.amount)
  if (input.amount > MAX_DEPOSIT)
    throw new DomainError(
      'limit_exceeded',
      `A single deposit can be up to ${usdText(MAX_DEPOSIT)}. Split it into several deposits.`,
    )
  const vault = tx.state.vaults.find((v) => v.portfolioId === input.portfolioId && v.kind === 'portfolio')
  if (!vault) throw new DomainError('not_found', 'Portfolio Vault not found.')
  const operationId = newId('dep')
  const receipt = tx.receipt({
    kind: 'deposit',
    amount: input.amount,
    fromLabel: input.source,
    toLabel: vault.name,
    description: 'Funds added to the Portfolio Vault',
    policyLabel: 'Portfolio Vault deposit',
    operationId,
    portfolioId: input.portfolioId,
  })
  tx.move(
    'deposit',
    input.amount,
    { kind: 'external', label: input.source },
    { kind: 'vault', vaultId: vault.id },
    {
      portfolioId: input.portfolioId,
      refId: operationId,
      receiptId: receipt.id,
    },
  )
  tx.activity(
    'capital_deposited',
    `Added ${usdText(input.amount)} to the Portfolio Vault`,
    { kind: 'receipt', id: receipt.id },
    {
      portfolioId: input.portfolioId,
      amount: input.amount,
    },
  )
  return receipt
}

/**
 * The Investor takes money out of their Portfolio Vault, to their account or another
 * address. Only the Portfolio Vault can be named: what is committed to an Agency
 * (a funding vault) keeps its own flow of tranches and returns.
 */
export function withdrawFunds(tx: Tx, input: { portfolioId: Id; amount: Cents; to: string }) {
  tx.authorize('withdraw_funds', { portfolioId: input.portfolioId })
  requirePositive(input.amount)
  const address = parseAddress(input.to)
  if (!address)
    throw new DomainError('validation', 'Enter a valid account address (0x followed by 40 characters).')
  const vault = tx.state.vaults.find((v) => v.portfolioId === input.portfolioId && v.kind === 'portfolio')
  if (!vault) throw new DomainError('not_found', 'Portfolio Vault not found.')
  const available = vaultBalance(tx.state, vault.id)
  if (available < input.amount) {
    throw new DomainError(
      'insufficient_funds',
      `The Portfolio Vault has ${usdText(available)} available. Capital committed to an Agency cannot be withdrawn from here.`,
    )
  }
  const operationId = newId('wd')
  const receipt = tx.receipt({
    kind: 'withdrawal',
    amount: input.amount,
    fromLabel: vault.name,
    toLabel: shortAddress(address),
    description: 'Funds withdrawn from the Portfolio Vault',
    policyLabel: 'Only the Portfolio Vault can be withdrawn',
    operationId,
    portfolioId: input.portfolioId,
  })
  tx.move(
    'withdrawal',
    input.amount,
    { kind: 'vault', vaultId: vault.id },
    { kind: 'external', label: shortAddress(address), address },
    { portfolioId: input.portfolioId, refId: operationId, receiptId: receipt.id },
  )
  tx.activity(
    'funds_withdrawn',
    `Withdrew ${usdText(input.amount)} from the Portfolio Vault`,
    { kind: 'receipt', id: receipt.id },
    { portfolioId: input.portfolioId, amount: input.amount },
  )
  return receipt
}

export function fundAgreement(tx: Tx, input: { agreementId: Id; amount: Cents }) {
  const agreement = tx.find('agreements', input.agreementId, 'Funding agreement')
  tx.authorize('fund_agreement', { portfolioId: agreement.portfolioId })
  requirePositive(input.amount)
  if (
    agreement.status === 'cancelled' ||
    agreement.status === 'completed' ||
    agreement.status === 'expired'
  ) {
    throw new DomainError('invalid_state', 'This agreement can no longer receive funds.')
  }
  const capital = agreementCapital(tx.state, agreement.id)
  if (capital.funded + input.amount > agreement.committed) {
    throw new DomainError(
      'limit_exceeded',
      `Funded capital cannot exceed the ${usdText(agreement.committed)} commitment. You can add up to ${usdText(capital.unfunded)}.`,
    )
  }
  const portfolioVault = tx.state.vaults.find(
    (v) => v.portfolioId === agreement.portfolioId && v.kind === 'portfolio',
  )!
  const available = vaultBalance(tx.state, portfolioVault.id)
  if (available < input.amount) {
    throw new DomainError(
      'insufficient_funds',
      `The Portfolio Vault has ${usdText(available)} available. Add funds first.`,
    )
  }
  const fundingVault = tx.state.vaults.find((v) => v.kind === 'funding' && v.agreementId === agreement.id)
  if (!fundingVault) throw new DomainError('not_found', 'Funding Vault not found.')
  const agency = tx.find('agencies', agreement.agencyId, 'Agency')
  const operationId = newId('fund')
  const receipt = tx.receipt({
    kind: 'funding',
    amount: input.amount,
    fromLabel: portfolioVault.name,
    toLabel: fundingVault.name,
    description: `Funding Agreement funded for ${agency.name}`,
    policyLabel: 'Funded capital cannot exceed the agreement commitment',
    operationId,
    portfolioId: agreement.portfolioId,
    agencyId: agency.id,
  })
  tx.move(
    'fund_agreement',
    input.amount,
    { kind: 'vault', vaultId: portfolioVault.id },
    { kind: 'vault', vaultId: fundingVault.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agency.id,
      agreementId: agreement.id,
      refId: operationId,
      receiptId: receipt.id,
    },
  )
  tx.activity(
    'agreement_funded',
    `Funded the ${agency.name} agreement with ${usdText(input.amount)}`,
    { kind: 'agreement', id: agreement.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agency.id,
      amount: input.amount,
    },
  )
  return receipt
}

// ─── Milestones and tranches ─────────────────────────────────────────────────

export type { EvidenceDraft } from './core'

export function submitMilestoneEvidence(
  tx: Tx,
  input: { milestoneId: Id; evidence: EvidenceDraft[]; note: string; destinationAccountId: Id },
): Milestone {
  const milestone = tx.find('milestones', input.milestoneId, 'Milestone')
  const agreement = tx.find('agreements', milestone.agreementId, 'Funding agreement')
  tx.authorize('submit_milestone_evidence', { agencyId: agreement.agencyId })
  if (agreement.status !== 'active')
    throw new DomainError('invalid_state', 'The agreement must be active to submit evidence.')
  if (input.evidence.length === 0)
    throw new DomainError('validation', 'Attach at least one piece of evidence.')
  const account = destinationAccount(tx, input.destinationAccountId, agreement.agencyId)

  const next = milestone.status === 'not_started' ? 'in_progress' : milestone.status
  if (next !== 'in_progress' && next !== 'changes_requested') {
    throw new DomainError('invalid_state', 'This milestone is not open for evidence.')
  }
  assertTransition('Milestone', canTransitionMilestone, next, 'ready_for_review')

  const evidence: Evidence[] = input.evidence.map((item) => evidenceFrom(item, tx.userId, tx.now))
  milestone.evidence = [...milestone.evidence, ...evidence]
  milestone.status = 'ready_for_review'
  milestone.submittedAt = tx.now
  milestone.submittedBy = tx.userId
  milestone.submissionNote = input.note.trim()
  milestone.evidenceHash = evidenceSetHash(milestone.evidence)
  milestone.decision = undefined

  const tranche = tx.find('tranches', milestone.trancheId, 'Tranche')
  tranche.status = 'under_review'
  tranche.requestedAt = tx.now
  tranche.requestedBy = tx.userId
  tranche.destinationAccountId = account.id

  tx.activity(
    'milestone_submitted',
    `Submitted evidence for ${milestone.title}`,
    { kind: 'milestone', id: milestone.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agreement.agencyId,
    },
  )
  tx.activity(
    'tranche_requested',
    `Requested ${tranche.name} (${usdText(tranche.amount)})`,
    { kind: 'tranche', id: tranche.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agreement.agencyId,
      amount: tranche.amount,
    },
  )
  const agency = tx.find('agencies', agreement.agencyId, 'Agency')
  tx.notify(
    tx.holders('investor', { portfolioId: agreement.portfolioId }),
    'Milestone ready for review',
    `${agency.name} submitted evidence for "${milestone.title}".`,
    `/investor/${agreement.portfolioId}/funding/${agreement.id}/milestones/${milestone.id}`,
  )
  return milestone
}

/** Where an Agency asks released funding to land: one of its own active accounts. */
function destinationAccount(tx: Tx, accountId: Id, agencyId: Id) {
  const account = tx.find('accounts', accountId, 'Account')
  if (account.agencyId !== agencyId)
    throw new DomainError('forbidden', 'The destination account belongs to another Agency.')
  if (account.status !== 'active')
    throw new DomainError('invalid_state', `${account.name} is not active. Choose another account.`)
  return account
}

/** Tranches without milestones (scheduled/manual) are requested directly. */
export function requestTranche(
  tx: Tx,
  input: { trancheId: Id; destinationAccountId: Id; note?: string },
): Tranche {
  const tranche = tx.find('tranches', input.trancheId, 'Tranche')
  const agreement = tx.find('agreements', tranche.agreementId, 'Funding agreement')
  tx.authorize('request_tranche', { agencyId: agreement.agencyId })
  if (agreement.status !== 'active')
    throw new DomainError('invalid_state', 'The agreement must be active to request funding.')
  if (tranche.milestoneId) {
    throw new DomainError(
      'invalid_state',
      'This tranche is released by milestone. Submit the milestone evidence instead.',
    )
  }
  if (tranche.status !== 'available' && tranche.status !== 'planned') {
    throw new DomainError('invalid_state', 'This tranche cannot be requested right now.')
  }
  const account = destinationAccount(tx, input.destinationAccountId, agreement.agencyId)
  tranche.status = 'under_review'
  tranche.requestedAt = tx.now
  tranche.requestedBy = tx.userId
  tranche.destinationAccountId = account.id
  tx.activity(
    'tranche_requested',
    `Requested ${tranche.name} (${usdText(tranche.amount)})`,
    { kind: 'tranche', id: tranche.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agreement.agencyId,
      amount: tranche.amount,
    },
  )
  tx.notify(
    tx.holders('investor', { portfolioId: agreement.portfolioId }),
    'Tranche requested',
    `${tranche.name} of ${agreement.title} was requested.`,
    `/investor/${agreement.portfolioId}/approvals`,
  )
  return tranche
}

/**
 * Investor approves the milestone (if any) and releases the tranche. The
 * capital moves from the Funding Vault to the chosen Agency Account in one
 * operation — mirroring the atomic onchain release.
 */
export function releaseTranche(tx: Tx, input: { trancheId: Id; checkedCriteria?: number[]; note?: string }) {
  const tranche = tx.find('tranches', input.trancheId, 'Tranche')
  const agreement = tx.find('agreements', tranche.agreementId, 'Funding agreement')
  tx.authorize('release_tranche', {
    portfolioId: agreement.portfolioId,
    createdBy: tranche.requestedBy ? { kind: 'user', userId: tranche.requestedBy } : undefined,
  })
  if (agreement.status !== 'active')
    throw new DomainError('invalid_state', 'The agreement is not active. Resume it before releasing funds.')
  if (tranche.status === 'released')
    throw new DomainError('invalid_state', 'This tranche was already released.')
  if (
    tranche.status !== 'under_review' &&
    tranche.status !== 'approved' &&
    !(tranche.status === 'available' && tranche.releaseCondition !== 'milestone')
  ) {
    throw new DomainError('invalid_state', 'This tranche has not been requested yet.')
  }

  const capital = agreementCapital(tx.state, agreement.id)
  if (capital.released + tranche.amount > capital.funded) {
    throw new DomainError(
      'insufficient_funds',
      `Released capital cannot exceed funded capital. Fund the agreement with at least ${usdText(cents(capital.released + tranche.amount - capital.funded))} first.`,
    )
  }

  let milestone: Milestone | undefined
  if (tranche.milestoneId) {
    milestone = tx.find('milestones', tranche.milestoneId, 'Milestone')
    if (milestone.status !== 'ready_for_review')
      throw new DomainError('invalid_state', 'The milestone is not ready for review.')
    milestone.status = 'approved'
    milestone.decision = {
      outcome: 'approved',
      note: input.note?.trim() || undefined,
      checkedCriteria: input.checkedCriteria ?? milestone.acceptanceCriteria.map((_, i) => i),
      decidedAt: tx.now,
      decidedBy: tx.userId,
    }
  } else {
    // Without a milestone, releasing is the Investor's approval of the Agency's
    // request (under review) or of a tranche that is simply available.
    const approvable = tranche.status === 'available' || tranche.status === 'under_review'
    assertTransition('Tranche', canTransitionTranche, approvable ? 'approved' : tranche.status, 'released')
  }

  const agency = tx.find('agencies', agreement.agencyId, 'Agency')
  // The account chosen when the tranche was requested must still be usable.
  const destination = tranche.destinationAccountId
    ? destinationAccount(tx, tranche.destinationAccountId, agency.id)
    : activeOperationsAccount(tx.state, agency.id)
  if (!destination) throw new DomainError('invalid_state', 'The Agency has no account to receive the funds.')
  const fundingVault = tx.state.vaults.find((v) => v.kind === 'funding' && v.agreementId === agreement.id)!

  const receipt = tx.receipt({
    kind: 'tranche_release',
    amount: tranche.amount,
    fromLabel: fundingVault.name,
    toLabel: `${agency.name} · ${destination.name}`,
    description: `${tranche.name} released to ${agency.name}`,
    policyLabel: 'Released capital cannot exceed funded capital · Investor approval required',
    operationId: tranche.id,
    portfolioId: agreement.portfolioId,
    agencyId: agency.id,
    evidenceIds: milestone?.evidence.map((e) => e.id),
  })
  tx.move(
    'release_tranche',
    tranche.amount,
    { kind: 'vault', vaultId: fundingVault.id },
    { kind: 'account', accountId: destination.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agency.id,
      agreementId: agreement.id,
      refId: tranche.id,
      receiptId: receipt.id,
    },
  )
  Object.assign(tranche, {
    status: 'released',
    releasedAt: tx.now,
    releasedBy: tx.userId,
    receiptId: receipt.id,
    destinationAccountId: destination.id,
  })

  // The next tranche becomes available and its milestone opens.
  const nextTranche = tx.state.tranches.find(
    (t) => t.agreementId === agreement.id && t.index === tranche.index + 1,
  )
  if (nextTranche && nextTranche.status === 'planned' && nextTranche.releaseCondition !== 'milestone')
    nextTranche.status = 'available'
  const nextMilestone = nextTranche?.milestoneId
    ? tx.state.milestones.find((m) => m.id === nextTranche.milestoneId)
    : undefined
  if (nextMilestone && nextMilestone.status === 'not_started') nextMilestone.status = 'in_progress'

  tx.activity(
    'tranche_released',
    `Released ${tranche.name} (${usdText(tranche.amount)}) to ${agency.name}`,
    { kind: 'tranche', id: tranche.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agency.id,
      amount: tranche.amount,
    },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: agency.id }),
    'Funding released',
    `${usdText(tranche.amount)} is now available in the ${agency.name} ${destination.name} account.`,
    `/agency/${agency.id}/accounts/${destination.id}`,
  )
  return { tranche, receipt, destination }
}

export function requestMilestoneChanges(tx: Tx, input: { milestoneId: Id; note: string; reject?: boolean }) {
  const milestone = tx.find('milestones', input.milestoneId, 'Milestone')
  const agreement = tx.find('agreements', milestone.agreementId, 'Funding agreement')
  const tranche = tx.find('tranches', milestone.trancheId, 'Tranche')
  tx.authorize('release_tranche', {
    portfolioId: agreement.portfolioId,
    createdBy: tranche.requestedBy ? { kind: 'user', userId: tranche.requestedBy } : undefined,
  })
  const outcome = input.reject ? 'rejected' : 'changes_requested'
  assertTransition('Milestone', canTransitionMilestone, milestone.status, outcome)
  const note = requireText(input.note, 'A note for the Agency', 600)
  milestone.status = outcome
  milestone.decision = { outcome, note, checkedCriteria: [], decidedAt: tx.now, decidedBy: tx.userId }
  tranche.status = input.reject ? 'rejected' : 'available'
  tx.activity(
    'milestone_changes_requested',
    input.reject ? `Rejected ${milestone.title}` : `Requested changes to ${milestone.title}`,
    { kind: 'milestone', id: milestone.id },
    {
      portfolioId: agreement.portfolioId,
      agencyId: agreement.agencyId,
    },
  )
  tx.notify(
    tx.holders('agency_admin', { agencyId: agreement.agencyId }),
    input.reject ? 'Milestone rejected' : 'Changes requested',
    `${tx.actorName()}: ${note}`,
    `/agency/${agreement.agencyId}/funding?agreement=${agreement.id}`,
  )
  return milestone
}

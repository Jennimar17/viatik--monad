import {
  encodeFunctionData,
  getAddress,
  keccak256,
  slice,
  stringToHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem'

import type { Cents } from '@/domain/money'
import type { Id, ViatikState } from '@/domain/types'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'

import { LEDGER_ROLE } from './encode'
import { ledgerId } from './ids'
import {
  ledgerSnapshot,
  type AgreementState,
  type LedgerRole,
  type LocationKind,
  type TrancheState,
} from './snapshot'
import type { ChainContext } from './types'
import { centsToUnits } from './units'

/**
 * Genesis: the seeded story imported into ViatikLedger under a fresh
 * namespace, so the chain starts where the app's history is. It imports what
 * the mock's view of the ledger holds (`ledgerSnapshot`), in the order the
 * contract needs: scopes, roles, locations with their balances (minting the
 * TestUSD behind them), agreements, budget rules, allowances, Member balances
 * and requests still waiting for approval. The namespace is set last.
 *
 * People without an account get a placeholder address that nobody holds:
 * their roles, allowances, balances and open requests still exist onchain, so
 * an Admin can approve what they asked for. The deployed contract cannot move
 * a placeholder's pending requests or balance to a real account, so someone
 * who signs in after the genesis is bound by the next re-seed (8.5).
 */

/** One owner call of the genesis, as calldata for the ledger's `multicall`. */
export type GenesisCall = { label: string; data: Hex }

export type Genesis = {
  namespace: string
  calls: GenesisCall[]
  /** People without an account who hold something onchain, and the address that stands in for them. */
  placeholders: Record<Id, Address>
  /** What the story has that the ledger does not carry, and why. */
  skipped: string[]
  /** TestUSD minted behind the imported balances. */
  minted: Cents
}

/** A transaction of the genesis; without a block, it was sent but not seen landing. */
export type GenesisTransaction = { hash: Hex; calls: number; block?: number; gasUsed?: number }

/** How a genesis went: every transaction sent, and where it stopped if it did. */
export type GenesisRun =
  | { status: 'completed'; namespace: string; transactions: GenesisTransaction[] }
  | {
      status: 'failed'
      namespace: string
      transactions: GenesisTransaction[]
      /** The call (or step) that failed. */
      failedAt: string
      problem: string
    }

/** The story contradicts the ledger's rules (a negative balance, tranches that do not add up). */
export class GenesisError extends Error {
  constructor(readonly problems: string[]) {
    super(`The state cannot be imported: ${problems.join('; ')}`)
  }
}

const LOCATION_KIND: Record<LocationKind, number> = {
  portfolio_vault: 1,
  funding_vault: 2,
  account: 3,
  budget: 4,
}
/**
 * An agreement that is over (or a draft) imports as pending: like the mock's
 * `inactive`, it neither governs the agency's exception threshold nor
 * releases, and the planner creates a draft as pending anyway.
 */
const AGREEMENT_STATUS: Record<AgreementState, number> = {
  pending: 1,
  inactive: 1,
  active: 2,
  paused: 3,
}
const TRANCHE_STATUS: Record<TrancheState, number> = {
  planned: 1,
  available: 2,
  requested: 3,
  released: 4,
  rejected: 5,
}
const ROLE_NUMBER: Record<LedgerRole, number> = {
  investor: LEDGER_ROLE.investor,
  admin: LEDGER_ROLE.agency_admin,
  member: LEDGER_ROLE.member,
}
/** Ids are `namespace:productId`, so a namespace never holds `:`; it fits the contract's `bytes32`. */
const NAMESPACE = /^[A-Za-z0-9._-]{1,32}$/

/** A stand-in account for someone without one: derived from the namespace, held by nobody. */
export function placeholderAddress(namespace: string, userId: Id): Address {
  return getAddress(slice(keccak256(stringToHex(`viatik:placeholder:${namespace}:${userId}`)), 12))
}

/**
 * The context to settle on after a genesis: each person's account, or the
 * placeholder this genesis gave them (`Genesis.placeholders`, kept with the
 * world). Only a real account signs.
 */
export function genesisContext(
  namespace: string,
  accountOf: (userId: Id) => Address | undefined,
  placeholders: Readonly<Record<Id, Address>>,
): ChainContext {
  return {
    namespace,
    addressOf: (userId) => accountOf(userId) ?? placeholders[userId],
    signerOf: accountOf,
  }
}

/** The namespace as the contract stores it (`bytes32`, readable). */
export function namespaceHex(namespace: string): Hex {
  if (!NAMESPACE.test(namespace))
    throw new Error('A namespace has 1 to 32 letters, digits, dots, dashes or underscores.')
  return stringToHex(namespace, { size: 32 })
}

export function buildGenesis(
  state: ViatikState,
  namespace: string,
  accountOf: (userId: Id) => Address | undefined,
): Genesis {
  if (!NAMESPACE.test(namespace)) throw new GenesisError([`namespace "${namespace}" is not valid`])
  const snapshot = ledgerSnapshot(state)
  const id = (productId: Id) => ledgerId(namespace, productId)
  const calls: GenesisCall[] = []
  const skipped: string[] = []
  const problems: string[] = []
  const placeholders: Record<Id, Address> = {}
  const holders = new Map<Address, Id>()
  let minted = 0
  const call = (label: string, functionName: string, args: readonly unknown[]) =>
    calls.push({
      label,
      data: encodeFunctionData({ abi: viatikLedgerAbi, functionName, args } as Parameters<
        typeof encodeFunctionData
      >[0]),
    })
  /** Whole, non-negative cents; anything else is a problem, not an exception. */
  const units = (what: string, cents: number) => {
    if (!Number.isInteger(cents) || cents < 0) {
      problems.push(`${what} is ${cents} cents`)
      return 0n
    }
    return centsToUnits(cents as Cents)
  }
  const addressOf = (userId: Id): Address => {
    const account = accountOf(userId)
    const address = account
      ? getAddress(account)
      : (placeholders[userId] ??= placeholderAddress(namespace, userId))
    const holder = holders.get(address)
    if (holder && holder !== userId) problems.push(`${holder} and ${userId} share the account ${address}`)
    holders.set(address, userId)
    return address
  }
  const roleIn = (scope: Id, userId: Id) => snapshot.roles.get(`${scope}|${userId}`)
  const canSpend = (agency: Id, userId: Id) => {
    const role = roleIn(agency, userId)
    return role === 'admin' || role === 'member'
  }

  // 1. Portfolios and agencies.
  for (const [scope, kind] of snapshot.scopes) {
    if (kind === 'portfolio') call(`portfolio ${scope}`, 'importScope', [id(scope), zeroHash])
  }
  for (const [agency, portfolio] of snapshot.agencyPortfolio) {
    if (snapshot.scopes.get(portfolio) !== 'portfolio') {
      problems.push(`agency ${agency} belongs to a portfolio that is not in the state`)
      continue
    }
    call(`agency ${agency}`, 'importScope', [id(portfolio), id(agency)])
  }

  // 2. Roles, each in a scope of its kind.
  for (const [key, role] of snapshot.roles) {
    const [scope, userId] = key.split('|') as [Id, Id]
    if (snapshot.scopes.get(scope) !== (role === 'investor' ? 'portfolio' : 'agency')) {
      problems.push(`${userId} is ${role} of ${scope}, which is not in the state`)
      continue
    }
    call(`role ${role} ${userId} in ${scope}`, 'importRole', [
      id(scope),
      addressOf(userId),
      ROLE_NUMBER[role],
    ])
  }

  // 3. Locations with their balances. The funding vaults come before their agreements.
  for (const [locationId, place] of snapshot.places) {
    const balance = units(`the balance of ${locationId}`, place.balance)
    const isOperations = place.kind === 'account' && snapshot.operations.get(place.scope) === locationId
    call(`location ${locationId}`, 'importLocation', [
      id(locationId),
      LOCATION_KIND[place.kind],
      id(place.scope),
      balance,
      isOperations,
    ])
    minted += Math.max(place.balance, 0)
  }

  // 4. Agreements with their progress and tranches.
  for (const [agreementId, agreement] of snapshot.agreements) {
    const vault = snapshot.places.get(agreement.vault)
    if (!vault || vault.kind !== 'funding_vault' || vault.scope !== agreement.agency) {
      problems.push(`agreement ${agreementId} has no funding vault of its agency`)
      continue
    }
    if (!(agreement.released <= agreement.funded && agreement.funded <= agreement.committed))
      problems.push(`agreement ${agreementId} released more than funded, or funded more than committed`)
    if (vault.balance !== agreement.funded - agreement.released)
      problems.push(`the vault of ${agreementId} holds ${vault.balance}, not funded − released`)
    const tranches = [...snapshot.tranches]
      .filter(([, t]) => t.agreement === agreementId)
      .sort(([, a], [, b]) => a.index - b.index)
    const total = tranches.reduce((sum, [, t]) => sum + t.amount, 0)
    if (tranches.length === 0 || total !== agreement.committed)
      problems.push(`the tranches of ${agreementId} add up to ${total}, not ${agreement.committed}`)
    call(`agreement ${agreementId}`, 'importAgreement', [
      id(agreementId),
      {
        agency: id(agreement.agency),
        vault: id(agreement.vault),
        committed: units(`${agreementId} committed`, agreement.committed),
        funded: units(`${agreementId} funded`, agreement.funded),
        released: units(`${agreementId} released`, agreement.released),
        exceptionThreshold: units(`${agreementId} exception threshold`, agreement.exceptionThreshold),
        status: AGREEMENT_STATUS[agreement.status],
      },
      tranches.map(([trancheId]) => id(trancheId)),
      tranches.map(([trancheId, t]) => {
        const milestone = state.tranches.find((x) => x.id === trancheId)?.milestoneId
        const evidence =
          t.status === 'requested' && milestone
            ? state.milestones.find((m) => m.id === milestone)?.evidenceHash
            : undefined
        return {
          agreement: zeroHash,
          amount: units(`tranche ${trancheId}`, t.amount),
          index: 0,
          milestone: t.milestone,
          status: TRANCHE_STATUS[t.status],
          requestedBy: t.requestedBy ? addressOf(t.requestedBy) : zeroAddress,
          destination: t.destination ? id(t.destination) : zeroHash,
          evidenceHash: evidence ?? zeroHash,
        }
      }),
    ])
  }

  // 5. Budget rules (each budget's balance came with its location), on a source account of its agency.
  for (const [budgetId, budget] of snapshot.budgets) {
    const source = snapshot.places.get(budget.sourceAccount)
    if (!source || source.kind !== 'account' || source.scope !== budget.agency) {
      problems.push(`budget ${budgetId} draws on ${budget.sourceAccount}, not an account of its agency`)
      continue
    }
    call(`budget ${budgetId}`, 'importBudget', [
      id(budgetId),
      {
        sourceAccount: id(budget.sourceAccount),
        perOperationLimit: units(`${budgetId} per-operation limit`, budget.perOperationLimit),
        approvalThreshold: units(`${budgetId} approval threshold`, budget.approvalThreshold),
        paused: budget.paused,
        anyDestination: budget.destinations.size === 0,
        destinationEpoch: 0n,
      },
      [...budget.destinations].map(id),
    ])
  }

  // 6. Spending access. The contract keeps it only for an Admin or Member of the budget's agency.
  for (const [key, perOperationLimit] of snapshot.allowances) {
    const [budgetId, userId] = key.split('|') as [Id, Id]
    const budget = snapshot.budgets.get(budgetId)
    if (!budget || !canSpend(budget.agency, userId)) {
      problems.push(`${userId} has an allowance on ${budgetId} without a role in its agency`)
      continue
    }
    call(`allowance ${userId} on ${budgetId}`, 'importAllowance', [
      id(budgetId),
      addressOf(userId),
      units(`the allowance of ${userId} on ${budgetId}`, perOperationLimit),
    ])
  }

  // 7. What Members hold.
  for (const [key, amount] of snapshot.members) {
    const [agencyId, userId] = key.split('|') as [Id, Id]
    const held = units(`what ${userId} holds in ${agencyId}`, amount)
    if (held === 0n) continue
    call(`balance of ${userId} in ${agencyId}`, 'importMemberBalance', [
      id(agencyId),
      addressOf(userId),
      held,
    ])
    minted += amount
  }

  // 8. Requests still waiting for approval, from someone with a role and an allowance on the budget.
  for (const [requestId, request] of snapshot.requests) {
    if (request.status !== 'pending') continue
    const budget = snapshot.budgets.get(request.budget)
    if (
      !budget ||
      budget.agency !== request.agency ||
      !canSpend(request.agency, request.requester) ||
      !snapshot.allowances.has(`${request.budget}|${request.requester}`)
    ) {
      problems.push(`pending request ${requestId}: ${request.requester} has no access to ${request.budget}`)
      continue
    }
    if (request.amount <= 0) problems.push(`pending request ${requestId} is for ${request.amount} cents`)
    call(`pending request ${requestId}`, 'importPendingRequest', [
      {
        requestId: id(requestId),
        budget: id(request.budget),
        requester: addressOf(request.requester),
        destination: request.destination ? id(request.destination) : zeroHash,
        member: request.member ? addressOf(request.member) : zeroAddress,
        amount: units(`pending request ${requestId}`, request.amount),
        evidenceHash: request.evidenceHash ?? zeroHash,
      },
    ])
  }
  // The snapshot leaves automations' requests out too, so the mock and the chain agree on them.
  const waitingFromAgents = state.requests.filter(
    (r) => r.status === 'needs_approval' && r.requester.kind !== 'user',
  ).length
  if (waitingFromAgents > 0)
    skipped.push(`${waitingFromAgents} pending requests from automations (automations do not sign)`)

  if (problems.length > 0) throw new GenesisError(problems)

  // Last: the namespace marks the epoch once everything in it exists.
  call(`namespace ${namespace}`, 'setNamespace', [namespaceHex(namespace)])

  return { namespace, calls, placeholders, skipped, minted: minted as Cents }
}

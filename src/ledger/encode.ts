import {
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  padHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hex,
} from 'viem'

import type { Cents } from '@/domain/money'
import type { Id, MembershipScope, Role } from '@/domain/types'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'

import { ledgerId } from './ids'
import type { ChainContext, Hash, LedgerOp, PlannedRecord, RecordEnd, RecordKind } from './types'
import { centsToUnits } from './units'

/** The registrar's signature that lets one person join a workspace (`join`). */
export type JoinPermit = { nonce: bigint; deadline: bigint; signature: Hex }

/** `Role` in the contract. */
export const LEDGER_ROLE: Record<Role, number> = { investor: 1, agency_admin: 2, member: 3 }

/** `ReceiptKind` in the contract, in its order. */
const RECORD_KIND: Record<RecordKind, number> = {
  deposit: 0,
  funding: 1,
  tranche_release: 2,
  transfer: 3,
  payment: 4,
  payment_pending: 5,
  payment_rejected: 6,
  return: 7,
  allocation: 8,
  withdrawal: 9,
  outside_payment: 10,
  capital_return: 11,
}

/** A plan that cannot become calldata yet: a person without an account, or no registrar to sign a permit. */
export class NotEncodable extends Error {
  constructor(
    readonly missing: 'account' | 'registrar',
    readonly userId?: Id,
  ) {
    super(missing === 'registrar' ? 'The registrar is not configured' : `${userId} has no account yet`)
  }
}

export const scopeIdOf = (scope: MembershipScope) =>
  scope.kind === 'portfolio' ? scope.portfolioId : scope.agencyId

/** `memberLocation(address)`: a Member's balance is keyed by their account. */
export const memberLocation = (account: Address): Hex => padHex(account, { size: 32 })

const hash = (value: Hash | null): Hex => value ?? zeroHash
const units = (value: Cents | number) => centsToUnits(value as Cents)

/** One contract call per operation, as calldata for the ledger's `multicall`. */
export function encodeOp(op: LedgerOp, chain: ChainContext, permit?: JoinPermit): Hex {
  const id = (productId: Id) => ledgerId(chain.namespace, productId)
  const account = (userId: Id) => {
    const address = chain.addressOf(userId)
    if (!address) throw new NotEncodable('account', userId)
    return address
  }
  const member = (userId: Id | null) => (userId ? account(userId) : zeroAddress)
  const optionalId = (productId: Id | null) => (productId ? id(productId) : zeroHash)
  const call = (functionName: string, args: readonly unknown[]) =>
    encodeFunctionData({ abi: viatikLedgerAbi, functionName, args } as Parameters<
      typeof encodeFunctionData
    >[0])

  switch (op.call) {
    case 'createPortfolio':
      return call('createPortfolio', [id(op.portfolioId), id(op.vaultId)])
    case 'registerAgency':
      return call('registerAgency', [id(op.agencyId), id(op.portfolioId), id(op.fundingVaultId)])
    case 'join':
      if (!permit) throw new NotEncodable('registrar')
      return call('join', [
        id(scopeIdOf(op.scope)),
        LEDGER_ROLE[op.role],
        permit.nonce,
        permit.deadline,
        permit.signature,
      ])
    case 'revokeRole':
      return call('revokeRole', [id(scopeIdOf(op.scope)), account(op.userId)])
    case 'createAccount':
      return call('createAccount', [id(op.accountId), id(op.agencyId), op.isOperations])
    case 'transfer':
      return call('transfer', [id(op.opId), id(op.fromAccountId), id(op.toAccountId), units(op.amount)])
    case 'deposit':
      return call('deposit', [id(op.opId), id(op.portfolioId), id(op.vaultId), units(op.amount)])
    case 'createAgreement':
      return call('createAgreement', [
        id(op.agreementId),
        id(op.agencyId),
        id(op.vaultId),
        units(op.committed),
        units(op.exceptionThreshold),
        op.tranches.map((t) => id(t.trancheId)),
        op.tranches.map((t) => units(t.amount)),
        op.tranches.map((t) => t.milestone),
      ])
    case 'acceptAgreement':
      return call('acceptAgreement', [id(op.agreementId)])
    case 'setAgreementPaused':
      return call('setAgreementPaused', [id(op.agreementId), op.paused])
    case 'fundAgreement':
      return call('fundAgreement', [
        id(op.opId),
        id(op.agreementId),
        id(op.portfolioVaultId),
        units(op.amount),
      ])
    case 'requestTranche':
      return call('requestTranche', [id(op.trancheId), id(op.accountId), hash(op.evidenceHash)])
    case 'requestChanges':
      return call('requestChanges', [id(op.trancheId), op.reject])
    case 'releaseTranche':
      return call('releaseTranche', [id(op.trancheId), hash(op.decisionHash)])
    case 'createBudget':
      return call('createBudget', [
        id(op.budgetId),
        id(op.sourceAccountId),
        units(op.perOperationLimit),
        units(op.approvalThreshold),
        op.allowedDestinationIds.map(id),
        units(op.allocation),
      ])
    case 'allocate':
      return call('allocate', [id(op.opId), id(op.budgetId), BigInt(op.delta) * centsToUnits(1 as Cents)])
    case 'updateRules':
      return call('updateRules', [
        id(op.budgetId),
        units(op.perOperationLimit),
        units(op.approvalThreshold),
        op.allowedDestinationIds.map(id),
      ])
    case 'setBudgetPaused':
      return call('setBudgetPaused', [id(op.budgetId), op.paused])
    case 'setAllowance':
      return call('setAllowance', [
        id(op.budgetId),
        account(op.userId),
        op.active,
        units(op.perOperationLimit),
      ])
    case 'requestPayment':
      return call('requestPayment', [
        id(op.requestId),
        id(op.paymentId),
        id(op.budgetId),
        optionalId(op.destinationId),
        member(op.memberUserId),
        units(op.amount),
        hash(op.evidenceHash),
      ])
    case 'approvePayment':
      return call('approvePayment', [id(op.requestId), id(op.paymentId)])
    case 'closeRequest':
      return call('closeRequest', [id(op.requestId)])
    case 'pay':
      return call('pay', [
        id(op.paymentId),
        id(op.sourceId),
        optionalId(op.destinationId),
        member(op.memberUserId),
        units(op.amount),
        hash(op.evidenceHash),
      ])
    case 'returnToAgency':
      return call('returnToAgency', [id(op.opId), id(op.agencyId), units(op.amount)])
    case 'withdraw':
      return call('withdraw', [id(op.opId), id(op.portfolioId), id(op.vaultId), units(op.amount), op.to])
    case 'withdrawMemberBalance':
      return call('withdrawMemberBalance', [id(op.opId), id(op.agencyId), units(op.amount), op.to])
    case 'payOutside':
      return call('payOutside', [
        id(op.paymentId),
        id(op.sourceId),
        op.to,
        units(op.amount),
        hash(op.evidenceHash),
      ])
    case 'recordEvidence':
      return call('recordEvidence', [id(op.agencyId), id(op.paymentId), op.evidenceHash])
    case 'returnCapital':
      return call('returnCapital', [
        id(op.opId),
        id(op.fromAccountId),
        id(op.portfolioVaultId),
        optionalId(op.agreementId),
        units(op.amount),
        hash(op.evidenceHash),
      ])
  }
}

/** The whole plan as one transaction: `multicall(bytes[])` on the ledger. */
export function encodePlan(
  ops: readonly LedgerOp[],
  chain: ChainContext,
  permits: ReadonlyMap<LedgerOp, JoinPermit> = new Map(),
): { calls: Hex[]; data: Hex } {
  const calls = ops.map((op) => encodeOp(op, chain, permits.get(op)))
  const data = encodeFunctionData({ abi: viatikLedgerAbi, functionName: 'multicall', args: [calls] })
  return { calls, data }
}

/**
 * The receipt hash the contract emits in `Recorded` for a planned record:
 * keccak256(abi.encode(opId, kind, amount, from, to, evidenceHash)).
 */
export function receiptHashOf(record: PlannedRecord, chain: ChainContext): Hex {
  const end = (value: RecordEnd): Hex => {
    if (value === null) return zeroHash
    // Where a withdrawal or an outside payment went: the address, as the contract hashes it (`memberLocation`).
    if ('address' in value) return memberLocation(value.address)
    if ('member' in value) {
      const address = chain.addressOf(value.member)
      if (!address) throw new NotEncodable('account', value.member)
      return memberLocation(address)
    }
    return ledgerId(chain.namespace, value.id)
  }
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [
        ledgerId(chain.namespace, record.opId),
        RECORD_KIND[record.kind],
        centsToUnits(record.amount),
        end(record.from),
        end(record.to),
        hash(record.evidenceHash),
      ],
    ),
  )
}

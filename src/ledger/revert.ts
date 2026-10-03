import { BaseError, decodeErrorResult, type Hex } from 'viem'

import { formatUsd, type Cents } from '@/domain/money'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'

import { translateLedgerError, type TranslatedError } from './errors'
import type { LedgerError, LedgerErrorCode } from './types'
import { unitsToCents } from './units'

/**
 * Decodes a ledger revert by the contract error's name (only a simulation, or
 * a failed user operation, returns its data). Server only: it carries the
 * contract ABI. Anything else falls back to `translateLedgerError`.
 */

const usd = (units: bigint) => formatUsd(unitsToCents(units).cents as Cents, { withCode: true })

/** `LimitRule` in the contract. */
const LIMIT_MESSAGE: Record<number, (limit: bigint) => string> = {
  0: (limit) => `The amount exceeds the per-operation limit of ${usd(limit)}.`,
  1: (limit) => `Funding would exceed what is left of the commitment (${usd(limit)}).`,
  2: () => 'Tranches must add up to the commitment.',
  3: (limit) => `Above the Investor’s exception threshold of ${usd(limit)}. The Investor decides.`,
  4: (limit) => `A single deposit can be up to ${usd(limit)}.`,
}

function fromContractError(name: string, args: readonly unknown[]): LedgerError | null {
  const error = (code: LedgerErrorCode, message: string): LedgerError => ({ code, message, retryable: false })
  switch (name) {
    case 'NotAuthorized':
    case 'OwnableUnauthorizedAccount':
      return error('not_authorized', 'The ledger did not accept this from your account.')
    case 'AlreadyProcessed':
      return error('already_processed', 'The ledger already recorded this operation.')
    case 'InsufficientFunds':
      return error('insufficient_funds', `Only ${usd(args[1] as bigint)} is available.`)
    case 'LimitExceeded':
      return error(
        'limit_exceeded',
        LIMIT_MESSAGE[Number(args[0])]?.(args[1] as bigint) ?? 'The amount is above a limit of the rules.',
      )
    case 'DestinationNotAllowed':
      return error('destination_not_allowed', 'This payment destination is not approved for this budget.')
    case 'BudgetPaused':
      return error('budget_paused', 'This budget is paused. New payments are on hold.')
    case 'AgreementPaused':
      return error('agreement_paused', 'The agreement is paused.')
    case 'NotRegistered':
      return error('not_registered', 'Something this operation needs is not registered with the ledger yet.')
    case 'InvalidState':
      return error('invalid_state', 'The ledger is not in a state to do this right now.')
    default:
      return null
  }
}

/** One of the ledger's errors, from raw revert data. */
export function ledgerErrorOf(data: Hex): TranslatedError | null {
  try {
    const decoded = decodeErrorResult({ abi: viatikLedgerAbi, data })
    const args = decoded.args ?? []
    const error = fromContractError(decoded.errorName, args)
    return error ? { ...error, raw: `${decoded.errorName}(${args.join(', ')})` } : null
  } catch {
    return null
  }
}

/** The revert data a simulation returned, if any, anywhere in a viem error chain. */
function revertData(error: unknown): Hex | undefined {
  if (!(error instanceof BaseError)) return undefined
  let found: Hex | undefined
  error.walk((cause) => {
    const data = (cause as { data?: unknown }).data
    if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) found = data as Hex
    return false
  })
  return found
}

export function decodeLedgerError(raw: unknown): TranslatedError {
  const data = revertData(raw)
  return (data && ledgerErrorOf(data)) || translateLedgerError(raw)
}

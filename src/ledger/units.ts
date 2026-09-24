import { cents, type Cents } from '@/domain/money'
import { USDC_DECIMALS } from '@/web3/addresses'

/**
 * The only place token units exist. Application money is integer cents;
 * USDC has 6 decimals, so 1 cent = 10^4 units.
 */
const UNITS_PER_CENT = 10n ** BigInt(USDC_DECIMALS - 2)

export function centsToUnits(value: Cents): bigint {
  return BigInt(value) * UNITS_PER_CENT
}

/**
 * Converts onchain units to cents. Sub-cent dust is truncated and reported so
 * callers can decide whether to surface it (it never should for USDC
 * produced by Viatik itself).
 */
export function unitsToCents(units: bigint): { cents: Cents; dust: bigint } {
  const whole = units / UNITS_PER_CENT
  const dust = units % UNITS_PER_CENT
  if (whole > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount exceeds the safe integer range')
  return { cents: cents(Number(whole)), dust }
}

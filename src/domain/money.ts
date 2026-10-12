/**
 * Application money is always an integer number of US cents.
 *
 * Floating-point arithmetic is never used for amounts. Token units (USDC has
 * 6 decimals) exist only inside the ledger adapter; the rest of the product
 * speaks cents.
 */

declare const centsBrand: unique symbol
export type Cents = number & { readonly [centsBrand]: 'Cents' }

export const CURRENCY = 'USD' as const
export const ZERO = 0 as Cents

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be an integer number of cents, received ${value}`)
  }
  return value as Cents
}

/** Whole dollars to cents. Only for fixtures and constants written by hand. */
export function usd(dollars: number): Cents {
  if (!Number.isSafeInteger(dollars)) {
    throw new RangeError(`usd() takes whole dollars, received ${dollars}`)
  }
  return cents(dollars * 100)
}

export function add(...values: Cents[]): Cents {
  let total = 0
  for (const value of values) total += value
  return cents(total)
}

export function subtract(a: Cents, b: Cents): Cents {
  return cents(a - b)
}

export function sum<T>(items: readonly T[], pick: (item: T) => Cents): Cents {
  let total = 0
  for (const item of items) total += pick(item)
  return cents(total)
}

export function max(a: Cents, b: Cents): Cents {
  return a > b ? a : b
}

export function min(a: Cents, b: Cents): Cents {
  return a < b ? a : b
}

export function clampToZero(value: Cents): Cents {
  return value < 0 ? ZERO : value
}

/**
 * Integer percentage (0–100) of `part` over `total`, for progress bars only.
 * Uses integer math so display never drifts from the amounts.
 */
export function percentOf(part: Cents, total: Cents): number {
  if (total <= 0) return 0
  const pct = Math.floor((part * 100) / total)
  return Math.max(0, Math.min(100, pct))
}

/** Splits `total` into `parts` integer amounts that add up exactly. */
export function splitEvenly(total: Cents, parts: number): Cents[] {
  const base = Math.floor(total / parts)
  const remainder = total - base * parts
  return Array.from({ length: parts }, (_, i) => cents(base + (i < remainder ? 1 : 0)))
}

export type FormatUsdOptions = {
  locale?: string
  /** Append the " USD" code, as the product does in prose and receipts. */
  withCode?: boolean
  /** Prefix a "$" symbol, as dense tables and charts do. */
  withSymbol?: boolean
  /** Always show +/− for signed ledger movements. */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'never'
  /** Drop cents for large, glanceable numbers (charts, KPIs). */
  compact?: boolean
}

const formatterCache = new Map<string, Intl.NumberFormat>()

function getFormatter(key: string, factory: () => Intl.NumberFormat) {
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = factory()
    formatterCache.set(key, formatter)
  }
  return formatter
}

/**
 * Locale-aware amount formatting. The integer cents are split into whole
 * units and a two-digit fraction before formatting, so no float is involved
 * in rounding.
 */
export function formatUsd(value: Cents, options: FormatUsdOptions = {}): string {
  const {
    locale = 'en-US',
    withCode = false,
    withSymbol = false,
    signDisplay = 'auto',
    compact = false,
  } = options

  if (compact) {
    const formatter = getFormatter(
      `compact|${locale}|${withSymbol}|${signDisplay}`,
      () =>
        new Intl.NumberFormat(locale, {
          notation: 'compact',
          maximumFractionDigits: 1,
          signDisplay,
          ...(withSymbol ? { style: 'currency', currency: CURRENCY, currencyDisplay: 'narrowSymbol' } : {}),
        }),
    )
    // Compact notation is display-only and loses precision by design.
    const text = formatter.format(value / 100)
    return withCode ? `${text} ${CURRENCY}` : text
  }

  const negative = value < 0
  const absolute = Math.abs(value)
  const whole = Math.floor(absolute / 100)
  const fraction = absolute % 100

  const integerFormatter = getFormatter(
    `int|${locale}`,
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0, useGrouping: true }),
  )
  const decimalSeparator = getDecimalSeparator(locale)
  const body = `${integerFormatter.format(whole)}${decimalSeparator}${String(fraction).padStart(2, '0')}`

  const sign = negative
    ? '−'
    : signDisplay === 'always' || (signDisplay === 'exceptZero' && value !== 0)
      ? '+'
      : ''
  const symbol = withSymbol ? '$' : ''
  const code = withCode ? ` ${CURRENCY}` : ''
  return `${signDisplay === 'never' ? '' : sign}${symbol}${body}${code}`
}

function getDecimalSeparator(locale: string): string {
  const parts = new Intl.NumberFormat(locale, { minimumFractionDigits: 1 }).formatToParts(1.1)
  return parts.find((part) => part.type === 'decimal')?.value ?? '.'
}

/**
 * Parses user input such as "1,250.5" or "120" into cents without floats.
 * Returns null for anything that is not a positive amount with at most two
 * decimals. A comma only groups thousands: "12,50" is refused rather than read
 * as 1,250 (`usdInputHint` says why).
 */
export function parseUsdInput(input: string): Cents | null {
  const trimmed = input.replace(/[\s$]/g, '').replace(/USD$/i, '')
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/.test(trimmed)) return null
  const normalized = trimmed.replace(/,/g, '')
  const [wholePart = '0', fractionPart = ''] = normalized.split('.')
  const whole = Number.parseInt(wholePart, 10)
  const fraction = Number.parseInt(fractionPart.padEnd(2, '0') || '0', 10)
  const total = whole * 100 + fraction
  return Number.isSafeInteger(total) ? cents(total) : null
}

/** Why typed text is not an amount, when a comma was used for cents ("12,50", "1.234,56"). */
export function usdInputHint(input: string): string | null {
  const trimmed = input.replace(/[\s$]/g, '').replace(/USD$/i, '')
  return parseUsdInput(input) === null && /,\d{1,2}$/.test(trimmed)
    ? 'Use a dot for cents, as in 12.50.'
    : null
}

/** Cents to a plain editable string ("1250.50"), used to seed inputs. */
export function toInputString(value: Cents): string {
  const whole = Math.floor(Math.abs(value) / 100)
  const fraction = Math.abs(value) % 100
  return `${value < 0 ? '-' : ''}${whole}.${String(fraction).padStart(2, '0')}`
}

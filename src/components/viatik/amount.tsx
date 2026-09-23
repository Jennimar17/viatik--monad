import { formatUsd, type Cents } from '@/domain/money'
import { cn } from '@/lib/utils'

const sizes = {
  xs: { root: 'text-xs', fraction: '', code: 'text-2xs' },
  sm: { root: 'text-sm', fraction: '', code: 'text-xs' },
  md: { root: 'text-base', fraction: '', code: 'text-xs' },
  lg: { root: 'font-display text-2xl tracking-tight', fraction: 'text-lg', code: 'text-sm' },
  xl: {
    root: 'font-display text-3xl tracking-tight sm:text-4xl',
    fraction: 'text-xl sm:text-2xl',
    code: 'text-sm',
  },
  display: {
    root: 'font-display text-4xl tracking-tight sm:text-5xl',
    fraction: 'text-2xl sm:text-3xl',
    code: 'text-base',
  },
} as const

export type AmountProps = {
  value: Cents
  size?: keyof typeof sizes
  /** Show the "USD" code after the number (default true for lg and up). */
  code?: boolean
  /** Prefix + or − for ledger movements. */
  signed?: boolean
  /** Set the cents smaller, like financial statements (default true for lg and up). */
  splitFraction?: boolean
  tone?: 'default' | 'muted' | 'positive' | 'negative'
  locale?: string
  className?: string
}

/**
 * Money on screen. Takes integer cents only; tabular figures keep columns
 * aligned. Large sizes set the cents smaller so the whole amount scans fast.
 */
export function Amount({
  value,
  size = 'md',
  code,
  signed = false,
  splitFraction,
  tone = 'default',
  locale,
  className,
}: AmountProps) {
  const style = sizes[size]
  const large = size === 'lg' || size === 'xl' || size === 'display'
  const showCode = code ?? large
  const split = splitFraction ?? large
  const text = formatUsd(value, { locale, signDisplay: signed ? 'exceptZero' : 'auto' })
  const separatorIndex = Math.max(text.lastIndexOf('.'), text.lastIndexOf(','))
  const whole = split && separatorIndex > 0 ? text.slice(0, separatorIndex) : text
  const fraction = split && separatorIndex > 0 ? text.slice(separatorIndex) : ''

  return (
    <span
      className={cn(
        'inline-flex items-baseline whitespace-nowrap num',
        style.root,
        tone === 'muted' && 'text-muted-foreground',
        tone === 'positive' && 'text-success',
        tone === 'negative' && 'text-danger',
        className,
      )}
    >
      <span>{whole}</span>
      {fraction ? <span className={cn('text-muted-foreground', style.fraction)}>{fraction}</span> : null}
      {showCode ? (
        <span className={cn('ml-1.5 font-sans font-normal tracking-normal text-subtle', style.code)}>
          USD
        </span>
      ) : null}
    </span>
  )
}

/** Compact, glanceable money for charts and dense KPIs ("12.4K"). */
export function CompactAmount({ value, className }: { value: Cents; className?: string }) {
  return <span className={cn('whitespace-nowrap num', className)}>{formatUsd(value, { compact: true })}</span>
}

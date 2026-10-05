import { Clock, ShieldCheck } from 'lucide-react'

import type { BalanceCheck } from '@/data/ledger-check'
import { cn } from '@/lib/utils'

/**
 * Whether a balance on screen matches the verified record (Monad). Only where
 * the workspace settles on Monad: nothing renders on the demo ledger. Product
 * language: the network is named only in Developer settings, Add funds, Vault
 * asset details and Verified details.
 */
export function BalanceCheckNote({
  check,
  className,
}: {
  check: BalanceCheck | null | undefined
  className?: string
}) {
  if (!check) return null
  return check.status === 'verified' ? (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-subtle', className)}>
      <ShieldCheck className="size-3.5 shrink-0 text-sage" aria-hidden="true" />
      Verified balance
    </span>
  ) : (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs text-subtle', className)}
      title="The verified record has not confirmed this balance yet. It is checked again after every operation."
    >
      <Clock className="size-3.5 shrink-0" aria-hidden="true" />
      Balance pending verification
    </span>
  )
}

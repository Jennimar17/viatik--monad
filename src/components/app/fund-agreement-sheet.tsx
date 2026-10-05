'use client'

import { CircleAlert } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, min, subtract, ZERO, type Cents } from '@/domain/money'
import { agreementCapital, vaultBalance } from '@/domain/selectors'
import type { FundingAgreement } from '@/domain/types'

import { ButtonLink } from '@/components/app/button-link'
import { useHref } from '@/components/app/role-context'

/** Investor moves capital from the Portfolio Vault into an agreement's Funding Vault. */
export function FundAgreementSheet({
  agreement,
  open,
  onOpenChange,
  suggested,
}: {
  agreement: FundingAgreement
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The amount to start from (for example, what a release is short of); everything fundable otherwise. */
  suggested?: Cents
}) {
  const { state } = useViatikState()
  const href = useHref()
  const command = useCommand('fundAgreement')
  const capital = agreementCapital(state, agreement.id)
  const portfolioVault = state.vaults.find(
    (v) => v.portfolioId === agreement.portfolioId && v.kind === 'portfolio',
  )
  const vaultAvailable = portfolioVault ? vaultBalance(state, portfolioVault.id) : ZERO
  const max = min(capital.unfunded, vaultAvailable)
  // undefined = untouched, so the amount defaults to everything that can be funded.
  const [draft, setDraft] = React.useState<Cents | null | undefined>(undefined)
  const amount = draft === undefined ? (suggested ? min(suggested, max) : max) : draft
  // What was confirmed: after the state refreshes, `max` (and so the default amount) drops to what is left.
  const [funded, setFunded] = React.useState<Cents | null>(null)
  const agencyLabel = state.agencies.find((a) => a.id === agreement.agencyId)?.name ?? 'Agency'
  const invalid = amount !== null && (amount <= 0 || amount > max)

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setDraft(undefined)
        setFunded(null)
        command.reset()
      }}
      title="Fund agreement"
      description={`${agreement.title} · ${agencyLabel}`}
      summary={{
        what: 'Capital moves from your Portfolio Vault into this agreement’s Funding Vault. The Agency cannot spend it until you release a tranche.',
        amount: amount ?? undefined,
        from: portfolioVault?.name ?? 'Portfolio Vault',
        to: `${agencyLabel} Funding Vault`,
        reversible:
          'Funds stay in the Funding Vault until you release a tranche. Viatik has no way to move them back yet.',
        policy: `Funded capital cannot exceed the ${formatUsd(agreement.committed, { withCode: true })} commitment.`,
      }}
      confirmLabel="Fund agreement"
      disabled={amount === null || invalid || max <= 0}
      phase={command.phase}
      error={command.error}
      onConfirm={() => {
        if (!amount) return
        setFunded(amount)
        return command.run({ agreementId: agreement.id, amount })
      }}
      success={{
        title: 'Agreement funded',
        body: `${formatUsd(funded ?? amount ?? ZERO, { withCode: true })} is now in the ${agencyLabel} Funding Vault.`,
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="fund-amount">Amount</Label>
        <MoneyInput id="fund-amount" value={amount} onChange={setDraft} invalid={invalid} available={max} />
        {max > 0 && suggested !== undefined && vaultAvailable < suggested ? (
          <p className="text-sm text-pretty text-muted-foreground">
            Your Portfolio Vault holds {formatUsd(vaultAvailable, { withCode: true })}, which is{' '}
            {formatUsd(subtract(suggested, vaultAvailable), { withCode: true })} short of what this release
            needs.{' '}
            <ButtonLink href={href('vaults/add-funds')} variant="link" size="sm" className="h-auto px-0">
              Add funds
            </ButtonLink>
          </p>
        ) : null}
        {max <= 0 ? (
          <p className="text-sm text-muted-foreground">
            {capital.unfunded <= 0 ? 'This agreement is fully funded.' : 'Your Portfolio Vault is empty.'}{' '}
            {capital.unfunded > 0 ? (
              <ButtonLink href={href('vaults/add-funds')} variant="link" size="sm" className="h-auto px-0">
                Add funds
              </ButtonLink>
            ) : null}
          </p>
        ) : (
          <p className="text-xs text-subtle">
            Up to {formatUsd(capital.unfunded, { withCode: true })} left to fund ·{' '}
            {formatUsd(vaultAvailable, { withCode: true })} in the Portfolio Vault
          </p>
        )}
      </div>
    </ApprovalSheet>
  )
}

/**
 * Shown where a release is blocked because the agreement has not been funded enough: says how much
 * is missing and lets the Investor fund it right there. The sheet stays mounted when the shortfall
 * is covered (`needed` undefined), so funding can finish on its success screen.
 */
export function FundShortfall({ agreement, needed }: { agreement: FundingAgreement; needed?: Cents }) {
  const [open, setOpen] = React.useState(false)
  if (needed === undefined && !open) return null
  return (
    <>
      {needed !== undefined ? (
        <div className="flex flex-col gap-3 rounded-lg border border-danger/35 bg-danger-soft px-3 py-2.5 text-sm">
          <span className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            <span className="text-pretty text-muted-foreground">
              This agreement is short of funds. Fund it with at least {formatUsd(needed, { withCode: true })}{' '}
              before releasing.
            </span>
          </span>
          <Button variant="outline" size="pill-sm" className="w-fit" onClick={() => setOpen(true)}>
            Fund agreement
          </Button>
        </div>
      ) : null}
      <FundAgreementSheet agreement={agreement} open={open} onOpenChange={setOpen} suggested={needed} />
    </>
  )
}

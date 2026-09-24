'use client'

import * as React from 'react'

import { Label } from '@/components/ui/label'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, min, ZERO, type Cents } from '@/domain/money'
import { agreementCapital, vaultBalance } from '@/domain/selectors'
import type { FundingAgreement } from '@/domain/types'

import { ButtonLink } from './button-link'
import { useHref } from './role-context'

/** Investor moves capital from the Portfolio Vault into an agreement's Funding Vault. */
export function FundAgreementSheet({
  agreement,
  open,
  onOpenChange,
}: {
  agreement: FundingAgreement
  open: boolean
  onOpenChange: (open: boolean) => void
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
  const amount = draft === undefined ? max : draft
  const agencyLabel = state.agencies.find((a) => a.id === agreement.agencyId)?.name ?? 'Agency'
  const invalid = amount !== null && (amount <= 0 || amount > max)

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setDraft(undefined)
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
          'Unreleased funds can return to the Portfolio Vault under the agreement’s return conditions.',
        policy: `Funded capital cannot exceed the ${formatUsd(agreement.committed, { withCode: true })} commitment.`,
      }}
      confirmLabel="Fund agreement"
      disabled={amount === null || invalid || max <= 0}
      phase={command.phase}
      error={command.error}
      onConfirm={() => amount && command.run({ agreementId: agreement.id, amount })}
      success={{
        title: 'Agreement funded',
        body: `${formatUsd(amount ?? ZERO, { withCode: true })} is now in the ${agencyLabel} Funding Vault.`,
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="fund-amount">Amount</Label>
        <MoneyInput id="fund-amount" value={amount} onChange={setDraft} invalid={invalid} available={max} />
        {max <= 0 ? (
          <p className="text-sm text-muted-foreground">
            {capital.unfunded <= 0 ? 'This agreement is fully funded.' : 'Your Portfolio Vault is empty.'}{' '}
            {capital.unfunded > 0 ? (
              <ButtonLink href={href('vaults')} variant="link" size="sm" className="h-auto px-0">
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

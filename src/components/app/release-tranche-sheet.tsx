'use client'

import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, subtract, add } from '@/domain/money'
import { accountName, agencyName, receiptFor } from '@/domain/queries'
import { agreementCapital } from '@/domain/selectors'

import { FundShortfall } from '@/components/app/fund-agreement-sheet'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'

/**
 * The Investor releases a tranche that has no milestone to review: one the Agency requested, or one
 * that is simply available (Manual, Scheduled and Recurring agreements). Needs the agreement to be
 * funded for it; if it is not, it says how much is missing and lets the Investor fund it.
 *
 * `trancheId` stays mounted while the sheet animates closed; pass null when none is selected.
 */
export function ReleaseTrancheSheet({
  trancheId,
  open,
  onOpenChange,
  onClosed,
}: {
  trancheId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: () => void
}) {
  const { state } = useViatikState()
  const release = useCommand('releaseTranche')
  const tranche = state.tranches.find((t) => t.id === trancheId)
  const agreement = state.agreements.find((a) => a.id === tranche?.agreementId)
  const agency = agreement ? agencyName(state, agreement.agencyId) : 'the Agency'
  const capital = agreement ? agreementCapital(state, agreement.id) : undefined
  const destination = tranche?.destinationAccountId
    ? accountName(state, tranche.destinationAccountId)
    : (state.accounts.find(
        (a) => a.agencyId === agreement?.agencyId && a.template === 'operations' && a.status === 'active',
      )?.name ?? 'Operations')
  const receipt = receiptFor(state, tranche?.receiptId)
  const short =
    tranche &&
    capital &&
    tranche.status !== 'released' &&
    tranche.status !== 'cancelled' &&
    capital.released + tranche.amount > capital.funded
      ? subtract(add(capital.released, tranche.amount), capital.funded)
      : undefined

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        release.reset()
        onClosed?.()
      }}
      title="Release tranche"
      description={tranche ? `${tranche.name} · ${agreement?.title ?? ''}` : undefined}
      summary={{
        what: tranche
          ? `${formatUsd(tranche.amount, { withCode: true })} moves from the ${agency} Funding Vault into the Agency’s ${destination} account.`
          : '',
        amount: tranche?.amount,
        from: `${agency} Funding Vault`,
        to: `${agency} · ${destination}`,
        reversible:
          'Cannot be undone once released. The Agency operates with it under the agreement’s policy.',
        policy: 'Released capital can never exceed funded capital.',
      }}
      confirmLabel="Release tranche"
      disabled={!tranche || short !== undefined}
      phase={release.phase}
      error={release.error}
      onConfirm={() => tranche && release.run({ trancheId: tranche.id })}
      success={{
        title: 'Funding released',
        body: tranche
          ? `${formatUsd(tranche.amount, { withCode: true })} is now available in the ${agency} ${destination} account.`
          : '',
        actions: <ReceiptDetailsButton receipt={receipt} />,
      }}
    >
      {agreement ? <FundShortfall agreement={agreement} needed={short} /> : null}
    </ApprovalSheet>
  )
}

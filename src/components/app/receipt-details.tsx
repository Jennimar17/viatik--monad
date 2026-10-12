'use client'

import * as React from 'react'

import { requestRecipientLabel } from '@/components/app/request-parts'
import {
  VerifiedDetailsButton,
  VerifiedDetailsDrawer,
  type VerifiedRecord,
} from '@/components/viatik/verified-details-drawer'
import { currentPolicyText } from '@/domain/policy'
import { accountName, agencyName, budgetName } from '@/domain/queries'
import type { PaymentRequest, Receipt, Tranche, ViatikState } from '@/domain/types'

export function receiptRecord(receipt: Receipt): VerifiedRecord {
  return {
    title: `${receipt.number} · ${receipt.description}`,
    amount: receipt.amount,
    fromLabel: receipt.fromLabel,
    toLabel: receipt.toLabel,
    details: receipt.verified,
  }
}

/** What the ledger recorded when a request was sent; none if it never reached the ledger. */
export function requestRecord(state: ViatikState, request: PaymentRequest): VerifiedRecord | undefined {
  if (!request.ledger) return undefined
  return {
    title: request.purpose,
    amount: request.amount,
    fromLabel: budgetName(state, request.budgetId),
    toLabel: requestRecipientLabel(state, request),
    // Stored with the policy sentence of its day: an older one reads as the request page does now.
    details: { ...request.ledger, contractPolicy: currentPolicyText(request.ledger.contractPolicy) },
  }
}

/** What the ledger recorded when the Agency requested a tranche. */
export function trancheRequestRecord(state: ViatikState, tranche: Tranche): VerifiedRecord | undefined {
  if (!tranche.requestVerified) return undefined
  const agreement = state.agreements.find((a) => a.id === tranche.agreementId)
  return {
    title: `${tranche.name} request`,
    amount: tranche.amount,
    fromLabel: agreement?.title ?? 'Funding agreement',
    toLabel: `${agencyName(state, agreement?.agencyId)} · ${accountName(state, tranche.destinationAccountId)}`,
    details: tranche.requestVerified,
  }
}

/** "View verified details" for a domain receipt; renders nothing until one exists. */
export function ReceiptDetailsButton({
  receipt,
  ...props
}: Omit<React.ComponentProps<typeof VerifiedDetailsButton>, 'record'> & { receipt: Receipt | undefined }) {
  if (!receipt) return null
  return <VerifiedDetailsButton record={receiptRecord(receipt)} {...props} />
}

/**
 * One shared drawer for lists where any row can open its receipt. The last
 * receipt stays mounted so the drawer can animate out.
 */
export function useReceiptDrawer() {
  const [receipt, setReceipt] = React.useState<Receipt>()
  const [open, setOpen] = React.useState(false)
  const show = React.useCallback((next: Receipt | undefined) => {
    if (!next) return
    setReceipt(next)
    setOpen(true)
  }, [])
  const drawer = receipt ? (
    <VerifiedDetailsDrawer record={receiptRecord(receipt)} open={open} onOpenChange={setOpen} />
  ) : null
  return { show, drawer }
}

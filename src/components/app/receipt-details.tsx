'use client'

import * as React from 'react'

import {
  VerifiedDetailsButton,
  VerifiedDetailsDrawer,
  type VerifiedRecord,
} from '@/components/viatik/verified-details-drawer'
import type { Receipt } from '@/domain/types'

export function receiptRecord(receipt: Receipt): VerifiedRecord {
  return {
    title: `${receipt.number} · ${receipt.description}`,
    amount: receipt.amount,
    fromLabel: receipt.fromLabel,
    toLabel: receipt.toLabel,
    details: receipt.verified,
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

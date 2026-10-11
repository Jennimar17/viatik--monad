'use client'

import { ShieldCheck } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { Cents } from '@/domain/money'
import type { VerifiedDetails } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { useIsMobile } from '@/hooks/use-mobile'
import { publicEnv } from '@/lib/env'

import { Amount } from './amount'
import { VerifiedDetailsList } from './operation'

const NETWORK = publicEnv.NEXT_PUBLIC_MONAD_NETWORK
/** The asset operations settle in: TestUSD stands in for USDC on testnet. */
const SETTLEMENT_ASSET = `${NETWORK === 'testnet' ? 'TestUSD' : 'USDC'} on ${networkInfo(NETWORK).name}`

export type VerifiedRecord = {
  /** e.g. "RCT-0042 · Vertex Cloud invoice". */
  title: string
  amount: Cents
  fromLabel: string
  toLabel: string
  details: VerifiedDetails
}

/**
 * "View verified details": the one drawer where Monad terms appear. Opens
 * from the right on desktop and from the bottom on phones.
 */
export function VerifiedDetailsDrawer({
  record,
  open,
  onOpenChange,
}: {
  record: VerifiedRecord
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mobile = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        className="max-h-[94svh] gap-0 overflow-y-auto p-0 data-[side=bottom]:rounded-t-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="font-display text-xl font-medium">Verified details</SheetTitle>
          <SheetDescription>{record.title}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-subtle">
                {record.fromLabel} → {record.toLabel}
              </span>
              <Amount value={record.amount} size="lg" />
            </div>
            <span className="flex items-center gap-1.5 text-xs text-sage">
              <ShieldCheck className="size-4" aria-hidden="true" /> {SETTLEMENT_ASSET}
            </span>
          </div>
          <VerifiedDetailsList details={record.details} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Button and drawer pair for any record with a receipt. */
export function VerifiedDetailsButton({
  record,
  label = 'View verified details',
  variant = 'outline',
  size = 'pill-sm',
  className,
}: {
  record: VerifiedRecord
  label?: string
  variant?: 'outline' | 'ghost' | 'secondary' | 'link'
  size?: 'pill-sm' | 'pill' | 'sm'
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <ShieldCheck data-icon="inline-start" /> {label}
      </Button>
      <VerifiedDetailsDrawer record={record} open={open} onOpenChange={setOpen} />
    </>
  )
}

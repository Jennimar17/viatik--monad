'use client'

import { ArrowRight, CircleCheck, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { Cents } from '@/domain/money'
import { useIsMobile } from '@/hooks/use-mobile'

import { Amount } from './amount'
import { PendingOperation, type OperationPhase } from './operation'

/** What a money-moving action does, stated before anyone confirms it. */
export type ConsequenceSummary = {
  /** What will happen, in one sentence. */
  what: string
  amount?: Cents
  from?: string
  to?: string
  /** Whether and how it can be undone, e.g. "Cannot be undone once released." */
  reversible: string
  /** The rule that authorizes it. */
  policy: string
}

/**
 * Confirmation for money-moving or irreversible actions. Always states what
 * happens, how much, from where to where, whether it can be undone and which
 * policy authorizes it, then shows the operation lifecycle in place. Opens
 * from the right on desktop and from the bottom on phones.
 */
export function ApprovalSheet({
  open,
  onOpenChange,
  onClosed,
  title,
  description,
  summary,
  children,
  confirmLabel,
  confirmVariant = 'default',
  onConfirm,
  phase,
  error,
  success,
  secondaryAction,
  disabled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs after the close animation ends: the place to clear form state. */
  onClosed?: () => void
  title: string
  description?: string
  summary: ConsequenceSummary
  children?: React.ReactNode
  confirmLabel: string
  confirmVariant?: 'default' | 'destructive'
  onConfirm: () => unknown
  phase: OperationPhase
  error?: string
  success?: { title: string; body: React.ReactNode; actions?: React.ReactNode }
  secondaryAction?: React.ReactNode
  disabled?: boolean
}) {
  const mobile = useIsMobile()
  const busy = phase !== 'idle' && phase !== 'completed' && phase !== 'failed'
  const done = phase === 'completed'

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !busy && onOpenChange(next)}
      onOpenChangeComplete={(next) => !next && onClosed?.()}
    >
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        className="max-h-[94svh] gap-0 overflow-y-auto p-0 data-[side=bottom]:rounded-t-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="border-b border-border px-5 py-4 sm:px-6">
          <SheetTitle className="font-display text-xl font-medium">
            {done && success ? success.title : title}
          </SheetTitle>
          {description && !done ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-5 px-5 py-5 sm:px-6">
          {done && success ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-soft p-4">
                <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-hidden="true" />
                <div className="text-sm text-pretty text-foreground">{success.body}</div>
              </div>
              {success.actions ? <div className="flex flex-wrap gap-2">{success.actions}</div> : null}
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
                <p className="text-sm text-pretty text-foreground">{summary.what}</p>
                {summary.amount !== undefined ? <Amount value={summary.amount} size="xl" /> : null}
                {summary.from || summary.to ? (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="rounded-full border border-border px-3 py-1 text-muted-foreground">
                      {summary.from}
                    </span>
                    <ArrowRight className="size-4 text-subtle" role="img" aria-label="to" />
                    <span className="rounded-full border border-border px-3 py-1 text-foreground">
                      {summary.to}
                    </span>
                  </div>
                ) : null}
                <dl className="mt-1 grid gap-2 border-t border-border pt-3 text-sm">
                  <div className="flex gap-2.5">
                    <dt className="sr-only">Reversible</dt>
                    {summary.reversible.toLowerCase().startsWith('cannot') ? (
                      <Undo2 className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                    ) : (
                      <RotateCcw className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
                    )}
                    <dd className="text-muted-foreground">{summary.reversible}</dd>
                  </div>
                  <div className="flex gap-2.5">
                    <dt className="sr-only">Policy</dt>
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden="true" />
                    <dd className="text-muted-foreground">{summary.policy}</dd>
                  </div>
                </dl>
              </div>
              {children}
              {phase !== 'idle' ? <PendingOperation phase={phase} error={error} /> : null}
            </>
          )}
        </div>

        <SheetFooter className="glass-chrome sticky bottom-0 flex-row justify-end gap-2 border-t px-5 py-3 sm:px-6">
          {done ? (
            <Button size="pill-sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              {secondaryAction}
              <Button variant="ghost" size="pill-sm" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                variant={confirmVariant}
                size="pill-sm"
                disabled={busy || disabled}
                onClick={() => void onConfirm()}
              >
                {busy ? 'Processing…' : confirmLabel}
              </Button>
            </>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

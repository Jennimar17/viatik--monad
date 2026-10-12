'use client'

import * as React from 'react'

import type { OperationPhase, Step } from '@/components/viatik/operation'
import { useLedger } from '@/data/react'

/**
 * Steps for an operation the signed-in person signs on Monad (Prepared →
 * Approved → the operation's own last step). Only Monad shows them: on the
 * demo or test ledger the sheet keeps its generic lifecycle.
 *
 * Usage in a sheet:
 *
 *   const pay = useCommand('payOutside')
 *   const steps = useSigningSteps(pay.phase, {
 *     prepared: "Viatik checks the payment against the ledger's rules.",
 *     done: { label: 'Sent', detail: 'Recorded on Monad and sent to the address.' },
 *   })
 *   <ApprovalSheet … phase={pay.phase} steps={steps} />
 */

/** How far a signed operation got: 0 preparing, 1 signing, 2 confirming, 3 done. */
export const SIGN_STAGE: Partial<Record<OperationPhase, number>> = {
  idle: 0,
  preparing: 0,
  waiting_for_confirmation: 1,
  processing: 2,
  completed: 3,
}

/** The words of one signed operation's steps. */
export type SigningLabels = {
  /** What "Prepared" checks, e.g. "Viatik checks the payment against the ledger's rules." */
  prepared: string
  /** What "Approved" says; defaults to the person signing while Viatik pays the fee. */
  approved?: string
  /** The last step, e.g. { label: 'Recorded', detail: 'Its fingerprint is recorded on Monad.' }. */
  done: { label: string; detail: string }
}

/**
 * The last stage an operation reached, kept after it fails so the failed step
 * can be marked. Updated during render.
 */
export function useReachedStage(phase: OperationPhase): number {
  const [reached, setReached] = React.useState(0)
  const stage = SIGN_STAGE[phase]
  if (stage !== undefined && stage !== reached) setReached(stage)
  return reached
}

/** Prepared → Approved → done for `phase`. A failure marks the step it reached. */
export function signingSteps(phase: OperationPhase, reached: number, labels: SigningLabels): Step[] {
  const stage = SIGN_STAGE[phase]
  const stateAt = (index: number): Step['state'] => {
    if (stage === undefined) {
      const failedAt = Math.min(reached, 2)
      return index < failedAt ? 'done' : index === failedAt ? 'failed' : 'upcoming'
    }
    if (phase === 'idle') return 'upcoming'
    return stage > index ? 'done' : stage === index ? 'current' : 'upcoming'
  }
  return [
    { id: 'prepared', label: 'Prepared', detail: labels.prepared, state: stateAt(0) },
    {
      id: 'approved',
      label: 'Approved',
      detail: labels.approved ?? 'Your Viatik account signs it. Viatik pays the network fee.',
      state: stateAt(1),
    },
    { id: 'done', label: labels.done.label, detail: labels.done.detail, state: stateAt(2) },
  ]
}

/**
 * The steps for `phase` when the workspace settles on Monad, otherwise
 * undefined (the sheet then shows its generic lifecycle). Call it on every
 * render, whatever the sheet shows.
 */
export function useSigningSteps(phase: OperationPhase, labels: SigningLabels): Step[] | undefined {
  const { view } = useLedger()
  const reached = useReachedStage(phase)
  return view?.settlement === 'monad' ? signingSteps(phase, reached, labels) : undefined
}

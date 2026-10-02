import type { ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'

import {
  DemoNote,
  Money,
  PreviewLabel,
  PreviewPanel,
  StatusChip,
} from '@/components/site/previews/primitives'
import { reconciliationDemo } from '@/components/site/content/demo-data'

/** Bill, payment and evidence as one trail, ending in a reconciled record. */
export function ReconciliationPreview() {
  const d = reconciliationDemo
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid gap-3 md:grid-cols-3" aria-label="Reconciliation trail">
        <Stage step="Bill" index={1}>
          <p className="text-sm font-medium text-foreground">{d.bill.vendor}</p>
          <p className="text-xs text-subtle num">{d.bill.reference}</p>
          <p className="mt-2 text-xl font-medium text-foreground num">
            <Money amount={d.bill.amount} currencyClassName="text-sm" />
          </p>
          <p className="text-xs text-muted-foreground">{d.bill.due}</p>
        </Stage>
        <Stage step="Payment" index={2}>
          <p className="text-sm font-medium text-foreground">{d.payment.account}</p>
          <p className="text-xs text-subtle">{d.payment.budget}</p>
          <div className="mt-3">
            <StatusChip status={d.payment.status} />
          </div>
        </Stage>
        <Stage step="Evidence" index={3}>
          <ul className="flex flex-col gap-2">
            {d.evidence.map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-foreground">
                <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-success" />
                {item}
              </li>
            ))}
          </ul>
        </Stage>
      </ol>

      <PreviewPanel className="flex flex-wrap items-center justify-between gap-3 border-success/40 p-4 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <PreviewLabel>Final state</PreviewLabel>
          <p className="text-sm text-foreground num">
            {d.bill.vendor} · {d.bill.reference} · <Money amount={d.bill.amount} />
          </p>
        </div>
        <StatusChip status={d.finalState} size="md" />
      </PreviewPanel>
      <DemoNote />
    </div>
  )
}

function Stage({ step, index, children }: { step: string; index: number; children: ReactNode }) {
  return (
    <li className="relative">
      <PreviewPanel className="flex h-full flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <PreviewLabel>{step}</PreviewLabel>
          <span className="text-xs text-subtle num">
            {index} <span aria-hidden="true">/</span>
            <span className="sr-only">of</span> 3
          </span>
        </div>
        <div className="flex flex-col gap-0.5">{children}</div>
      </PreviewPanel>
      {index < 3 ? (
        <span
          aria-hidden="true"
          className="absolute -bottom-3 left-1/2 h-3 w-px -translate-x-1/2 bg-border md:top-1/2 md:-right-3 md:bottom-auto md:left-auto md:h-px md:w-3 md:translate-x-0"
        />
      ) : null}
    </li>
  )
}

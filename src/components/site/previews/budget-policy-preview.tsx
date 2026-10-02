import { cn } from '@/lib/utils'

import {
  DemoNote,
  KeyValueList,
  Money,
  PreviewLabel,
  PreviewPanel,
  StatusChip,
} from '@/components/site/previews/primitives'
import { budgetPolicyDemo, type BudgetNode } from '@/components/site/content/demo-data'

/** Lays out by its own width (container queries), so it fits full-width or in a column. */
export function BudgetPolicyPreview() {
  const d = budgetPolicyDemo
  return (
    <div className="@container flex flex-col gap-3">
      <PreviewPanel className="grid @5xl:grid-cols-12">
        {/* Capital structure */}
        <div className="flex flex-col gap-6 p-4 sm:p-6 @5xl:col-span-7 @5xl:border-r @5xl:border-border">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <PreviewLabel>Capital structure</PreviewLabel>
              <p className="text-sm font-medium text-foreground sm:text-base">Arc Studio · Operations</p>
            </div>
            <StatusChip status={{ label: 'Investor controls applied', tone: 'accent' }} />
          </div>

          <div className="flex flex-col @2xl:flex-row @2xl:items-center">
            <Node node={d.chain[0]} className="@2xl:w-44" />
            <Connector />
            <Node node={d.chain[1]} className="@2xl:w-48" highlight />
            <Connector />
            <ul
              aria-label="Budget destinations"
              className="relative ml-3 flex flex-col gap-3 border-l border-border pl-5 @2xl:ml-0 @2xl:flex-1 @2xl:pl-6"
            >
              {d.destinations.map((node) => (
                <li
                  key={node.name}
                  className="relative before:absolute before:top-1/2 before:-left-5 before:h-px before:w-5 before:bg-border @2xl:before:-left-6 @2xl:before:w-6"
                >
                  <Node node={node} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Policy */}
        <div className="flex flex-col gap-6 border-t border-border p-4 sm:p-6 @5xl:col-span-5 @5xl:border-t-0">
          <div className="flex flex-col gap-1">
            <PreviewLabel>Budget policy</PreviewLabel>
            <p className="text-sm font-medium text-foreground sm:text-base">Product Delivery budget</p>
          </div>
          <KeyValueList dense items={d.rules} />

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <PreviewLabel>Policy results</PreviewLabel>
            <ul className="flex flex-col gap-3">
              {d.requests.map((request) => (
                <li
                  key={request.destination}
                  className={cn(
                    'flex flex-col gap-2 rounded-lg border p-3',
                    request.status.tone === 'warning'
                      ? 'border-warning/40 bg-muted/40'
                      : 'border-border bg-muted/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm font-medium text-foreground">{request.destination}</p>
                      <p className="text-xs text-subtle num">
                        <Money amount={request.amount} /> · {request.category}
                      </p>
                    </div>
                    <StatusChip status={request.status} />
                  </div>
                  {request.reason ? (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-subtle">Reason: </span>
                      {request.reason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </PreviewPanel>
      <DemoNote />
    </div>
  )
}

function Node({
  node,
  className,
  highlight = false,
}: {
  node: BudgetNode
  className?: string
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border px-4 py-3',
        highlight ? 'border-violet/50 bg-muted/40' : 'border-border bg-muted/40',
        className,
      )}
    >
      <span className="text-xs text-subtle">
        {node.kind === 'AI Agent' ? 'AI Agent · Controlled automation' : node.kind}
      </span>
      <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
    </div>
  )
}

function Connector() {
  return <span aria-hidden="true" className="ml-3 h-5 w-px shrink-0 bg-border @2xl:mx-0 @2xl:h-px @2xl:w-8" />
}

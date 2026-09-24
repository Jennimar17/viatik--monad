import { ChevronRightIcon } from 'lucide-react'

import {
  DemoNote,
  Money,
  PreviewHeader,
  PreviewLabel,
  PreviewPanel,
  StatusChip,
} from '@/components/site/previews/primitives'
import { portfolioDemo } from '@/components/site/content/demo-data'
import { CapitalChart } from '@/components/site/previews/capital-chart'

export function InvestorPreview() {
  return (
    <div className="flex flex-col gap-3">
      <PreviewPanel className="overflow-hidden">
        <div className="p-4 sm:p-5">
          <PreviewHeader
            label="Portfolio"
            title={`${portfolioDemo.rows.length} Agencies · Northstar Capital`}
            meta={<StatusChip status={{ label: '1 review pending', tone: 'accent' }} />}
          />
        </div>

        <div className="border-t border-border px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <PreviewLabel>Total capital released</PreviewLabel>
              <p className="pt-1 font-display text-3xl font-medium tracking-tight num">$165,000.00</p>
            </div>
            <p className="text-sm text-subtle">Apr – Sep</p>
          </div>
          <CapitalChart portfolio compact className="pt-4" />
        </div>

        {/* Desktop table */}
        <div className="overflow-x-auto">
          <table className="hidden w-full border-t border-border text-sm sm:table">
            <caption className="sr-only">Agencies funded by Northstar Capital</caption>
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th scope="col" className="px-5 py-2.5 font-normal">
                  Agency
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  Committed
                </th>
                <th scope="col" className="px-3 py-2.5 text-right font-normal">
                  Released
                </th>
                <th scope="col" className="px-3 py-2.5 font-normal">
                  Next milestone
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-normal">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {portfolioDemo.rows.map((row) => (
                <tr key={row.agency} className="border-t border-border">
                  <th scope="row" className="px-5 py-3 font-medium text-foreground">
                    {row.agency}
                  </th>
                  <td className="px-3 py-3 text-right text-foreground num">
                    <Money amount={row.committed} />
                  </td>
                  <td className="px-3 py-3 text-right text-foreground num">
                    <Money amount={row.released} />
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{row.nextMilestone}</td>
                  <td className="px-5 py-3 text-right">
                    <StatusChip status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Stacked records on small screens */}
        <ul
          className="flex flex-col border-t border-border sm:hidden"
          aria-label="Agencies funded by Northstar Capital"
        >
          {portfolioDemo.rows.map((row) => (
            <li key={row.agency} className="flex flex-col gap-3 border-t border-border p-4 first:border-t-0">
              <div className="flex items-center justify-between gap-3">
                <p className="font-medium text-foreground">{row.agency}</p>
                <StatusChip status={row.status} />
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-subtle">Committed</dt>
                  <dd className="text-foreground num">
                    <Money amount={row.committed} />
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs text-subtle">Released</dt>
                  <dd className="text-foreground num">
                    <Money amount={row.released} />
                  </dd>
                </div>
                <div className="col-span-2 flex flex-col gap-0.5">
                  <dt className="text-xs text-subtle">Next milestone</dt>
                  <dd className="text-muted-foreground">{row.nextMilestone}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </PreviewPanel>

      <PreviewPanel className="flex flex-wrap items-center justify-between gap-3 border-violet/40 p-4 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <PreviewLabel>Pending action</PreviewLabel>
          <p className="text-sm font-medium text-foreground">{portfolioDemo.pendingAction.title}</p>
          <p className="text-xs text-subtle num">{portfolioDemo.pendingAction.detail} USD</p>
        </div>
        <span className="inline-flex h-9 items-center gap-1 rounded-full bg-muted px-4 text-sm font-medium text-foreground">
          Review milestone
          <ChevronRightIcon aria-hidden="true" className="size-4 text-subtle" />
        </span>
      </PreviewPanel>

      <DemoNote />
    </div>
  )
}

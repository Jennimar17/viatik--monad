import {
  DemoNote,
  Money,
  PreviewHeader,
  PreviewLabel,
  PreviewPanel,
  ProgressLine,
  Stat,
  StatusChip,
} from '@/components/site/previews/primitives'
import { memberDemo } from '@/components/site/content/demo-data'

export function MemberPreview() {
  const d = memberDemo
  return (
    <div className="flex flex-col gap-3">
      <PreviewPanel className="p-4 sm:p-5">
        <PreviewHeader
          label={`${d.member} · ${d.budget}`}
          title="Your spending access"
          meta={<StatusChip status={{ label: 'Active', tone: 'success' }} />}
        />

        <div className="mt-5 rounded-lg bg-muted/60 p-4">
          <PreviewLabel className="mb-1.5">Budget rules, in plain language</PreviewLabel>
          <p className="text-sm leading-relaxed text-foreground num">{d.policyText}</p>
        </div>

        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-4">
            <PreviewLabel>Used this month</PreviewLabel>
            <p className="text-xs text-subtle num">
              {d.usedThisMonth} of {d.monthlyLimit} USD
            </p>
          </div>
          <ProgressLine value={d.usedPercent} label={`${d.usedPercent}% of monthly limit used`} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <Stat label="Available" value={<Money amount={d.available} />} />
          <Stat label="Used this month" value={<Money amount={d.usedThisMonth} />} />
          <Stat label="Pending requests" value={d.pendingRequests} />
          <Stat label="Missing receipts" value={d.missingReceipts} />
        </div>
      </PreviewPanel>

      <PreviewPanel className="p-4 sm:px-5">
        <PreviewLabel>Recent</PreviewLabel>
        <ul className="mt-2 flex flex-col text-sm">
          <li className="flex items-center justify-between gap-3 py-2">
            <span className="text-foreground">Vertex Cloud · Development tools</span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground num">
                <Money amount="120.00" />
              </span>
              <StatusChip status={{ label: 'Receipt attached', tone: 'success' }} />
            </span>
          </li>
          <li className="flex items-center justify-between gap-3 border-t border-border py-2">
            <span className="text-foreground">Funding request · Research licence</span>
            <span className="flex items-center gap-3">
              <span className="text-muted-foreground num">
                <Money amount="300.00" />
              </span>
              <StatusChip status={{ label: 'Pending', tone: 'accent' }} />
            </span>
          </li>
        </ul>
      </PreviewPanel>

      <DemoNote />
    </div>
  )
}

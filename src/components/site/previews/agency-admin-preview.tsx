import {
  DemoNote,
  Money,
  PreviewHeader,
  PreviewLabel,
  PreviewPanel,
  Stat,
  StatusChip,
} from '@/components/site/previews/primitives'
import { agencyOverviewDemo } from '@/components/site/content/demo-data'

export function AgencyAdminPreview() {
  const d = agencyOverviewDemo
  return (
    <div className="flex flex-col gap-3">
      <PreviewPanel className="p-4 sm:p-5">
        <PreviewHeader
          label={`${d.agency} · ${d.account} account`}
          title="Overview"
          meta={<StatusChip status={{ label: 'Within policy', tone: 'success' }} />}
        />

        <div className="mt-5 flex flex-col gap-1">
          <PreviewLabel>Available to operate</PreviewLabel>
          <p className="font-display text-3xl font-medium text-foreground num">
            <Money amount={d.availableToOperate} currencyClassName="text-[0.5em]" />
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          <Stat label="Allocated to budgets" value={<Money amount={d.allocatedToBudgets} />} />
          <Stat label="Reserved for payments" value={<Money amount={d.reservedForPayments} />} />
          <Stat label="Bills due" value={d.billsDue} />
          <Stat label="Pending requests" value={d.pendingRequests} />
        </div>

        <ul aria-label="Agency actions" className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
          {d.actions.map((action, index) => (
            <li
              key={action}
              className={
                index === 0
                  ? 'inline-flex h-9 items-center rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground'
                  : 'inline-flex h-9 items-center rounded-full bg-muted px-4 text-sm font-medium text-foreground'
              }
            >
              {action}
            </li>
          ))}
        </ul>
      </PreviewPanel>

      <PreviewPanel className="p-4 sm:px-5">
        <PreviewLabel>Needs attention</PreviewLabel>
        <ul className="mt-2 flex flex-col text-sm">
          <li className="flex items-center justify-between gap-3 py-2">
            <span className="text-foreground">Vertex Cloud · INV-2048</span>
            <span className="text-muted-foreground num">
              <Money amount="1,240.00" /> · Due Sep 30
            </span>
          </li>
          <li className="flex items-center justify-between gap-3 border-t border-border py-2">
            <span className="text-foreground">Alex Morgan · Funding request</span>
            <span className="text-muted-foreground num">
              <Money amount="300.00" /> · Approval needed
            </span>
          </li>
        </ul>
      </PreviewPanel>

      <DemoNote />
    </div>
  )
}

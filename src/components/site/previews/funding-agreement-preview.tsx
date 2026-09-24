import {
  DemoNote,
  KeyValueList,
  Money,
  PreviewHeader,
  PreviewLabel,
  PreviewPanel,
  ProgressLine,
  StatusChip,
} from '@/components/site/previews/primitives'
import { fundingAgreementDemo } from '@/components/site/content/demo-data'

export function FundingAgreementPreview() {
  const d = fundingAgreementDemo
  return (
    <div className="flex flex-col gap-3">
      <PreviewPanel className="p-4 sm:p-5">
        <PreviewHeader
          label="Funding agreement"
          title={`${d.agency} · ${d.purpose}`}
          meta={<StatusChip status={{ label: 'Active', tone: 'success' }} />}
        />

        <KeyValueList
          className="mt-4"
          items={[
            { label: 'Investor', value: d.investor },
            { label: 'Agency', value: d.agency },
            { label: 'Purpose', value: d.purpose },
            { label: 'Commitment', value: <Money amount={d.commitment} /> },
            { label: 'Released to date', value: <Money amount={d.released} /> },
            { label: 'Release model', value: d.releaseModel },
          ]}
        />

        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-4">
            <PreviewLabel>Progress</PreviewLabel>
            <p className="text-xs text-subtle num">{d.progressPercent}% · 2 of 4 milestones reached</p>
          </div>
          <ProgressLine
            value={d.progressPercent}
            segments={4}
            label={`${d.progressPercent}% of milestones reached`}
          />
        </div>

        <ol className="mt-5 flex flex-col border-t border-border" aria-label="Tranches">
          {d.tranches.map((tranche, index) => (
            <li
              key={tranche.label}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 border-b border-border py-3 text-sm last:border-b-0"
            >
              <span className="w-20 text-foreground num">{tranche.label}</span>
              <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-foreground num">
                  <Money amount={tranche.amount} />
                </span>
                <span className="truncate text-xs text-subtle">{d.milestones[index]}</span>
              </span>
              <StatusChip status={tranche.status} />
            </li>
          ))}
        </ol>
      </PreviewPanel>
      <DemoNote />
    </div>
  )
}

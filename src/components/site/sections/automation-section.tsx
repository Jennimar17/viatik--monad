import { ArrowRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DemoNote,
  KeyValueList,
  Money,
  PreviewHeader,
  PreviewLabel,
  PreviewPanel,
  StatusChip,
} from '@/components/site/previews/primitives'
import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { automation } from '@/components/site/content/landing-content'
import { automationDemo } from '@/components/site/content/demo-data'

export function AutomationSection() {
  return (
    <Section aria-labelledby="automation-heading" className="py-0 md:py-0">
      <Container>
        <div className="grain grid gap-12 overflow-hidden rounded-3xl border border-border bg-card p-6 text-card-foreground sm:p-10 lg:grid-cols-12 lg:items-center lg:gap-10 lg:p-14">
          <div className="flex flex-col gap-8 lg:col-span-5">
            <SectionIntro
              eyebrow={automation.eyebrow}
              heading={<span id="automation-heading">{automation.heading}</span>}
              body={automation.body}
            />
            <div>
              <Button
                variant="outline"
                size="pill"
                nativeButton={false}
                render={<a href={automation.cta.href} />}
              >
                {automation.cta.label}
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div className="lg:col-span-6 lg:col-start-7">
            <AutomationPolicyPreview />
          </div>
        </div>
      </Container>
    </Section>
  )
}

function AutomationPolicyPreview() {
  const d = automationDemo
  return (
    <div className="flex flex-col gap-3">
      <PreviewPanel className="bg-background p-4 sm:p-5">
        <PreviewHeader
          label={`Automation policy · ${d.kind}`}
          title={d.name}
          meta={<StatusChip status={d.status} />}
        />
        <p className="mt-1 text-xs text-subtle">Managed by {d.managedBy}</p>

        <KeyValueList className="mt-4" items={d.policy} />

        <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
          <PreviewLabel>Recent action</PreviewLabel>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-muted/60 px-3 py-2.5">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">{d.recentAction.title}</p>
              <p className="text-xs text-subtle num">
                <Money amount={d.recentAction.amount} /> · Receipt {d.recentAction.receipt.toLowerCase()}
              </p>
            </div>
            <StatusChip
              status={{ label: `Policy result: ${d.recentAction.policyResult}`, tone: 'success' }}
            />
          </div>
        </div>

        <ul
          aria-label="Automation controls"
          className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4"
        >
          {['Emergency pause', 'Set expiration', 'Edit providers'].map((control) => (
            <li
              key={control}
              className="inline-flex h-8 items-center rounded-full border border-border px-3 text-xs font-medium text-muted-foreground"
            >
              {control}
            </li>
          ))}
        </ul>
      </PreviewPanel>
      <DemoNote />
    </div>
  )
}

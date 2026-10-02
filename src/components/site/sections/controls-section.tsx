'use client'

import type { ComponentType } from 'react'
import { Tabs } from '@base-ui/react/tabs'

import { Badge } from '@/components/ui/badge'
import { Container, Eyebrow, Lede, PointList, Section } from '@/components/site/chrome/section'
import { BudgetPolicyPreview } from '@/components/site/previews/budget-policy-preview'
import { FundingAgreementPreview } from '@/components/site/previews/funding-agreement-preview'
import { ReconciliationPreview } from '@/components/site/previews/reconciliation-preview'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { controls, type ControlTab } from '@/components/site/content/landing-content'

const previews: Record<ControlTab['id'], ComponentType> = {
  agreements: FundingAgreementPreview,
  budgets: BudgetPolicyPreview,
  reconciliation: ReconciliationPreview,
}

/**
 * Agreements, budgets, reconciliation and the security model in one place:
 * the shared statement on top, one product preview per tab, and the controls
 * that hold across all of them.
 */
export function ControlsSection() {
  const { security } = controls

  return (
    <Section id="controls" aria-labelledby="controls-heading" className="grain bg-background text-foreground">
      <Container>
        <div className="grid items-end gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <Eyebrow>{controls.eyebrow}</Eyebrow>
            <h2
              id="controls-heading"
              className="font-display text-3xl leading-[1.12] font-medium tracking-[-0.035em] text-balance text-foreground md:text-4xl lg:text-[2.875rem]"
            >
              <span className="block">{controls.statement[0]}</span>
              <span className="block text-muted-foreground">{controls.statement[1]}</span>
            </h2>
          </div>
          <Lede className="max-w-md lg:col-span-4 lg:col-start-9">{controls.body}</Lede>
        </div>

        <Tabs.Root defaultValue="agreements" className="mt-12 flex flex-col gap-10 lg:mt-16">
          <Tabs.List
            aria-label="Choose a control"
            className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-secondary/45 p-1.5 backdrop-blur-lg"
          >
            {controls.tabs.map((tab) => (
              <Tabs.Tab
                key={tab.id}
                value={tab.id}
                className="inline-flex h-11 shrink-0 items-center rounded-full border border-transparent px-4 text-sm font-medium text-muted-foreground transition-all outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6 data-active:bg-primary data-active:text-primary-foreground"
              >
                {tab.tab}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {controls.tabs.map((tab) => {
            const Preview = previews[tab.id]
            return (
              <Tabs.Panel
                key={tab.id}
                value={tab.id}
                className="grid animate-in gap-10 duration-300 fade-in-0 outline-none slide-in-from-bottom-1 lg:grid-cols-12 lg:gap-12"
              >
                <div className="flex flex-col gap-6 lg:col-span-4">
                  <h3 className="font-display text-2xl font-medium text-balance text-foreground md:text-3xl">
                    {tab.heading}
                  </h3>
                  <p className="text-lg text-pretty text-muted-foreground">{tab.body}</p>
                  <PointList points={tab.points} />
                </div>
                <div className="product-stage grain min-w-0 p-3 sm:p-5 lg:col-span-8">
                  <div className="theme-light overflow-hidden rounded-xl bg-background text-foreground">
                    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
                      <ViatikLogo href="" tone="dark" />
                      <Badge variant="outline">Product preview</Badge>
                    </div>
                    <div className="p-3 sm:p-4">
                      <Preview />
                    </div>
                  </div>
                </div>
              </Tabs.Panel>
            )
          })}
        </Tabs.Root>

        <div
          id="security"
          className="mt-20 grid gap-10 border-t border-border pt-12 lg:mt-28 lg:grid-cols-12 lg:gap-16"
        >
          <div className="flex flex-col gap-4 lg:col-span-4">
            <Eyebrow>Security</Eyebrow>
            <h3 className="font-display text-2xl font-medium text-balance text-foreground md:text-3xl">
              {security.heading}
            </h3>
            <p className="text-base text-pretty text-muted-foreground">{security.body}</p>
          </div>
          <ul className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:col-span-8 lg:grid-cols-3">
            {security.controls.map((control) => (
              <li key={control.title} className="flex flex-col gap-2 bg-background p-5 sm:p-6">
                <span aria-hidden="true" className="size-1.5 bg-violet" />
                <h4 className="mt-2 font-display text-lg font-medium text-foreground">{control.title}</h4>
                <p className="text-sm text-pretty text-muted-foreground">{control.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </Section>
  )
}

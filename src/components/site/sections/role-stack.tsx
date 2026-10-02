'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { ArrowRightIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Container, PointList, Section, SectionIntro } from '@/components/site/chrome/section'
import { CapitalStackScene } from '@/components/site/illustrations/capital-stack'
import { Amount } from '@/components/viatik/amount'
import { UsageRing } from '@/components/viatik/charts'
import { BudgetCard, FundingProgress } from '@/components/viatik/finance'
import { AgentAvatar } from '@/components/viatik/people'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge } from '@/components/viatik/status'
import { formatUsd } from '@/domain/money'
import { roles, type RoleId, type RoleLayer } from '@/components/site/content/landing-content'
import {
  agentRules,
  allowance,
  budget,
  capital,
  story,
  tranches,
} from '@/components/site/content/product-demo'
import { siteConfig } from '@/components/site/content/site'

/**
 * Roles as a capital stack: an isometric stack on one side, the role tabs and
 * a real product surface for the selected role on the other.
 */
export function RoleStackSection() {
  const [active, setActive] = useState<RoleId>('investor')
  const activeIndex = roles.items.findIndex((role) => role.id === active)

  return (
    <Section id="product" aria-labelledby="roles-heading" className="grain bg-background text-foreground">
      <Container>
        <SectionIntro
          eyebrow={roles.eyebrow}
          heading={<span id="roles-heading">{roles.heading}</span>}
          body={roles.body}
        />

        <div className="mt-12 grid items-start gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-12">
          <div className="lg:sticky lg:top-28 lg:col-span-5">
            <CapitalStackScene
              labels={roles.items.map((role) => `${role.number}  ${role.label}`)}
              active={activeIndex}
              onSelect={(index) => setActive(roles.items[index]?.id ?? 'investor')}
              className="mx-auto w-full max-w-md"
            />
          </div>

          <Tabs.Root
            value={active}
            onValueChange={(value) => setActive(value as RoleId)}
            className="flex min-w-0 flex-col gap-8 lg:col-span-7"
          >
            <Tabs.List aria-label="Choose a role" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {roles.items.map((role) => (
                <Tabs.Tab
                  key={role.id}
                  value={role.id}
                  className="flex min-h-11 flex-col items-start gap-1 rounded-2xl border border-border bg-card/40 p-3.5 text-left transition-colors outline-none hover:border-mist/30 focus-visible:ring-3 focus-visible:ring-ring/50 data-active:border-mist/45 data-active:bg-card"
                >
                  <span className="text-xs tracking-[0.12em] text-subtle num">{role.number}</span>
                  <span className="font-display text-base font-medium text-foreground">{role.label}</span>
                </Tabs.Tab>
              ))}
            </Tabs.List>

            {roles.items.map((role) => (
              <Tabs.Panel
                key={role.id}
                value={role.id}
                className="grid animate-in gap-8 duration-300 fade-in-0 outline-none slide-in-from-bottom-1 xl:grid-cols-2"
              >
                <RoleCopy role={role} />
                <div className="min-w-0 xl:pt-1">
                  <RoleProduct id={role.id} />
                </div>
              </Tabs.Panel>
            ))}
          </Tabs.Root>
        </div>
      </Container>
    </Section>
  )
}

function RoleCopy({ role }: { role: RoleLayer }) {
  return (
    <div className="flex flex-col gap-5">
      <h3 className="font-display text-2xl font-medium text-balance text-foreground md:text-3xl">
        {role.heading}
      </h3>
      <p className="text-base text-pretty text-muted-foreground md:text-lg">{role.body}</p>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs tracking-[0.12em] text-subtle uppercase">Best fit for</p>
        <p className="text-base text-pretty text-muted-foreground">{role.bestFitFor}</p>
      </div>
      <PointList points={role.features} />
      <div>
        <Link
          href={siteConfig.routes.demoRole(role.cta.role)}
          className={buttonVariants({ variant: 'outline', size: 'pill' })}
        >
          {role.cta.label}
          <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
        </Link>
      </div>
    </div>
  )
}

/** The real product surface each role works with, fed with the demo's story. */
function RoleProduct({ id }: { id: RoleId }) {
  switch (id) {
    case 'investor':
      return (
        <div className="theme-dark product-frame flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">Funding agreement</p>
              <p className="text-xs text-subtle">
                {story.agency} · {story.agreement}
              </p>
            </div>
            <StatusBadge status={{ label: 'Active', tone: 'success' }} />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-subtle">Capital released</p>
            <Amount value={capital.released} size="xl" />
            <p className="text-xs text-muted-foreground">
              of <span className="num">{formatUsd(capital.committed)}</span> committed
            </p>
          </div>
          <FundingProgress segments={tranches} />
        </div>
      )
    case 'agency-admin':
      return (
        <div className="theme-dark product-frame p-3">
          <BudgetCard {...budget} className="border-transparent" />
        </div>
      )
    case 'member':
      return (
        <div className="theme-dark product-frame flex flex-col items-center gap-5 p-6 text-center">
          <UsageRing value={allowance.used} max={allowance.limit} size={148} label="Monthly allowance">
            <Amount value={allowance.available} size="md" />
            <span className="text-xs text-subtle">left of {allowance.limit}.00</span>
          </UsageRing>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Monthly allowance</p>
            <p className="text-xs text-subtle">{allowance.budget}</p>
          </div>
          <PolicySummary
            title="What you can spend on"
            lines={['Development tools and cloud services.', 'Payments above 250.00 USD need approval.']}
            className="w-full text-left"
          />
        </div>
      )
    case 'ai-agent':
      return (
        <div className="theme-dark product-frame flex flex-col gap-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <AgentAvatar size="md" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-medium text-foreground">{story.agent}</p>
                <p className="text-xs text-subtle">AI Agent · {story.agency}</p>
              </div>
            </div>
            <StatusBadge status={{ label: 'Active', tone: 'success' }} />
          </div>
          <PolicySummary title="Spending rules" lines={agentRules} />
        </div>
      )
  }
}

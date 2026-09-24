'use client'

import Link from 'next/link'
import type { ComponentType } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { ArrowRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { AgencyAdminPreview } from '@/components/site/previews/agency-admin-preview'
import { InvestorPreview } from '@/components/site/previews/investor-preview'
import { MemberPreview } from '@/components/site/previews/member-preview'
import { Container, Eyebrow, Section, SectionIntro } from '@/components/site/chrome/section'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { Badge } from '@/components/ui/badge'
import { roleStory, type RoleStory } from '@/components/site/content/landing-content'
import { siteConfig, type DemoRole } from '@/components/site/content/site'

const previews: Record<DemoRole, ComponentType> = {
  investor: InvestorPreview,
  'agency-admin': AgencyAdminPreview,
  member: MemberPreview,
}

export function RoleProductStory() {
  return (
    <Section id="product" aria-labelledby="roles-heading">
      <Container>
        <SectionIntro
          eyebrow="Product"
          heading={<span id="roles-heading">{roleStory.heading}</span>}
          body={roleStory.body}
        />

        <Tabs.Root defaultValue="investor" className="mt-12 flex flex-col gap-10 lg:mt-16">
          <Tabs.List
            aria-label="Choose a perspective"
            className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-border bg-secondary/45 p-1.5 backdrop-blur-lg"
          >
            {roleStory.roles.map((role) => (
              <Tabs.Tab
                key={role.id}
                value={role.id}
                className="inline-flex h-11 shrink-0 items-center rounded-full border border-transparent px-4 text-sm font-medium text-muted-foreground transition-all outline-none select-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:px-6 data-active:bg-primary data-active:text-primary-foreground"
              >
                {role.tab}
              </Tabs.Tab>
            ))}
          </Tabs.List>

          {roleStory.roles.map((role) => {
            const Preview = previews[role.id]
            return (
              <Tabs.Panel
                key={role.id}
                value={role.id}
                className="grid animate-in gap-10 duration-300 fade-in-0 outline-none slide-in-from-bottom-1 lg:grid-cols-12 lg:gap-12"
              >
                <RoleCopy role={role} />
                <div className="product-stage grain min-w-0 p-3 sm:p-5 lg:col-span-7">
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
      </Container>
    </Section>
  )
}

function RoleCopy({ role }: { role: RoleStory }) {
  return (
    <div className="flex flex-col gap-6 lg:col-span-5">
      <Eyebrow>{role.eyebrow}</Eyebrow>
      <h3 className="font-display text-2xl font-medium text-balance text-foreground md:text-3xl">
        {role.heading}
      </h3>
      <p className="text-lg text-pretty text-muted-foreground">{role.body}</p>

      <ul className="grid grid-cols-1 border-t border-border sm:grid-cols-2 sm:gap-x-8">
        {role.features.map((feature) => (
          <li
            key={feature}
            className="flex items-center gap-3 border-b border-border py-3 text-sm text-foreground"
          >
            <span aria-hidden="true" className="size-1.5 shrink-0 bg-violet" />
            {feature}
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="outline"
          size="pill"
          nativeButton={false}
          render={<Link href={siteConfig.routes.demoRole(role.id)} />}
        >
          {role.cta}
          <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

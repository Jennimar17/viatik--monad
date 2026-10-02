import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowUpRightIcon, CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Container, Eyebrow, Lede, Section } from '@/components/site/chrome/section'
import { SpendingChart } from '@/components/site/showcase/spending-chart'
import { ViatikMark } from '@/components/viatik/viatik-logo'
import { showcase } from '@/components/site/content/landing-content'
import { siteConfig, type DemoRole } from '@/components/site/content/site'

/**
 * Who Viatik is for, in three cards: the investor's commitment, the
 * operator's view of spending, and the team's clear budget. It opens the
 * light block that continues with How it works.
 */
export function ShowcaseSection() {
  const { investors, operators, teams } = showcase.cards

  return (
    <Section id="why" aria-labelledby="why-heading" className="theme-light pb-16 md:pb-20">
      <Container>
        <div className="grid items-end gap-8 lg:grid-cols-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <Eyebrow>{showcase.eyebrow}</Eyebrow>
            <h2
              id="why-heading"
              className="font-display text-3xl leading-[1.14] font-medium tracking-[-0.035em] text-balance text-foreground md:text-4xl"
            >
              <span className="block">{showcase.headline[0]}</span>
              <span className="block text-muted-foreground">{showcase.headline[1]}</span>
            </h2>
          </div>
          <Lede className="max-w-md lg:col-span-4 lg:col-start-9">{showcase.body}</Lede>
        </div>

        <div className="grid gap-5 pt-12 md:grid-cols-3 md:pt-16">
          <ShowcaseCard
            className="photo-card"
            title={investors.title}
            description={investors.description}
            link={investors.link}
            role="investor"
          >
            <div className="relative isolate flex h-60 items-end overflow-hidden rounded-xl">
              <Image
                src="/images/modern-architecture.jpg"
                alt="Sculptural white architecture opening toward the sky"
                fill
                sizes="(min-width: 1280px) 380px, (min-width: 768px) 30vw, 90vw"
                className="object-cover"
              />
              <div className="relative z-10 w-full p-3">
                <div className="glass-panel theme-light rounded-xl p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <ViatikMark tone="dark" className="size-5" />
                    <span>{investors.chipLabel}</span>
                  </div>
                  <p className="pt-2 font-display text-2xl font-medium tracking-tight num">
                    {investors.chipValue}
                  </p>
                  <p className="pt-1 text-sm text-muted-foreground">{investors.chipNote}</p>
                </div>
              </div>
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            className="theme-dark grain"
            title={operators.title}
            description={operators.description}
            link={operators.link}
            role="agency-admin"
          >
            <div className="flex h-60 flex-col justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{operators.metricLabel}</p>
                <p className="pt-1 font-display text-3xl font-medium tracking-tight num">
                  {operators.metricValue}
                </p>
              </div>
              <SpendingChart />
            </div>
          </ShowcaseCard>

          <ShowcaseCard
            className="photo-card"
            title={teams.title}
            description={teams.description}
            link={teams.link}
            role="member"
          >
            <div className="relative isolate flex h-60 items-end overflow-hidden rounded-xl">
              <Image
                src="/images/creative-team.jpg"
                alt="A creative team collaborating around a shared studio table"
                fill
                sizes="(min-width: 1280px) 380px, (min-width: 768px) 30vw, 90vw"
                className="object-cover object-[38%_center]"
              />
              <div className="relative z-10 w-full p-3">
                <div className="glass-panel theme-light flex items-center gap-3 rounded-xl p-4">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sage/45 text-brand">
                    <CheckIcon className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{teams.chipTitle}</p>
                    <p className="text-sm text-muted-foreground">{teams.chipNote}</p>
                  </div>
                </div>
              </div>
            </div>
          </ShowcaseCard>
        </div>
      </Container>
    </Section>
  )
}

function ShowcaseCard({
  title,
  description,
  link,
  role,
  className,
  children,
}: {
  title: string
  description: string
  link: string
  role: DemoRole
  className?: string
  children: ReactNode
}) {
  return (
    <Card className={cn('hover-lift h-full', className)}>
      <CardHeader>
        <CardTitle>
          <h3>{title}</h3>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">{children}</CardContent>
      <CardFooter>
        <Link
          href={siteConfig.routes.demoRole(role)}
          className="flex min-h-9 w-full items-center justify-between gap-3 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {link} <ArrowUpRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </CardFooter>
    </Card>
  )
}

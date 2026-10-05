'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowUpRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { GlassFigure } from '@/components/site/illustrations/glass-figures'
import { useCases, type UseCase } from '@/components/site/content/landing-content'
import { siteConfig, type DemoRole } from '@/components/site/content/site'

const roleView: Record<DemoRole, string> = {
  investor: 'Investor view',
  'agency-admin': 'Agency view',
  member: 'Member view',
}

/**
 * An editorial index of use cases. Pointing at or focusing a row brings its
 * glass figure into the grainy panel beside the list. Until the use-case pages
 * exist, each row opens the demo as the role that case starts from.
 */
export function UseCasesSection() {
  const [active, setActive] = useState(0)
  const current = useCases.items[active] ?? useCases.items[0]

  return (
    <Section id="use-cases" aria-labelledby="use-cases-heading" className="theme-light">
      <Container>
        <SectionIntro
          eyebrow={useCases.eyebrow}
          heading={<span id="use-cases-heading">{useCases.heading}</span>}
          body={useCases.body}
        />

        <div className="mt-12 grid items-start gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-12">
          <div
            aria-hidden="true"
            className="theme-dark grain grain-strong relative isolate hidden aspect-[4/5] overflow-hidden rounded-3xl border border-border bg-brand text-foreground lg:sticky lg:top-28 lg:col-span-5 lg:block"
          >
            {useCases.items.map((item, index) => (
              <GlassFigure
                key={item.id}
                id={item.id}
                className="scene-fade absolute inset-x-[9%] top-[6%]"
                style={{ opacity: index === active ? 1 : 0 }}
              />
            ))}
            <div className="image-shade absolute inset-0" />
            <div className="absolute inset-x-0 bottom-0 z-[2] flex items-end justify-between gap-4 p-7">
              <div className="flex flex-col gap-1.5">
                <p className="text-xs tracking-[0.14em] text-subtle uppercase">{current?.caption}</p>
                <p className="font-display text-2xl font-medium tracking-[-0.02em]">{current?.title}</p>
              </div>
              <span className="font-display text-5xl font-medium text-mist/25 num">
                {String(active + 1).padStart(2, '0')}
              </span>
            </div>
          </div>

          <ol className="flex flex-col border-t border-border lg:col-span-7">
            {useCases.items.map((item, index) => (
              <UseCaseRow
                key={item.id}
                item={item}
                index={index}
                active={index === active}
                onActivate={() => setActive(index)}
              />
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  )
}

function UseCaseRow({
  item,
  index,
  active,
  onActivate,
}: {
  item: UseCase
  index: number
  active: boolean
  onActivate: () => void
}) {
  return (
    <li className="border-b border-border">
      <Link
        href={siteConfig.routes.demoRole(item.role)}
        onMouseEnter={onActivate}
        onFocus={onActivate}
        className="group grid grid-cols-[auto_1fr_auto] items-start gap-x-5 py-7 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:gap-x-8 md:py-8"
      >
        <span
          className={cn(
            'pt-1 font-display text-lg font-medium num transition-colors sm:text-xl',
            active ? 'text-foreground' : 'text-subtle',
          )}
        >
          {String(index + 1).padStart(2, '0')}
        </span>

        <span className="flex min-w-0 flex-col gap-2">
          <span className="font-display text-2xl font-medium tracking-[-0.03em] text-balance text-foreground md:text-3xl">
            {item.title}
          </span>
          <span className="max-w-lg text-base text-pretty text-muted-foreground">{item.body}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="text-xs tracking-[0.14em] text-subtle uppercase">{item.caption}</span>
            <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground">
              {roleView[item.role]}
            </span>
          </span>
          <span
            aria-hidden="true"
            className="theme-dark grain grain-strong relative isolate mt-3 block h-48 overflow-hidden rounded-2xl border border-border bg-brand lg:hidden"
          >
            <GlassFigure
              id={item.id}
              className="absolute top-1/2 left-1/2 h-[118%] w-auto -translate-x-1/2 -translate-y-1/2"
            />
          </span>
        </span>

        <span
          aria-hidden="true"
          className={cn(
            'mt-1 flex size-10 items-center justify-center rounded-full border transition-all duration-300',
            active
              ? 'border-foreground bg-foreground text-background'
              : 'border-border text-muted-foreground group-hover:border-foreground',
          )}
        >
          <ArrowUpRightIcon className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </Link>
    </li>
  )
}

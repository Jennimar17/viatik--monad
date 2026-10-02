'use client'

import Link from 'next/link'
import { useState, type CSSProperties } from 'react'
import { ArrowRightIcon, PlusIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

import { buttonVariants } from '@/components/ui/button'
import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { roles, type RolePillar } from '@/components/site/content/landing-content'
import { siteConfig } from '@/components/site/content/site'

/** Resting heights of closed pillars on desktop, so the row reads as a skyline. */
const REST_HEIGHTS = [94, 86, 97, 90]

/**
 * Roles as extruded prisms: one opens into a full card, the rest stand as
 * gradient columns with a vertical label. It is a single-open accordion, so
 * each pillar's heading holds a button that controls its region.
 */
export function RolePillarsSection() {
  const [open, setOpen] = useState(0)

  return (
    <Section id="product" aria-labelledby="roles-heading" className="grain bg-background text-foreground">
      <Container>
        <SectionIntro
          eyebrow={roles.eyebrow}
          heading={<span id="roles-heading">{roles.heading}</span>}
          body={roles.body}
        />

        <ul className="mt-12 flex flex-col gap-4 lg:mt-16 lg:h-[42rem] lg:flex-row lg:items-end lg:gap-3">
          {roles.items.map((role, index) => (
            <Pillar
              key={role.id}
              role={role}
              index={index}
              isOpen={index === open}
              onOpen={() => setOpen(index)}
            />
          ))}
        </ul>
      </Container>
    </Section>
  )
}

function Pillar({
  role,
  index,
  isOpen,
  onOpen,
}: {
  role: RolePillar
  index: number
  isOpen: boolean
  onOpen: () => void
}) {
  const triggerId = `pillar-${role.id}-trigger`
  const panelId = `pillar-${role.id}-panel`
  const height = isOpen ? 100 : REST_HEIGHTS[index % REST_HEIGHTS.length]

  return (
    <li
      data-open={isOpen ? '' : undefined}
      style={{ '--pillar-h': `calc(${height}% - var(--depth))` } as CSSProperties}
      className={cn(
        'prism min-w-0 transition-[flex-grow,height] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] lg:h-(--pillar-h) lg:basis-0',
        `prism-tone-${(index % 4) + 1}`,
        isOpen ? 'lg:grow-[5]' : 'lg:min-w-20 lg:grow',
      )}
    >
      <div className="prism-face grain relative flex h-full flex-col overflow-hidden">
        <h3>
          <button
            id={triggerId}
            type="button"
            aria-expanded={isOpen}
            aria-controls={panelId}
            onClick={onOpen}
            className={cn(
              'z-[2] flex w-full text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset',
              isOpen
                ? 'cursor-default flex-col gap-2 px-6 pt-6 sm:px-8 sm:pt-8 lg:px-10 lg:pt-10'
                : 'min-h-16 items-center gap-4 px-5 text-brand lg:absolute lg:inset-0 lg:min-h-0 lg:flex-col lg:items-start lg:justify-between lg:gap-0 lg:p-5',
            )}
          >
            <span className={cn('text-xs tracking-[0.12em] num', isOpen ? 'text-subtle' : 'text-brand/70')}>
              {role.number}
            </span>
            <span
              className={cn(
                'font-display font-medium tracking-[-0.02em]',
                isOpen
                  ? 'text-3xl text-foreground md:text-4xl'
                  : 'text-lg lg:rotate-180 lg:text-base lg:tracking-[0.08em] lg:uppercase lg:[writing-mode:vertical-rl]',
              )}
            >
              {role.label}
            </span>
            {!isOpen ? <PlusIcon aria-hidden="true" className="ml-auto size-5 lg:hidden" /> : null}
          </button>
        </h3>

        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          hidden={!isOpen}
          className="z-[2] flex flex-1 animate-in flex-col gap-5 px-6 pt-5 pb-6 delay-150 duration-500 fade-in-0 fill-mode-both sm:px-8 sm:pb-8 lg:px-10 lg:pb-10"
        >
          <p className="max-w-xl text-base text-pretty text-muted-foreground md:text-lg">{role.lede}</p>

          <div className="flex flex-col gap-1.5">
            <p className="text-xs tracking-[0.12em] text-subtle uppercase">Best fit for</p>
            <p className="max-w-xl text-base text-pretty text-muted-foreground">{role.bestFitFor}</p>
          </div>

          <ul className="flex flex-col border-t border-border">
            {role.features.map((feature) => (
              <li key={feature} className="border-b border-border py-2.5 text-base text-foreground">
                {feature}
              </li>
            ))}
          </ul>

          <div className="mt-auto flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pt-2">
            <div className="flex flex-col gap-1">
              <p className="text-xs tracking-[0.12em] text-subtle uppercase">{role.stat.label}</p>
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-4xl font-medium tracking-[-0.03em] text-foreground num">
                  {role.stat.value}
                </span>
                <span className="text-sm text-muted-foreground">{role.stat.note}</span>
              </p>
            </div>
            <Link
              href={siteConfig.routes.demoRole(role.cta.role)}
              className={buttonVariants({ variant: 'outline', size: 'pill-sm' })}
            >
              {role.cta.label}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </li>
  )
}

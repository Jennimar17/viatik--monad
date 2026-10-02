import Link from 'next/link'
import { ArrowUpRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { UseCaseScene } from '@/components/site/illustrations/scenes'
import { useCases, type UseCase } from '@/components/site/content/landing-content'
import { siteConfig, type DemoRole } from '@/components/site/content/site'

const roleView: Record<DemoRole, string> = {
  investor: 'Investor',
  'agency-admin': 'Agency',
  member: 'Member',
}

/**
 * Bento of funders and teams, each drawn as an isometric building on plan
 * paper. Until the use-case pages exist, every card opens the demo as the
 * role that case starts from.
 */
export function UseCasesSection() {
  const [featured, ...rest] = useCases.items
  if (!featured) return null

  return (
    <Section id="use-cases" aria-labelledby="use-cases-heading" className="theme-light">
      <Container>
        <SectionIntro
          eyebrow={useCases.eyebrow}
          heading={<span id="use-cases-heading">{useCases.heading}</span>}
          body={useCases.body}
        />

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:mt-16 lg:grid-cols-4 lg:grid-rows-[repeat(2,19rem)]">
          <UseCaseCard item={featured} featured className="sm:col-span-2 lg:row-span-2" />
          {rest.map((item) => (
            <UseCaseCard key={item.id} item={item} />
          ))}
        </ul>
      </Container>
    </Section>
  )
}

function UseCaseCard({
  item,
  featured = false,
  className,
}: {
  item: UseCase
  featured?: boolean
  className?: string
}) {
  return (
    <li className={cn('min-w-0', className)}>
      <Link
        href={siteConfig.routes.demoRole(item.role)}
        className={cn(
          'group theme-dark blueprint-grid grain grain-strong relative isolate flex h-full flex-col justify-end overflow-hidden rounded-2xl border border-border text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
          featured ? 'min-h-[32rem] sm:min-h-[26rem]' : 'min-h-72',
        )}
      >
        <div
          aria-hidden="true"
          className={cn('absolute inset-x-5', featured ? 'top-8 bottom-60 sm:bottom-44' : 'top-6 bottom-28')}
        >
          <UseCaseScene scene={item.id} className="scene-lift size-full" />
        </div>
        <div className="image-shade absolute inset-0" aria-hidden="true" />
        <ArrowUpRightIcon
          aria-hidden="true"
          className="absolute top-4 right-4 z-[2] size-4 text-mist/70 transition-colors group-hover:text-mist"
        />

        <div className={cn('relative z-[2] flex flex-col gap-2', featured ? 'p-6 lg:p-8' : 'p-5')}>
          {featured ? (
            <span className="mb-1 w-fit rounded-full border border-border bg-background/80 px-2.5 py-1 text-[0.6875rem] font-medium tracking-[0.14em] uppercase">
              {useCases.featuredLabel}
            </span>
          ) : null}
          <h3
            className={cn(
              'font-display font-medium tracking-[-0.03em] text-balance',
              featured ? 'text-3xl md:text-4xl' : 'text-2xl',
            )}
          >
            {item.title}
          </h3>
          {featured && item.body ? (
            <p className="max-w-md text-base text-pretty text-muted-foreground">{item.body}</p>
          ) : null}
          <p className="text-xs tracking-[0.14em] text-subtle uppercase">{item.caption}</p>
          <span className="sr-only">Explore the {roleView[item.role]} view in the demo</span>
        </div>
      </Link>
    </li>
  )
}

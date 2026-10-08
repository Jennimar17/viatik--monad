import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'

import { cn } from '@/lib/utils'

import { Container, PointList, SectionIntro } from '@/components/site/chrome/section'
import { siteConfig } from '@/components/site/content/site'
import { footer } from '@/components/site/content/landing-content'
import { buttonVariants } from '@/components/ui/button'
import { ViatikLogo } from '@/components/viatik/viatik-logo'

export type PageBlock = {
  /** Anchor id; also used by the optional table of contents. */
  id: string
  /** Light band, as on the landing; dark is the default. */
  tone?: 'light'
  heading: string
  body?: string
  points?: string[]
  /** Small cards in a grid, for roles, stages or phases. */
  cards?: { title: string; body: string; tag?: string }[]
}

/**
 * Simple informational page in the landing's visual language: the legal
 * page's bar and footer, a larger intro, content blocks, and a closing call
 * to open the demo. Content lives in `content/pages.ts`.
 */
export function MarketingPage({
  eyebrow,
  title,
  intro,
  blocks,
  toc = false,
}: {
  eyebrow: string
  title: string
  intro: string
  blocks: PageBlock[]
  toc?: boolean
}) {
  return (
    <>
      <header className="border-b border-border">
        <Container className="flex h-20 items-center justify-between gap-4">
          <ViatikLogo />
          <Link href="/" className={buttonVariants({ variant: 'ghost', size: 'pill-sm' })}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back to Viatik
          </Link>
        </Container>
      </header>

      <main id="main">
        <Container className="pt-16 pb-14 md:pt-24 md:pb-20">
          <SectionIntro as="h1" eyebrow={eyebrow} heading={title} body={intro} />
          {toc ? (
            <nav aria-label="On this page" className="mt-10">
              <ul className="flex flex-wrap gap-2">
                {blocks.map((block) => (
                  <li key={block.id}>
                    <a
                      href={`#${block.id}`}
                      className="inline-flex rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      {block.heading}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </Container>

        {blocks.map((block) => (
          <section
            key={block.id}
            id={block.id}
            aria-labelledby={`${block.id}-heading`}
            className={cn('scroll-mt-4 py-16 md:py-24', block.tone === 'light' && 'theme-light')}
          >
            <Container className="flex flex-col gap-8">
              <div className="flex max-w-2xl flex-col gap-3">
                <h2
                  id={`${block.id}-heading`}
                  className="font-display text-2xl leading-tight font-medium tracking-[-0.03em] text-balance text-foreground md:text-4xl"
                >
                  {block.heading}
                </h2>
                {block.body ? (
                  <p className="text-base text-pretty text-muted-foreground md:text-lg">{block.body}</p>
                ) : null}
              </div>
              {block.points ? <PointList points={block.points} className="max-w-2xl" /> : null}
              {block.cards ? (
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {block.cards.map((card) => (
                    <li
                      key={card.title}
                      className={cn(
                        'flex flex-col gap-2 rounded-2xl border border-border p-5',
                        block.tone === 'light' ? 'bg-background/60' : 'bg-card/60',
                      )}
                    >
                      {card.tag ? (
                        <span className="w-fit text-xs font-medium tracking-[0.08em] text-subtle uppercase">
                          {card.tag}
                        </span>
                      ) : null}
                      <h3 className="text-base font-medium text-foreground">{card.title}</h3>
                      <p className="text-sm text-pretty text-muted-foreground">{card.body}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Container>
          </section>
        ))}

        <Container className="py-16 md:py-24">
          <aside
            aria-label="Open the demo"
            className="grain relative flex flex-col gap-5 overflow-hidden rounded-3xl border border-border bg-card/60 p-7 sm:flex-row sm:items-center sm:justify-between sm:p-10"
          >
            <p className="max-w-md font-display text-2xl leading-tight font-medium tracking-[-0.03em] text-balance md:text-3xl">
              Follow one tranche from commitment to completed payment.
            </p>
            <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill' })}>
              Open the demo
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </a>
          </aside>
        </Container>
      </main>

      <footer className="border-t border-border">
        <Container className="flex flex-col gap-4 py-8 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>{footer.copyright}</p>
          <nav aria-label="Legal" className="flex gap-6">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </Container>
      </footer>
    </>
  )
}

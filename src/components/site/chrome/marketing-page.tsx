import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'

import { Container, Eyebrow, PointList, SectionIntro } from '@/components/site/chrome/section'
import { siteConfig } from '@/components/site/content/site'
import { footer } from '@/components/site/content/landing-content'
import { buttonVariants } from '@/components/ui/button'
import { ViatikLogo } from '@/components/viatik/viatik-logo'

export type PageBlock = {
  /** Anchor id; also used by the optional table of contents. */
  id: string
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
  children,
}: {
  eyebrow: string
  title: string
  intro: string
  blocks: PageBlock[]
  toc?: boolean
  children?: React.ReactNode
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
        <Container className="py-16 md:py-24">
          <SectionIntro as="h1" eyebrow={eyebrow} heading={title} body={intro} />

          <div className={toc ? 'mt-14 grid gap-12 lg:mt-20 lg:grid-cols-12' : 'mt-14 lg:mt-20'}>
            {toc ? (
              <nav aria-label="On this page" className="lg:sticky lg:top-8 lg:col-span-3 lg:self-start">
                <Eyebrow className="mb-4">On this page</Eyebrow>
                <ul className="flex flex-col">
                  {blocks.map((block) => (
                    <li key={block.id}>
                      <a
                        href={`#${block.id}`}
                        className="inline-flex py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {block.heading}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}

            <div className={toc ? 'flex flex-col gap-16 lg:col-span-9' : 'flex flex-col gap-16 md:gap-20'}>
              {blocks.map((block) => (
                <section
                  key={block.id}
                  id={block.id}
                  aria-labelledby={`${block.id}-heading`}
                  className="flex scroll-mt-8 flex-col gap-6"
                >
                  <div className="flex max-w-2xl flex-col gap-3">
                    <h2
                      id={`${block.id}-heading`}
                      className="font-display text-2xl leading-tight font-medium tracking-[-0.03em] text-balance text-foreground md:text-3xl"
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
                          className="flex flex-col gap-2 rounded-2xl border border-border bg-card/60 p-5"
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
                </section>
              ))}
              {children}
            </div>
          </div>

          <aside
            aria-label="Open the demo"
            className="grain relative mt-20 flex flex-col gap-5 overflow-hidden rounded-3xl border border-border bg-card/60 p-7 sm:flex-row sm:items-center sm:justify-between sm:p-10"
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

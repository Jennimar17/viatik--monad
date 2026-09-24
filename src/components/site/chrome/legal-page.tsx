import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import type * as React from 'react'

import { buttonVariants } from '@/components/ui/button'
import { footer } from '@/components/site/content/landing-content'
import { Container, SectionIntro } from '@/components/site/chrome/section'
import { ViatikLogo } from '@/components/viatik/viatik-logo'

/**
 * Minimal legal page in the landing's visual language. It has its own bar
 * instead of the landing header, whose links are anchors on the home page.
 */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string
  updated: string
  intro: string
  sections: { heading: string; body: React.ReactNode }[]
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
        <Container className="flex max-w-3xl flex-col gap-12 py-16 md:py-24">
          <div className="flex flex-col gap-4">
            <SectionIntro as="h1" eyebrow="Legal" heading={title} body={intro} />
            <p className="text-sm text-subtle">Last updated {updated}</p>
          </div>
          <div className="flex flex-col gap-10">
            {sections.map((section) => (
              <section key={section.heading} className="flex flex-col gap-3">
                <h2 className="font-display text-xl font-medium tracking-tight text-foreground">
                  {section.heading}
                </h2>
                <div className="flex flex-col gap-3 text-base text-pretty text-muted-foreground">
                  {section.body}
                </div>
              </section>
            ))}
          </div>
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

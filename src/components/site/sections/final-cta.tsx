import Image from 'next/image'
import { ArrowRightIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { WaitlistDialog } from '@/components/site/sections/waitlist-dialog'
import { Container, Section } from '@/components/site/chrome/section'
import { finalCta } from '@/components/site/content/landing-content'
import { siteConfig } from '@/components/site/content/site'

export function FinalCta() {
  return (
    <Section id="waitlist" aria-labelledby="cta-heading">
      <Container>
        <div className="grain relative isolate grid gap-10 overflow-hidden rounded-3xl border border-border p-8 sm:p-12 lg:grid-cols-12 lg:items-center lg:p-16">
          <Image
            src="/images/alpine-landscape.jpg"
            alt=""
            fill
            sizes="(min-width: 1280px) 1216px, 95vw"
            className="object-cover object-bottom saturate-50"
          />
          <div className="absolute inset-0 bg-brand/80" aria-hidden="true" />
          <div className="relative z-10 flex flex-col gap-5 lg:col-span-7">
            <h2
              id="cta-heading"
              className="font-display text-3xl font-medium tracking-[-0.035em] text-balance text-foreground md:text-4xl"
            >
              {finalCta.heading}
            </h2>
            <p className="max-w-xl text-lg text-pretty text-muted-foreground">{finalCta.body}</p>
          </div>
          <div className="relative z-10 flex flex-wrap items-center gap-3 lg:col-span-5 lg:justify-end">
            <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill' })}>
              {finalCta.primary}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </a>
            <WaitlistDialog triggerLabel={finalCta.secondary} />
          </div>
        </div>
      </Container>
    </Section>
  )
}

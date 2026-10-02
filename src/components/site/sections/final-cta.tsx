import Image from 'next/image'
import Link from 'next/link'
import { ArrowRightIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Container, Section } from '@/components/site/chrome/section'
import { finalCta } from '@/components/site/content/landing-content'
import { siteConfig } from '@/components/site/content/site'

/** One action, the demo, plus a direct way into each role inside it. */
export function FinalCta() {
  return (
    <Section id="get-started" aria-labelledby="cta-heading" className="theme-light">
      <Container>
        <div className="theme-dark grain relative isolate grid gap-10 overflow-hidden rounded-3xl border border-border p-8 text-foreground sm:p-12 lg:grid-cols-12 lg:items-center lg:p-16">
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
          <div className="relative z-10 flex flex-col gap-5 lg:col-span-5 lg:items-end">
            <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill' })}>
              {finalCta.primary}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </a>
            <div className="flex flex-col gap-3 lg:items-end">
              <p className="text-sm text-muted-foreground">{finalCta.rolesLabel}</p>
              <ul className="flex flex-wrap gap-2 lg:justify-end">
                {finalCta.roles.map((item) => (
                  <li key={item.role}>
                    <Link
                      href={siteConfig.routes.demoRole(item.role)}
                      className={buttonVariants({ variant: 'outline', size: 'pill-sm' })}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  )
}

import { ArrowDownRightIcon, ArrowRightIcon, ShieldCheckIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { HeroCapitalFlow } from '@/components/site/hero/hero-capital-flow'
import { Container, Eyebrow } from '@/components/site/chrome/section'
import { hero } from '@/components/site/content/landing-content'
import { siteConfig } from '@/components/site/content/site'

export function HeroSection() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-background text-foreground"
    >
      <Container className="grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-12 lg:gap-12 lg:py-12">
        <div className="hero-copy flex flex-col gap-8 lg:col-span-6 lg:py-10">
          <Eyebrow>{hero.eyebrow}</Eyebrow>

          <h1
            id="hero-heading"
            className="font-display text-[clamp(2.9rem,5.2vw,4.625rem)] leading-[1.04] font-medium tracking-[-0.05em] text-balance text-foreground"
          >
            <span className="block">{hero.headline[0]}</span>
            <span className="block text-stone">{hero.headline[1]}</span>
          </h1>

          <p className="max-w-lg text-lg leading-relaxed text-pretty text-muted-foreground">{hero.body}</p>

          <div className="flex flex-wrap items-center gap-3">
            <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill' })}>
              {hero.primaryCta.label}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </a>
            <a
              href={hero.secondaryCta.href}
              className={buttonVariants({ variant: 'secondary', size: 'pill' })}
            >
              {hero.secondaryCta.label}
              <ArrowDownRightIcon data-icon="inline-end" aria-hidden="true" />
            </a>
          </div>

          <div className="flex items-start gap-2.5 text-sm text-subtle">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{hero.supportingLine}</p>
          </div>
        </div>

        <div className="min-w-0 lg:col-span-6">
          <HeroCapitalFlow />
        </div>
      </Container>
      <Container>
        <div className="flex flex-col justify-between gap-4 border-t border-border py-6 text-sm text-subtle sm:flex-row sm:items-center">
          <p>For the people backing what comes next.</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span>Purposeful funding</span>
            <span aria-hidden="true" className="size-1 rounded-full bg-stone/50" />
            <span>Connected operations</span>
            <span aria-hidden="true" className="hidden size-1 rounded-full bg-stone/50 sm:block" />
            <span>Verifiable progress</span>
          </div>
        </div>
      </Container>
    </section>
  )
}

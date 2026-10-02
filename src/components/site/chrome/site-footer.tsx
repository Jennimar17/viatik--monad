import Link from 'next/link'
import type { Route } from 'next'
import { ArrowRightIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Container, Eyebrow } from '@/components/site/chrome/section'
import { SocialIcon } from '@/components/site/chrome/social-icons'
import { StageScene } from '@/components/site/illustrations/scenes'
import { ViatikLogo, ViatikMark } from '@/components/viatik/viatik-logo'
import { closing, footer } from '@/components/site/content/landing-content'
import { footerNav, isPlanned, siteConfig, socials, type FooterItem } from '@/components/site/content/site'

const entryClass = 'inline-flex min-h-11 items-center text-sm text-muted-foreground'
const linkClass = `${entryClass} transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50`

/**
 * The page's closing: one dark block that starts with the final call to
 * action under iridescent light, continues with the site map, and ends on an
 * oversized wordmark cut by the bottom edge.
 */
export function SiteFooter() {
  return (
    <footer className="grain relative isolate overflow-hidden bg-background text-foreground">
      <section
        id="get-started"
        aria-labelledby="cta-heading"
        className="aurora relative border-t border-border"
      >
        <div className="blueprint-lines absolute inset-0" aria-hidden="true" />
        <div
          className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background"
          aria-hidden="true"
        />
        <StageScene
          stage="commit"
          className="absolute top-1/2 left-[5%] hidden h-36 w-48 -translate-y-1/2 opacity-80 lg:block"
        />
        <StageScene
          stage="verify"
          className="absolute top-1/2 right-[5%] hidden h-36 w-48 -translate-y-1/2 opacity-80 lg:block"
        />

        <Container className="relative z-[2] flex flex-col items-center gap-6 py-24 text-center md:py-32">
          <Eyebrow>{closing.eyebrow}</Eyebrow>
          <h2
            id="cta-heading"
            className="max-w-3xl font-display text-4xl leading-[1.04] font-medium tracking-[-0.045em] text-balance md:text-5xl lg:text-6xl"
          >
            {closing.heading}
          </h2>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">{closing.body}</p>
          <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill' })}>
            {closing.primary}
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </a>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-sm text-subtle">{closing.rolesLabel}</span>
            {closing.roles.map((item) => (
              <Link
                key={item.role}
                href={siteConfig.routes.demoRole(item.role)}
                className={buttonVariants({ variant: 'outline', size: 'pill-sm' })}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </Container>
      </section>

      <Container className="relative z-[2]">
        <div className="grid gap-12 border-t border-border py-16 lg:grid-cols-12 lg:gap-8">
          <div className="flex flex-col items-start gap-6 lg:col-span-4">
            <ViatikLogo />
            <p className="max-w-xs text-base text-pretty text-muted-foreground">{siteConfig.statement}</p>
            <p className="flex max-w-xs items-start gap-2.5 rounded-xl border border-border bg-card/40 px-3.5 py-2.5 text-xs text-subtle">
              <ViatikMark className="mt-px size-4" />
              {footer.hackathon}
            </p>
            <ul aria-label="Social profiles" className="flex gap-2">
              {socials.map((social) => (
                <li key={social.network}>
                  <span
                    role="img"
                    aria-label={social.label}
                    title={social.label}
                    className="flex size-10 items-center justify-center rounded-full border border-border text-muted-foreground"
                  >
                    <SocialIcon network={social.network} className="size-4" />
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:col-span-8 lg:grid-cols-5"
          >
            {footerNav.map((group) => (
              <div key={group.heading} className="flex flex-col gap-3">
                <h3 className="text-xs font-medium tracking-[0.08em] text-subtle uppercase">
                  {group.heading}
                </h3>
                <ul className="flex flex-col">
                  {group.items.map((item) => (
                    <li key={item.label}>
                      <FooterEntry item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="flex flex-col gap-3 border-t border-border py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>{footer.copyright}</p>
          <p className="flex items-center gap-2">
            <ViatikMark className="size-5" />
            {footer.builtOn}
          </p>
        </div>
      </Container>

      <div aria-hidden="true" className="pointer-events-none relative overflow-hidden select-none">
        <p className="wordmark-iri -mb-[0.2em] text-center font-display text-[clamp(6rem,26vw,24rem)] leading-[0.9] font-medium tracking-[-0.065em]">
          Viatik
        </p>
      </div>
    </footer>
  )
}

/** Live entries go to their anchor or route; planned pages read like links but cannot be followed. */
function FooterEntry({ item }: { item: FooterItem }) {
  if (isPlanned(item)) {
    return (
      <span aria-disabled="true" className={`${entryClass} cursor-default`}>
        {item.label}
      </span>
    )
  }

  if (item.href.startsWith('#')) {
    return (
      <a href={item.href} className={linkClass}>
        {item.label}
      </a>
    )
  }

  return (
    <Link href={item.href as Route} className={linkClass}>
      {item.label}
    </Link>
  )
}

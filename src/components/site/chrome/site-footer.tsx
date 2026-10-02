import Link from 'next/link'
import type { Route } from 'next'
import { ArrowRightIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Container } from '@/components/site/chrome/section'
import { ViatikLogo, ViatikMark } from '@/components/viatik/viatik-logo'
import { footer } from '@/components/site/content/landing-content'
import { footerNav, isPlanned, siteConfig, type FooterItem } from '@/components/site/content/site'

const linkClass =
  'inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Container className="grid gap-12 py-16 lg:grid-cols-12 lg:gap-8">
        <div className="flex flex-col items-start gap-5 lg:col-span-3">
          <ViatikLogo />
          <p className="max-w-xs text-base text-pretty text-muted-foreground">{siteConfig.statement}</p>
          <p className="flex items-start gap-2 rounded-xl border border-border px-3 py-2 text-xs text-subtle">
            <ViatikMark className="mt-px size-4" />
            {footer.hackathon}
          </p>
          <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill-sm' })}>
            Open the demo
            <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
          </a>
        </div>

        <nav
          aria-label="Footer"
          className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:col-span-9 lg:grid-cols-5"
        >
          {footerNav.map((group) => (
            <div key={group.heading} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-[0.08em] text-subtle uppercase">{group.heading}</h3>
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
      </Container>

      <div className="border-t border-border">
        <Container className="flex flex-col gap-3 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>{footer.copyright}</p>
          <a
            href="https://unsplash.com/license"
            target="_blank"
            rel="noopener noreferrer"
            className="w-fit underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            Photography via Unsplash · License
          </a>
          <p className="flex items-center gap-2">
            <ViatikMark className="size-5" />
            {footer.builtOn}
          </p>
        </Container>
      </div>
    </footer>
  )
}

/** Live links go to their anchor or route; planned pages show as text marked "Soon". */
function FooterEntry({ item }: { item: FooterItem }) {
  if (isPlanned(item)) {
    return (
      <span className="block py-2.5 text-sm text-subtle">
        {item.label}
        <span className="ml-1.5 inline-block rounded-full border border-border px-1.5 align-[0.1em] text-[0.625rem] leading-4 tracking-[0.1em] uppercase">
          {footer.planned}
        </span>
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

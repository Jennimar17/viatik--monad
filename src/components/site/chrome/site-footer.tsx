import Link from 'next/link'
import type { Route } from 'next'

import { Container } from '@/components/site/chrome/section'
import { ViatikLogo, ViatikMark } from '@/components/viatik/viatik-logo'
import { footer } from '@/components/site/content/landing-content'
import { footerNav, siteConfig } from '@/components/site/content/site'

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <Container className="grid gap-12 py-16 lg:grid-cols-12 lg:gap-8">
        <div className="flex flex-col gap-4 lg:col-span-4">
          <ViatikLogo />
          <p className="max-w-xs text-base text-pretty text-muted-foreground">{siteConfig.statement}</p>
        </div>

        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4 lg:col-span-8">
          {footerNav.map((group) => (
            <div key={group.heading} className="flex flex-col gap-3">
              <h3 className="text-xs font-medium tracking-[0.08em] text-subtle uppercase">{group.heading}</h3>
              <ul className="flex flex-col">
                {group.items.map((item) => {
                  const className =
                    'inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
                  return (
                    <li key={item.label}>
                      {item.href.startsWith('#') ? (
                        <a href={item.href} className={className}>
                          {item.label}
                        </a>
                      ) : (
                        <Link href={item.href as Route} className={className}>
                          {item.label}
                        </Link>
                      )}
                    </li>
                  )
                })}
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

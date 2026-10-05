'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

import { buttonVariants } from '@/components/ui/button'
import { MobileNavigation } from '@/components/site/chrome/mobile-navigation'
import { Container } from '@/components/site/chrome/section'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { primaryNav, siteConfig } from '@/components/site/content/site'

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b transition-colors duration-300',
        scrolled
          ? 'border-border bg-background/85 backdrop-blur-2xl'
          : 'border-transparent bg-background/80 backdrop-blur-lg',
      )}
    >
      <Container className="flex h-20 items-center justify-between gap-4 lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <ViatikLogo />

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="inline-flex min-h-11 items-center rounded-full px-4 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center justify-end gap-2">
          <a
            href={siteConfig.routes.signIn}
            className={cn(buttonVariants({ variant: 'ghost', size: 'pill-sm' }), 'hidden sm:inline-flex')}
          >
            Sign in
          </a>
          <a href={siteConfig.routes.demo} className={buttonVariants({ size: 'pill-sm' })}>
            Open demo
          </a>
          <MobileNavigation />
        </div>
      </Container>
    </header>
  )
}

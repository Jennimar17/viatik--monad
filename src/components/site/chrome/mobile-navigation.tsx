'use client'

import { useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { MenuIcon, XIcon } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { Container } from '@/components/site/chrome/section'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { primaryNav, siteConfig } from '@/components/site/content/site'

/**
 * Full-width top sheet for small screens. The dialog primitive supplies the
 * focus trap, Escape handling and focus return; anchors close the sheet before
 * the browser scrolls.
 */
export function MobileNavigation() {
  const [open, setOpen] = useState(false)

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        render={<Button variant="ghost" size="icon-pill" className="lg:hidden" />}
        aria-label="Open menu"
      >
        <MenuIcon aria-hidden="true" className="size-5" />
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/70 duration-200 lg:hidden data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup
          aria-label="Site menu"
          className="fixed inset-x-0 top-0 z-50 max-h-svh overflow-y-auto border-b border-border bg-background pb-6 duration-200 outline-none lg:hidden data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top-2"
        >
          <Dialog.Title className="sr-only">Viatik navigation</Dialog.Title>
          <Container className="flex h-20 items-center justify-between">
            <ViatikLogo href="" />
            <Dialog.Close render={<Button variant="ghost" size="icon-pill" />} aria-label="Close menu">
              <XIcon aria-hidden="true" className="size-5" />
            </Dialog.Close>
          </Container>

          <Container className="flex flex-col gap-6 pt-2">
            <nav aria-label="Primary">
              <ul className="flex flex-col divide-y divide-border border-y border-border">
                {primaryNav.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-14 items-center justify-between font-display text-xl font-medium text-foreground transition-colors hover:text-violet focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="flex flex-col gap-3">
              <a
                href={siteConfig.routes.demo}
                onClick={() => setOpen(false)}
                className={buttonVariants({ size: 'pill' })}
              >
                Open demo
              </a>
              <a
                href="#waitlist"
                onClick={() => setOpen(false)}
                className={buttonVariants({ variant: 'secondary', size: 'pill' })}
              >
                Get early access
              </a>
            </div>
          </Container>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

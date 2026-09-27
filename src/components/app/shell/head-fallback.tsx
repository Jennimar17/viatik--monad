'use client'

import { usePathname } from 'next/navigation'
import * as React from 'react'

import { sectionFor } from '../nav'
import { useRole } from '../role-context'

const VIEWPORT = 'width=device-width, initial-scale=1'

/**
 * Keeps the tab title and the viewport tag after client navigations. With
 * Next 16.3.6 the new screen can commit without its metadata (vercel/next.js#98684):
 * the title empties and phones fall back to a desktop viewport. This restores
 * both from the navigation map until the fix ships; it never overrides a title
 * Next did render.
 */
export function HeadFallback() {
  const pathname = usePathname()
  const { role, base } = useRole()

  React.useEffect(() => {
    const relative = pathname.startsWith(base) ? pathname.slice(base.length + 1) : ''
    const section = sectionFor(role, relative)
    const title = `${section?.label ?? 'Viatik'} · Viatik`
    // The metadata stream may still land shortly after the commit; wait one tick before filling in.
    const timer = window.setTimeout(() => {
      if (!document.title) document.title = title
      if (!document.querySelector('meta[name="viewport"]')) {
        const meta = document.createElement('meta')
        meta.name = 'viewport'
        meta.content = VIEWPORT
        document.head.appendChild(meta)
      }
    }, 150)
    return () => window.clearTimeout(timer)
  }, [pathname, base, role])

  return null
}

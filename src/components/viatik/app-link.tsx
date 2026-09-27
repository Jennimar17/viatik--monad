'use client'

import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import type * as React from 'react'

/**
 * In-app link: a plain anchor that navigates through the router.
 *
 * With Next 16.3.6, a click on `next/link` commits the new screen without its
 * metadata: the title and the viewport tag disappear from `<head>` until a
 * full reload (vercel/next.js#98684, fixed in canary). `router.push` keeps
 * them, so product screens link with this component until the fix ships in a
 * stable release; the landing keeps `next/link`. Modified clicks and new-tab
 * targets fall through to the browser.
 */
export function AppLink({
  href,
  replace = false,
  scroll = true,
  onClick,
  target,
  ...props
}: Omit<React.ComponentProps<'a'>, 'href'> & { href: Route; replace?: boolean; scroll?: boolean }) {
  const router = useRouter()
  return (
    <a
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        if (target && target !== '_self') return
        event.preventDefault()
        if (replace) router.replace(href, { scroll })
        else router.push(href, { scroll })
      }}
      {...props}
    />
  )
}

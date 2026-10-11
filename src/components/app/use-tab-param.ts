'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import * as React from 'react'

/**
 * Query-string state for screens that can be deep linked: which tab is open
 * (`?tab=`) and whether a sheet is open (`?new=monthly`). Links, banners and
 * notifications point straight at it, e.g. href(`agencies/${id}?tab=accountability`).
 *
 * Both hooks read `useSearchParams`, which needs a Suspense boundary for the
 * static prerender (Next 16 fails the production build without one). Wrap the
 * page the way accounts/transfer/page.tsx does:
 *
 *   export default function BillsPage() {
 *     // useSearchParams needs a boundary for the static prerender.
 *     return (
 *       <React.Suspense>
 *         <Bills />
 *       </React.Suspense>
 *     )
 *   }
 *
 * The URL is updated with `window.history.replaceState`, which Next keeps in
 * sync with `useSearchParams` without a navigation: switching tabs adds no
 * history entry, refetches nothing and keeps the scroll position.
 */

/** The current URL with `name` set to `value` (or removed when null), keeping every other parameter. */
function withParam(pathname: string, search: string, name: string, value: string | null): string {
  const params = new URLSearchParams(search)
  if (value === null) params.delete(name)
  else params.set(name, value)
  const query = params.toString()
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  return `${pathname}${query ? `?${query}` : ''}${hash}`
}

/**
 * One query parameter as state: follows the URL when it changes (a link to
 * the same page with another value), and answers a change right away while
 * the URL catches up.
 */
function useParamState(name: string): [string | null, (value: string | null) => void] {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const fromUrl = searchParams.get(name)
  const [state, setState] = React.useState<{ url: string | null; local: string | null | undefined }>({
    url: fromUrl,
    local: undefined,
  })
  // The URL moved (our own update landing, or a link): it wins again.
  if (state.url !== fromUrl) setState({ url: fromUrl, local: undefined })
  const value = state.local !== undefined ? state.local : fromUrl

  const search = searchParams.toString()
  const set = React.useCallback(
    (next: string | null) => {
      setState((current) => ({ ...current, local: next }))
      window.history.replaceState(null, '', withParam(pathname, search, name, next))
    },
    [pathname, search, name],
  )
  return [value, set]
}

/**
 * Controlled PageTabs state synced with `?tab=` (or `param`). Spread it into
 * PageTabs: `<PageTabs tabs={tabs} {...useTabParam(values, 'overview')} />`.
 *
 * - `values`: the tabs this screen renders now; an unknown or hidden `?tab=` falls back.
 * - `fallback`: the tab to open without a valid `?tab=`. It is read once, when the
 *   screen mounts, so the open tab does not jump when the data behind it changes
 *   (e.g. Payments opens "To justify" while something is pending, and stays there
 *   after the last receipt is added).
 */
export function useTabParam(
  values: readonly string[],
  fallback: string,
  param = 'tab',
): { value: string; onValueChange: (value: string) => void } {
  const [fromUrl, setParam] = useParamState(param)
  const [initial] = React.useState(fallback)
  const value =
    fromUrl !== null && values.includes(fromUrl)
      ? fromUrl
      : values.includes(initial)
        ? initial
        : values.includes(fallback)
          ? fallback
          : (values[0] ?? fallback)
  const onValueChange = React.useCallback((next: string) => setParam(next), [setParam])
  return { value, onValueChange }
}

/**
 * A sheet that a link can open: open while `?{param}={value}` is in the URL.
 * Closing it removes the parameter, so a reload does not open it again.
 *
 *   const [creating, setCreating] = useOpenParam('new', 'monthly')
 *   <Button onClick={() => setCreating(true)}>New monthly payment</Button>
 *   <NewReminderSheet open={creating} onOpenChange={setCreating} />
 */
export function useOpenParam(param: string, value: string): [boolean, (open: boolean) => void] {
  const [current, setParam] = useParamState(param)
  const setOpen = React.useCallback((open: boolean) => setParam(open ? value : null), [setParam, value])
  return [current === value, setOpen]
}

import NextLink from 'next/link'
import type * as React from 'react'

/**
 * `next/link` without prefetching, for every screen inside the product.
 *
 * Product routes are fully dynamic, so in production builds every visible
 * link keeps fetching `?_rsc` route trees that the client then aborts
 * (Next 16.3.6): wasted requests on every screen for no faster navigation.
 * Navigations fetch on click and show the section skeleton meanwhile. The
 * landing keeps `next/link` as is.
 */
export default function Link(props: React.ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={false} {...props} />
}

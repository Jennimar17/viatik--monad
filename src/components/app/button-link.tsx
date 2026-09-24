import type { Route } from 'next'
import Link from 'next/link'
import type * as React from 'react'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type Variants = NonNullable<Parameters<typeof buttonVariants>[0]>

/** A link that looks like a button (pill sizes included), as the landing renders its CTAs. */
export function ButtonLink({
  href,
  variant,
  size,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, 'className' | 'href'> & {
  href: Route
  variant?: Variants['variant']
  size?: Variants['size']
  className?: string
}) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {children}
    </Link>
  )
}

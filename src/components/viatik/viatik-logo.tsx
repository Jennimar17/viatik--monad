import Image from 'next/image'
import Link from 'next/link'

import { cn } from '@/lib/utils'

type MarkProps = {
  className?: string
  /** `light` is the mist artwork for dark surfaces; `dark` is plum for paper. */
  tone?: 'light' | 'dark'
}

/** The supplied mark is kept intact; only the export's empty canvas is cropped. */
export function ViatikMark({ className, tone = 'light' }: MarkProps) {
  return (
    <Image
      src={`/brand/viatik-mark-${tone}.svg`}
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      loading="eager"
      className={cn('size-8 shrink-0', className)}
    />
  )
}

type LogoProps = {
  className?: string
  /** Wraps the logo in a link home. An empty string renders a static logo. */
  href?: '/' | ''
  tone?: 'light' | 'dark'
}

export function ViatikLogo({ className, href = '/', tone = 'light' }: LogoProps) {
  const content = (
    <Image
      src={`/brand/viatik-wordmark-${tone}.svg`}
      alt="Viatik"
      width={118}
      height={40}
      // The wordmark usually sits in the header, above the fold.
      loading="eager"
      className="h-10 w-auto"
    />
  )
  const classes = cn(
    'inline-flex min-h-11 w-fit shrink-0 items-center rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
    className,
  )

  if (!href) return <span className={classes}>{content}</span>

  return (
    <Link href={href} aria-label="Viatik home" className={classes}>
      {content}
    </Link>
  )
}

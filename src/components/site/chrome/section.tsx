import type * as React from 'react'
import { cn } from '@/lib/utils'

export function Container({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-page px-5 sm:px-8', className)} {...props} />
}

export function Section({ className, ...props }: React.ComponentProps<'section'>) {
  return <section data-reveal className={cn('py-20 md:py-28', className)} {...props} />
}

export function Eyebrow({ className, children, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase',
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-violet" />
      {children}
    </p>
  )
}

type HeadingLevel = 'h1' | 'h2' | 'h3'

export function SectionHeading({
  as: Tag = 'h2',
  className,
  ...props
}: React.ComponentProps<'h2'> & { as?: HeadingLevel }) {
  return (
    <Tag
      className={cn(
        'font-display text-3xl leading-[1.12] font-medium tracking-[-0.035em] text-balance text-foreground md:text-4xl lg:text-[2.875rem]',
        className,
      )}
      {...props}
    />
  )
}

export function Lede({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-base text-pretty text-muted-foreground md:text-lg', className)} {...props} />
}

/** Copy stack used at the top of most sections: eyebrow, heading, lede. */
export function SectionIntro({
  eyebrow,
  heading,
  body,
  as,
  className,
  headingClassName,
  align = 'left',
}: {
  eyebrow?: string
  heading: React.ReactNode
  body?: React.ReactNode
  as?: HeadingLevel
  className?: string
  headingClassName?: string
  align?: 'left' | 'center'
}) {
  return (
    <div
      className={cn(
        'flex max-w-2xl flex-col gap-5',
        align === 'center' && 'items-center text-center',
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <SectionHeading as={as} className={headingClassName}>
        {heading}
      </SectionHeading>
      {body ? <Lede>{body}</Lede> : null}
    </div>
  )
}

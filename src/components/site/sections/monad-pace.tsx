import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

import { monad } from '@/components/site/content/landing-content'

/**
 * Monad's speed in plain terms: one line a payment crosses in 0.8 s, then
 * three figures. The motion is CSS only and holds at its end state for people
 * who prefer reduced motion.
 */
export function MonadPace({ className }: { className?: string }) {
  const { pace } = monad
  return (
    <div className={cn('theme-dark product-frame grain flex flex-col gap-8 p-6 sm:p-8', className)}>
      <div className="flex flex-col gap-1.5">
        <p className="font-display text-xl font-medium text-foreground">{pace.title}</p>
        <p className="text-sm text-pretty text-muted-foreground">{pace.body}</p>
      </div>

      <div className="flex flex-col gap-3" aria-hidden="true">
        <div className="flex items-center justify-between text-xs text-subtle">
          <span>{pace.from}</span>
          <span className="pace-final inline-flex items-center gap-1.5 text-foreground">
            <span className="flex size-4 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckIcon className="size-3" />
            </span>
            {pace.to}
          </span>
        </div>
        <div className="relative mx-1.5 h-px bg-mist/15">
          <span
            className="pace-fill absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(90deg, var(--iri-periwinkle), var(--iri-lilac), var(--iri-mint))',
            }}
          />
          <span className="pace-dot absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mist shadow-[0_0_16px_var(--iri-lilac)]" />
        </div>
        <p className="text-center font-mono text-xs text-muted-foreground num">{pace.duration}</p>
      </div>

      <dl className="grid grid-cols-3 gap-4 border-t border-border pt-6">
        {pace.stats.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <dt className="order-2 text-xs text-pretty text-subtle">{stat.label}</dt>
            <dd className="font-display text-2xl font-medium tracking-[-0.02em] text-foreground num sm:text-3xl">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-auto text-xs text-subtle">{pace.note}</p>
    </div>
  )
}

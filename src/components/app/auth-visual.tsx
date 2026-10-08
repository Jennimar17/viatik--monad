import { CheckIcon, ShieldCheckIcon, ZapIcon } from 'lucide-react'
import type { CSSProperties } from 'react'

import { capital, story } from '@/components/site/content/product-demo'
import { Amount } from '@/components/viatik/amount'
import { cn } from '@/lib/utils'

const frame = 'theme-dark product-frame product-frame-glass'

/** One floating popup: the wrapper drifts, the card inside arrives. */
function Float({
  className,
  delay,
  slow,
  children,
}: {
  className?: string
  delay: number
  slow?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('absolute', slow ? 'quiet-orbit' : 'gentle-float', className)}>
      <div className="hero-step" style={{ animationDelay: `${delay}ms` } as CSSProperties}>
        {children}
      </div>
    </div>
  )
}

/**
 * Small popups scattered over the sign-in photograph. Lighter than the
 * landing hero: no stacked flow, just glimpses of the product at work.
 */
export function AuthVisual({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn('relative min-h-[28rem] w-full', className)}>
      <Float delay={200} className="top-0 right-0">
        <div className={cn(frame, 'flex items-center gap-2.5 rounded-full py-2 pr-4 pl-2')}>
          <span className="flex size-7 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckIcon className="size-3.5" />
          </span>
          <span className="text-xs text-foreground">Milestone approved</span>
          <Amount value={capital.tranche} size="sm" signed tone="positive" />
        </div>
      </Float>

      <Float delay={360} slow className="top-24 left-0">
        <div className={cn(frame, 'flex w-56 flex-col gap-3 rounded-2xl p-4')}>
          <p className="text-xs text-subtle">Capital released</p>
          <Amount value={capital.released} size="lg" />
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cn('h-1 flex-1 rounded-full', i < 2 ? 'bg-mist' : 'bg-mist/20')} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Tranche 2 of 4 · {story.agency}</p>
        </div>
      </Float>

      <Float delay={520} className="top-64 right-0">
        <div className={cn(frame, 'flex w-60 items-center gap-3 rounded-2xl p-3')}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-mist/10 text-mist">
            <ShieldCheckIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-2xs text-subtle">Payment verified</p>
            <p className="truncate text-sm font-medium text-foreground">{story.vendor}</p>
          </div>
          <Amount value={capital.payment} size="sm" />
        </div>
      </Float>

      <Float delay={680} slow className="bottom-2 left-10">
        <div className={cn(frame, 'flex items-center gap-2 rounded-full px-3.5 py-2')}>
          <ZapIcon className="size-3.5 text-success" />
          <span className="text-xs text-foreground">Final on Monad in 0.8s</span>
        </div>
      </Float>
    </div>
  )
}

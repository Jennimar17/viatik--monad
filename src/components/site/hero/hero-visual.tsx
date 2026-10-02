import Image from 'next/image'
import type { CSSProperties, ReactNode } from 'react'
import { CheckIcon, ShieldCheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

import { Amount } from '@/components/viatik/amount'
import { FundingProgress } from '@/components/viatik/finance'
import { StatusBadge } from '@/components/viatik/status'
import { ViatikMark } from '@/components/viatik/viatik-logo'
import { formatUsd } from '@/domain/money'
import { capital, story, tranches } from '@/components/site/content/product-demo'

/**
 * The hero's visual: the brand landscape with the same grain and shade as the
 * sign-in page, and three real product surfaces on glass read top to bottom
 * as one flow (milestone approved, capital released, payment verified). Cards
 * never overlap; dashed connectors carry the eye from one step to the next.
 */
export function HeroVisual({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'grain relative isolate flex min-h-[32rem] flex-col justify-center overflow-hidden rounded-3xl border border-mist/15 bg-brand',
        className,
      )}
    >
      <Image
        src="/images/alpine-landscape.jpg"
        alt=""
        fill
        preload
        sizes="(min-width: 1280px) 580px, (min-width: 1024px) 46vw, 100vw"
        className="object-cover object-[60%_center]"
      />
      <div className="hero-scene-shade absolute inset-0" aria-hidden="true" />

      <ol
        aria-label="Capital moving from an approved milestone to a verified payment"
        className="relative z-[2] flex flex-col px-4 py-8 sm:px-8 sm:py-10"
      >
        <Step index={0} className="ml-auto w-full max-w-xs">
          <div className="theme-dark product-frame product-frame-glass flex items-center gap-3 rounded-2xl p-3.5 pr-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <CheckIcon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-subtle">Milestone approved</p>
              <p className="truncate text-sm font-medium text-foreground">Prototype delivered</p>
            </div>
            <Amount value={capital.tranche} size="md" signed tone="positive" />
          </div>
        </Step>

        <Step index={1} connector="ml-[72%]">
          <div className="theme-dark product-frame product-frame-glass flex flex-col gap-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <ViatikMark className="size-8" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{story.agency}</p>
                  <p className="text-xs text-pretty text-subtle">
                    {story.agreement} · {story.investor}
                  </p>
                </div>
              </div>
              <StatusBadge status={{ label: 'Tranche 2 of 4', tone: 'success' }} />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-subtle">Capital released</p>
              <Amount value={capital.released} size="xl" />
              <p className="text-xs text-muted-foreground">
                of <span className="num">{formatUsd(capital.committed)}</span> committed
              </p>
            </div>
            <FundingProgress segments={tranches} />
          </div>
        </Step>

        <Step index={2} connector="ml-[24%]" className="w-full max-w-sm">
          <div className="theme-dark product-frame product-frame-glass flex items-center gap-3 rounded-2xl p-3.5 pr-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mist/10 text-mist">
              <ShieldCheckIcon className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-subtle">Payment complete</p>
              <p className="truncate text-sm font-medium text-foreground">{story.vendor}</p>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <Amount value={capital.payment} size="sm" />
              <span className="text-2xs whitespace-nowrap text-success">Verified on Monad</span>
            </div>
          </div>
        </Step>
      </ol>
    </div>
  )
}

function Step({
  index,
  connector,
  className,
  children,
}: {
  index: number
  /** Horizontal position of the dashed connector above this step. */
  connector?: string
  className?: string
  children: ReactNode
}) {
  return (
    <li
      className={cn('hero-step relative', connector && 'pt-7', className)}
      style={{ animationDelay: `${180 + index * 160}ms` } as CSSProperties}
    >
      {connector ? (
        <span
          aria-hidden="true"
          className={cn('absolute top-0 block h-7 border-l border-dashed border-mist/35', connector)}
        />
      ) : null}
      {children}
    </li>
  )
}

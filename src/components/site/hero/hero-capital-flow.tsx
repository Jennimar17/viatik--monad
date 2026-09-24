import Image from 'next/image'
import { cn } from '@/lib/utils'
import { ArrowDownLeftIcon, CheckIcon, ShieldCheckIcon } from 'lucide-react'

import { CapitalChart } from '@/components/site/previews/capital-chart'
import { PreviewLabel, StatusChip } from '@/components/site/previews/primitives'
import { ViatikMark } from '@/components/viatik/viatik-logo'
import { heroDemo } from '@/components/site/content/demo-data'

/**
 * Three connected interface states — agreement, released budget, completed
 * payment — keep the capital story readable even with motion disabled.
 */
export function HeroCapitalFlow({ className }: { className?: string }) {
  return (
    <div className={cn('relative isolate overflow-hidden rounded-3xl border border-mist/15', className)}>
      <Image
        src="/images/alpine-landscape.jpg"
        alt="Sunlit alpine peaks rising above a quiet mountain landscape"
        fill
        preload
        sizes="(min-width: 1280px) 580px, (min-width: 1024px) 46vw, (min-width: 640px) 90vw, 100vw"
        className="object-cover object-[60%_center] saturate-50"
      />
      <div className="hero-scene-shade absolute inset-0" aria-hidden="true" />

      <div className="relative z-10 px-4 py-6 sm:px-7">
        <div className="flex items-center justify-between gap-4 text-sm text-mist">
          <span>A clearer path for capital.</span>
        </div>

        <ol
          className="grid grid-cols-12 pt-8 sm:pt-12"
          aria-label="Capital moving from commitment to completed payment"
        >
          <li className="hero-account-card col-span-12 sm:col-span-11 sm:col-start-2">
            <div className="gentle-float">
              <AgreementPanel />
            </div>
          </li>
          <li className="hero-release-card z-10 col-span-11 col-start-1 -mt-3 sm:col-span-9 sm:-mt-2">
            <BudgetPanel />
          </li>
          <li className="quiet-orbit col-span-11 col-start-2 mt-4 sm:col-span-9 sm:col-start-4">
            <PaymentPanel />
          </li>
        </ol>

        <p className="pt-5 text-center text-sm text-mist/80">Illustrative product preview · USD</p>
      </div>
    </div>
  )
}

function AgreementPanel() {
  return (
    <div className="theme-light glass-panel grain rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ViatikMark tone="dark" className="size-7" />
          <span className="text-sm font-medium">Capital overview</span>
        </div>
        <span className="text-sm text-subtle">USD</span>
      </div>
      <div className="pt-4">
        <PreviewLabel>Capital released</PreviewLabel>
        <p className="pt-1 font-display text-4xl font-medium tracking-[-0.04em] num">${heroDemo.released}</p>
        <p className="pt-1 text-sm text-muted-foreground">of ${heroDemo.committed} committed</p>
      </div>
      <CapitalChart compact className="pt-3" />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-sm font-medium">{heroDemo.agency}</span>
        <StatusChip status={{ label: heroDemo.tranche.label, tone: 'success' }} />
      </div>
    </div>
  )
}

function BudgetPanel() {
  return (
    <div className="theme-light glass-panel flex items-center gap-3 rounded-2xl p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sage/35 text-brand">
        <ArrowDownLeftIcon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted-foreground">Milestone approved</p>
        <p className="text-xl font-medium tracking-tight num">+${heroDemo.tranche.amount}</p>
      </div>
      <CheckIcon className="size-5 shrink-0 text-success" aria-hidden="true" />
    </div>
  )
}

function PaymentPanel() {
  return (
    <div className="glass-panel flex items-center gap-3 rounded-2xl p-4">
      <ShieldCheckIcon className="size-6 shrink-0 text-sage" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">Payment complete · ${heroDemo.payment}</p>
        <p className="text-sm text-mist/75">Receipt verified on {heroDemo.network}</p>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

import { StatusBadge } from '@/components/viatik/status'
import { monad } from '@/components/site/content/landing-content'

const BLOCK_MS = 400
const VISIBLE = 9
const STEP = 76
const START = 18_402_110
/** A tranche release lands in every fifth block, so one is nearly always in view. */
const TRANCHE_EVERY = 5
/** Monad finality: two blocks, 800 ms. */
const FINAL_AFTER = 2

const format = (n: number) => n.toLocaleString('en-US')

/**
 * Monad's pace made visible: blocks arrive every 400 ms and a tranche release
 * reaches finality two blocks after it lands. The stream is simulated at the
 * network's published pace, runs only while on screen, and holds still for
 * people who prefer reduced motion.
 */
export function MonadSpeed({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(START)
  const [running, setRunning] = useState(false)
  const [throughput, setThroughput] = useState(10_000)

  useEffect(() => {
    const root = rootRef.current
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!root || reduced.matches || !('IntersectionObserver' in window)) return

    let counted = false
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting)
        setRunning(visible)
        if (visible && !counted) {
          counted = true
          countUp(setThroughput)
        }
      },
      { threshold: 0.25 },
    )
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setHeight((h) => h + 1), BLOCK_MS)
    return () => window.clearInterval(timer)
  }, [running])

  const blocks = Array.from({ length: VISIBLE }, (_, i) => height - (VISIBLE - 1) + i)
  const lastTranche = height - (height % TRANCHE_EVERY)
  const confirmations = height - lastTranche
  const final = confirmations >= FINAL_AFTER

  return (
    <div
      ref={rootRef}
      className={cn('theme-dark product-frame grain flex flex-col gap-6 p-5 sm:p-7', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">{monad.speed.title}</p>
          <p className="text-xs text-subtle">{monad.speed.caption}</p>
        </div>
        <span className="font-mono text-xs text-muted-foreground num" aria-hidden="true">
          #{format(height)}
        </span>
      </div>

      <div
        aria-hidden="true"
        className="relative h-24 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_18%,#000_100%)]"
      >
        {blocks.map((block, index) => (
          <div
            key={block}
            className={cn(
              'block-tile absolute top-1 right-0 flex flex-col items-center gap-2',
              index === VISIBLE - 1 && 'animate-in duration-300 fade-in-0 zoom-in-90',
            )}
            style={{ transform: `translateX(-${(VISIBLE - 1 - index) * STEP}px)` }}
          >
            <BlockTile block={block} />
            <span className="font-mono text-2xs text-subtle num">…{String(block).slice(-4)}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium text-foreground">{monad.speed.tranche}</p>
          <p className="text-xs text-subtle num">
            Block #{format(lastTranche)} ·{' '}
            {final ? 'final in 0.8 s' : `${confirmations} of ${FINAL_AFTER} blocks`}
          </p>
        </div>
        <StatusBadge
          status={final ? { label: 'Finalized', tone: 'success' } : { label: 'Finalizing', tone: 'warning' }}
          pulse={!final}
        />
      </div>

      <dl className="hairline-grid grid-cols-2 overflow-hidden rounded-xl sm:grid-cols-4">
        {monad.speed.stats.map((stat, index) => (
          <div key={stat.label} className="flex flex-col gap-1 p-4">
            <dt className="order-2 text-xs text-subtle">{stat.label}</dt>
            <dd className="font-display text-2xl font-medium tracking-[-0.02em] text-foreground num">
              {index === 0 ? format(throughput) : stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-subtle">{monad.speed.note}</p>
    </div>
  )
}

function BlockTile({ block }: { block: number }) {
  const tranche = block % TRANCHE_EVERY === 0
  const filled = 3 + ((block * 7) % 6)
  return (
    <span
      className={cn(
        'grid size-16 grid-cols-3 content-center justify-items-center gap-1.5 rounded-xl border p-3',
        tranche ? 'border-transparent' : 'border-border bg-surface',
      )}
      style={
        tranche
          ? {
              backgroundImage:
                'linear-gradient(135deg, var(--iri-periwinkle), var(--iri-lilac) 45%, var(--iri-rose) 70%, var(--iri-mint))',
            }
          : undefined
      }
    >
      {Array.from({ length: 9 }, (_, dot) => (
        <span
          key={dot}
          className={cn(
            'size-1.5 rounded-[1px]',
            tranche ? 'bg-brand/70' : dot < filled ? 'bg-mist/70' : 'bg-mist/15',
          )}
        />
      ))}
    </span>
  )
}

/** Counts the throughput figure up from zero once, the first time it is seen. */
function countUp(set: (value: number) => void) {
  const target = 10_000
  const duration = 1200
  const start = performance.now()
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration)
    set(Math.round(target * (1 - Math.pow(1 - t, 3))))
    if (t < 1) requestAnimationFrame(tick)
  }
  set(0)
  requestAnimationFrame(tick)
}

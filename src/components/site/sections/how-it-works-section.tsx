'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

import { Container, Eyebrow, Lede, Section } from '@/components/site/chrome/section'
import { StageScene } from '@/components/site/illustrations/scenes'
import { howItWorks } from '@/components/site/content/landing-content'

const STAGES = howItWorks.stages
const DESKTOP = '(min-width: 1024px)'

/**
 * The problem statement and the five-stage answer in one section. Horizontal
 * journey on desktop, vertical on mobile. The active stage follows the
 * reader's scroll position; every stage stays fully legible regardless.
 */
export function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null)
  const stageRefs = useRef<(HTMLLIElement | null)[]>([])
  const [active, setActive] = useState(0)

  useEffect(() => {
    let frame = 0

    const measure = () => {
      frame = 0
      const section = sectionRef.current
      if (!section) return
      const vh = window.innerHeight
      const focal = vh * 0.55
      let next = 0

      if (window.matchMedia(DESKTOP).matches) {
        // Progress as the section travels from 80% of the viewport height to 25%.
        const rect = section.getBoundingClientRect()
        const start = vh * 0.8
        const end = vh * 0.25
        const progress = (start - rect.top) / (rect.height - end + start)
        next = Math.floor(Math.min(Math.max(progress, 0), 0.9999) * STAGES.length)
      } else {
        stageRefs.current.forEach((el, index) => {
          if (el && el.getBoundingClientRect().top < focal) next = index
        })
      }

      setActive((current) => (current === next ? current : next))
    }

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <Section
      id="how-it-works"
      ref={sectionRef}
      aria-labelledby="flow-heading"
      className="theme-light pt-0 md:pt-0"
    >
      <Container>
        <div className="grid items-end gap-8 border-t border-border pt-16 md:pt-20 lg:grid-cols-12">
          <div className="flex flex-col gap-5 lg:col-span-7">
            <Eyebrow>{howItWorks.eyebrow}</Eyebrow>
            <h2
              id="flow-heading"
              className="font-display text-3xl leading-[1.14] font-medium tracking-[-0.035em] text-balance text-foreground md:text-4xl"
            >
              <span className="block">{howItWorks.headline[0]}</span>
              <span className="block text-muted-foreground">{howItWorks.headline[1]}</span>
            </h2>
          </div>
          <Lede className="max-w-md lg:col-span-4 lg:col-start-9">{howItWorks.body}</Lede>
        </div>

        <ol className="mt-14 grid gap-10 lg:mt-20 lg:grid-cols-5 lg:gap-6" aria-label="Capital flow stages">
          {STAGES.map((stage, index) => {
            const reached = index <= active
            const isActive = index === active
            const isLast = index === STAGES.length - 1
            return (
              <li
                key={stage.id}
                ref={(el) => {
                  stageRefs.current[index] = el
                }}
                aria-current={isActive ? 'step' : undefined}
                className="relative grid grid-cols-[0.75rem_1fr] content-start gap-x-5 lg:grid-cols-1 lg:gap-y-6"
              >
                <div className="relative row-span-2 lg:row-span-1 lg:row-start-2 lg:h-3" aria-hidden="true">
                  {/* Vertical segment (mobile) */}
                  <span
                    className={cn(
                      'absolute top-2 bottom-[-2.5rem] left-[5px] w-px transition-colors duration-500 lg:hidden',
                      index < active ? 'bg-violet' : 'bg-border',
                      isLast && 'hidden',
                    )}
                  />
                  {/* Horizontal segment (desktop) */}
                  <span
                    className={cn(
                      'absolute top-[5px] left-3 hidden h-px transition-colors duration-500 lg:block',
                      isLast ? 'right-0' : 'right-[-1.5rem]',
                      index < active ? 'bg-violet' : 'bg-border',
                    )}
                  />
                  <span
                    className={cn(
                      'absolute top-0 left-0 size-3 rounded-[2px] border transition-colors duration-300',
                      reached ? 'border-violet bg-violet' : 'border-subtle bg-background',
                      isActive && 'outline-4 outline-violet/25',
                    )}
                  />
                </div>

                <StageScene
                  stage={stage.id}
                  className={cn(
                    'col-start-2 row-start-1 mb-4 h-20 w-28 transition-opacity duration-500 lg:col-start-1 lg:mb-0 lg:h-24 lg:w-32',
                    reached ? 'opacity-100' : 'opacity-55',
                  )}
                />

                <div className="col-start-2 flex flex-col gap-3 pb-2 lg:col-start-1 lg:row-start-3 lg:pr-6">
                  <h3
                    className={cn(
                      'font-display text-xl font-medium transition-colors duration-300',
                      reached ? 'text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {stage.title}
                  </h3>
                  <p className="text-sm text-pretty text-muted-foreground">{stage.description}</p>
                  <div
                    className={cn(
                      'preview-panel mt-1 flex flex-col gap-1 rounded-xl border px-3 py-3 transition-colors duration-300',
                      isActive ? 'border-violet/50 bg-card' : 'border-border bg-card',
                    )}
                  >
                    <span className="text-xs text-subtle">{stage.detail.label}</span>
                    <span className="text-sm text-foreground num">{stage.detail.value}</span>
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </Container>
    </Section>
  )
}

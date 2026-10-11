'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { AuthVisual } from '@/components/app/auth-visual'
import { Button } from '@/components/ui/button'
import { PersonAvatar, roleIcons } from '@/components/viatik/people'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { DEMO_PERSONAS, type DemoPersonaKey } from '@/domain/fixtures'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { publicEnv } from '@/lib/env'
import { useSession } from '@/lib/session'

/** `?as=` values used by the landing's "Explore the … view" links. */
const DEEP_LINKS: Record<string, DemoPersonaKey> = {
  investor: 'investor',
  'agency-admin': 'admin',
  member: 'member',
}

const choiceClass =
  'group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors outline-none hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring'

export default function DemoPage() {
  return (
    <React.Suspense>
      <Demo />
    </React.Suspense>
  )
}

function Demo() {
  const router = useRouter()
  const params = useSearchParams()
  const { userId, mode, accountsEnabled, enterDemo } = useSession()
  const showDemo = publicEnv.NEXT_PUBLIC_DEMO_MODE || !accountsEnabled

  const enterAs = React.useCallback(
    (key: DemoPersonaKey) => {
      const persona = DEMO_PERSONAS.find((p) => p.key === key)
      if (!persona) return
      enterDemo(persona.userId)
      router.push(persona.href as Route)
    },
    [router, enterDemo],
  )

  const deepLink = DEEP_LINKS[params.get('as') ?? '']
  React.useEffect(() => {
    if (!showDemo) router.replace('/sign-in')
    else if (deepLink) enterAs(deepLink)
  }, [showDemo, deepLink, enterAs, router])

  const current = mode === 'demo' ? DEMO_PERSONAS.find((p) => p.userId === userId) : undefined
  if (!showDemo) return null

  return (
    <main id="main" className="grid min-h-svh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <section className="grain relative hidden overflow-hidden lg:block" aria-hidden="true">
        <img src="/images/alpine-landscape.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="hero-scene-shade absolute inset-0" />
        <div className="relative z-[2] flex h-full flex-col justify-between gap-8 px-10 py-10 xl:px-14">
          <p className="max-w-sm font-display text-4xl leading-tight font-medium tracking-tight text-balance text-mist">
            See how capital moves, from every seat.
          </p>
          <AuthVisual className="mx-auto max-w-md" />
        </div>
      </section>

      <section className="flex flex-col justify-center px-5 py-12 sm:px-12">
        <div className="mx-auto flex w-full max-w-md flex-col gap-8">
          <ViatikLogo className="-ml-1" />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-medium tracking-tight">Explore the demo</h1>
            <p className="text-base text-muted-foreground">
              Sample data, no account needed. Choose who you want to be in the story.
            </p>
          </div>

          {current ? (
            <Button size="pill" className="w-full justify-center" onClick={() => enterAs(current.key)}>
              Continue as {current.name} <ArrowRight data-icon="inline-end" />
            </Button>
          ) : null}

          <div className="flex flex-col gap-2" id="demo-personas">
            {DEMO_PERSONAS.map((persona) => {
              const Icon = roleIcons[persona.role]
              return (
                <button key={persona.key} type="button" onClick={() => enterAs(persona.key)} className={choiceClass}>
                  <PersonAvatar name={persona.name} size="md" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {persona.name}
                      <span className="box-tag">
                        <Icon className="size-2.5" aria-hidden="true" /> {roleLabel[persona.role]}
                      </span>
                    </span>
                    <span className="text-xs text-pretty text-muted-foreground">
                      {persona.organization} · {roleDescription[persona.role]}
                    </span>
                  </span>
                  <ArrowRight
                    className="size-4 text-subtle transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </div>

          <Link
            href="/sign-in"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-subtle hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to sign in
          </Link>
        </div>
      </section>
    </main>
  )
}

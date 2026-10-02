'use client'

import { ArrowRight, Fingerprint, Mail } from 'lucide-react'
import type { Route } from 'next'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { roleHome } from '@/components/app/nav'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { OrgAvatar, PersonAvatar, roleIcons } from '@/components/viatik/people'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { useViatik } from '@/data/react'
import { DEMO_PERSONAS, type DemoPersonaKey } from '@/domain/fixtures'
import { roleDescription, roleLabel } from '@/domain/permissions'
import type { Membership, ViatikState } from '@/domain/types'
import { publicEnv } from '@/lib/env'
import { useSession, type SignInMethod } from '@/lib/session'

/** `?as=` values used by the landing's "Explore the … view" links. */
const DEEP_LINKS: Record<string, DemoPersonaKey> = {
  investor: 'investor',
  'agency-admin': 'admin',
  member: 'member',
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M21.35 11.1H12v2.98h5.35c-.23 1.44-1.66 4.22-5.35 4.22-3.22 0-5.85-2.67-5.85-5.95S8.78 6.4 12 6.4c1.84 0 3.06.78 3.77 1.45l2.57-2.47C16.7 3.86 14.56 2.9 12 2.9 6.97 2.9 2.9 6.97 2.9 12s4.07 9.1 9.1 9.1c5.25 0 8.73-3.69 8.73-8.88 0-.6-.07-1.05-.15-1.5Z"
      />
    </svg>
  )
}

const choiceClass =
  'group flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors outline-none hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring'

function workspaceName(state: ViatikState, membership: Membership) {
  const scope = membership.scope
  return scope.kind === 'portfolio'
    ? (state.portfolios.find((p) => p.id === scope.portfolioId)?.name ?? 'Portfolio')
    : (state.agencies.find((a) => a.id === scope.agencyId)?.name ?? 'Agency')
}

export default function SignInPage() {
  return (
    <React.Suspense>
      <SignIn />
    </React.Suspense>
  )
}

function SignIn() {
  const router = useRouter()
  const params = useSearchParams()
  const { userId, mode, account, accountsEnabled, accountsReady, error, retry, enterDemo, signIn, signOut } =
    useSession()
  const { state, memberships } = useViatik()
  const [chooseDemo, setChooseDemo] = React.useState(false)
  // Set when the person uses a real sign-in button on this page, so the
  // workspace opens by itself once the account resolves.
  const [signingIn, setSigningIn] = React.useState(false)
  const personasRef = React.useRef<HTMLDivElement>(null)
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

  // Deep links from viatik.xyz ("Explore the Investor view").
  React.useEffect(() => {
    const persona = DEEP_LINKS[params.get('as') ?? '']
    if (persona && showDemo) enterAs(persona)
  }, [params, enterAs, showDemo])

  // After a real sign-in: one workspace opens directly; none goes to onboarding.
  const signedIn = mode === 'account' && Boolean(userId) && Boolean(state)
  const only = memberships.length === 1 ? memberships[0] : undefined
  React.useEffect(() => {
    if (!signingIn || !signedIn) return
    if (memberships.length === 0) router.replace('/welcome')
    else if (only) router.replace(roleHome(only))
  }, [signingIn, signedIn, memberships.length, only, router])

  // Without a Privy app, every sign-in method leads to choosing a demo person.
  const simulate = () => {
    setChooseDemo(true)
    personasRef.current?.querySelector('button')?.focus()
  }

  const start = (method: SignInMethod) => {
    if (!accountsEnabled) return simulate()
    setSigningIn(true)
    signIn(method)
  }

  // Privy is restoring a session or the server is resolving the account.
  const checking = accountsEnabled && (!accountsReady || userId === undefined)
  const current = mode === 'demo' ? DEMO_PERSONAS.find((p) => p.userId === userId) : undefined

  return (
    <main id="main" className="grid min-h-svh grid-cols-1 lg:grid-cols-[1.05fr_1fr]">
      <section className="grain relative hidden overflow-hidden lg:block" aria-hidden="true">
        <img src="/images/alpine-landscape.jpg" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="hero-scene-shade absolute inset-0" />
        <p className="absolute top-10 left-10 z-[2] max-w-sm font-display text-4xl leading-tight font-medium tracking-tight text-balance text-mist">
          Fund the work. Control how capital moves.
        </p>
        <div className="absolute inset-x-10 bottom-12 z-[2] flex flex-col gap-4">
          <div className="glass-panel hero-account-card w-80 rounded-2xl p-5">
            <p className="text-xs text-stone">Capital released</p>
            <p className="mt-1 font-display text-3xl tracking-tight num">
              25,000<span className="text-xl opacity-70">.00</span>
              <span className="ml-1.5 text-sm text-stone">USD</span>
            </p>
            <p className="mt-2 text-sm opacity-80">Tranche 2 of 4 · Prototype delivered</p>
          </div>
          <div className="glass-panel hero-release-card gentle-float ml-16 w-72 rounded-2xl p-4">
            <p className="text-sm font-medium">Payment completed</p>
            <p className="mt-1 text-sm opacity-80">120.00 USD to Vertex Cloud · Receipt verified</p>
          </div>
        </div>
      </section>

      <section className="flex flex-col justify-center px-5 py-12 sm:px-12">
        <div className="mx-auto flex w-full max-w-md flex-col gap-8">
          <ViatikLogo className="-ml-1" />
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-medium tracking-tight">Sign in to Viatik</h1>
            <p className="text-base text-muted-foreground">
              Manage funding, budgets and payments from one secure workspace.
            </p>
          </div>

          {mode === 'account' && userId ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <p className="text-sm text-muted-foreground">
                Signed in as{' '}
                <span className="text-foreground">{account?.email ?? account?.name ?? 'your account'}</span>
              </p>
              {!state ? (
                <Skeleton className="h-16 rounded-xl" />
              ) : memberships.length === 0 ? (
                <Button size="pill" className="w-full justify-center" onClick={() => router.push('/welcome')}>
                  Set up your workspace <ArrowRight data-icon="inline-end" />
                </Button>
              ) : (
                <div className="flex flex-col gap-2" role="group" aria-label="Your workspaces">
                  {memberships.map((membership) => {
                    const name = workspaceName(state, membership)
                    const Icon = roleIcons[membership.role]
                    return (
                      <button
                        key={membership.id}
                        type="button"
                        onClick={() => router.push(roleHome(membership))}
                        className={choiceClass}
                      >
                        <OrgAvatar name={name} size="md" />
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">{name}</span>
                          <span className="box-tag w-fit">
                            <Icon className="size-2.5" aria-hidden="true" /> {roleLabel[membership.role]}
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
              )}
              <Button
                variant="ghost"
                size="pill-sm"
                className="w-fit"
                onClick={async () => {
                  setSigningIn(false)
                  await signOut()
                }}
              >
                Use another account
              </Button>
            </div>
          ) : (
            <>
              {current ? (
                <Button size="pill" className="w-full justify-center" onClick={() => enterAs(current.key)}>
                  Continue as {current.name} <ArrowRight data-icon="inline-end" />
                </Button>
              ) : null}

              <div className="flex flex-col gap-2.5">
                <Button
                  size="pill"
                  variant={current ? 'outline' : 'default'}
                  className="w-full justify-center"
                  disabled={checking}
                  onClick={() => start('email')}
                >
                  <Mail data-icon="inline-start" /> Continue with email
                </Button>
                <Button
                  size="pill"
                  variant="outline"
                  className="w-full justify-center"
                  disabled={checking}
                  onClick={() => start('google')}
                >
                  <GoogleMark /> Continue with Google
                </Button>
                <Button
                  size="pill"
                  variant="outline"
                  className="w-full justify-center"
                  disabled={checking}
                  onClick={() => start('passkey')}
                >
                  <Fingerprint data-icon="inline-start" /> Use a passkey
                </Button>
                {error ? (
                  <div
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/40 px-3.5 py-2.5"
                    role="alert"
                  >
                    <p className="text-sm text-danger">{error}</p>
                    <Button variant="outline" size="pill-sm" onClick={retry}>
                      Try again
                    </Button>
                  </div>
                ) : null}
                <p className="pt-1 text-center text-sm text-subtle" aria-live="polite">
                  {checking && accountsReady
                    ? 'Opening your account…'
                    : 'Your financial account is created automatically. No wallet extension required.'}
                </p>
              </div>
            </>
          )}

          {showDemo ? (
            <>
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs tracking-[0.1em] text-subtle uppercase">Or try the demo</span>
                <Separator className="flex-1" />
              </div>

              <div ref={personasRef} className="flex flex-col gap-2" id="demo-personas">
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {chooseDemo
                    ? 'Sign-in is simulated in this demo. Choose who you want to be:'
                    : 'Explore Viatik as one of the people in the demo story:'}
                </p>
                {DEMO_PERSONAS.map((persona) => {
                  const Icon = roleIcons[persona.role]
                  return (
                    <button
                      key={persona.key}
                      type="button"
                      onClick={() => enterAs(persona.key)}
                      className={choiceClass}
                    >
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
            </>
          ) : null}
        </div>
      </section>
    </main>
  )
}

'use client'

import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { inviteHref, roleHome } from '@/components/app/nav'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/viatik/feedback'
import { PendingOperation } from '@/components/viatik/operation'
import { roleIcons } from '@/components/viatik/people'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { useCommand, useViatik } from '@/data/react'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { nameFromEmail } from '@/lib/format'
import { useSession } from '@/lib/session'
import { timeZoneOptions } from '@/lib/time-zones'

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Accepts a full invitation link (…/invite/abc123) or the bare code. */
function invitationCode(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const match = value.match(/\/invite\/([^/?#\s]+)/)
  const code = match?.[1] ?? value
  return /^[\w-]{3,64}$/.test(code) ? code : null
}

type WelcomeRole = 'investor' | 'agency_admin' | 'member'

const WELCOME_ROLES: { key: string; role: WelcomeRole }[] = [
  { key: 'investor', role: 'investor' },
  { key: 'admin', role: 'agency_admin' },
  { key: 'member', role: 'member' },
]

const inviteCopy: Record<Exclude<WelcomeRole, 'investor'>, { title: string; body: string }> = {
  agency_admin: {
    title: 'Join your Agency as Admin',
    body: 'Agency Admins are invited by the Investor funding their Agency. Paste the invitation you received.',
  },
  member: {
    title: 'Join your team as Member',
    body: 'Members are invited by their Agency Admin. Paste the invitation you received.',
  },
}

const choiceClass =
  'group flex items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left transition-colors outline-none hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring'

/** A demo person whose access was removed has no workspace left: the way back to the other people. */
function DemoNote() {
  const { mode, user } = useViatik()
  if (mode !== 'demo') return null
  return (
    <div className="flex max-w-xl flex-col gap-2 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
      <p className="text-pretty text-muted-foreground">
        {user?.name || 'This person'} no longer belongs to a workspace in this demo. Choose another person to
        keep exploring, then use Reset demo to restore the sample data.
      </p>
      <Link
        href="/sign-in/demo"
        className="inline-flex w-fit items-center gap-1.5 font-medium text-foreground hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to the demo
      </Link>
    </div>
  )
}

/**
 * First stop for a signed-in person who belongs to no workspace yet: start a
 * portfolio (and become its Investor) or join the workspace that invited them.
 */
export default function WelcomePage() {
  return (
    <React.Suspense>
      <Welcome />
    </React.Suspense>
  )
}

function Welcome() {
  const router = useRouter()
  const params = useSearchParams()
  const picked = WELCOME_ROLES.find((r) => r.key === params.get('role'))?.role
  const { userId, account, signOut } = useSession()
  const { state, user, memberships, isError, refetch } = useViatik()
  const create = useCommand('createPortfolio', { silent: true })
  // On Monad, opening a portfolio takes a signature and a confirmation: shown as steps while it runs.
  const steps = useSigningSteps(create.phase, {
    prepared: 'Viatik prepares your portfolio and its Portfolio Vault.',
    done: { label: 'Created', detail: 'Recorded on Monad, with you as its Investor.' },
  })

  // null until edited: the field shows a suggestion from the email.
  const [ownerName, setOwnerName] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [timeZone, setTimeZone] = React.useState(browserTimeZone)
  const [touched, setTouched] = React.useState(false)
  // A portfolio cannot be deleted yet, so creating one needs an explicit yes.
  const [acknowledged, setAcknowledged] = React.useState(false)
  const [invite, setInvite] = React.useState('')
  const [inviteTouched, setInviteTouched] = React.useState(false)

  // Signed out → sign-in; already in a workspace → straight there.
  const home = memberships[0]
  React.useEffect(() => {
    if (userId === null) router.replace('/sign-in')
    else if (home) router.replace(roleHome(home))
  }, [userId, home, router])

  if (isError) {
    return (
      <main id="main" className="mx-auto max-w-lg px-4 py-24">
        <ErrorState titleAs="h1" onRetry={refetch} />
      </main>
    )
  }

  if (!userId || !state || home) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-6 px-4 py-12">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-96 rounded-2xl" />
      </main>
    )
  }

  const email = account?.email || user?.email || null
  // Sign-in only gives a name with Google; everyone else types it here once.
  const needsName = !user?.name.trim()
  const yourName = ownerName ?? nameFromEmail(email)

  const errors = {
    ownerName: needsName && yourName.trim().length < 2 ? 'Enter your name.' : undefined,
    name: name.trim().length < 2 ? 'Enter a name for your portfolio.' : undefined,
  }
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined)
  const busy = create.isPending
  const code = invitationCode(invite)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (errors.ownerName || errors.name || !acknowledged) return
    const portfolio = await create.run({
      name: name.trim(),
      // One name is enough: the portfolio and its organization share it.
      organization: name.trim(),
      timeZone,
      ownerName: needsName ? yourName.trim() : undefined,
    })
    if (portfolio) router.replace(`/investor/${portfolio.id}/overview` as Route)
  }

  const join = (event: React.FormEvent) => {
    event.preventDefault()
    setInviteTouched(true)
    if (code) router.push(inviteHref(code))
  }

  const firstName = user?.name.trim().split(' ')[0] ?? ''

  const back = (
    <Button
      variant="ghost"
      size="pill-sm"
      className="-ml-3 w-fit text-subtle"
      onClick={() => router.push('/welcome')}
    >
      <ArrowLeft data-icon="inline-start" /> Change role
    </Button>
  )

  const footer = (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-subtle">
      {email ? <span>Signed in as {email}</span> : null}
      <Button
        variant="link"
        size="sm"
        className="h-auto px-0 text-subtle"
        onClick={async () => {
          await signOut()
          router.replace('/sign-in')
        }}
      >
        Sign out
      </Button>
    </p>
  )

  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <ViatikLogo className="-ml-1" />
      <DemoNote />

      {!picked ? (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-sm text-subtle">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</p>
            <h1 className="font-display text-3xl font-medium tracking-tight">How will you use Viatik?</h1>
            <p className="max-w-xl text-base text-pretty text-muted-foreground">
              Choose your role. You can always be invited to other workspaces later.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3" role="group" aria-label="Choose your role">
            {WELCOME_ROLES.map(({ key, role }) => {
              const Icon = roleIcons[role]
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => router.push(`/welcome?role=${key}` as Route)}
                  className={choiceClass}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-3">
                    <Icon className="size-5 text-subtle" aria-hidden="true" />
                    <span className="text-base font-medium">{roleLabel[role]}</span>
                    <span className="text-sm text-pretty text-muted-foreground">{roleDescription[role]}</span>
                  </span>
                  <ArrowRight
                    className="mt-0.5 size-4 shrink-0 text-subtle transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </button>
              )
            })}
          </div>
        </>
      ) : picked === 'investor' ? (
        <div className="flex max-w-md flex-col gap-6">
          {back}
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-medium tracking-tight">Create your portfolio</h1>
            <p className="text-base text-pretty text-muted-foreground">
              Fund Agencies through Funding Agreements and release capital as milestones are met.
            </p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
            {needsName ? (
              <FormField
                label="Your name"
                htmlFor="owner-name"
                error={shown('ownerName')}
                hint="How your team sees you in Viatik."
              >
                <PillInput
                  id="owner-name"
                  value={yourName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  autoComplete="name"
                  maxLength={80}
                  aria-invalid={Boolean(shown('ownerName')) || undefined}
                />
              </FormField>
            ) : null}
            <FormField label="Portfolio or organization name" htmlFor="portfolio-name" error={shown('name')}>
              <PillInput
                id="portfolio-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Northstar Capital"
                autoComplete="organization"
                maxLength={80}
                aria-invalid={Boolean(shown('name')) || undefined}
              />
            </FormField>
            <FormField label="Time zone" htmlFor="portfolio-tz">
              <SimpleSelect
                id="portfolio-tz"
                value={timeZone}
                onValueChange={setTimeZone}
                options={timeZoneOptions(timeZone)}
              />
            </FormField>
            <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
              <p className="text-sm text-pretty text-foreground">
                A portfolio cannot be deleted yet. Agency Admins and Members do not create one: they join
                through an invitation. If that is you, use Change role.
              </p>
              <div className="flex items-start gap-3">
                <Checkbox
                  id="portfolio-confirm"
                  checked={acknowledged}
                  disabled={busy}
                  onCheckedChange={(value) => setAcknowledged(Boolean(value))}
                  aria-invalid={(touched && !acknowledged) || undefined}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="portfolio-confirm"
                  className="text-sm leading-snug font-medium text-pretty text-foreground"
                >
                  I am an Investor and want to create this portfolio
                </Label>
              </div>
              {touched && !acknowledged ? (
                <p className="text-sm text-danger" role="alert">
                  Confirm before creating your portfolio.
                </p>
              ) : null}
            </div>
            {create.error ? (
              <p className="text-sm text-danger" role="alert">
                {create.error}
              </p>
            ) : null}
            <Button type="submit" size="pill" disabled={busy}>
              {busy ? 'Creating…' : 'Create portfolio'}
            </Button>
            {busy && steps ? <PendingOperation phase={create.phase} steps={steps} /> : null}
          </form>
        </div>
      ) : (
        <div className="flex max-w-md flex-col gap-6">
          {back}
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-medium tracking-tight">{inviteCopy[picked].title}</h1>
            <p className="text-base text-pretty text-muted-foreground">
              {inviteCopy[picked].body} It only works when you sign in with the email it was created for.
            </p>
          </div>
          <form className="flex flex-col gap-4" onSubmit={join} noValidate>
            <FormField
              label="Invitation link or code"
              htmlFor="invitation-code"
              error={inviteTouched && !code ? 'Paste the link from your invitation.' : undefined}
              hint="You can also open the link directly."
            >
              <PillInput
                id="invitation-code"
                value={invite}
                onChange={(event) => setInvite(event.target.value)}
                placeholder="https://…/invite/…"
                autoComplete="off"
                aria-invalid={(inviteTouched && !code) || undefined}
              />
            </FormField>
            <Button type="submit" size="pill">
              Continue
            </Button>
          </form>
        </div>
      )}

      {footer}
    </main>
  )
}

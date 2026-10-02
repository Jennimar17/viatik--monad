'use client'

import { Briefcase, Ticket } from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { inviteHref, roleHome } from '@/components/app/nav'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/viatik/feedback'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { useCommand, useViatik } from '@/data/react'
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

/**
 * First stop for a signed-in person who belongs to no workspace yet: start a
 * portfolio (and become its Investor) or join the workspace that invited them.
 */
export default function WelcomePage() {
  const router = useRouter()
  const { userId, account, signOut } = useSession()
  const { state, user, memberships, isError, refetch } = useViatik()
  const create = useCommand('createPortfolio', { silent: true })

  const [name, setName] = React.useState('')
  const [organization, setOrganization] = React.useState('')
  const [timeZone, setTimeZone] = React.useState(browserTimeZone)
  const [touched, setTouched] = React.useState(false)
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

  const errors = {
    name: name.trim().length < 2 ? 'Enter a name for the portfolio.' : undefined,
    organization: organization.trim().length < 2 ? 'Enter your organization.' : undefined,
  }
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined)
  const busy = create.isPending
  const code = invitationCode(invite)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (errors.name || errors.organization) return
    const portfolio = await create.run({
      name: name.trim(),
      organization: organization.trim(),
      timeZone,
    })
    if (portfolio) router.replace(`/investor/${portfolio.id}/overview` as Route)
  }

  const join = (event: React.FormEvent) => {
    event.preventDefault()
    setInviteTouched(true)
    if (code) router.push(inviteHref(code))
  }

  // A passkey-only account has no verified name or email: greet without inventing one.
  const firstName = account && !account.name ? '' : (user?.name ?? account?.name ?? '').split(' ')[0]
  const email = account?.email || user?.email || null

  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-3xl flex-col justify-center gap-8 px-4 py-12">
      <ViatikLogo className="-ml-1" />
      <div className="flex flex-col gap-2">
        <p className="text-sm text-subtle">{firstName ? `Welcome, ${firstName}` : 'Welcome'}</p>
        <h1 className="font-display text-3xl font-medium tracking-tight">Set up your workspace</h1>
        <p className="max-w-xl text-base text-pretty text-muted-foreground">
          Start a portfolio to fund teams, or join the workspace that invited you.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="surface flex flex-col gap-5 rounded-2xl p-6" aria-labelledby="create-title">
          <div className="flex items-start gap-3">
            <Briefcase className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 id="create-title" className="text-base font-medium">
                Create a portfolio
              </h2>
              <p className="text-sm text-pretty text-muted-foreground">
                For investors. Fund Agencies through Funding Agreements and release capital as milestones are
                met.
              </p>
            </div>
          </div>
          <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)} noValidate>
            <FormField label="Portfolio name" htmlFor="portfolio-name" error={shown('name')}>
              <PillInput
                id="portfolio-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Northstar Ventures"
                autoComplete="off"
                maxLength={80}
                aria-invalid={Boolean(shown('name')) || undefined}
              />
            </FormField>
            <FormField label="Organization" htmlFor="portfolio-organization" error={shown('organization')}>
              <PillInput
                id="portfolio-organization"
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="Northstar Capital"
                autoComplete="organization"
                maxLength={80}
                aria-invalid={Boolean(shown('organization')) || undefined}
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
            {create.error ? (
              <p className="text-sm text-danger" role="alert">
                {create.error}
              </p>
            ) : null}
            <Button type="submit" size="pill" disabled={busy}>
              {busy ? 'Creating…' : 'Create portfolio'}
            </Button>
          </form>
        </section>

        <section className="surface flex flex-col gap-5 rounded-2xl p-6" aria-labelledby="join-title">
          <div className="flex items-start gap-3">
            <Ticket className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden="true" />
            <div className="flex flex-col gap-1">
              <h2 id="join-title" className="text-base font-medium">
                Join with an invitation
              </h2>
              <p className="text-sm text-pretty text-muted-foreground">
                Agency Admins and Members join through the link their team sent to {email ?? 'their email'}.
              </p>
            </div>
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
            <Button type="submit" size="pill" variant="outline">
              Continue
            </Button>
          </form>
        </section>
      </div>

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
    </main>
  )
}

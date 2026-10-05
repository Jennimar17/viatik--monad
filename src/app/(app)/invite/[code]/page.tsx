'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import type { Route } from 'next'
import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { roleHome } from '@/components/app/nav'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/viatik/feedback'
import { OrgAvatar, roleIcons } from '@/components/viatik/people'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { getDataSource, type SessionMode } from '@/data'
import { STATE_KEY, useCommand, useViatik } from '@/data/react'
import type { Invitation } from '@/domain/types'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { useSession } from '@/lib/session'

/**
 * Invitation link. Anyone with the link sees the workspace, role and inviter.
 * With real accounts, the invitee signs in (the invitation's email is
 * prefilled) and accepts as themselves; the invitation only works for the
 * email it was sent to. In the demo, accepting creates a new demo person.
 */
export default function InvitePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const {
    mode,
    userId,
    account,
    accountsEnabled,
    error: sessionError,
    retry,
    enterDemo,
    signIn,
    signOut,
  } = useSession()
  const { state, memberships } = useViatik()
  const queryClient = useQueryClient()
  const [accepting, setAccepting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  // A real account accepts through the command pipeline: on a world settled on Monad the join is a
  // transaction the person signs, and a retry (or a reload) keeps the same operation key.
  const acceptCommand = useCommand('acceptInvitation', { silent: true })

  // Real accounts, unless this device is exploring as one of the demo people.
  const real = accountsEnabled && mode !== 'demo'
  const source: SessionMode = real ? 'account' : 'demo'

  const {
    data: invitation,
    isLoading,
    isError: lookupFailed,
    refetch: lookUpAgain,
  } = useQuery({
    queryKey: ['invitation', source, code],
    queryFn: () => getDataSource(source).lookupInvitation(code),
  })

  if (isLoading) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-12">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-96 rounded-2xl" />
      </main>
    )
  }

  // Could not ask (offline, server down): not the same as an unknown link.
  if (lookupFailed) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4">
        <ViatikLogo className="-ml-1" />
        <ErrorState
          titleAs="h1"
          title="We could not open this invitation"
          description="The link may be fine. Check your connection and try again."
          onRetry={() => void lookUpAgain()}
        />
      </main>
    )
  }

  if (!invitation) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4">
        <ViatikLogo className="-ml-1" />
        <EmptyState
          titleAs="h1"
          title="This invitation link is not valid"
          description="It may have expired or been used already. Ask the person who invited you for a new link."
          action={
            <ButtonLink href="/sign-in" size="pill">
              Sign in
            </ButtonLink>
          }
        />
      </main>
    )
  }

  const Icon = roleIcons[invitation.role]
  const pending = invitation.status === 'pending'
  const signedIn = real && mode === 'account' && Boolean(userId)
  // Resolving the account, or loading what the data knows about the person.
  const checking = real && (userId === undefined || (signedIn && !state))
  // The invitation only works for its own email; a passkey-only account has none to prove.
  const wrongAccount =
    signedIn && (account?.email ?? '').toLowerCase() !== invitation.email.trim().toLowerCase()

  const finish = async (inviteeId: string, accepted: Invitation) => {
    await queryClient.invalidateQueries({ queryKey: STATE_KEY })
    router.push(
      roleHome({
        id: 'new',
        userId: inviteeId,
        role: accepted.role,
        scope: accepted.scope,
        status: 'active',
        createdAt: new Date().toISOString(),
      }),
    )
  }

  const accept = async () => {
    setAccepting(true)
    setError(null)
    try {
      if (real) {
        const accepted = (await acceptCommand.run({ code })) as Invitation | undefined
        if (!accepted) {
          // The reason is in `acceptCommand.error`; the button is ready for another try.
          setAccepting(false)
          return
        }
        await finish(userId as string, accepted)
      } else {
        // Demo: the invitee gets a new demo person of their own.
        const inviteeId = `u_${code.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`
        const accepted = (await getDataSource('demo').dispatch(inviteeId, 'acceptInvitation', {
          code,
        })) as Invitation
        enterDemo(inviteeId)
        await finish(inviteeId, accepted)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not accept the invitation.')
      setAccepting(false)
    }
  }

  // A way out of the invitation: back to the workspace, onboarding or sign-in.
  const home = memberships[0]
  const exit: { href: Route; label: string } = home
    ? { href: roleHome(home), label: 'Go to my workspace' }
    : userId && state
      ? { href: '/welcome', label: 'Go to my account' }
      : { href: '/sign-in', label: 'Back to sign in' }

  let action: React.ReactNode
  if (!pending) {
    action = (
      <Button size="pill" disabled>
        Invitation already used
      </Button>
    )
  } else if (checking) {
    action = (
      <Button size="pill" disabled>
        Checking your account…
      </Button>
    )
  } else if (real && !signedIn && sessionError) {
    // Signed in to Privy, but the account could not be resolved: say so and offer a retry.
    action = (
      <>
        <p className="text-sm text-danger" role="alert">
          {sessionError}
        </p>
        <Button size="pill" variant="outline" onClick={retry}>
          Try again
        </Button>
      </>
    )
  } else if (real && !signedIn) {
    action = (
      <Button size="pill" onClick={() => signIn(undefined, { email: invitation.email })}>
        Sign in to accept
      </Button>
    )
  } else if (wrongAccount) {
    action = (
      <>
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-pretty text-muted-foreground">
          {account?.email ? (
            <>
              You are signed in as <span className="text-foreground">{account.email}</span>.
            </>
          ) : (
            'You are signed in without an email address.'
          )}{' '}
          This invitation is for <span className="text-foreground">{invitation.email}</span>.
        </p>
        <Button size="pill" variant="outline" onClick={() => void signOut()}>
          Use another account
        </Button>
      </>
    )
  } else {
    action = (
      <Button size="pill" disabled={accepting} onClick={accept}>
        {accepting ? 'Accepting…' : 'Accept invitation'}
      </Button>
    )
  }

  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-12">
      <ViatikLogo className="-ml-1" />
      <section className="surface flex flex-col gap-5 rounded-2xl p-6" aria-labelledby="invite-title">
        <div className="flex items-center gap-3">
          <OrgAvatar name={invitation.workspace} size="lg" />
          <div className="flex flex-col">
            <span className="text-sm text-subtle">{invitation.invitedBy} invited you to join</span>
            <h1 id="invite-title" className="font-display text-xl font-medium">
              {invitation.workspace}
            </h1>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-border p-4">
          <Icon className="mt-0.5 size-5 shrink-0 text-subtle" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{roleLabel[invitation.role]}</span>
            <span className="text-sm text-pretty text-muted-foreground">
              {roleDescription[invitation.role]}
            </span>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Invitation for <span className="text-foreground">{invitation.name}</span> · {invitation.email}
        </p>
        {real ? null : (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-subtle">
            Demo: accepting creates a new account for {invitation.name}.
          </p>
        )}
        {(error ?? acceptCommand.error) ? (
          <p className="text-sm text-danger" role="alert">
            {error ?? acceptCommand.error}
          </p>
        ) : null}
        <div className="flex flex-col gap-3" aria-live="polite">
          {action}
        </div>
        <p className="text-center text-xs text-subtle">
          Your financial account is created automatically. No wallet extension required.
        </p>
      </section>
      <ButtonLink href={exit.href} variant="ghost" size="pill-sm" className="w-fit">
        <ArrowLeft data-icon="inline-start" /> {exit.label}
      </ButtonLink>
    </main>
  )
}

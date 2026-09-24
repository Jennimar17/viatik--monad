'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { roleHome } from '@/components/app/nav'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/viatik/feedback'
import { OrgAvatar, roleIcons } from '@/components/viatik/people'
import { ViatikLogo } from '@/components/viatik/viatik-logo'
import { getDataSource } from '@/data'
import type { Invitation } from '@/domain/types'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { useSession } from '@/lib/session'

/**
 * Invitation link. Anyone with the link sees the workspace, role and inviter;
 * accepting creates the invitee's account. The accounts phase binds the
 * invitation to the invitee's verified email.
 */
export default function InvitePage() {
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const { signIn } = useSession()
  const queryClient = useQueryClient()
  const [accepting, setAccepting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const { data: invitation, isLoading } = useQuery({
    queryKey: ['invitation', code],
    queryFn: () => getDataSource().lookupInvitation(code),
  })

  if (isLoading) {
    return (
      <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-12">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-96 rounded-2xl" />
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

  const accept = async () => {
    setAccepting(true)
    setError(null)
    try {
      // Demo: the invitee gets a new account of their own.
      const inviteeId = `u_${code.replace(/[^a-z0-9]/gi, '').slice(0, 18)}`
      const accepted = (await getDataSource().dispatch(inviteeId, 'acceptInvitation', { code })) as Invitation
      signIn(inviteeId)
      await queryClient.invalidateQueries()
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not accept the invitation.')
      setAccepting(false)
    }
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
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-subtle">
          Demo: accepting creates a new account for {invitation.name}.
        </p>
        {error ? (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <Button size="pill" disabled={accepting || !pending} onClick={accept}>
          {pending ? (accepting ? 'Accepting…' : 'Accept invitation') : 'Invitation already used'}
        </Button>
        <p className="text-center text-xs text-subtle">
          Your financial account is created automatically. No wallet extension required.
        </p>
      </section>
    </main>
  )
}

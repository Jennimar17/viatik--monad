'use client'

import { MailPlus, UserPlus } from 'lucide-react'
import * as React from 'react'

import { InvitationLink } from '@/components/app/invitation-link'
import { InviteSheet } from '@/components/app/invite-sheet'
import { usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { roleLabel } from '@/domain/permissions'
import { userName } from '@/domain/queries'
import { pluralize } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

export default function InvestorTeamPage() {
  const { state, userId } = useViatikState()
  const { portfolioId } = useRole()
  const { can } = usePermissions()
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [cancelId, setCancelId] = React.useState<string | null>(null)
  const cancel = useCommand('cancelInvitation')

  const portfolio = state.portfolios.find((p) => p.id === portfolioId)
  const members = state.memberships.filter(
    (m) => m.scope.kind === 'portfolio' && m.scope.portfolioId === portfolioId && m.status === 'active',
  )
  const invitations = state.invitations.filter(
    (i) => i.scope.kind === 'portfolio' && i.scope.portfolioId === portfolioId && i.status === 'pending',
  )
  const cancelling = state.invitations.find((i) => i.id === cancelId)
  const manage = can('manage_team')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Team"
        description="Investors who can see the portfolio, fund agreements and release tranches."
        meta={
          <span className="text-sm text-subtle">
            {pluralize(members.length, 'investor')}
            {invitations.length ? ` · ${pluralize(invitations.length, 'pending invitation')}` : ''}
          </span>
        }
        actions={
          manage ? (
            <Button size="pill" onClick={() => setInviteOpen(true)}>
              <UserPlus data-icon="inline-start" /> Invite investor
            </Button>
          ) : null
        }
      />

      <Panel
        title="Investors"
        description="Everyone here sees the whole portfolio and decides on exceptions."
      >
        <ul className="flex flex-col">
          {members.map((m) => {
            const user = state.users.find((u) => u.id === m.userId)
            return (
              <li key={m.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
                <PersonAvatar name={user?.name ?? 'Investor'} size="md" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {user?.name}
                    {m.userId === userId ? <span className="text-subtle"> · you</span> : null}
                  </span>
                  <span className="truncate text-xs text-subtle">
                    {user?.title} · {user?.email} · since {formatLocalDate(m.createdAt)}
                  </span>
                </span>
                <Tag>{roleLabel[m.role]}</Tag>
                <StatusBadge
                  status={{ label: 'Active', tone: 'success' }}
                  className="hidden sm:inline-flex"
                />
              </li>
            )
          })}
        </ul>
      </Panel>

      <Panel title="Pending invitations">
        {invitations.length === 0 ? (
          <EmptyState
            compact
            icon={<MailPlus />}
            title="No pending invitations"
            description="People you invite appear here until they join."
          />
        ) : (
          <ul className="flex flex-col">
            {invitations.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-3 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-center"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <PersonAvatar name={i.name} size="md" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{i.name}</span>
                    <span className="truncate text-xs text-subtle">
                      {i.email} · {roleLabel[i.role]} · invited {formatLocalDate(i.createdAt)} by{' '}
                      {userName(state, i.invitedBy)}
                    </span>
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <InvitationLink
                    variant="actions"
                    invitation={i}
                    workspace={portfolio?.name ?? 'the portfolio'}
                    inviter={userName(state, i.invitedBy)}
                  />
                  {manage ? (
                    <Button
                      variant="ghost"
                      size="pill-sm"
                      className="text-danger hover:text-danger"
                      onClick={() => setCancelId(i.id)}
                    >
                      Cancel invitation
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <InviteSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        scope={{ portfolioId }}
        roles={['investor']}
        workspaceName={portfolio?.name ?? 'the portfolio'}
      />

      <ApprovalSheet
        open={Boolean(cancelId)}
        onOpenChange={(open) => !open && setCancelId(null)}
        onClosed={cancel.reset}
        title="Cancel invitation"
        description={cancelling ? `${cancelling.name} · ${cancelling.email}` : undefined}
        summary={{
          what: `The invitation link for ${cancelling?.name ?? 'this person'} stops working. They will not be able to join with it.`,
          reversible: 'You can invite them again at any time.',
          policy: 'Only Investors manage who joins the portfolio.',
        }}
        confirmLabel="Cancel invitation"
        confirmVariant="destructive"
        phase={cancel.phase}
        error={cancel.error}
        onConfirm={() => cancelId && cancel.run({ invitationId: cancelId })}
        success={{ title: 'Invitation cancelled', body: 'The link no longer works.' }}
      />
    </div>
  )
}

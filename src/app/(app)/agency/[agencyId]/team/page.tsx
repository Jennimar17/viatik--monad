'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { MailPlus, UserPlus, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { InvitationLink } from '@/components/app/invitation-link'
import { InviteSheet } from '@/components/app/invite-sheet'
import { PageTabs } from '@/components/app/page-tabs'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader } from '@/components/viatik/layout'
import { PersonAvatar, roleIcons } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, sum, type Cents } from '@/domain/money'
import { roleLabel } from '@/domain/permissions'
import { userName } from '@/domain/queries'
import type { Membership } from '@/domain/types'
import { formatDate, pluralize } from '@/lib/format'

type Row = {
  membership: Membership
  name: string
  email: string
  title: string
  budgets: number
  allowance: Cents
  spent: Cents
}

export default function TeamPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const { can } = usePermissions()
  const [inviteOpen, setInviteOpen] = React.useState(false)
  const [cancelId, setCancelId] = React.useState<string | null>(null)
  const cancel = useCommand('cancelInvitation')

  const agency = state.agencies.find((a) => a.id === agencyId)
  const memberships = state.memberships.filter(
    (m) => m.scope.kind === 'agency' && m.scope.agencyId === agencyId && m.status !== 'invited',
  )
  const active = memberships.filter((m) => m.status === 'active')
  const invitations = state.invitations.filter(
    (i) => i.scope.kind === 'agency' && i.scope.agencyId === agencyId && i.status === 'pending',
  )
  const budgetIds = new Set(state.budgets.filter((b) => b.agencyId === agencyId).map((b) => b.id))
  const month = now.slice(0, 7)
  // Fixed while the cancel sheet is open, so its copy does not change once the invitation expires.
  const cancelling = state.invitations.find((i) => i.id === cancelId)

  const rows: Row[] = memberships.map((m) => {
    const user = state.users.find((u) => u.id === m.userId)
    const allowances = state.allowances.filter(
      (a) =>
        a.status === 'active' &&
        a.holder.kind === 'member' &&
        a.holder.userId === m.userId &&
        budgetIds.has(a.budgetId),
    )
    const spent = sum(
      state.requests.filter(
        (r) =>
          r.agencyId === agencyId &&
          r.requester.kind === 'user' &&
          r.requester.userId === m.userId &&
          r.status === 'completed' &&
          r.createdAt.startsWith(month),
      ),
      (r) => r.amount,
    )
    return {
      membership: m,
      name: user?.name ?? 'Unknown person',
      email: user?.email ?? '',
      title: user?.title ?? '',
      budgets: allowances.length,
      allowance: sum(allowances, (a) => a.periodLimit),
      spent,
    }
  })

  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <PersonAvatar name={row.original.name} size="sm" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{row.original.name}</span>
            <span className="truncate text-xs text-subtle">{row.original.email}</span>
          </span>
        </span>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: ({ row }) => {
        const Icon = roleIcons[row.original.membership.role]
        return (
          <Tag>
            <Icon className="size-2.5" aria-hidden="true" /> {roleLabel[row.original.membership.role]}
          </Tag>
        )
      },
    },
    {
      accessorKey: 'budgets',
      header: 'Budgets',
      cell: ({ row }) => <span className="text-sm text-muted-foreground num">{row.original.budgets}</span>,
    },
    {
      accessorKey: 'allowance',
      header: 'Allowance',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.allowance} size="sm" />,
    },
    {
      accessorKey: 'spent',
      header: 'Spent this month',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.spent} size="sm" />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={
            row.original.membership.status === 'active'
              ? { label: 'Active', tone: 'success' }
              : { label: 'Removed', tone: 'neutral' }
          }
        />
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Team"
        description="People in the Agency, their role, and the spending access they have."
        meta={
          <span className="text-sm text-subtle">
            {pluralize(active.length, 'person', 'people')}
            {invitations.length ? ` · ${pluralize(invitations.length, 'pending invitation')}` : ''}
          </span>
        }
        actions={
          can('manage_team') ? (
            <Button size="pill" onClick={() => setInviteOpen(true)}>
              <UserPlus data-icon="inline-start" /> Invite member
            </Button>
          ) : null
        }
      />

      <PageTabs
        tabs={[
          {
            value: 'members',
            label: 'Members',
            count: active.length,
            content: (
              <DataTable
                data={rows}
                columns={columns}
                searchPlaceholder="Search people"
                searchText={(r) => `${r.name} ${r.email} ${r.title}`}
                facets={[
                  {
                    id: 'role',
                    label: 'Role',
                    accessor: (r) => r.membership.role,
                    options: [
                      { value: 'agency_admin', label: 'Agency Admins' },
                      { value: 'member', label: 'Members' },
                    ],
                  },
                  {
                    id: 'status',
                    label: 'Status',
                    accessor: (r) => r.membership.status,
                    options: [
                      { value: 'active', label: 'Active' },
                      { value: 'revoked', label: 'Removed' },
                    ],
                  },
                ]}
                onRowClick={(r) => router.push(href(`team/${r.membership.userId}`))}
                initialSorting={[{ id: 'name', desc: false }]}
                renderMobile={(r) => (
                  <div className="flex items-center gap-3">
                    <PersonAvatar name={r.name} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{r.name}</span>
                      <span className="truncate text-xs text-subtle">
                        {roleLabel[r.membership.role]} · {formatUsd(r.allowance)} allowance
                      </span>
                    </span>
                    {r.membership.status === 'revoked' ? (
                      <StatusBadge status={{ label: 'Removed', tone: 'neutral' }} />
                    ) : null}
                  </div>
                )}
                empty={
                  <EmptyState
                    compact
                    icon={<Users />}
                    title="No people yet"
                    description="Invite the people who will spend from the Agency’s budgets."
                  />
                }
              />
            ),
          },
          {
            value: 'invitations',
            label: 'Pending invitations',
            count: invitations.length,
            content:
              invitations.length === 0 ? (
                <EmptyState
                  icon={<MailPlus />}
                  title="No pending invitations"
                  description="People you invite appear here until they join."
                />
              ) : (
                <ul className="surface flex flex-col divide-y divide-border overflow-hidden rounded-xl">
                  {invitations.map((i) => (
                    <li key={i.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <PersonAvatar name={i.name} size="md" />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">{i.name}</span>
                          <span className="truncate text-xs text-subtle">
                            {i.email} · {roleLabel[i.role]} · invited {formatDate(i.createdAt)} by{' '}
                            {userName(state, i.invitedBy)}
                          </span>
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2">
                        <InvitationLink
                          variant="actions"
                          invitation={i}
                          workspace={agency?.name ?? 'the Agency'}
                          inviter={userName(state, i.invitedBy)}
                        />
                        {can('manage_team') ? (
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
              ),
          },
        ]}
      />

      <InviteSheet
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        scope={{ agencyId }}
        roles={['member', 'agency_admin']}
        workspaceName={agency?.name ?? 'the Agency'}
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
          policy: 'Only Agency Admins manage who joins the Agency.',
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

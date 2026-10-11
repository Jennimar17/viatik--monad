'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { MailPlus, UserPlus, Users } from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { PeopleToJustifyList, personStatus, RemindButton } from '@/components/app/accountability-parts'
import { InvitationLink } from '@/components/app/invitation-link'
import { InviteSheet } from '@/components/app/invite-sheet'
import { PageTabs } from '@/components/app/page-tabs'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { useTabParam } from '@/components/app/use-tab-param'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar, roleIcons } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import {
  accountabilityByPerson,
  JUSTIFY_WITHIN_DAYS,
  type PersonAccountability,
} from '@/domain/accountability'
import { formatUsd, sum, ZERO, type Cents } from '@/domain/money'
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
  /** Money for purchases still to justify. */
  toJustify: Cents
  /** What they still owe, if anything (money to justify or vendor receipts). */
  owing?: PersonAccountability
}

const TABS = ['members', 'receipts', 'invitations'] as const

/** Where a person's receipts stand, for the Receipts filter. */
const receiptsState = (owing: PersonAccountability | undefined) =>
  !owing ? 'none' : owing.overdueCount > 0 ? 'overdue' : 'pending'

export default function TeamPage() {
  // useSearchParams (the open tab) needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <Team />
    </React.Suspense>
  )
}

/** People in the Agency, who still owes receipts (`?tab=receipts`), and pending invitations. */
function Team() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const { can } = usePermissions()
  const tabs = useTabParam(TABS, 'members')
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
  // Everyone with money for purchases to justify or vendor receipts missing, most overdue first.
  const people = accountabilityByPerson(state, agencyId, now)
  const owingBy = new Map(people.map((p) => [p.userId, p]))
  const overdueTotal = sum(people, (p) => p.overdue)
  const pendingTotal = sum(people, (p) => p.pending)

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
      toJustify: owingBy.get(m.userId)?.pending ?? ZERO,
      owing: owingBy.get(m.userId),
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
      accessorKey: 'toJustify',
      header: 'To justify',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const { owing, toJustify } = row.original
        if (!owing) return <span className="text-sm text-subtle">—</span>
        return (
          <span className="flex flex-col items-end gap-1">
            {toJustify > 0 ? <Amount value={toJustify} size="sm" /> : null}
            {owing.overdueCount > 0 || toJustify === 0 ? <StatusBadge status={personStatus(owing)} /> : null}
          </span>
        )
      },
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
          <>
            {/* Renders nothing when nobody can be reminded; stays (disabled) once everyone was reminded. */}
            <RemindButton agencyId={agencyId} people={people} size="pill" />
            {can('manage_team') ? (
              <Button size="pill" onClick={() => setInviteOpen(true)}>
                <UserPlus data-icon="inline-start" /> Invite member
              </Button>
            ) : null}
          </>
        }
      />

      <PageTabs
        {...tabs}
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
                  {
                    id: 'receipts',
                    label: 'Receipts',
                    accessor: (r) => receiptsState(r.owing),
                    options: [
                      { value: 'overdue', label: 'Receipts overdue' },
                      { value: 'pending', label: 'Receipts pending' },
                      { value: 'none', label: 'Up to date' },
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
                        {r.toJustify > 0 ? ` · ${formatUsd(r.toJustify)} to justify` : ''}
                      </span>
                    </span>
                    {r.membership.status === 'revoked' ? (
                      <StatusBadge status={{ label: 'Removed', tone: 'neutral' }} />
                    ) : r.owing && r.owing.overdueCount > 0 ? (
                      <StatusBadge status={personStatus(r.owing)} />
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
            value: 'receipts',
            label: 'Receipts pending',
            count: people.length,
            content: (
              <Panel
                title="Who still owes receipts"
                description={
                  pendingTotal > 0
                    ? `${formatUsd(pendingTotal, { withCode: true })} to justify${overdueTotal > 0 ? `, ${formatUsd(overdueTotal, { withCode: true })} overdue` : ''}. Reminders go out at most once a day per person.`
                    : people.length > 0
                      ? 'Only receipts for vendor payments are missing. People add them from Expenses.'
                      : `Money for purchases is justified with receipts within ${JUSTIFY_WITHIN_DAYS} days.`
                }
              >
                <PeopleToJustifyList
                  people={people}
                  now={now}
                  personHref={(userId) => href(`team/${userId}`)}
                  action={(person) => <RemindButton agencyId={agencyId} person={person} />}
                />
              </Panel>
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

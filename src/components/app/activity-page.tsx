'use client'

import { Download, History } from 'lucide-react'
import * as React from 'react'

import { ActivityList } from '@/components/app/activity'
import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { actorName, agencyName } from '@/domain/queries'
import type { ActivityType } from '@/domain/types'
import { csvCell, pluralize } from '@/lib/format'

type Group = 'funding' | 'payments' | 'budgets' | 'bills' | 'team'

const GROUP_LABEL: Record<Group, string> = {
  funding: 'Funding',
  payments: 'Payments',
  budgets: 'Budgets and access',
  bills: 'Bills and receipts',
  team: 'Team and automations',
}

/** Every activity type belongs to one filter group; the type keeps the map complete. */
const GROUP_OF: Record<ActivityType, Group> = {
  agreement_created: 'funding',
  agreement_paused: 'funding',
  agreement_frozen: 'funding',
  capital_deposited: 'funding',
  agreement_funded: 'funding',
  tranche_requested: 'funding',
  milestone_submitted: 'funding',
  milestone_changes_requested: 'funding',
  tranche_released: 'funding',
  account_created: 'budgets',
  funds_transferred: 'payments',
  budget_created: 'budgets',
  budget_paused: 'budgets',
  budget_resumed: 'budgets',
  allowance_assigned: 'budgets',
  allowance_revoked: 'budgets',
  payment_requested: 'payments',
  payment_approved: 'payments',
  payment_declined: 'payments',
  payment_completed: 'payments',
  policy_rejected: 'payments',
  bill_added: 'bills',
  bill_reconciled: 'bills',
  expense_added: 'bills',
  member_invited: 'team',
  member_joined: 'team',
  agent_created: 'team',
  agent_paused: 'team',
  agent_resumed: 'team',
  agency_created: 'team',
  portfolio_created: 'funding',
  funds_withdrawn: 'payments',
  destination_updated: 'payments',
}

const GROUP_OPTIONS = [
  { value: 'all', label: 'All events' },
  ...(Object.keys(GROUP_LABEL) as Group[]).map((group) => ({ value: group, label: GROUP_LABEL[group] })),
]

const RANGE_OPTIONS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
]

const ACTOR_OPTIONS = [
  { value: 'all', label: 'People and AI Agents' },
  { value: 'people', label: 'People only' },
  { value: 'automation', label: 'AI Agents only' },
]

const DEFAULT_RANGE = '30'
const PAGE = 40
const DAY = 86_400_000

/**
 * The activity log of a workspace, grouped by day. Investors see the whole
 * portfolio, Agency Admins their Agency, Members only what involves them.
 */
export function ActivityPage({ description }: { description: string }) {
  const { state, now, userId } = useViatikState()
  const { role, agencyId, portfolioId } = useRole()
  const [group, setGroup] = React.useState('all')
  const [range, setRange] = React.useState(DEFAULT_RANGE)
  const [actor, setActor] = React.useState('all')
  const [agency, setAgency] = React.useState('all')
  const [limit, setLimit] = React.useState(PAGE)

  const scoped = React.useMemo(
    () =>
      state.activity
        .filter((a) => {
          if (role === 'member') {
            return (
              a.agencyId === agencyId &&
              (a.subjectUserId === userId || (a.actor.kind === 'user' && a.actor.userId === userId))
            )
          }
          if (role === 'agency_admin') return a.agencyId === agencyId
          return a.portfolioId === portfolioId
        })
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [state.activity, role, agencyId, portfolioId, userId],
  )

  const since = range === 'all' ? '' : new Date(new Date(now).getTime() - Number(range) * DAY).toISOString()
  const items = scoped.filter(
    (a) =>
      (!since || a.createdAt >= since) &&
      (group === 'all' || GROUP_OF[a.type] === group) &&
      (actor === 'all' || (actor === 'automation' ? a.actor.kind === 'ai_agent' : a.actor.kind === 'user')) &&
      (agency === 'all' || a.agencyId === agency),
  )
  const filtered = group !== 'all' || range !== DEFAULT_RANGE || actor !== 'all' || agency !== 'all'
  const agencies = state.agencies.filter((a) => a.portfolioId === portfolioId)

  const clearFilters = () => {
    setGroup('all')
    setRange(DEFAULT_RANGE)
    setActor('all')
    setAgency('all')
    setLimit(PAGE)
  }

  const exportCsv = () => {
    const header = ['Date', 'Actor', 'Event', 'Amount (USD)', 'Agency']
    const rows = items.map((a) => [
      a.createdAt,
      actorName(state, a.actor),
      a.summary,
      a.amount !== undefined ? (a.amount / 100).toFixed(2) : '',
      a.agencyId ? agencyName(state, a.agencyId) : '',
    ])
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `viatik-activity-${now.slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Activity"
        description={description}
        actions={
          <Button variant="outline" size="pill" onClick={exportCsv} disabled={items.length === 0}>
            <Download data-icon="inline-start" /> Export CSV
          </Button>
        }
      />

      {scoped.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Event type" htmlFor="activity-group">
            <SimpleSelect
              id="activity-group"
              value={group}
              onValueChange={setGroup}
              options={GROUP_OPTIONS}
            />
          </FormField>
          <FormField label="Period" htmlFor="activity-range">
            <SimpleSelect
              id="activity-range"
              value={range}
              onValueChange={setRange}
              options={RANGE_OPTIONS}
            />
          </FormField>
          {role !== 'member' ? (
            <FormField label="Who" htmlFor="activity-actor">
              <SimpleSelect
                id="activity-actor"
                value={actor}
                onValueChange={setActor}
                options={ACTOR_OPTIONS}
              />
            </FormField>
          ) : null}
          {role === 'investor' ? (
            <FormField label="Agency" htmlFor="activity-agency">
              <SimpleSelect
                id="activity-agency"
                value={agency}
                onValueChange={setAgency}
                options={[
                  { value: 'all', label: 'All agencies' },
                  ...agencies.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </FormField>
          ) : null}
        </div>
      ) : null}

      <Panel>
        {scoped.length === 0 ? (
          <EmptyState
            compact
            icon={<History />}
            title="No activity yet"
            description="Funding, budgets, payments and team changes will show up here as they happen."
          />
        ) : items.length === 0 ? (
          <EmptyState
            compact
            title="No activity for these filters"
            description="Try a longer period or another event type."
            action={
              <Button variant="outline" size="pill-sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <p className="pb-3 text-xs text-subtle">
              {pluralize(items.length, 'event')}
              {filtered ? ' match these filters' : ` in the last ${DEFAULT_RANGE} days`}
            </p>
            <ActivityList
              state={state}
              records={items.slice(0, limit)}
              now={now}
              grouped
              showAgency={role === 'investor'}
            />
            {items.length > limit ? (
              <Button
                variant="ghost"
                size="pill-sm"
                className="mt-4 self-center"
                onClick={() => setLimit(limit + PAGE)}
              >
                Show {Math.min(PAGE, items.length - limit)} older
              </Button>
            ) : null}
          </>
        )}
      </Panel>
    </div>
  )
}

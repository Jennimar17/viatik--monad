'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { OctagonX, Pencil, PlayCircle } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ChipSelect, FormField, PillInput } from '@/components/app/form-controls'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyBarChart } from '@/components/viatik/charts'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { MoneyInput } from '@/components/viatik/forms'
import { HairlineGrid, KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { AgentAvatar } from '@/components/viatik/people'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, sum, type Cents } from '@/domain/money'
import { joinList } from '@/domain/policy'
import { budgetName, destinationName, userName } from '@/domain/queries'
import { agentSpentToday, committedAt, lastMonths } from '@/domain/selectors'
import { agentStatus } from '@/domain/status'
import type { AgentDecision, PaymentRequest } from '@/domain/types'
import { formatDate, formatDateTime, fromDateInput, pluralize } from '@/lib/format'

const DAY = 86_400_000
const DAYS_SHOWN = 14
/** Requests that count as spending: approved holds, settling and settled payments. */
const SPENT: ReadonlySet<PaymentRequest['status']> = new Set(['approved', 'processing', 'completed'])

const decisionBadge = {
  approved: { label: 'Allowed', tone: 'success' },
  rejected: { label: 'Denied', tone: 'danger' },
  needs_approval: { label: 'Needs approval', tone: 'warning' },
} as const

type SheetKind = 'pause' | 'edit'

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>()
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const pause = useCommand('setAgentPaused')
  const update = useCommand('updateAgentPolicy')
  const [sheet, setSheet] = React.useState<SheetKind | null>(null)
  // Fixed when the pause sheet opens, so its copy does not flip once the command lands.
  const [pausing, setPausing] = React.useState(true)
  const [dailyCap, setDailyCap] = React.useState<Cents | null>(null)
  const [perOperation, setPerOperation] = React.useState<Cents | null>(null)
  const [providers, setProviders] = React.useState<string[]>([])
  const [expires, setExpires] = React.useState('')

  const agent = state.agents.find((a) => a.id === agentId && a.agencyId === agencyId)
  if (!agent) {
    return (
      <ScreenUnavailable
        title="Automation not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const canConfigure = can('configure_ai_agent')
  const paused = agent.status === 'paused'
  const decisions = state.agentDecisions
    .filter((d) => d.agentId === agent.id)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
  const requests = state.requests.filter(
    (r) => r.requester.kind === 'ai_agent' && r.requester.agentId === agent.id && SPENT.has(r.status),
  )
  const today = agentSpentToday(state, agent.id, now)
  const dayStart = (offset: number) => {
    const date = new Date(now)
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset)
  }
  const dayLabel = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  const days = Array.from({ length: DAYS_SHOWN }, (_, i) => {
    const start = dayStart(DAYS_SHOWN - 1 - i)
    const end = start + DAY
    return {
      day: dayLabel.format(new Date(start)),
      spent: sum(
        requests.filter((r) => {
          const at = new Date(committedAt(r)).getTime()
          return at >= start && at < end
        }),
        (r) => r.amount,
      ),
    }
  })
  const hasSpend = days.some((d) => d.spent > 0)
  const month = lastMonths(now, 1)[0]
  const thisMonth = requests.filter(
    (r) => month && committedAt(r) >= month.start && committedAt(r) < month.end,
  )
  const monthTotal = sum(thisMonth, (r) => r.amount)
  const denied = decisions.filter((d) => d.outcome === 'rejected').length
  const agencyDestinations = state.destinations.filter(
    (d) =>
      d.agencyId === agent.agencyId &&
      (d.status === 'approved' || agent.allowedDestinationIds.includes(d.id)),
  )
  const budget = state.budgets.find((b) => b.id === agent.budgetId)
  const expiresAt = fromDateInput(expires)
  const editErrors = {
    dailyCap: dailyCap && dailyCap > 0 ? undefined : 'Set a daily cap.',
    perOperation:
      perOperation && perOperation > 0
        ? dailyCap && perOperation > dailyCap
          ? 'Cannot exceed the daily cap.'
          : budget && perOperation > budget.perOperationLimit
            ? `Cannot exceed the budget’s ${formatUsd(budget.perOperationLimit, { withCode: true })} per-payment limit.`
            : undefined
        : 'Set a per-operation maximum.',
    providers: providers.length > 0 ? undefined : 'Choose at least one provider.',
    expires: expiresAt && expiresAt > now ? undefined : 'Pick a date in the future.',
  }
  const editValid = !Object.values(editErrors).some(Boolean)

  const openEdit = () => {
    setDailyCap(agent.dailyCap)
    setPerOperation(agent.perOperationMax)
    setProviders(agent.allowedDestinationIds)
    setExpires(agent.expiresAt.slice(0, 10))
    setSheet('edit')
  }
  const closeSheet = (open: boolean) => !open && setSheet(null)

  const columns: ColumnDef<AgentDecision, unknown>[] = [
    {
      accessorKey: 'at',
      header: 'Time',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.original.at)}
        </span>
      ),
    },
    {
      id: 'provider',
      header: 'Provider',
      cell: ({ row }) => (
        <span className="text-sm">{destinationName(state, row.original.destinationId)}</span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.amount} size="sm" />,
    },
    {
      id: 'outcome',
      header: 'Decision',
      cell: ({ row }) => <StatusBadge status={decisionBadge[row.original.outcome]} />,
    },
    {
      accessorKey: 'reason',
      header: 'Reason',
      cell: ({ row }) => (
        <span className="text-sm text-pretty text-muted-foreground">{row.original.reason}</span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('automations')} className="hover:text-foreground">
            Automations
          </Link>
        }
        title={
          <span className="flex items-center gap-4">
            <AgentAvatar size="lg" /> {agent.name}
          </span>
        }
        description={agent.purpose}
        meta={
          <>
            <StatusBadge status={agentStatus[agent.status]} size="md" pulse={agent.status === 'active'} />
            <span className="text-sm text-subtle">
              Managed by {userName(state, agent.managedBy)} · expires {formatDate(agent.expiresAt)}
            </span>
          </>
        }
        actions={
          canConfigure ? (
            <>
              <Button variant="outline" size="pill" onClick={openEdit}>
                <Pencil data-icon="inline-start" /> Edit policy
              </Button>
              <Button
                variant={paused ? 'default' : 'destructive'}
                size="pill"
                onClick={() => {
                  setPausing(!paused)
                  setSheet('pause')
                }}
              >
                {paused ? <PlayCircle data-icon="inline-start" /> : <OctagonX data-icon="inline-start" />}
                {paused ? 'Resume agent' : 'Pause agent'}
              </Button>
            </>
          ) : null
        }
      />

      {paused ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          Paused{agent.pausedAt ? ` ${formatDateTime(agent.pausedAt)}` : ''}. The automation cannot create new
          payments until you resume it.
        </div>
      ) : null}

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Spent today"
          value={today}
          hint={`Daily cap ${formatUsd(agent.dailyCap, { withCode: true })}`}
          emphasis
        />
        <KpiTile label="This month" value={monthTotal} hint={pluralize(thisMonth.length, 'payment')} />
        <KpiTile
          label="Decisions logged"
          value={<span className="font-display text-2xl leading-none">{decisions.length}</span>}
          hint="Every attempt is recorded"
        />
        <KpiTile
          label="Denied by policy"
          value={<span className="font-display text-2xl leading-none">{denied}</span>}
          hint="Blocked before any money moved"
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Daily spending"
          description={`Last ${DAYS_SHOWN} days, against the ${formatUsd(agent.dailyCap)} daily cap.`}
        >
          {hasSpend ? (
            <MoneyBarChart
              data={days}
              xKey="day"
              series={[{ key: 'spent', label: 'Spent', color: 'var(--color-info)' }]}
              className="h-56"
            />
          ) : (
            <EmptyState
              compact
              title="No automated spending yet"
              description="Payments the agent makes will show here by day."
            />
          )}
        </Panel>
        <Panel title="Policy">
          <div className="flex flex-col gap-4">
            <PolicySummary
              title="Deterministic rules"
              lines={[
                `At most ${formatUsd(agent.dailyCap, { withCode: true })} per day.`,
                `At most ${formatUsd(agent.perOperationMax, { withCode: true })} per payment.`,
                `Only pays ${joinList(agent.allowedDestinationIds.map((id) => destinationName(state, id)))}.`,
                `Spends from ${budgetName(state, agent.budgetId)} and never touches other accounts.`,
                `Stops automatically on ${formatDate(agent.expiresAt)}.`,
              ]}
            />
            <KeyValueList
              dense
              items={[
                {
                  label: 'Working balance limit',
                  value: formatUsd(agent.workingBalanceLimit, { withCode: true }),
                },
                { label: 'Created', value: formatDate(agent.createdAt) },
              ]}
            />
          </div>
        </Panel>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Decision log</h2>
        <DataTable
          data={decisions}
          columns={columns}
          initialSorting={[{ id: 'at', desc: true }]}
          searchPlaceholder="Search decisions"
          searchText={(d) => `${destinationName(state, d.destinationId)} ${d.reason}`}
          facets={[
            {
              id: 'outcome',
              label: 'Decision',
              accessor: (d) => d.outcome,
              options: [
                { value: 'approved', label: 'Allowed' },
                { value: 'rejected', label: 'Denied' },
                { value: 'needs_approval', label: 'Needs approval' },
              ],
            },
          ]}
          renderMobile={(d) => (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{destinationName(state, d.destinationId)}</span>
                <Amount value={d.amount} size="sm" />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-subtle">{formatDateTime(d.at)}</span>
                <StatusBadge status={decisionBadge[d.outcome]} />
              </div>
              <span className="text-xs text-pretty text-muted-foreground">{d.reason}</span>
            </div>
          )}
          empty={
            <EmptyState
              compact
              title="No decisions yet"
              description="Every payment the agent attempts is logged here with the rule that allowed or denied it."
            />
          }
        />
      </section>

      <ApprovalSheet
        open={sheet === 'pause'}
        onOpenChange={closeSheet}
        onClosed={pause.reset}
        title={pausing ? 'Pause agent' : 'Resume agent'}
        summary={{
          what: pausing
            ? `${agent.name} stops immediately. It cannot create new holds or payments.`
            : `${agent.name} can make payments again within its policy.`,
          reversible: 'You can change this at any time.',
          policy: 'The emergency pause is enforced at settlement, not only in the app.',
        }}
        confirmLabel={pausing ? 'Pause agent' : 'Resume agent'}
        confirmVariant={pausing ? 'destructive' : 'default'}
        phase={pause.phase}
        error={pause.error}
        onConfirm={() => pause.run({ agentId: agent.id, paused: pausing })}
        success={{
          title: pausing ? 'Agent paused' : 'Agent resumed',
          body: pausing ? 'No automated payment can be made now.' : 'Automated payments are enabled again.',
        }}
      />

      <ApprovalSheet
        open={sheet === 'edit'}
        onOpenChange={closeSheet}
        onClosed={update.reset}
        title="Edit policy"
        description={agent.name}
        summary={{
          what: `The new limits apply to ${agent.name}’s next payment.`,
          reversible: 'You can edit the policy again at any time.',
          policy: 'The per-operation maximum cannot exceed the daily cap or the budget’s per-payment limit.',
        }}
        confirmLabel="Save policy"
        disabled={!editValid}
        phase={update.phase}
        error={update.error}
        onConfirm={() =>
          dailyCap &&
          perOperation &&
          expiresAt &&
          update.run({
            agentId: agent.id,
            dailyCap,
            perOperationMax: perOperation,
            allowedDestinationIds: providers,
            expiresAt,
          })
        }
        success={{ title: 'Policy saved', body: 'The new limits are active for the next payment.' }}
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Daily cap" htmlFor="edit-cap" error={editErrors.dailyCap}>
              <MoneyInput id="edit-cap" value={dailyCap} onChange={setDailyCap} />
            </FormField>
            <FormField label="Per-operation maximum" htmlFor="edit-per-op" error={editErrors.perOperation}>
              <MoneyInput
                id="edit-per-op"
                value={perOperation}
                onChange={setPerOperation}
                invalid={Boolean(editErrors.perOperation)}
              />
            </FormField>
          </div>
          <FormField label="Allowed providers" error={editErrors.providers}>
            <ChipSelect
              ariaLabel="Allowed providers"
              value={providers}
              onChange={setProviders}
              options={agencyDestinations.map((d) => ({ value: d.id, label: d.name }))}
            />
          </FormField>
          <FormField label="Expires on" htmlFor="edit-expires" error={editErrors.expires}>
            <PillInput
              id="edit-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </FormField>
        </div>
      </ApprovalSheet>
    </div>
  )
}

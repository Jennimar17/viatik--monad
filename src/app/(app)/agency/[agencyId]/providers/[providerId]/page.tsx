'use client'

import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  PlayCircle,
} from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ActivityList } from '@/components/app/activity'
import { BillsTable } from '@/components/app/bills-table'
import { destinationKindLabel } from '@/components/app/money-setup'
import { PaymentsTable } from '@/components/app/payments-table'
import {
  isMovementTo,
  providerKindLine,
  providerStatus,
  providerSummary,
  providerWebsiteHref,
} from '@/components/app/provider-parts'
import {
  ProviderEditSheet,
  ProviderStatusSheet,
  providerActionLabel,
  providerStatusActions,
  type ProviderStatusAction,
} from '@/components/app/provider-sheets'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoneyBarChart } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { spendByMonth } from '@/domain/selectors'
import { agentStatus, budgetStatus } from '@/domain/status'
import { seriesColor } from '@/lib/chart-colors'
import { pluralize } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

const actionIcons: Record<ProviderStatusAction, React.ReactNode> = {
  pause: <PauseCircle className="size-4" />,
  resume: <PlayCircle className="size-4" />,
  archive: <Archive className="size-4" />,
  restore: <ArchiveRestore className="size-4" />,
}

export default function ProviderDetailPage() {
  const { providerId } = useParams<{ providerId: string }>()
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const [sheet, setSheet] = React.useState<'edit' | 'status' | null>(null)
  // Fixed when the status sheet opens, so its copy does not flip once the change lands.
  const [action, setAction] = React.useState<ProviderStatusAction>('pause')

  const provider = state.destinations.find((d) => d.id === providerId && d.agencyId === agencyId)
  if (!provider) {
    return (
      <ScreenUnavailable
        title="Provider not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const canManage = can('send_payment')
  const summary = providerSummary(state, provider, now)
  const actions = providerStatusActions(provider.status)
  // A stopped provider's way back is the main action; pausing and archiving sit in the menu.
  const restoreAction = actions.find((a) => a === 'resume' || a === 'restore')
  const menuActions = actions.filter((a) => a !== restoreAction)
  const website = providerWebsiteHref(provider.website)
  const monthly = spendByMonth(
    state,
    { agencyId: provider.agencyId },
    (m) => (isMovementTo(m, provider.id) ? 'paid' : null),
    now,
    6,
  )
  const hasSpend = monthly.some((row) => Number(row.paid ?? 0) > 0)
  const openBudgets = state.budgets.filter(
    (b) => b.agencyId === provider.agencyId && b.status !== 'closed' && b.allowedDestinationIds.length === 0,
  )
  // Sent before a pause or archive, these still wait for a decision: the status sheet points them out.
  const pendingRequests = state.requests.filter(
    (r) =>
      r.agencyId === provider.agencyId &&
      r.status === 'needs_approval' &&
      r.destination.kind === 'destination' &&
      r.destination.destinationId === provider.id,
  ).length
  const history = state.activity
    .filter((a) => a.entity.kind === 'destination' && a.entity.id === provider.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  const openStatus = (next: ProviderStatusAction) => {
    setAction(next)
    setSheet('status')
  }
  const closeSheet = (open: boolean) => !open && setSheet(null)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('providers')} className="hover:text-foreground">
            Providers
          </Link>
        }
        title={
          <span className="flex items-center gap-4">
            <OrgAvatar name={provider.name} size="lg" /> <span className="min-w-0">{provider.name}</span>
          </span>
        }
        description={providerKindLine(provider)}
        meta={
          <>
            <StatusBadge status={providerStatus[provider.status]} size="md" />
            <span className="text-sm text-subtle">Added {formatLocalDate(provider.addedAt)}</span>
          </>
        }
        actions={
          canManage ? (
            <>
              {menuActions.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="outline" size="icon-pill" aria-label="More actions" />}
                  >
                    <MoreHorizontal />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 p-1.5">
                    {menuActions.map((a) => (
                      <DropdownMenuItem
                        key={a}
                        className="gap-2 rounded-lg"
                        variant={a === 'archive' ? 'destructive' : 'default'}
                        onClick={() => openStatus(a)}
                      >
                        {actionIcons[a]} {providerActionLabel[a]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              <Button variant="outline" size="pill" onClick={() => setSheet('edit')}>
                <Pencil data-icon="inline-start" /> Edit details
              </Button>
              {restoreAction ? (
                <Button size="pill" onClick={() => openStatus(restoreAction)}>
                  {restoreAction === 'resume' ? (
                    <PlayCircle data-icon="inline-start" />
                  ) : (
                    <ArchiveRestore data-icon="inline-start" />
                  )}
                  {providerActionLabel[restoreAction]}
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {provider.status === 'paused' ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-pretty">
          Paused. New payments, bill payments and requests to {provider.name} are refused until{' '}
          {canManage ? 'you resume it' : 'an Agency Admin resumes it'}.
        </div>
      ) : provider.status === 'archived' ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-pretty">
          Archived. {provider.name} is hidden from the current providers and cannot be paid. Its history stays
          here{canManage ? '; restore it to pay it again' : ''}.
        </div>
      ) : provider.status === 'pending_review' ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-pretty">
          Waiting for review. {provider.name} cannot be paid until it is approved.
        </div>
      ) : null}

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Paid in total"
          value={summary.totalPaid}
          hint={pluralize(summary.completed.length, 'payment')}
          emphasis
        />
        <KpiTile
          label="Paid this month"
          value={summary.paidThisMonth}
          hint={summary.lastPaidAt ? `Last paid ${formatLocalDate(summary.lastPaidAt)}` : 'Not paid yet'}
        />
        <KpiTile
          label="Scheduled"
          value={summary.scheduledTotal}
          hint={summary.scheduled.length ? `${summary.scheduled.length} upcoming` : 'Nothing scheduled'}
        />
        <KpiTile
          label="Bills to pay"
          value={summary.openBillsTotal}
          hint={
            summary.overdueBills.length
              ? `${pluralize(summary.overdueBills.length, 'bill')} overdue`
              : summary.openBills.length
                ? pluralize(summary.openBills.length, 'bill')
                : 'Nothing to pay'
          }
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Paid by month"
          description="Completed payments, last six months."
        >
          {hasSpend ? (
            <MoneyBarChart
              data={monthly}
              series={[{ key: 'paid', label: 'Paid', color: seriesColor(0) }]}
              className="h-56"
            />
          ) : (
            <EmptyState
              compact
              title="Nothing paid recently"
              description={`Payments to ${provider.name} will show here by month.`}
            />
          )}
        </Panel>
        <Panel title="Details">
          <KeyValueList
            items={[
              { label: 'Type', value: destinationKindLabel[provider.kind] },
              { label: 'Category', value: categoryLabel[provider.category] },
              { label: 'Payment reference', value: provider.settlementLabel || 'Not set' },
              {
                label: 'Website',
                value: website ? (
                  <a
                    href={website}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
                  >
                    {website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                    <ExternalLink className="size-3.5 text-subtle" aria-hidden="true" />
                  </a>
                ) : (
                  (provider.website ?? 'Not set')
                ),
              },
              { label: 'Status', value: <StatusBadge status={providerStatus[provider.status]} /> },
              { label: 'Added', value: formatLocalDate(provider.addedAt) },
            ]}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Where it is used"
          description="Budgets that name it as an allowed destination, and automations that can pay it."
        >
          <div className="flex flex-col gap-4">
            {summary.budgets.length === 0 ? (
              <p className="text-sm text-pretty text-muted-foreground">
                No budget lists {provider.name} by name.
                {openBudgets.length
                  ? ` ${pluralize(openBudgets.length, 'budget')} without a list of destinations can pay any approved provider.`
                  : ''}
              </p>
            ) : (
              <ul className="flex flex-col">
                {summary.budgets.map((b) => (
                  <li
                    key={b.id}
                    className="flex items-center justify-between gap-3 border-t border-border py-2.5 text-sm first:border-t-0"
                  >
                    <span className="flex min-w-0 flex-col">
                      <Link href={href(`budgets/${b.id}`)} className="truncate font-medium hover:underline">
                        {b.name}
                      </Link>
                      <span className="text-xs text-subtle">
                        Up to {formatUsd(b.perOperationLimit, { withCode: true })} per payment
                      </span>
                    </span>
                    <StatusBadge status={budgetStatus[b.status]} />
                  </li>
                ))}
              </ul>
            )}
            {summary.agents.length > 0 ? (
              <ul className="flex flex-col border-t border-border pt-2">
                {summary.agents.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="flex min-w-0 flex-col">
                      <Link
                        href={href(`automations/${a.id}`)}
                        className="truncate font-medium hover:underline"
                      >
                        {a.name}
                      </Link>
                      <span className="text-xs text-subtle">
                        Automation · up to {formatUsd(a.perOperationMax, { withCode: true })} per payment
                      </span>
                    </span>
                    <StatusBadge status={agentStatus[a.status]} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Panel>
        <Panel title="History" description="Changes to this provider and who made them.">
          {history.length === 0 ? (
            <EmptyState
              compact
              title="No changes yet"
              description="Edits, pauses and archives of this provider appear here."
            />
          ) : (
            <ActivityList state={state} records={history} now={now} />
          )}
        </Panel>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Payments</h2>
        <PaymentsTable
          payments={summary.payments}
          empty={
            <EmptyState
              compact
              title="No payments yet"
              description={`Payments to ${provider.name} appear here with their budget and receipt.`}
            />
          }
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Bills</h2>
        <BillsTable bills={summary.bills} emptyTitle={`No bills from ${provider.name}`} />
      </section>

      {canManage ? (
        <>
          <ProviderEditSheet open={sheet === 'edit'} onOpenChange={closeSheet} provider={provider} />
          <ProviderStatusSheet
            open={sheet === 'status'}
            onOpenChange={closeSheet}
            provider={provider}
            action={action}
            openBills={{ count: summary.openBills.length, total: summary.openBillsTotal }}
            pendingRequests={pendingRequests}
          />
        </>
      ) : null}
    </div>
  )
}

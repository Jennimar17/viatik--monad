'use client'

import { ArrowRight, ExternalLink, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { AgreementProgress, MilestoneTimelineFor } from '@/components/app/funding-parts'
import { inviteHref } from '@/components/app/nav'
import { PageTabs } from '@/components/app/page-tabs'
import { PaymentsTable } from '@/components/app/payments-table'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyBarChart } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { CapitalStateList, KpiTile, UsageBar } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { OrgAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { agencyTypeLabel, categoryLabel } from '@/domain/labels'
import { roleLabel } from '@/domain/permissions'
import { userName } from '@/domain/queries'
import { agencyCapital, budgetUsage, spendByMonth } from '@/domain/selectors'
import { agencyStatus, agreementStatus, budgetStatus } from '@/domain/status'
import type { SpendingCategory } from '@/domain/types'
import { seriesColor, seriesKey } from '@/lib/chart-colors'
import { formatDate, pluralize } from '@/lib/format'

export default function InvestorAgencyDetailPage() {
  const { agencyId } = useParams<{ agencyId: string }>()
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const pause = useCommand('setAgreementPaused')
  const [pauseOpen, setPauseOpen] = React.useState(false)
  // Fixed when the sheet opens: the refreshed status must not flip its copy.
  const [resuming, setResuming] = React.useState(false)

  const agency = state.agencies.find((a) => a.id === agencyId && a.portfolioId === portfolioId)
  if (!agency) {
    return (
      <ScreenUnavailable
        title="Agency not found"
        description="It may belong to another portfolio, or the link is out of date."
      />
    )
  }

  const agreement = state.agreements.find((a) => a.agencyId === agency.id && a.status !== 'cancelled')
  const capital = agencyCapital(state, agency.id, now)
  const budgets = state.budgets.filter((b) => b.agencyId === agency.id)
  const members = state.memberships.filter(
    (m) => m.scope.kind === 'agency' && m.scope.agencyId === agency.id && m.status === 'active',
  )
  const invitations = state.invitations.filter(
    (i) => i.scope.kind === 'agency' && i.scope.agencyId === agency.id && i.status === 'pending',
  )
  const payments = state.payments.filter((p) => p.agencyId === agency.id)
  const activity = state.activity.filter((a) => a.agencyId === agency.id).slice(0, 40)
  const review = agreement
    ? state.milestones.find((m) => m.agreementId === agreement.id && m.status === 'ready_for_review')
    : undefined
  const paused = agreement?.status === 'paused'
  const categories = Array.from(new Set(payments.map((p) => p.category))) as SpendingCategory[]
  const categorySeries = categories.map((category, i) => ({
    key: seriesKey(i),
    label: categoryLabel[category],
    color: seriesColor(i),
    category,
  }))
  const spend = spendByMonth(
    state,
    { agencyId: agency.id },
    (m) => {
      const category = state.payments.find((p) => p.id === m.refId)?.category
      return categorySeries.find((s) => s.category === category)?.key ?? null
    },
    now,
    6,
  )
  const hasSpend = spend.some((row) => categorySeries.some((s) => Number(row[s.key] ?? 0) > 0))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('agencies')} className="hover:text-foreground">
            Agencies
          </Link>
        }
        title={
          <span className="flex items-center gap-4">
            <OrgAvatar name={agency.name} size="lg" /> {agency.name}
          </span>
        }
        description={agency.description}
        meta={
          <>
            <Tag>{agencyTypeLabel[agency.type]}</Tag>
            {agreement ? (
              <StatusBadge status={agreementStatus[agreement.status]} size="md" />
            ) : (
              <StatusBadge status={agencyStatus[agency.status]} size="md" />
            )}
            {agency.website ? (
              <a
                href={agency.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-subtle hover:text-foreground"
              >
                Website <ExternalLink className="size-3" aria-hidden="true" />
              </a>
            ) : null}
          </>
        }
        actions={
          <>
            {agreement && (agreement.status === 'active' || paused) && can('freeze_agreement') ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon-pill" aria-label="More actions" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1.5">
                  <DropdownMenuItem
                    className="gap-2 rounded-lg"
                    onClick={() => {
                      setResuming(paused)
                      setPauseOpen(true)
                    }}
                  >
                    {paused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
                    {paused ? 'Resume agreement' : 'Pause agreement'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {review && agreement ? (
              <ButtonLink href={href(`funding/${agreement.id}/milestones/${review.id}`)} size="pill">
                Review milestone <ArrowRight data-icon="inline-end" />
              </ButtonLink>
            ) : agreement ? (
              <ButtonLink href={href(`funding/${agreement.id}`)} size="pill">
                Open agreement
              </ButtonLink>
            ) : (
              <ButtonLink href={href(`funding/new?agency=${agency.id}`)} size="pill">
                Create funding agreement
              </ButtonLink>
            )}
          </>
        }
      />

      {paused ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          The funding agreement is paused. Tranche releases are on hold; {agency.name} keeps operating with
          capital already released.
        </div>
      ) : null}

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Available to operate" value={capital.availableToOperate} emphasis />
        <KpiTile
          label="Allocated to budgets"
          value={capital.allocated}
          hint={pluralize(budgets.length, 'budget')}
        />
        <KpiTile label="Spent this month" value={capital.spentThisPeriod} />
        <KpiTile label="Spent since start" value={capital.states.spent} hint="All payments" />
      </HairlineGrid>

      <PageTabs
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: agreement ? (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <div className="flex flex-col gap-6 xl:col-span-2">
                  <Panel
                    title={agreement.title}
                    description={agreement.purpose}
                    action={
                      <ButtonLink href={href(`funding/${agreement.id}`)} variant="ghost" size="pill-sm">
                        Details <ArrowRight data-icon="inline-end" />
                      </ButtonLink>
                    }
                  >
                    <AgreementProgress state={state} agreement={agreement} />
                  </Panel>
                  <Panel title="Milestones">
                    <MilestoneTimelineFor
                      state={state}
                      agreementId={agreement.id}
                      actionFor={(tranche, milestone) =>
                        milestone?.status === 'ready_for_review' ? (
                          <ButtonLink
                            href={href(`funding/${agreement.id}/milestones/${milestone.id}`)}
                            size="pill-sm"
                          >
                            Review milestone
                          </ButtonLink>
                        ) : undefined
                      }
                    />
                  </Panel>
                </div>
                <Panel title="Capital states" description="Never merged into one balance.">
                  <CapitalStateList states={capital.states} />
                </Panel>
              </div>
            ) : (
              <EmptyState
                title="No funding agreement yet"
                description="Define the commitment, release schedule and milestones for this Agency."
                action={
                  <ButtonLink href={href(`funding/new?agency=${agency.id}`)} size="pill">
                    Create funding agreement
                  </ButtonLink>
                }
              />
            ),
          },
          {
            value: 'spending',
            label: 'Spending',
            content: (
              <div className="flex flex-col gap-6">
                <Panel title="Spending by category" description="Last six months. Read-only for Investors.">
                  {hasSpend ? (
                    <MoneyBarChart data={spend} series={categorySeries} className="h-64" />
                  ) : (
                    <EmptyState
                      compact
                      title="No spending yet"
                      description="Payments from the Agency’s budgets will show here by category."
                    />
                  )}
                </Panel>
                <Panel
                  title="Budgets"
                  description="Set by the Agency Admin within the agreement’s boundaries."
                >
                  {budgets.length === 0 ? (
                    <EmptyState
                      compact
                      title="No budgets yet"
                      description="The Agency Admin creates budgets once funding is released."
                    />
                  ) : (
                    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      {budgets.map((b) => {
                        const usage = budgetUsage(state, b, now)
                        return (
                          <li key={b.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
                            <span className="flex items-center justify-between gap-2 text-sm">
                              <span className="truncate font-medium">{b.name}</span>
                              <StatusBadge status={budgetStatus[b.status]} />
                            </span>
                            <UsageBar
                              used={usage.spentThisPeriod}
                              reserved={usage.reserved}
                              limit={b.periodLimit}
                              label={`${b.name} usage`}
                            />
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </Panel>
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-xl font-medium">Recent payments</h2>
                  <PaymentsTable
                    payments={payments}
                    pageSize={8}
                    empty={
                      <EmptyState
                        compact
                        title="No payments yet"
                        description="Payments the Agency makes will appear here with their receipts."
                      />
                    }
                  />
                </section>
              </div>
            ),
          },
          {
            value: 'team',
            label: 'Team',
            count: members.length,
            content: (
              <Panel
                title="People"
                description="Managed by the Agency Admin. Investors only see who has access."
              >
                {members.length === 0 && invitations.length === 0 ? (
                  <EmptyState
                    compact
                    title="No people yet"
                    description="The Agency Admin has not joined yet."
                  />
                ) : (
                  <ul className="flex flex-col">
                    {members.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                      >
                        <PersonAvatar name={userName(state, m.userId)} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{userName(state, m.userId)}</span>
                          <span className="text-xs text-subtle">Since {formatDate(m.createdAt)}</span>
                        </span>
                        <Tag>{roleLabel[m.role]}</Tag>
                      </li>
                    ))}
                    {invitations.map((i) => (
                      <li
                        key={i.id}
                        className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                      >
                        <PersonAvatar name={i.name} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{i.name}</span>
                          <span className="truncate text-xs text-subtle">
                            {i.email} · invited {formatDate(i.createdAt)}
                          </span>
                        </span>
                        <Tag>{roleLabel[i.role]}</Tag>
                        <ButtonLink href={inviteHref(i.code)} variant="outline" size="pill-sm">
                          Invitation link
                        </ButtonLink>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ),
          },
          {
            value: 'activity',
            label: 'Activity',
            content: (
              <Panel>
                {activity.length === 0 ? (
                  <EmptyState
                    compact
                    title="No activity yet"
                    description="Events in this Agency will show up here."
                  />
                ) : (
                  <ActivityList state={state} records={activity} now={now} grouped />
                )}
              </Panel>
            ),
          },
        ]}
      />

      {agreement ? (
        <ApprovalSheet
          open={pauseOpen}
          onOpenChange={setPauseOpen}
          onClosed={pause.reset}
          title={resuming ? 'Resume agreement' : 'Pause agreement'}
          description={agreement.title}
          summary={{
            what: resuming
              ? `${agreement.title} becomes active again. Pending tranche requests can be reviewed and released.`
              : `No tranche of ${agreement.title} can be released while it is paused. ${agency.name} keeps operating with capital already released.`,
            reversible: 'You can change this at any time.',
            policy:
              'Pausing is an Investor-only control, enforced by the funding contract, not only in the app.',
          }}
          confirmLabel={resuming ? 'Resume agreement' : 'Pause agreement'}
          confirmVariant={resuming ? 'default' : 'destructive'}
          phase={pause.phase}
          error={pause.error}
          onConfirm={() => pause.run({ agreementId: agreement.id, paused: !resuming })}
          success={{
            title: resuming ? 'Agreement resumed' : 'Agreement paused',
            body: `${agency.name} was notified.`,
          }}
        />
      ) : null}
    </div>
  )
}

'use client'

import { ArrowRight, ExternalLink, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import {
  AccountabilityKpis,
  InvoicesPendingList,
  OutsidePaymentsTable,
  PeopleToJustifyList,
  RecurringPaymentsList,
  ReturnsList,
  recurringEntries,
} from '@/components/app/accountability-parts'
import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { AgreementProgress, MilestoneTimelineFor } from '@/components/app/funding-parts'
import { InvitationLink } from '@/components/app/invitation-link'
import { PageTabs, type PageTab } from '@/components/app/page-tabs'
import { PaymentsTable } from '@/components/app/payments-table'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScheduledPayments, UNSCHEDULED_STATUS } from '@/components/app/schedules'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { useTabParam } from '@/components/app/use-tab-param'
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
import {
  accountabilityByPerson,
  agencyAccountability,
  JUSTIFY_WITHIN_DAYS,
  PROOF_WITHIN_DAYS,
} from '@/domain/accountability'
import { agencyTypeLabel, categoryLabel } from '@/domain/labels'
import { roleLabel } from '@/domain/permissions'
import { agreementsOf, userName } from '@/domain/queries'
import { isUnscheduledPayment } from '@/domain/schedules'
import { agencyCapital, agreementBadge, budgetUsage, isFullyReleased, spendByMonth } from '@/domain/selectors'
import { agencyStatus, budgetStatus } from '@/domain/status'
import type { FundingAgreement, SpendingCategory } from '@/domain/types'
import { seriesColor, seriesKey } from '@/lib/chart-colors'
import { formatDate, pluralize } from '@/lib/format'

export default function InvestorAgencyDetailPage() {
  // useSearchParams (the ?tab= deep link) needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <InvestorAgencyDetail />
    </React.Suspense>
  )
}

function InvestorAgencyDetail() {
  const { agencyId } = useParams<{ agencyId: string }>()
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const { can, canView } = usePermissions()
  const pause = useCommand('setAgreementPaused')
  const [pauseOpen, setPauseOpen] = React.useState(false)
  // Fixed when the sheet opens: the refreshed status must not flip its copy.
  const [resuming, setResuming] = React.useState(false)
  // Read-only for the Investor: outside payments, invoices, money to justify, returns, monthly payments.
  const showAccountability = canView('pay_outside')
  const tab = useTabParam(
    showAccountability
      ? ['overview', 'spending', 'accountability', 'team', 'activity']
      : ['overview', 'spending', 'team', 'activity'],
    'overview',
  )

  const agency = state.agencies.find((a) => a.id === agencyId && a.portfolioId === portfolioId)
  if (!agency) {
    return (
      <ScreenUnavailable
        title="Agency not found"
        description="It may belong to another portfolio, or the link is out of date."
      />
    )
  }

  // An Agency can have several agreements. The header acts on the one that is running, with a
  // tranche still to release (or the most urgent), and the Overview tab lists them all.
  const agreements = agreementsOf(state, agency.id)
  const running = (a: FundingAgreement) => a.status === 'active' || a.status === 'paused'
  const agreement =
    agreements.find((a) => running(a) && !isFullyReleased(state, a.id)) ??
    agreements.find(running) ??
    agreements[0]
  const settled = agreement ? isFullyReleased(state, agreement.id) : false
  // A pause holds releases: one with nothing left to release is not on hold.
  const pausedAgreements = agreements.filter((a) => a.status === 'paused' && !isFullyReleased(state, a.id))
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
  const review = state.milestones.find(
    (m) => m.status === 'ready_for_review' && agreements.some((a) => a.id === m.agreementId),
  )
  const reviewAgreement = review ? agreements.find((a) => a.id === review.agreementId) : undefined
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
  const accountability = agencyAccountability(state, agency.id, now)
  // Only people with money for purchases still to justify, as the "Still to justify" figure counts:
  // someone only missing a receipt for a vendor payment has nothing to justify or give back.
  const people = accountabilityByPerson(state, agency.id, now).filter((person) => person.pending > 0)
  // The tab counts what is overdue: invoices, and money for purchases not justified in time.
  const overdueItems =
    accountability.proofOverdue + people.reduce((total, person) => total + person.overdueCount, 0)
  const recurring = recurringEntries(state, agency.id, now)

  const accountabilityTab: PageTab = {
    value: 'accountability',
    label: 'Accountability',
    count: overdueItems,
    content: (
      <div className="flex flex-col gap-6">
        <AccountabilityKpis agencyId={agency.id} viewer="investor" />
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel
            title="Invoices pending"
            description={`Paid outside Viatik and still waiting for the invoice, due within ${PROOF_WITHIN_DAYS} days of paying.`}
          >
            <InvoicesPendingList items={accountability.withoutProof} now={now} limit={5} />
          </Panel>
          <Panel
            title="Still to justify"
            description={`Money people received for purchases, to cover with receipts or give back within ${JUSTIFY_WITHIN_DAYS} days.`}
          >
            <PeopleToJustifyList people={people} now={now} expandable limit={5} />
          </Panel>
        </div>
        <section className="flex flex-col gap-4" aria-labelledby="paid-outside-title">
          <div>
            <h2 id="paid-outside-title" className="font-display text-xl font-medium">
              Paid outside Viatik
            </h2>
            <p className="text-sm text-pretty text-muted-foreground">
              Paid by the Agency Admin to an address outside Viatik. The invoice is due within{' '}
              {PROOF_WITHIN_DAYS} days.
            </p>
          </div>
          <OutsidePaymentsTable payments={payments} now={now} pageSize={8} />
        </section>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Panel
            title="Returned to you"
            description="Money the Agency Admin sent back to your Portfolio Vault."
          >
            <ReturnsList agencyId={agency.id} limit={5} />
          </Panel>
          <Panel
            title="Recurring payments"
            description="Tools and services the Agency pays outside Viatik every month, and when each is next due."
          >
            <RecurringPaymentsList entries={recurring} now={now} limit={5} />
          </Panel>
        </div>
      </div>
    ),
  }

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
              <StatusBadge status={agreementBadge(state, agreement)} size="md" />
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
            {agreement && (agreement.status === 'active' || paused) && !settled && can('freeze_agreement') ? (
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
                    {paused ? 'Resume' : 'Pause'} {agreements.length > 1 ? agreement.title : 'agreement'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {review && reviewAgreement ? (
              <ButtonLink href={href(`funding/${reviewAgreement.id}/milestones/${review.id}`)} size="pill">
                Review milestone <ArrowRight data-icon="inline-end" />
              </ButtonLink>
            ) : agreements.length > 1 ? (
              <ButtonLink href={href('funding')} size="pill">
                Open funding
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

      {pausedAgreements.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          {pausedAgreements.map((a) => a.title).join(', ')} {pausedAgreements.length > 1 ? 'are' : 'is'}{' '}
          paused. Tranche releases are on hold; {agency.name} keeps operating with capital already released.
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
        {...tab}
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content:
              agreements.length > 0 ? (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                  <div className="flex flex-col gap-6 xl:col-span-2">
                    {agreements.map((item) => (
                      <React.Fragment key={item.id}>
                        <Panel
                          title={item.title}
                          description={item.purpose}
                          action={
                            <span className="flex items-center gap-2">
                              {agreements.length > 1 ? (
                                <StatusBadge status={agreementBadge(state, item)} />
                              ) : null}
                              <ButtonLink href={href(`funding/${item.id}`)} variant="ghost" size="pill-sm">
                                Details <ArrowRight data-icon="inline-end" />
                              </ButtonLink>
                            </span>
                          }
                        >
                          <AgreementProgress state={state} agreement={item} />
                        </Panel>
                        <Panel title={agreements.length > 1 ? `Milestones · ${item.title}` : 'Milestones'}>
                          <MilestoneTimelineFor
                            state={state}
                            agreementId={item.id}
                            actionFor={(tranche, milestone) =>
                              milestone?.status === 'ready_for_review' ? (
                                <ButtonLink
                                  href={href(`funding/${item.id}/milestones/${milestone.id}`)}
                                  size="pill-sm"
                                >
                                  Review milestone
                                </ButtonLink>
                              ) : undefined
                            }
                          />
                        </Panel>
                      </React.Fragment>
                    ))}
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
                <Panel
                  title="Scheduled payments"
                  description="Payments the Agency Admin authorized for later. You can pause, resume or cancel them; one you pause only you can resume."
                >
                  <ScheduledPayments agencyId={agency.id} viewer="investor" />
                </Panel>
                <section className="flex flex-col gap-4">
                  <h2 className="font-display text-xl font-medium">Recent payments</h2>
                  <PaymentsTable
                    payments={payments}
                    pageSize={8}
                    statusFor={(p) => (isUnscheduledPayment(p) ? UNSCHEDULED_STATUS : undefined)}
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
          ...(showAccountability ? [accountabilityTab] : []),
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
                        <InvitationLink
                          variant="actions"
                          invitation={i}
                          workspace={agency.name}
                          inviter={userName(state, i.invitedBy)}
                          className="shrink-0"
                        />
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

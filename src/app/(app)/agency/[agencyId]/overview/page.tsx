'use client'

import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  CalendarPlus,
  FileClock,
  FilePlus2,
  HandCoins,
  PieChart,
  ReceiptText,
  Send,
  Users,
} from 'lucide-react'
import Link from '@/components/viatik/link'
import * as React from 'react'

import { InvoicesPendingList, PeopleToJustifyList, RemindButton } from '@/components/app/accountability-parts'
import { ActivityList } from '@/components/app/activity'
import { AddInvoiceSheet } from '@/components/app/add-invoice-sheet'
import { ButtonLink } from '@/components/app/button-link'
import { isDueNow, MonthlyPayments } from '@/components/app/reminders'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { WelcomeCard } from '@/components/app/welcome-card'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { MoneyBarChart } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { BudgetHealth, KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel, SectionLabel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import {
  accountabilityByPerson,
  agencyAccountability,
  PROOF_WITHIN_DAYS,
  remindersDue,
} from '@/domain/accountability'
import { formatUsd } from '@/domain/money'
import {
  agreementsOf,
  actorName,
  adminApprovals,
  billState,
  destinationName,
  openBills,
} from '@/domain/queries'
import { schedulesNeedingAttention } from '@/domain/schedules'
import { agencyCapital, budgetUsage, spendByMonth } from '@/domain/selectors'
import { budgetStatus, trancheStatus } from '@/domain/status'
import { seriesColor, seriesKey } from '@/lib/chart-colors'
import { daysUntil, dueLabel, formatDate, formatRelative, partOfDay, pluralize } from '@/lib/format'

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })

export default function AgencyOverviewPage() {
  const { state, now, user } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  // Kept while the invoice sheet closes, so it does not go blank.
  const [invoiceFor, setInvoiceFor] = React.useState<string | null>(null)
  const [invoiceOpen, setInvoiceOpen] = React.useState(false)

  const agency = state.agencies.find((a) => a.id === agencyId)
  const capital = agencyCapital(state, agencyId, now)
  // Every agreement counts: the ones waiting for acceptance get a banner, and the next tranche is
  // the one most in need of attention across the agreements that are running.
  const agreements = agreementsOf(state, agencyId)
  const awaiting = agreements.filter((a) => a.status === 'pending_acceptance')
  const investor = agreements[0]
    ? state.portfolios.find((p) => p.id === agreements[0]!.portfolioId)?.name
    : undefined
  const running = agreements.filter((a) => a.status === 'active' || a.status === 'paused')
  const upcoming = running.flatMap((a) => {
    const tranche = state.tranches
      .filter((t) => t.agreementId === a.id)
      .sort((x, y) => x.index - y.index)
      .find((t) => t.status !== 'released' && t.status !== 'cancelled' && t.status !== 'rejected')
    return tranche ? [{ agreement: a, tranche }] : []
  })
  const next = upcoming.find((u) => u.tranche.status === 'under_review') ?? upcoming[0]
  const agreement = next?.agreement
  const nextTranche = next?.tranche
  const nextMilestone = nextTranche?.milestoneId
    ? state.milestones.find((m) => m.id === nextTranche.milestoneId)
    : undefined
  const approvals = adminApprovals(state, agencyId)
  const bills = openBills(state, agencyId, now).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId)
  const budgetSeries = budgets.map((b, i) => ({
    key: seriesKey(i),
    label: b.name,
    color: seriesColor(i),
    id: b.id,
  }))
  const spend = spendByMonth(
    state,
    { agencyId },
    (m) => {
      if (m.from.kind !== 'budget') return null
      const budgetId = m.from.budgetId
      return budgetSeries.find((s) => s.id === budgetId)?.key ?? null
    },
    now,
    6,
  )
  const hasSpend = spend.some((row) => budgetSeries.some((s) => Number(row[s.key] ?? 0) > 0))
  const monthSpendTrend = spend.map((row) =>
    budgetSeries.reduce((sum, s) => sum + Number(row[s.key] ?? 0), 0),
  )
  const pending = [...approvals.mine, ...approvals.withInvestor]
  // What people still have to justify, invoices still to add and monthly payments due.
  const accountability = agencyAccountability(state, agencyId, now)
  const people = accountabilityByPerson(state, agencyId, now)
  const monthlyDue = remindersDue(state, agencyId, now).filter((r) => isDueNow(r, now))
  const canPayOutside =
    can('pay_outside') && state.accounts.some((a) => a.agencyId === agencyId && a.status === 'active')
  const canInvoice = can('pay_outside')
  // Scheduled payments that were due and could not be paid, or stopped (their Admin left).
  const scheduleAttention = can('send_payment') ? schedulesNeedingAttention(state, agencyId, now) : []
  const followUps =
    accountability.peopleOverdue + accountability.proofOverdue + monthlyDue.length + scheduleAttention.length
  const addInvoice = (paymentId: string) => {
    setInvoiceFor(paymentId)
    setInvoiceOpen(true)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Tag>Agency</Tag>
            <span>{agency?.name}</span>
            {investor ? (
              <>
                <span aria-hidden="true">·</span>
                <span>Funded by {investor}</span>
              </>
            ) : null}
          </>
        }
        title={`Good ${partOfDay(now)}, ${user?.name.split(' ')[0]}`}
        description="What your Agency can operate with today, what is waiting for you, and where money went this month."
        actions={
          <ButtonLink href={href('funding')} size="pill">
            <HandCoins data-icon="inline-start" /> Request funding
          </ButtonLink>
        }
      />

      <WelcomeCard />

      {awaiting.length > 0 ? (
        <section
          aria-label="Funding agreements waiting for you"
          className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4"
        >
          <p className="text-sm font-medium">
            {awaiting.length === 1
              ? 'A funding agreement is waiting for your acceptance'
              : `${awaiting.length} funding agreements are waiting for your acceptance`}
          </p>
          <ul className="flex flex-col gap-2">
            {awaiting.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{a.title}</span>
                  <span className="text-muted-foreground">
                    {formatUsd(a.committed, { withCode: true })} committed ·{' '}
                    {state.portfolios.find((p) => p.id === a.portfolioId)?.name}
                  </span>
                </span>
                <ButtonLink href={href(`funding?agreement=${a.id}`)} variant="outline" size="pill-sm">
                  Review and accept <ArrowRight data-icon="inline-end" />
                </ButtonLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {followUps > 0 ? (
        <section
          aria-label="Needs a follow-up"
          className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4"
        >
          <p className="text-sm font-medium">Needs a follow-up</p>
          <ul className="flex flex-col gap-2">
            {scheduleAttention.length > 0 ? (
              <li className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {scheduleAttention.length === 1
                      ? '1 scheduled payment needs attention'
                      : `${scheduleAttention.length} scheduled payments need attention`}
                  </span>
                  <span className="text-muted-foreground">
                    Due and not paid, or stopped. Viatik keeps trying the ones that are due.
                  </span>
                </span>
                <ButtonLink href={href('payments?tab=scheduled')} variant="outline" size="pill-sm">
                  Open scheduled payments <ArrowRight data-icon="inline-end" />
                </ButtonLink>
              </li>
            ) : null}
            {accountability.peopleOverdue > 0 ? (
              <li className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {accountability.peopleOverdue === 1
                      ? '1 person has receipts overdue'
                      : `${accountability.peopleOverdue} people have receipts overdue`}
                  </span>
                  <span className="text-muted-foreground">
                    {formatUsd(accountability.overdue, { withCode: true })} of money for purchases is not
                    justified in time.
                  </span>
                </span>
                <ButtonLink href={href('team?tab=receipts')} variant="outline" size="pill-sm">
                  See who <ArrowRight data-icon="inline-end" />
                </ButtonLink>
              </li>
            ) : null}
            {accountability.proofOverdue > 0 ? (
              <li className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">
                    {accountability.proofOverdue === 1
                      ? '1 invoice is overdue'
                      : `${accountability.proofOverdue} invoices are overdue`}
                  </span>
                  <span className="text-muted-foreground">
                    Paid outside Viatik more than {PROOF_WITHIN_DAYS} days ago, still without the invoice.
                  </span>
                </span>
                <ButtonLink href={href('bills?tab=invoices')} variant="outline" size="pill-sm">
                  Add invoices <ArrowRight data-icon="inline-end" />
                </ButtonLink>
              </li>
            ) : null}
            {monthlyDue.length > 2 ? (
              <li className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="flex flex-col">
                  <span className="font-medium">{monthlyDue.length} monthly payments are due</span>
                  <span className="text-muted-foreground">
                    {monthlyDue.map((r) => r.reminder.title).join(', ')}
                  </span>
                </span>
                <ButtonLink href={href('bills?tab=monthly')} variant="outline" size="pill-sm">
                  Open monthly payments <ArrowRight data-icon="inline-end" />
                </ButtonLink>
              </li>
            ) : (
              monthlyDue.map(({ reminder, dueAt }) => (
                <li key={reminder.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="flex flex-col">
                    <span className="font-medium">
                      {reminder.title}{' '}
                      {daysUntil(dueAt, now) < 0 ? `was due ${formatDate(dueAt)}` : 'is due today'}
                    </span>
                    <span className="text-muted-foreground">
                      Monthly payment to {reminder.payee}
                      {reminder.amount !== undefined
                        ? `, about ${formatUsd(reminder.amount, { withCode: true })}`
                        : ''}
                      .
                    </span>
                  </span>
                  {canPayOutside ? (
                    <ButtonLink
                      href={href(`accounts/pay-outside?reminder=${reminder.id}`)}
                      variant="outline"
                      size="pill-sm"
                    >
                      Pay now<span className="sr-only"> for “{reminder.title}”</span>{' '}
                      <ArrowRight data-icon="inline-end" />
                    </ButtonLink>
                  ) : (
                    <ButtonLink href={href('bills?tab=monthly')} variant="outline" size="pill-sm">
                      Open <ArrowRight data-icon="inline-end" />
                    </ButtonLink>
                  )}
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      <div className="-mx-4 flex scrollbar-none gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        {can('create_budget') ? (
          <ButtonLink href={href('budgets/new')} variant="secondary" size="pill-sm">
            <PieChart data-icon="inline-start" /> Create budget
          </ButtonLink>
        ) : null}
        {can('pay_member') ? (
          <ButtonLink href={href('payments/team')} variant="secondary" size="pill-sm">
            <Users data-icon="inline-start" /> Pay team
          </ButtonLink>
        ) : null}
        {can('manage_bills') ? (
          <ButtonLink href={href('bills')} variant="secondary" size="pill-sm">
            <ReceiptText data-icon="inline-start" /> Pay bill
          </ButtonLink>
        ) : null}
        {can('transfer_funds') ? (
          <ButtonLink href={href('accounts/transfer')} variant="secondary" size="pill-sm">
            <Send data-icon="inline-start" /> Transfer funds
          </ButtonLink>
        ) : null}
        {canPayOutside ? (
          <ButtonLink href={href('accounts/pay-outside')} variant="secondary" size="pill-sm">
            <ArrowUpRight data-icon="inline-start" /> Pay outside Viatik
          </ButtonLink>
        ) : null}
      </div>

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Available to operate"
          value={capital.availableToOperate}
          hint="Across operating accounts"
          emphasis
        />
        <KpiTile
          label="Allocated to budgets"
          value={capital.allocated}
          hint={pluralize(budgets.filter((b) => b.status === 'active').length, 'active budget')}
        />
        <KpiTile label="Reserved for payments" value={capital.reserved} hint="Held for approved requests" />
        <KpiTile
          label="Spent this period"
          value={capital.spentThisPeriod}
          trend={monthSpendTrend}
          hint={monthName.format(new Date(now))}
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Next expected tranche">
          {nextTranche && agreement ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">
                  {nextTranche.name} · {agreement.title}
                </span>
                <Amount value={nextTranche.amount} size="xl" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={trancheStatus[nextTranche.status]}
                  pulse={nextTranche.status === 'under_review'}
                />
                {nextMilestone ? (
                  <span className="text-sm text-muted-foreground">{nextMilestone.title}</span>
                ) : null}
              </div>
              <p className="text-sm text-pretty text-muted-foreground">
                {nextTranche.status === 'under_review'
                  ? `${investor} is reviewing your ${nextMilestone ? 'evidence' : 'request'}. You will be notified when the funds are released.`
                  : nextMilestone
                    ? `Submit evidence for “${nextMilestone.title}” to request this tranche. Due ${formatDate(nextMilestone.dueDate)}.`
                    : nextTranche.scheduledFor
                      ? `Planned for ${formatDate(nextTranche.scheduledFor)}. The Investor releases it.`
                      : `${investor ?? 'Your Investor'} releases it when they decide. You can also request it.`}
              </p>
              <ButtonLink
                href={href(`funding?agreement=${nextTranche.agreementId}`)}
                variant="outline"
                size="pill-sm"
                className="w-fit"
              >
                Open funding <ArrowRight data-icon="inline-end" />
              </ButtonLink>
            </div>
          ) : (
            <EmptyState
              compact
              title={
                awaiting.length > 0
                  ? 'Accept an agreement to start'
                  : running.length > 0
                    ? 'Every tranche released'
                    : 'No active funding agreement'
              }
              description={
                awaiting.length > 0
                  ? 'Its tranches and milestones appear here once you accept it.'
                  : running.length > 0
                    ? `${investor ?? 'Your Investor'} released every tranche${running.length === 1 ? ` of ${running[0]!.title}` : ''}. The money is in your accounts: keep operating with it, or return what you don’t need with Return to Investor.`
                    : 'Once an Investor creates and activates an agreement, its tranches and milestones will appear here.'
              }
            />
          )}
        </Panel>

        <Panel
          title="Pending requests"
          description="Spending that needs your decision."
          action={
            <ButtonLink href={href('approvals')} variant="ghost" size="pill-sm">
              Approvals <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {pending.length === 0 ? (
            <EmptyState
              compact
              title="Nothing needs your attention"
              description="Requests that require your decision will appear here."
            />
          ) : (
            <ul className="flex flex-col">
              {pending.slice(0, 4).map((request) => (
                <li key={request.id} className="border-t border-border first:border-t-0">
                  <Link
                    href={href('approvals')}
                    className="flex items-center gap-3 py-3 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <PersonAvatar name={actorName(state, request.requester)} size="sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{request.purpose}</span>
                      <span className="truncate text-xs text-subtle">
                        {actorName(state, request.requester)} · {formatRelative(request.createdAt, now)}
                        {approvals.withInvestor.includes(request) ? ' · With Investor' : ''}
                      </span>
                    </span>
                    <Amount value={request.amount} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Bills due"
          action={
            <ButtonLink href={href('bills')} variant="ghost" size="pill-sm">
              All bills <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {bills.length === 0 ? (
            <EmptyState
              compact
              icon={<FileClock />}
              title="No bills due"
              description="Upload a bill to schedule or pay it."
            />
          ) : (
            <ul className="flex flex-col">
              {bills.slice(0, 4).map((bill) => {
                const overdue = billState(bill, now) === 'overdue'
                return (
                  <li key={bill.id} className="border-t border-border first:border-t-0">
                    <Link
                      href={href(`bills/${bill.id}`)}
                      className="flex items-center gap-3 py-3 outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {destinationName(state, bill.destinationId)}
                        </span>
                        <span className={overdue ? 'text-xs text-danger' : 'text-xs text-subtle'}>
                          {bill.status === 'scheduled'
                            ? `Scheduled · ${dueLabel(bill.dueDate, now)}`
                            : dueLabel(bill.dueDate, now)}
                        </span>
                      </span>
                      <Amount value={bill.amount} size="sm" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Money to justify"
          description={
            accountability.pending > 0
              ? `${formatUsd(accountability.pending, { withCode: true })} pending${accountability.overdue > 0 ? ` · ${formatUsd(accountability.overdue, { withCode: true })} overdue` : ', nothing overdue'}`
              : 'Receipts for the money for purchases people received.'
          }
          // On phones "Remind everyone" goes under the list: beside the title it squeezes the text.
          action={<RemindButton agencyId={agencyId} people={people} className="max-sm:hidden" />}
        >
          <PeopleToJustifyList
            people={people}
            now={now}
            limit={4}
            personHref={(userId) => href(`team/${userId}`)}
            action={(person) => <RemindButton agencyId={agencyId} person={person} />}
          />
          <RemindButton agencyId={agencyId} people={people} className="mt-2 w-fit sm:hidden" />
        </Panel>

        <Panel
          title="Outside Viatik"
          description="Invoices to add and monthly payments that are due."
          action={
            <ButtonLink href={href('bills?tab=invoices')} variant="ghost" size="pill-sm">
              Bills <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {accountability.withoutProof.length === 0 && monthlyDue.length === 0 ? (
            <EmptyState
              compact
              icon={<CalendarClock />}
              title="Nothing to follow up"
              description="Payments made outside Viatik wait here for their invoice, and monthly payments show here when they are due."
              action={
                can('manage_reminders') ? (
                  <ButtonLink href={href('bills?tab=monthly&new=monthly')} variant="outline" size="pill-sm">
                    <CalendarPlus data-icon="inline-start" /> New monthly payment
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-1">
                <SectionLabel>
                  Invoices pending
                  {accountability.withoutProof.length > 0
                    ? ` · ${accountability.withoutProof.length}${accountability.proofOverdue > 0 ? ` (${accountability.proofOverdue} late)` : ''}`
                    : ''}
                </SectionLabel>
                <InvoicesPendingList
                  items={accountability.withoutProof}
                  now={now}
                  limit={3}
                  showAddress={false}
                  action={
                    canInvoice
                      ? (payment) => (
                          <Button variant="outline" size="pill-sm" onClick={() => addInvoice(payment.id)}>
                            <FilePlus2 data-icon="inline-start" /> Add invoice
                          </Button>
                        )
                      : undefined
                  }
                  empty={<p className="py-2 text-sm text-muted-foreground">Every invoice is in.</p>}
                />
              </div>
              <div className="flex flex-col gap-1">
                <SectionLabel>
                  Monthly payments due{monthlyDue.length > 0 ? ` · ${monthlyDue.length}` : ''}
                </SectionLabel>
                <MonthlyPayments
                  agencyId={agencyId}
                  limit={3}
                  dueOnly
                  manage={false}
                  empty={<p className="py-2 text-sm text-muted-foreground">No monthly payment is due.</p>}
                />
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Spending by budget" description="Last six months.">
          {hasSpend ? (
            <MoneyBarChart data={spend} series={budgetSeries} className="h-72" />
          ) : (
            <EmptyState
              compact
              title="No spending yet"
              description={
                budgets.length === 0
                  ? 'Create a budget to start tracking spend by month.'
                  : 'Payments from your budgets will show here by month.'
              }
              action={
                budgets.length === 0 && can('create_budget') ? (
                  <ButtonLink href={href('budgets/new')} size="pill-sm" variant="outline">
                    Create budget
                  </ButtonLink>
                ) : undefined
              }
            />
          )}
        </Panel>
        <Panel
          title="Budget health"
          description="Used this period against each limit."
          action={
            <ButtonLink href={href('budgets')} variant="ghost" size="pill-sm">
              Budgets <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {budgets.length === 0 ? (
            <EmptyState
              compact
              title="No budgets yet"
              description="Create a budget to assign capital, limits, and approved uses."
            />
          ) : (
            <BudgetHealth
              budgets={budgets.map((budget) => {
                const usage = budgetUsage(state, budget, now)
                return {
                  id: budget.id,
                  name: budget.name,
                  used: usage.spentThisPeriod,
                  reserved: usage.reserved,
                  limit: budget.periodLimit,
                  href: href(`budgets/${budget.id}`),
                  note:
                    budget.status !== 'active' ? (
                      <StatusBadge status={budgetStatus[budget.status]} />
                    ) : (
                      `${formatUsd(usage.available)} available`
                    ),
                }
              })}
            />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent activity"
        action={
          <ButtonLink href={href('activity')} variant="ghost" size="pill-sm">
            All activity <ArrowUpRight data-icon="inline-end" />
          </ButtonLink>
        }
      >
        <ActivityList
          state={state}
          records={state.activity.filter((a) => a.agencyId === agencyId).slice(0, 8)}
          now={now}
        />
      </Panel>

      <AddInvoiceSheet
        paymentId={invoiceFor}
        open={invoiceOpen}
        onOpenChange={setInvoiceOpen}
        onClosed={() => setInvoiceFor(null)}
      />
    </div>
  )
}

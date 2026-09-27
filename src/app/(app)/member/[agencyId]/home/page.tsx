'use client'

import { ArrowUpRight, CalendarClock, FileWarning, PieChart, Plus, Upload } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/app/button-link'
import { useHref, useRole } from '@/components/app/role-context'
import { WelcomeCard } from '@/components/app/welcome-card'
import { Amount } from '@/components/viatik/amount'
import { UsageRing } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { UsageBar } from '@/components/viatik/finance'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { budgetPeriodUnit, categoryLabel } from '@/domain/labels'
import { formatUsd, min, sum } from '@/domain/money'
import { describeBudgetPolicy } from '@/domain/policy'
import { destinationName, memberBudgets, recipientName } from '@/domain/queries'
import { requestStatus } from '@/domain/status'
import { formatDate, formatRelative, formatShortDate } from '@/lib/format'

export default function MemberHomePage() {
  const { state, now, user, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const agency = state.agencies.find((a) => a.id === agencyId)

  const budgets = memberBudgets(state, agencyId, userId, now)
  const availableTotal = sum(budgets, (b) => min(b.remaining, b.usage.available))
  const limitTotal = sum(budgets, (b) => b.allowance.periodLimit)
  const usedTotal = sum(budgets, (b) => b.used)
  const main = [...budgets].sort((a, b) => b.allowance.periodLimit - a.allowance.periodLimit)[0]

  const myRequests = state.requests.filter(
    (r) => r.agencyId === agencyId && r.requester.kind === 'user' && r.requester.userId === userId,
  )
  const pending = myRequests.filter(
    (r) => r.status === 'needs_approval' || r.status === 'approved' || r.status === 'processing',
  )
  const nextPayment = state.payments
    .filter(
      (p) =>
        p.agencyId === agencyId &&
        p.recipient.kind === 'member' &&
        p.recipient.userId === userId &&
        p.status === 'scheduled',
    )
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))[0]
  const expenses = state.expenses
    .filter((e) => e.agencyId === agencyId && e.userId === userId)
    .sort((a, b) => (a.spentAt < b.spentAt ? 1 : -1))
  const missing = expenses.filter((e) => !e.receipt)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Tag>Member</Tag>
            <span>{agency?.name}</span>
          </>
        }
        title={`Hi, ${user?.name.split(' ')[0]}`}
        description="What you can spend, what is pending, and what still needs a receipt."
        actions={
          <ButtonLink href={href('requests/new')} size="pill" className="hidden sm:inline-flex">
            <Plus data-icon="inline-start" /> New request
          </ButtonLink>
        }
      />

      <WelcomeCard />

      {budgets.length === 0 ? (
        <EmptyState
          icon={<PieChart />}
          title="No spending access yet"
          description="Your Agency Admin has not assigned a budget to you."
        />
      ) : (
        <section
          aria-label="Available to spend"
          className="surface grid gap-6 rounded-2xl p-5 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-8 sm:p-7"
        >
          <UsageRing
            value={usedTotal}
            max={limitTotal}
            size={148}
            label="Allowance used this period"
            className="mx-auto sm:mx-0"
          >
            <span className="text-2xs tracking-[0.1em] text-subtle uppercase">Used</span>
            <span className="font-display text-xl num">
              {Math.round((usedTotal / Math.max(limitTotal, 1)) * 100)}%
            </span>
          </UsageRing>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-sm text-muted-foreground">Available to spend</span>
              <Amount value={availableTotal} size="display" />
              <span className="text-sm text-subtle">
                {formatUsd(usedTotal, { withCode: true })} used of {formatUsd(limitTotal, { withCode: true })}{' '}
                this period
              </span>
            </div>
            <ul className="flex flex-col gap-3">
              {budgets.map((b) => (
                <li key={b.budget.id}>
                  <Link
                    href={href(`budget/${b.budget.id}`)}
                    className="flex flex-col gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between text-sm">
                      <span className="font-medium">{b.budget.name}</span>
                      <span className="text-subtle">{formatUsd(b.remaining)} left</span>
                    </span>
                    <UsageBar
                      used={b.used}
                      limit={b.allowance.periodLimit}
                      label={`${b.budget.name} allowance`}
                      showLegend={false}
                    />
                  </Link>
                </li>
              ))}
            </ul>
            <ButtonLink href={href('requests/new')} size="pill" className="sm:hidden">
              <Plus data-icon="inline-start" /> New request
            </ButtonLink>
          </div>
        </section>
      )}

      {missing.length > 0 ? (
        <Link
          href={href('expenses')}
          className="flex items-center gap-4 rounded-xl border border-warning/30 bg-warning-soft p-4 transition-colors outline-none hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileWarning className="size-5 shrink-0 text-warning" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm font-medium">
              {missing.length} {missing.length === 1 ? 'expense needs' : 'expenses need'} a receipt
            </span>
            <span className="text-sm text-muted-foreground">
              Upload them so your Agency can reconcile the payments.
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium">
            <Upload className="size-4" aria-hidden="true" /> Upload receipt
          </span>
        </Link>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Pending requests"
          action={
            <ButtonLink href={href('requests')} variant="ghost" size="pill-sm">
              All requests <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {pending.length === 0 ? (
            <EmptyState
              compact
              title="No pending requests"
              description="Requests waiting for approval will show here."
            />
          ) : (
            <ul className="flex flex-col">
              {pending.map((r) => (
                <li key={r.id} className="border-t border-border first:border-t-0">
                  <Link
                    href={href(`requests/${r.id}`)}
                    className="flex items-center gap-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{r.purpose}</span>
                      <span className="text-xs text-subtle">
                        {recipientName(state, r.destination)} · {formatRelative(r.createdAt, now)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Amount value={r.amount} size="sm" />
                      <StatusBadge status={requestStatus[r.status]} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Next expected payment">
          {nextPayment ? (
            <div className="flex items-center gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-border text-subtle">
                <CalendarClock className="size-5" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Amount value={nextPayment.amount} size="lg" />
                <span className="text-sm text-muted-foreground">
                  {nextPayment.memo} · {formatDate(nextPayment.scheduledFor)}
                </span>
              </span>
            </div>
          ) : (
            <EmptyState
              compact
              title="No payments scheduled"
              description="Payouts your Agency schedules for you will show here."
            />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel
          title="Recent expenses"
          action={
            <ButtonLink href={href('expenses')} variant="ghost" size="pill-sm">
              All expenses <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          {expenses.length === 0 ? (
            <EmptyState compact title="No expenses yet" description="Your expenses will appear here." />
          ) : (
            <ul className="flex flex-col">
              {expenses.slice(0, 5).map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{e.merchant}</span>
                    <span className="text-xs text-subtle">
                      {formatShortDate(e.spentAt)} · {categoryLabel[e.category]}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Amount value={e.amount} size="sm" />
                    <StatusBadge
                      status={
                        e.receipt
                          ? { label: 'Receipt attached', tone: 'success' }
                          : { label: 'Missing receipt', tone: 'warning' }
                      }
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {main ? (
          <Panel title="Your budget rules" description={main.budget.name}>
            <PolicySummary
              title="In plain language"
              lines={[
                `You can spend up to ${formatUsd(main.allowance.periodLimit, { withCode: true })} per ${budgetPeriodUnit[main.budget.period]}.`,
                ...describeBudgetPolicy(main.budget, {
                  destinationNames: main.budget.allowedDestinationIds.map((id) => destinationName(state, id)),
                  categoryLabels: categoryLabel,
                }).slice(1),
              ]}
            />
          </Panel>
        ) : null}
      </div>
    </div>
  )
}

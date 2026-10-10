'use client'

import { ArrowUpRight, PieChart, Plus } from 'lucide-react'
import * as React from 'react'

import Link from '@/components/viatik/link'

import { ButtonLink } from '@/components/app/button-link'
import { MemberAccountabilityBanner, useMemberAccountability } from '@/components/app/member-advances'
import { SettlementNote, useMemberViatikAccount } from '@/components/app/member-viatik-account'
import { MemberWithdrawSheet } from '@/components/app/member-withdraw-sheet'
import { requestRecipientLabel } from '@/components/app/request-parts'
import { useHref, useRole } from '@/components/app/role-context'
import { WelcomeCard } from '@/components/app/welcome-card'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { UsageRing } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { UsageBar } from '@/components/viatik/finance'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { budgetPeriodUnit, categoryLabel } from '@/domain/labels'
import { formatUsd, min, sum } from '@/domain/money'
import { describeBudgetPolicy } from '@/domain/policy'
import { destinationName, memberBudgets } from '@/domain/queries'
import { requestStatusFor } from '@/domain/status'
import { formatRelative, formatShortDate } from '@/lib/format'

export default function MemberOverviewPage() {
  const { state, now, user, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const agency = state.agencies.find((a) => a.id === agencyId)
  const agencyName = agency?.name ?? 'your Agency'
  const account = useMemberViatikAccount(agencyId)
  const acc = useMemberAccountability(agencyId)
  const [sendOpen, setSendOpen] = React.useState(false)

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
  const paidToMe = state.payments.filter(
    (p) => p.agencyId === agencyId && p.recipient.kind === 'member' && p.recipient.userId === userId,
  )
  const nextPayment = paidToMe
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))[0]
  const lastReceived = paidToMe
    .filter((p) => p.status === 'completed' && p.completedAt)
    .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))[0]
  const expenses = state.expenses
    .filter((e) => e.agencyId === agencyId && e.userId === userId)
    .sort((a, b) => (a.spentAt < b.spentAt ? 1 : -1))

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
        description="What you can spend, your Viatik balance, money still to justify with receipts, and what is pending."
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

      {/* Money for purchases to justify and missing vendor receipts, in one banner (hidden when nothing is open). */}
      <MemberAccountabilityBanner agencyId={agencyId} />

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
                        {requestRecipientLabel(state, r, userId)} · {formatRelative(r.createdAt, now)}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Amount value={r.amount} size="sm" />
                      <StatusBadge status={requestStatusFor(r)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Viatik balance"
          description={`What ${agencyName} paid you and you still hold.`}
          action={
            <ButtonLink href={href('payments')} variant="ghost" size="pill-sm">
              All payments <ArrowUpRight data-icon="inline-end" />
            </ButtonLink>
          }
        >
          <div className="flex flex-col gap-4">
            <Amount value={account.held} size="xl" />
            <KeyValueList
              dense
              items={[
                {
                  label: 'Last received',
                  value: lastReceived
                    ? `+${formatUsd(lastReceived.amount)} · ${formatShortDate(lastReceived.completedAt ?? '')}`
                    : 'Nothing yet',
                  hint: lastReceived?.memo,
                },
                {
                  label: 'Next payment',
                  value: nextPayment
                    ? `${formatUsd(nextPayment.amount)} · ${formatShortDate(nextPayment.scheduledFor)}`
                    : 'Nothing scheduled',
                  hint: nextPayment?.memo,
                },
                ...(acc.pending > 0
                  ? [
                      {
                        label: 'Still to justify',
                        value:
                          acc.overdueCount > 0 ? (
                            <span className="text-danger">
                              {formatUsd(acc.pending)} · {acc.overdueCount} overdue
                            </span>
                          ) : (
                            formatUsd(acc.pending)
                          ),
                        hint: 'Money for purchases',
                      },
                    ]
                  : []),
              ]}
            />
            {/* Why "Send to my account" is unavailable, once the network check is done. */}
            {account.canMove && !account.canSendNow && !account.own.loading ? (
              <SettlementNote account={account} agencyName={agencyName} />
            ) : null}
            {account.canMove ? (
              <Button
                size="pill-sm"
                className="w-fit"
                disabled={!account.canSendNow}
                onClick={() => setSendOpen(true)}
              >
                <ArrowUpRight data-icon="inline-start" /> Send to my account
              </Button>
            ) : null}
          </div>
          <MemberWithdrawSheet
            open={sendOpen && account.canMove}
            onOpenChange={setSendOpen}
            agencyId={agencyId}
            agencyName={agencyName}
            held={account.held}
            own={account.own}
          />
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
                  allowance: main.allowance,
                }).slice(1),
              ]}
            />
          </Panel>
        ) : null}
      </div>
    </div>
  )
}

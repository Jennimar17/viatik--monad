'use client'

import { Pencil, ReceiptText, UserMinus } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { AdvanceRows, RemindButton } from '@/components/app/accountability-parts'
import { ButtonLink } from '@/components/app/button-link'
import { FormField } from '@/components/app/form-controls'
import { PaymentsTable } from '@/components/app/payments-table'
import { requestRecipientLabel } from '@/components/app/request-parts'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyBarChart } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { UsageBar } from '@/components/viatik/finance'
import { MoneyInput } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import {
  accountabilityByPerson,
  advancesOf,
  JUSTIFY_WITHIN_DAYS,
  lastReminded,
  missingReceipts,
} from '@/domain/accountability'
import { budgetPeriodUnit } from '@/domain/labels'
import { cents, formatUsd, type Cents } from '@/domain/money'
import { roleLabel } from '@/domain/permissions'
import { holderSpentInPeriod, memberHeld, spendByMonth } from '@/domain/selectors'
import { requestStatusFor } from '@/domain/status'
import { formatDate, formatRelative, pluralize } from '@/lib/format'

export default function MemberDetailPage() {
  const { memberId } = useParams<{ memberId: string }>()
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const { can } = usePermissions()
  const revoke = useCommand('revokeMembership')
  const edit = useCommand('assignAllowance')
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  // The allowance being edited is fixed when its sheet opens; the sheet reads the live record.
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [amount, setAmount] = React.useState<Cents | null>(null)

  const user = state.users.find((u) => u.id === memberId)
  const memberships = state.memberships.filter(
    (m) => m.userId === memberId && m.scope.kind === 'agency' && m.scope.agencyId === agencyId,
  )
  const membership = memberships.find((m) => m.status === 'active') ?? memberships[0]
  if (!user || !membership) {
    return (
      <ScreenUnavailable
        title="Member not found"
        description="They may belong to another Agency, or the link is out of date."
      />
    )
  }

  const isSelf = memberId === userId
  const removed = membership.status === 'revoked'
  const budgetIds = new Set(state.budgets.filter((b) => b.agencyId === agencyId).map((b) => b.id))
  const allowances = state.allowances.filter(
    (a) =>
      a.status === 'active' &&
      a.holder.kind === 'member' &&
      a.holder.userId === memberId &&
      budgetIds.has(a.budgetId),
  )
  const requests = state.requests
    .filter((r) => r.agencyId === agencyId && r.requester.kind === 'user' && r.requester.userId === memberId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const requestIds = new Set(requests.map((r) => r.id))
  const payouts = state.payments.filter(
    (p) => p.agencyId === agencyId && p.recipient.kind === 'member' && p.recipient.userId === memberId,
  )
  const spend = spendByMonth(
    state,
    { agencyId },
    (m) => {
      const payment = state.payments.find((p) => p.id === m.refId)
      return payment?.requestId && requestIds.has(payment.requestId) ? 'spent' : null
    },
    now,
    6,
  )
  const hasSpend = spend.some((row) => Number(row.spent ?? 0) > 0)
  const editing = state.allowances.find((a) => a.id === editingId)
  const editingBudget = state.budgets.find((b) => b.id === editing?.budgetId)
  const overLimit = Boolean(amount && editingBudget && amount > editingBudget.periodLimit)
  const firstName = user.name.split(' ')[0] ?? user.name
  // Money for purchases they received, and what is still to justify.
  const advances = advancesOf(state, { agencyId, userId: memberId }, now)
  const owing = accountabilityByPerson(state, agencyId, now).find((p) => p.userId === memberId)
  const vendorReceipts = missingReceipts(state, { agencyId, userId: memberId }).length
  const remindedAt = lastReminded(state, agencyId, memberId)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('team')} className="hover:text-foreground">
            Team
          </Link>
        }
        title={
          <span className="flex items-center gap-4">
            <PersonAvatar name={user.name} size="lg" /> {user.name}
          </span>
        }
        description={`${user.title} · ${user.email}`}
        meta={
          <>
            <Tag>{roleLabel[membership.role]}</Tag>
            {removed ? <StatusBadge status={{ label: 'Removed', tone: 'neutral' }} size="md" /> : null}
            <span className="text-sm text-subtle">
              Joined {formatDate(membership.createdAt)} · {user.timeZone.replace(/_/g, ' ')}
            </span>
          </>
        }
        actions={
          !removed && !isSelf && can('manage_team') ? (
            <Button variant="destructive" size="pill" onClick={() => setRevokeOpen(true)}>
              <UserMinus data-icon="inline-start" /> Revoke access
            </Button>
          ) : null
        }
      />

      {removed ? (
        <div className="rounded-xl border border-border bg-mist/5 px-4 py-3 text-sm text-muted-foreground">
          Access removed{membership.revokedAt ? ` on ${formatDate(membership.revokedAt)}` : ''}. Their
          allowances stopped and pending requests were cancelled. Payments already made are not affected.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title="Spending access"
          description="Each allowance is a limit on a budget, not money handed over."
        >
          {allowances.length === 0 ? (
            <EmptyState
              compact
              title={removed ? 'No spending access' : 'No budgets assigned'}
              description={
                removed
                  ? 'Allowances end when access is removed.'
                  : `Assign ${firstName} an allowance from a budget to let them spend.`
              }
              action={
                !removed && can('assign_allowance') ? (
                  <ButtonLink href={href('budgets')} variant="outline" size="pill-sm">
                    Go to budgets
                  </ButtonLink>
                ) : undefined
              }
            />
          ) : (
            <ul className="flex flex-col">
              {allowances.map((a) => {
                const budget = state.budgets.find((b) => b.id === a.budgetId)
                if (!budget) return null
                const used = holderSpentInPeriod(state, budget, a.holder, now)
                return (
                  <li
                    key={a.id}
                    className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 sm:flex-row sm:items-center"
                  >
                    <Link href={href(`budgets/${budget.id}`)} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium hover:underline">
                        {budget.name}
                      </span>
                      <span className="text-xs text-subtle">
                        {formatUsd(a.periodLimit, { withCode: true })} per {budgetPeriodUnit[budget.period]}
                        {a.perOperationLimit ? ` · max ${formatUsd(a.perOperationLimit)} each` : ''}
                      </span>
                    </Link>
                    <UsageBar
                      used={used}
                      limit={a.periodLimit}
                      className="sm:w-56"
                      label={`${budget.name} allowance`}
                    />
                    {can('assign_allowance') ? (
                      <Button
                        variant="ghost"
                        size="pill-sm"
                        onClick={() => {
                          setEditingId(a.id)
                          setAmount(a.periodLimit)
                        }}
                      >
                        <Pencil data-icon="inline-start" /> Edit allowance
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Profile">
          <KeyValueList
            items={[
              { label: 'Email', value: user.email },
              { label: 'Time zone', value: user.timeZone.replace(/_/g, ' ') },
              { label: 'Requests', value: String(requests.length) },
              {
                label: 'Payments received',
                value: String(payouts.filter((p) => p.status === 'completed').length),
              },
              {
                label: 'Viatik balance',
                hint: 'Money they hold in the Agency',
                value: <Amount value={cents(memberHeld(state, agencyId, memberId))} size="sm" />,
              },
              {
                label: 'Last reminded',
                value: remindedAt ? formatRelative(remindedAt, now) : 'Never',
              },
            ]}
          />
        </Panel>
      </div>

      <Panel
        title="Money to justify"
        description={
          owing && owing.pending > 0
            ? `${formatUsd(owing.pending, { withCode: true })} pending${owing.overdue > 0 ? ` · ${formatUsd(owing.overdue, { withCode: true })} overdue` : ', nothing overdue'}`
            : `Money for purchases is justified with receipts within ${JUSTIFY_WITHIN_DAYS} days.`
        }
        // On phones the button goes under the list: beside the title it squeezes the text.
        action={
          owing ? <RemindButton agencyId={agencyId} person={owing} className="max-sm:hidden" /> : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <AdvanceRows
            advances={advances}
            showReceipts
            empty={
              <EmptyState
                compact
                icon={<ReceiptText />}
                title="Nothing to justify"
                description={`Money for purchases ${firstName} receives shows here until its receipts, or what they give back, cover it.`}
              />
            }
          />
          {vendorReceipts > 0 ? (
            <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-pretty">
              {vendorReceipts === 1
                ? `1 expense from a vendor payment still needs its receipt.`
                : `${vendorReceipts} expenses from vendor payments still need their receipt.`}{' '}
              {firstName} adds {vendorReceipts === 1 ? 'it' : 'them'} from Expenses.
            </p>
          ) : null}
          {owing ? <RemindButton agencyId={agencyId} person={owing} className="w-fit sm:hidden" /> : null}
        </div>
      </Panel>

      <Panel
        title="Spending through requests"
        description="Last six months, from the budgets assigned to them."
      >
        {hasSpend ? (
          <MoneyBarChart
            data={spend}
            series={[{ key: 'spent', label: 'Spent', color: 'var(--color-sage)' }]}
            className="h-52"
          />
        ) : (
          <EmptyState
            compact
            title="No spending yet"
            description={`Payments requested by ${firstName} will show here by month.`}
          />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Requests" description={pluralize(requests.length, 'request')}>
          {requests.length === 0 ? (
            <EmptyState
              compact
              title="No requests yet"
              description="Requests for payments will appear here."
            />
          ) : (
            <ul className="flex flex-col">
              {requests.slice(0, 8).map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{r.purpose}</span>
                    <span className="truncate text-xs text-subtle">
                      {requestRecipientLabel(state, r, userId)} · {formatRelative(r.createdAt, now)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Amount value={r.amount} size="sm" />
                    <StatusBadge status={requestStatusFor(r)} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <section className="flex flex-col gap-4">
          <h2 className="font-display text-xl font-medium">Payments to {firstName}</h2>
          <PaymentsTable
            payments={payouts}
            showBudget={false}
            pageSize={6}
            empty={
              <EmptyState
                compact
                title="No payments yet"
                description={`Team payments and reimbursements to ${firstName} will appear here.`}
              />
            }
          />
        </section>
      </div>

      <ApprovalSheet
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        onClosed={() => {
          if (revoke.phase === 'completed') router.push(href('team'))
          revoke.reset()
        }}
        title="Revoke access"
        summary={{
          what: `${user.name} loses access to the Agency immediately. Their spending allowances stop and pending requests are cancelled. Money already paid to them is not affected.`,
          reversible: 'You can invite them again later.',
          policy: 'Removed permissions take effect immediately, at settlement and in the app.',
        }}
        confirmLabel="Revoke access"
        confirmVariant="destructive"
        phase={revoke.phase}
        error={revoke.error}
        onConfirm={() => revoke.run({ membershipId: membership.id })}
        success={{ title: 'Access revoked', body: `${user.name} can no longer sign in to this Agency.` }}
      />

      <ApprovalSheet
        open={Boolean(editingId)}
        onOpenChange={(open) => !open && setEditingId(null)}
        onClosed={() => {
          edit.reset()
          setAmount(null)
        }}
        title="Edit allowance"
        description={editingBudget?.name}
        summary={{
          what: `${user.name} can spend up to the new amount per ${editingBudget ? budgetPeriodUnit[editingBudget.period] : 'period'} from ${editingBudget?.name ?? 'the budget'}.`,
          amount: amount ?? undefined,
          reversible: 'You can change it again at any time.',
          policy: `Cannot exceed the budget’s ${editingBudget ? formatUsd(editingBudget.periodLimit, { withCode: true }) : ''} period limit.`,
        }}
        confirmLabel="Save allowance"
        disabled={!amount || overLimit}
        phase={edit.phase}
        error={edit.error}
        onConfirm={() =>
          editing &&
          amount &&
          edit.run({
            budgetId: editing.budgetId,
            holder: editing.holder,
            periodLimit: amount,
            perOperationLimit: editing.perOperationLimit,
          })
        }
        success={{ title: 'Allowance updated', body: `${user.name} was notified of the new limit.` }}
      >
        <FormField
          label={`Allowance per ${editingBudget ? budgetPeriodUnit[editingBudget.period] : 'period'}`}
          htmlFor="allowance-edit"
          error={
            overLimit && editingBudget
              ? `Cannot exceed the ${formatUsd(editingBudget.periodLimit, { withCode: true })} period limit.`
              : undefined
          }
        >
          <MoneyInput id="allowance-edit" value={amount} onChange={setAmount} invalid={overLimit} />
        </FormField>
      </ApprovalSheet>
    </div>
  )
}

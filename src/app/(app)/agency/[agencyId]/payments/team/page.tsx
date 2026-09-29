'use client'

import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { FormActions, MoneyInput } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, sum, usd, ZERO, type Cents } from '@/domain/money'
import { accountName, userName } from '@/domain/queries'
import { accountBalance, budgetUsage } from '@/domain/selectors'
import { pluralize } from '@/lib/format'

const NO_BUDGET = 'none'
const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })

type Row = { userId: string; selected: boolean; amount: Cents | null }

export default function TeamPaymentsPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const send = useCommand('sendTeamPayments')

  const people = state.memberships.filter(
    (m) =>
      m.scope.kind === 'agency' &&
      m.scope.agencyId === agencyId &&
      m.status === 'active' &&
      m.role === 'member',
  )
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const budgets = state.budgets.filter(
    (b) => b.agencyId === agencyId && b.status === 'active' && b.allowedCategories.includes('team'),
  )
  useBottomBar(people.length > 0)

  // Start from the first team budget that still has money; otherwise pay from the account.
  const [budgetId, setBudgetId] = React.useState<string>(
    () => budgets.find((b) => budgetUsage(state, b, now).available > 0)?.id ?? NO_BUDGET,
  )
  const [accountId, setAccountId] = React.useState<string | null>(
    accounts.find((a) => a.template === 'people')?.id ?? accounts[0]?.id ?? null,
  )
  const [memo, setMemo] = React.useState(`${monthName.format(new Date(now))} team payment`)
  // Everyone paid before is preselected with their last amount.
  const [rows, setRows] = React.useState<Row[]>(() =>
    people.map((m) => {
      const last = state.payments
        .filter(
          (p) =>
            p.recipient.kind === 'member' &&
            p.recipient.userId === m.userId &&
            (p.type === 'team' || p.type === 'contractor'),
        )
        .sort((a, b) => (a.scheduledFor < b.scheduledFor ? 1 : -1))[0]
      return { userId: m.userId, selected: Boolean(last), amount: last?.amount ?? usd(500) }
    }),
  )
  const [open, setOpen] = React.useState(false)
  const [sentCount, setSentCount] = React.useState(0)

  const budget = budgets.find((b) => b.id === budgetId)
  const sourceAccountId = budget ? budget.sourceAccountId : accountId
  const available = budget
    ? budgetUsage(state, budget, now).available
    : accountId
      ? accountBalance(state, accountId)
      : ZERO
  const selected = rows.filter(
    (r): r is Row & { amount: Cents } => r.selected && r.amount !== null && r.amount > 0,
  )
  const total = sum(selected, (r) => r.amount)
  const overLimit = budget ? selected.filter((r) => r.amount > budget.perOperationLimit) : []
  const error =
    total > available
      ? `Only ${formatUsd(available, { withCode: true })} available. Lower the amounts or choose another source.`
      : overLimit.length > 0 && budget
        ? `${pluralize(overLimit.length, 'payment')} above ${budget.name}’s ${formatUsd(budget.perOperationLimit, { withCode: true })} per-operation limit.`
        : undefined
  const updateRow = (userId: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, ...patch } : r)))

  if (people.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Pay team" />
        <EmptyState
          title="No Members to pay"
          description="Invite people to the Agency first. Team payments go to active Members."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('payments')} className="hover:text-foreground">
            Payments
          </Link>
        }
        title="Pay team"
        description="Send payments to several team members in one batch. Viatik does not calculate payroll taxes."
      />

      <Panel title="From where?">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Budget" htmlFor="budget" hint="Paying from a budget applies its rules.">
            <SimpleSelect
              id="budget"
              value={budgetId}
              onValueChange={setBudgetId}
              options={[
                { value: NO_BUDGET, label: 'No budget, pay from an account' },
                ...budgets.map((b) => ({
                  value: b.id,
                  label: b.name,
                  description: `${formatUsd(budgetUsage(state, b, now).available)} available`,
                })),
              ]}
            />
          </FormField>
          {budget ? null : (
            <FormField label="Account" htmlFor="account">
              <SimpleSelect
                id="account"
                value={accountId}
                onValueChange={setAccountId}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: `${formatUsd(accountBalance(state, a.id))} available`,
                }))}
              />
            </FormField>
          )}
          <FormField label="Memo" htmlFor="memo" className="sm:col-span-2">
            <PillInput id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </FormField>
        </div>
      </Panel>

      <Panel
        title="Team"
        description={`${formatUsd(available, { withCode: true })} available in ${accountName(state, sourceAccountId ?? undefined)}${budget ? ` · ${budget.name}` : ''}`}
      >
        <ul className="flex flex-col">
          {rows.map((row) => {
            const name = userName(state, row.userId)
            const tooHigh = Boolean(
              budget && row.selected && row.amount && row.amount > budget.perOperationLimit,
            )
            return (
              <li
                key={row.userId}
                className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
              >
                <Checkbox
                  checked={row.selected}
                  onCheckedChange={(value) => updateRow(row.userId, { selected: Boolean(value) })}
                  aria-label={`Pay ${name}`}
                />
                <PersonAvatar name={name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                <div className="w-40 sm:w-52">
                  <MoneyInput
                    value={row.amount}
                    onChange={(value) => updateRow(row.userId, { amount: value })}
                    disabled={!row.selected}
                    invalid={tooHigh}
                    aria-describedby={undefined}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm text-muted-foreground">{pluralize(selected.length, 'payment')}</span>
          <Amount value={total} size="lg" />
        </div>
        {error ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </Panel>

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('payments'))}>
          Cancel
        </Button>
        <Button
          size="pill-sm"
          disabled={selected.length === 0 || !sourceAccountId || memo.trim().length < 3 || Boolean(error)}
          onClick={() => setOpen(true)}
        >
          Review team payments
        </Button>
      </FormActions>

      <ApprovalSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={() => {
          send.reset()
          if (sentCount > 0) router.push(href('payments'))
        }}
        title="Send team payments"
        summary={{
          what: `${pluralize(selected.length, 'team member')} paid in one batch: ${selected.map((r) => userName(state, r.userId)).join(', ')}.`,
          amount: total,
          from: budget
            ? `${accountName(state, budget.sourceAccountId)} · ${budget.name}`
            : accountName(state, accountId ?? undefined),
          to: pluralize(selected.length, 'team member'),
          reversible: 'Cannot be undone. Once paid, the money belongs to each team member.',
          policy: budget
            ? `${budget.name}: per-operation limit ${formatUsd(budget.perOperationLimit, { withCode: true })}.`
            : 'Agency account payment, authorized by an Agency Admin.',
        }}
        confirmLabel="Send team payments"
        phase={send.phase}
        error={send.error}
        onConfirm={async () => {
          if (!sourceAccountId) return
          const payments = await send.run({
            agencyId,
            accountId: sourceAccountId,
            budgetId: budget?.id,
            memo: memo.trim(),
            items: selected.map((r) => ({ userId: r.userId, amount: r.amount })),
          })
          if (payments) setSentCount(payments.length)
        }}
        success={{
          title: 'Team payments completed',
          body: `${formatUsd(total, { withCode: true })} was paid to ${pluralize(selected.length, 'team member')}. Each payment has its own receipt.`,
        }}
      />
    </div>
  )
}

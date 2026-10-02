'use client'

import { MoreHorizontal, PauseCircle, PlayCircle, Plus, UserPlus } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { HolderAvatar, holderFromKey, holderOptions } from '@/components/app/holders'
import { AddDestinationButton, EmptySourceHint } from '@/components/app/money-setup'
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
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyBarChart } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile, UsageBar } from '@/components/viatik/finance'
import { MoneyInput } from '@/components/viatik/forms'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { budgetPeriodLabel, budgetPeriodUnit, categoryLabel } from '@/domain/labels'
import { formatUsd, usd, ZERO, type Cents } from '@/domain/money'
import { describeBudgetPolicy } from '@/domain/policy'
import { accountName, actorName, destinationName, holderName } from '@/domain/queries'
import { accountBalance, budgetUsage, holderSpentInPeriod, isHold, spendByMonth } from '@/domain/selectors'
import { budgetStatus, requestStatus } from '@/domain/status'
import { seriesColor, seriesKey } from '@/lib/chart-colors'
import { formatDate, formatRelative, pluralize } from '@/lib/format'

type SheetKind = 'pause' | 'assign' | 'fund' | 'revoke'

export default function BudgetDetailPage() {
  const { budgetId } = useParams<{ budgetId: string }>()
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const [sheet, setSheet] = React.useState<SheetKind | null>(null)
  // What the open sheet acts on, fixed when it opens so a refresh cannot change its copy.
  const [resuming, setResuming] = React.useState(false)
  const [revokeId, setRevokeId] = React.useState<string | null>(null)
  const [holderKey, setHolderKey] = React.useState<string | null>(null)
  const [allowance, setAllowance] = React.useState<Cents | null>(usd(500))
  const [fundAmount, setFundAmount] = React.useState<Cents | null>(null)
  const pause = useCommand('setBudgetPaused')
  const assign = useCommand('assignAllowance')
  const fund = useCommand('allocateToBudget')
  const revoke = useCommand('revokeAllowance')

  const budget = state.budgets.find((b) => b.id === budgetId && b.agencyId === agencyId)
  if (!budget) {
    return (
      <ScreenUnavailable
        title="Budget not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const usage = budgetUsage(state, budget, now)
  const unit = budgetPeriodUnit[budget.period]
  const source = accountName(state, budget.sourceAccountId)
  const sourceAvailable = accountBalance(state, budget.sourceAccountId)
  const allowances = state.allowances.filter((a) => a.budgetId === budget.id && a.status === 'active')
  const payments = state.payments.filter((p) => p.budgetId === budget.id)
  const holds = state.requests.filter((r) => r.budgetId === budget.id && isHold(r))
  const paused = budget.status === 'paused'
  const categorySeries = budget.allowedCategories.map((category, i) => ({
    key: seriesKey(i),
    label: categoryLabel[category],
    color: seriesColor(i),
    category,
  }))
  const spend = spendByMonth(
    state,
    { budgetId: budget.id },
    (m) => {
      const category = state.payments.find((p) => p.id === m.refId)?.category
      return categorySeries.find((s) => s.category === category)?.key ?? null
    },
    now,
    6,
  )
  const hasSpend = spend.some((row) => categorySeries.some((series) => Number(row[series.key] ?? 0) > 0))
  const candidates = holderOptions(
    state,
    budget.agencyId,
    allowances.map((a) => a.holder),
  )
  const policyLines = describeBudgetPolicy(budget, {
    destinationNames: budget.allowedDestinationIds.map((id) => destinationName(state, id)),
    categoryLabels: categoryLabel,
  })
  // Looked up across all allowances: after a revoke it is no longer active.
  const revoking = state.allowances.find((a) => a.id === revokeId)
  const assignee = holderKey ? holderName(state, holderFromKey(holderKey)) : null
  const closeSheet = (open: boolean) => !open && setSheet(null)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href={href('budgets')} className="hover:text-foreground">
              Budgets
            </Link>
            <span aria-hidden="true">/</span>
            <span>{source}</span>
          </>
        }
        title={budget.name}
        description={budget.purpose}
        meta={
          <>
            <StatusBadge status={budgetStatus[budget.status]} size="md" />
            <Tag>{budgetPeriodLabel[budget.period]}</Tag>
            {budget.expiresAt ? (
              <span className="text-sm text-subtle">Closes {formatDate(budget.expiresAt)}</span>
            ) : null}
          </>
        }
        actions={
          <>
            {can('pause_budget') ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon-pill" aria-label="More actions" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1.5">
                  <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => setSheet('fund')}>
                    <Plus className="size-4" /> Add funds to budget
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 rounded-lg"
                    onClick={() => {
                      setResuming(paused)
                      setSheet('pause')
                    }}
                  >
                    {paused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}{' '}
                    {paused ? 'Resume budget' : 'Pause budget'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {can('assign_allowance') ? (
              <Button size="pill" onClick={() => setSheet('assign')} disabled={candidates.length === 0}>
                <UserPlus data-icon="inline-start" /> Assign allowance
              </Button>
            ) : null}
          </>
        }
      />

      {paused ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          Budget paused. New requests and payments are on hold; approved holds can still complete.
        </div>
      ) : null}

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Available" value={usage.available} hint="Balance minus holds" emphasis />
        <KpiTile label="Reserved" value={usage.reserved} hint={pluralize(holds.length, 'active hold')} />
        <KpiTile
          label="Spent this period"
          value={usage.spentThisPeriod}
          hint={`of ${formatUsd(budget.periodLimit, { withCode: true })} limit`}
        />
        <KpiTile
          label="Allocated in total"
          value={usage.allocated}
          hint={`${formatUsd(usage.spentTotal, { withCode: true })} spent since creation`}
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Spending by category" description="Last six months.">
          {hasSpend ? (
            <MoneyBarChart data={spend} series={categorySeries} className="h-64" />
          ) : (
            <EmptyState
              compact
              title="No spending yet"
              description="Payments from this budget will show here by category."
            />
          )}
        </Panel>
        <Panel title="Rules">
          <div className="flex flex-col gap-5">
            <UsageBar
              used={usage.spentThisPeriod}
              reserved={usage.reserved}
              limit={budget.periodLimit}
              label="Period usage"
            />
            <PolicySummary lines={policyLines} />
          </div>
        </Panel>
      </div>

      <Panel
        title="People and automations with access"
        description="Each allowance is a limit, not a transfer. The money stays in the budget."
      >
        {allowances.length === 0 ? (
          <EmptyState
            compact
            title="No spending access yet"
            description="Assign a Member or an AI Agent to let them spend from this budget."
          />
        ) : (
          <ul className="flex flex-col">
            {allowances.map((a) => {
              const name = holderName(state, a.holder)
              const used = holderSpentInPeriod(state, budget, a.holder, now)
              return (
                <li
                  key={a.id}
                  className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 sm:flex-row sm:items-center"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-3">
                    <HolderAvatar state={state} holder={a.holder} size="md" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <span className="text-xs text-subtle">
                        {a.holder.kind === 'member' ? 'Member' : 'AI Agent'} ·{' '}
                        {formatUsd(a.periodLimit, { withCode: true })} per {unit}
                        {a.perOperationLimit ? ` · max ${formatUsd(a.perOperationLimit)} each` : ''}
                      </span>
                    </span>
                  </span>
                  <UsageBar used={used} limit={a.periodLimit} label={`${name} usage`} className="sm:w-64" />
                  {can('assign_allowance') ? (
                    <Button
                      variant="ghost"
                      size="pill-sm"
                      className="text-danger hover:text-danger"
                      onClick={() => {
                        setRevokeId(a.id)
                        setSheet('revoke')
                      }}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title="Active holds" description="Approved, waiting to settle.">
          {holds.length === 0 ? (
            <EmptyState
              compact
              title="No active holds"
              description="Approved requests hold their amount here until the payment settles."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {holds.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate">{r.purpose}</span>
                    <span className="text-xs text-subtle">
                      {actorName(state, r.requester)} · {formatRelative(r.createdAt, now)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <Amount value={r.amount} size="sm" />
                    <StatusBadge status={requestStatus[r.status]} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Allowed destinations">
          {budget.allowedDestinationIds.length === 0 ? (
            state.destinations.some((d) => d.agencyId === budget.agencyId && d.status === 'approved') ? (
              <p className="text-sm text-muted-foreground">Any approved payment destination of the Agency.</p>
            ) : (
              <div className="flex flex-col items-start gap-2">
                <p className="text-sm text-pretty text-muted-foreground">
                  The Agency has no payment destinations yet. Nobody can pay from this budget until you add one.
                </p>
                {can('send_payment') ? <AddDestinationButton agencyId={budget.agencyId} /> : null}
              </div>
            )
          ) : (
            <ul className="flex flex-col gap-2">
              {budget.allowedDestinationIds.map((id) => {
                const destination = state.destinations.find((d) => d.id === id)
                return (
                  <li key={id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{destination?.name ?? 'Payment destination'}</span>
                    <span className="text-xs text-subtle">{destination?.settlementLabel}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
        <Panel title="Approved uses">
          <div className="flex flex-wrap gap-2">
            {budget.allowedCategories.map((c) => (
              <span
                key={c}
                className="rounded-full border border-border px-3 py-1 text-sm text-muted-foreground"
              >
                {categoryLabel[c]}
              </span>
            ))}
          </div>
        </Panel>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Payments</h2>
        <PaymentsTable
          payments={payments}
          showBudget={false}
          empty={
            <EmptyState
              compact
              title="No payments yet"
              description="Payments from this budget will appear here with their receipts."
            />
          }
        />
      </section>

      <ApprovalSheet
        open={sheet === 'pause'}
        onOpenChange={closeSheet}
        onClosed={pause.reset}
        title={resuming ? 'Resume budget' : 'Pause budget'}
        summary={{
          what: resuming
            ? `${budget.name} accepts requests and payments again.`
            : `No one can create new requests or payments on ${budget.name} while it is paused.`,
          reversible: 'You can change this at any time.',
          policy: 'Paused budgets cannot create new holds; settlement enforces it, not only the app.',
        }}
        confirmLabel={resuming ? 'Resume budget' : 'Pause budget'}
        confirmVariant={resuming ? 'default' : 'destructive'}
        phase={pause.phase}
        error={pause.error}
        onConfirm={() => pause.run({ budgetId: budget.id, paused: !resuming })}
        success={{
          title: resuming ? 'Budget resumed' : 'Budget paused',
          body: resuming ? 'Spending is enabled again.' : 'People with access were notified.',
        }}
      />

      <ApprovalSheet
        open={sheet === 'assign'}
        onOpenChange={closeSheet}
        onClosed={() => {
          assign.reset()
          setHolderKey(null)
          setAllowance(usd(500))
        }}
        title="Assign allowance"
        summary={{
          what: 'The person or automation can spend from this budget within their allowance. No money moves until they make a payment.',
          amount: allowance ?? undefined,
          reversible: 'You can revoke access at any time; it takes effect immediately.',
          policy: `Cannot exceed the budget's ${formatUsd(budget.periodLimit, { withCode: true })} period limit.`,
        }}
        confirmLabel="Assign allowance"
        disabled={!holderKey || !allowance || allowance > budget.periodLimit}
        phase={assign.phase}
        error={assign.error}
        onConfirm={() =>
          holderKey &&
          allowance &&
          assign.run({ budgetId: budget.id, holder: holderFromKey(holderKey), periodLimit: allowance })
        }
        success={{
          title: 'Access assigned',
          body: `${assignee ?? 'They'} can now spend up to ${formatUsd(allowance ?? ZERO, { withCode: true })} per ${unit} from ${budget.name}.`,
        }}
      >
        <div className="flex flex-col gap-4">
          <FormField label="Who" htmlFor="holder">
            <SimpleSelect
              id="holder"
              value={holderKey}
              onValueChange={setHolderKey}
              options={candidates}
              placeholder="Choose a Member or AI Agent"
            />
          </FormField>
          <FormField
            label={`Allowance per ${unit}`}
            htmlFor="allowance"
            error={
              allowance && allowance > budget.periodLimit
                ? `Cannot exceed the ${formatUsd(budget.periodLimit, { withCode: true })} period limit.`
                : undefined
            }
          >
            <MoneyInput
              id="allowance"
              value={allowance}
              onChange={setAllowance}
              invalid={Boolean(allowance && allowance > budget.periodLimit)}
            />
          </FormField>
        </div>
      </ApprovalSheet>

      <ApprovalSheet
        open={sheet === 'fund'}
        onOpenChange={closeSheet}
        onClosed={() => {
          fund.reset()
          setFundAmount(null)
        }}
        title="Add funds to budget"
        summary={{
          what: `Moves money from ${source} into ${budget.name}.`,
          amount: fundAmount ?? undefined,
          from: source,
          to: budget.name,
          reversible: 'Unused funds can be returned to the source account.',
          policy: 'Budgets are funded only from accounts of the same Agency.',
        }}
        confirmLabel="Add funds"
        disabled={!fundAmount || fundAmount > sourceAvailable}
        phase={fund.phase}
        error={fund.error}
        onConfirm={() =>
          fundAmount && fund.run({ budgetId: budget.id, amount: fundAmount, direction: 'allocate' })
        }
        success={{
          title: 'Budget funded',
          body: `${formatUsd(fundAmount ?? ZERO, { withCode: true })} was added to ${budget.name}.`,
        }}
      >
        <FormField
          label="Amount"
          htmlFor="fund-amount"
          error={
            fundAmount && fundAmount > sourceAvailable && sourceAvailable > 0
              ? `${source} has ${formatUsd(sourceAvailable, { withCode: true })} available.`
              : undefined
          }
          hint={
            sourceAvailable === 0 ? (
              <EmptySourceHint name={source} fundingHref={href('funding')} />
            ) : undefined
          }
        >
          <MoneyInput
            id="fund-amount"
            value={fundAmount}
            onChange={setFundAmount}
            available={sourceAvailable}
            invalid={Boolean(fundAmount && fundAmount > sourceAvailable)}
          />
        </FormField>
      </ApprovalSheet>

      <ApprovalSheet
        open={sheet === 'revoke'}
        onOpenChange={closeSheet}
        onClosed={() => {
          revoke.reset()
          setRevokeId(null)
        }}
        title="Revoke spending access"
        summary={{
          what: `${revoking ? holderName(state, revoking.holder) : 'This holder'} loses access to ${budget.name} immediately. Pending requests are cancelled.`,
          reversible: 'You can assign access again later.',
          policy: 'Removed permissions take effect immediately, at settlement and in the app.',
        }}
        confirmLabel="Revoke access"
        confirmVariant="destructive"
        phase={revoke.phase}
        error={revoke.error}
        onConfirm={() => revokeId && revoke.run({ allowanceId: revokeId })}
        success={{ title: 'Access revoked', body: 'The allowance is no longer active.' }}
      />
    </div>
  )
}

'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { ArrowLeftRight, ArrowUpRight, MoreHorizontal, PieChart, Undo2 } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { accountHistory } from '@/components/app/account-parts'
import { BalanceCheckNote } from '@/components/app/balance-check'
import { ButtonLink } from '@/components/app/button-link'
import { locationLabel, movementLabel } from '@/components/app/capital-trail-panel'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { ReturnToInvestorSheet } from '@/components/app/return-to-investor-sheet'
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
import { MoneyAreaChart } from '@/components/viatik/charts'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useLedger, useViatikState } from '@/data/react'
import { shortAddress } from '@/domain/address'
import { accountTemplate } from '@/domain/labels'
import { cents, sum } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import { accountBalance, budgetBalance } from '@/domain/selectors'
import { budgetStatus } from '@/domain/status'
import type { Movement } from '@/domain/types'
import { formatDateTime, pluralize } from '@/lib/format'

export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const { state, now } = useViatikState()
  const { checks } = useLedger()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const receipts = useReceiptDrawer()
  const [returnOpen, setReturnOpen] = React.useState(false)

  const account = state.accounts.find((a) => a.id === accountId && a.agencyId === agencyId)
  if (!account) {
    return (
      <ScreenUnavailable
        title="Account not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const isInflow = (m: Movement) => m.to.kind === 'account' && m.to.accountId === account.id
  const isOutflow = (m: Movement) => m.from.kind === 'account' && m.from.accountId === account.id
  const movements = state.movements
    .filter((m) => isInflow(m) || isOutflow(m))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const inflow = sum(movements.filter(isInflow), (m) => m.amount)
  const outflow = sum(movements.filter(isOutflow), (m) => m.amount)
  const budgets = state.budgets.filter((b) => b.sourceAccountId === account.id)
  const history = accountHistory(state, account, now)
  // Paid outside Viatik by an Agency Admin: the payee and the address it went to.
  const outsideAddress = (m: Movement) =>
    m.kind === 'payment' && !isInflow(m) && m.to.kind === 'external' ? (m.to.address ?? '') : undefined
  const counterparty = (m: Movement) => {
    const other = isInflow(m) ? m.from : m.to
    // Agency Admins do not see the Portfolio Vault itself: the return's receipt names it.
    if (m.kind === 'capital_return') {
      return receiptFor(state, m.receiptId)?.toLabel ?? locationLabel(state, other)
    }
    if (other.kind === 'external' && other.address) return `${other.label} · ${shortAddress(other.address)}`
    return locationLabel(state, other)
  }
  const signedAmount = (m: Movement) => (isInflow(m) ? m.amount : cents(-m.amount))
  const balance = accountBalance(state, account.id)
  const canPayOutside = can('pay_outside')
  const canReturn = can('return_capital')
  // Why money cannot leave this account now, for the actions that move it.
  const blockedReason =
    account.status === 'frozen'
      ? `${account.name} is frozen: it cannot move money.`
      : balance === 0
        ? `${account.name} has no money yet.`
        : undefined

  const columns: ColumnDef<Movement, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'Movement',
      cell: ({ row }) => <span className="text-sm font-medium">{movementLabel[row.original.kind]}</span>,
    },
    {
      id: 'counterparty',
      header: 'Counterparty',
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm text-muted-foreground">{counterparty(row.original)}</span>
          {outsideAddress(row.original) !== undefined ? <Tag className="shrink-0">Outside Viatik</Tag> : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <Amount
          value={signedAmount(row.original)}
          size="sm"
          signed
          tone={isInflow(row.original) ? 'positive' : 'default'}
        />
      ),
    },
    {
      id: 'receipt',
      header: 'Receipt',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const receipt = receiptFor(state, row.original.receiptId)
        return receipt ? (
          <span className="font-mono text-xs text-muted-foreground">{receipt.number}</span>
        ) : (
          <span className="text-xs text-subtle">—</span>
        )
      },
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('accounts')} className="hover:text-foreground">
            Accounts
          </Link>
        }
        title={account.name}
        description={account.purpose || accountTemplate[account.template].description}
        meta={
          <>
            <Tag>{accountTemplate[account.template].label}</Tag>
            {account.status === 'frozen' ? (
              <>
                <StatusBadge status={{ label: 'Frozen', tone: 'warning' }} />
                {/* Visible, and the reason the disabled "Pay outside Viatik" points to. */}
                <span id="account-frozen-note" className="text-sm text-subtle">
                  It cannot move money until it is active again.
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            {canReturn ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="icon-pill" aria-label="More account actions" />}
                >
                  <MoreHorizontal />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-1.5">
                  <DropdownMenuItem
                    className="items-start gap-2 rounded-lg"
                    disabled={Boolean(blockedReason)}
                    onClick={() => setReturnOpen(true)}
                  >
                    <Undo2 className="mt-0.5 size-4" />
                    <span className="flex flex-col">
                      Return to Investor
                      {blockedReason ? <span className="text-xs text-subtle">{blockedReason}</span> : null}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {can('transfer_funds') ? (
              <ButtonLink href={href(`accounts/transfer?from=${account.id}`)} variant="outline" size="pill">
                <ArrowLeftRight data-icon="inline-start" /> Transfer funds
              </ButtonLink>
            ) : null}
            {/* Only a frozen account blocks it (the note beside the Frozen badge says why). An empty one
                still opens the page, which says so and can pay from a budget or another account instead. */}
            {canPayOutside && account.status === 'frozen' ? (
              <Button variant="outline" size="pill" disabled aria-describedby="account-frozen-note">
                <ArrowUpRight data-icon="inline-start" /> Pay outside Viatik
              </Button>
            ) : canPayOutside ? (
              <ButtonLink
                href={href(`accounts/pay-outside?from=${account.id}`)}
                variant="outline"
                size="pill"
              >
                <ArrowUpRight data-icon="inline-start" /> Pay outside Viatik
              </ButtonLink>
            ) : null}
            {can('create_budget') ? (
              <ButtonLink href={href('budgets/new')} size="pill">
                <PieChart data-icon="inline-start" /> Create budget
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Balance"
          value={balance}
          hint={<BalanceCheckNote check={checks?.check(account.id)} />}
          emphasis
        />
        <KpiTile label="Money in" value={inflow} hint="All time" />
        <KpiTile label="Money out" value={outflow} hint="All time" />
        <KpiTile
          label="In funded budgets"
          value={sum(budgets, (b) => budgetBalance(state, b.id))}
          hint={pluralize(budgets.length, 'budget')}
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Panel className="xl:col-span-2" title="Balance over time" description="End of each month.">
          <MoneyAreaChart
            data={history}
            series={[{ key: 'balance', label: 'Balance', color: 'var(--color-mist)' }]}
            className="h-60"
          />
        </Panel>
        <Panel title="Budgets funded from this account">
          {budgets.length === 0 ? (
            <EmptyState
              compact
              title="No budgets yet"
              description="Budgets that take their money from this account will show here."
            />
          ) : (
            <ul className="flex flex-col">
              {budgets.map((b) => (
                <li key={b.id} className="border-t border-border first:border-t-0">
                  <Link
                    href={href(`budgets/${b.id}`)}
                    className="flex items-center justify-between gap-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-sm font-medium">{b.name}</span>
                      <StatusBadge status={budgetStatus[b.status]} className="w-fit" />
                    </span>
                    <Amount value={budgetBalance(state, b.id)} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Movements</h2>
        <DataTable
          data={movements}
          columns={columns}
          caption={`${account.name} movements`}
          searchPlaceholder="Search movements"
          searchText={(m) => {
            const address = outsideAddress(m)
            return `${movementLabel[m.kind]} ${counterparty(m)}${address === undefined ? '' : ` Outside Viatik ${address}`}`
          }}
          facets={[
            {
              id: 'direction',
              label: 'Direction',
              accessor: (m) => (isInflow(m) ? 'in' : 'out'),
              options: [
                { value: 'in', label: 'Money in' },
                { value: 'out', label: 'Money out' },
              ],
            },
          ]}
          onRowClick={(m) => receipts.show(receiptFor(state, m.receiptId))}
          empty={
            <EmptyState
              compact
              title="No movements yet"
              description="Funding, transfers and payments through this account will show here."
            />
          }
          renderMobile={(m) => (
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{movementLabel[m.kind]}</span>
                <span className="truncate text-xs text-subtle">
                  {counterparty(m)} · {formatDateTime(m.createdAt)}
                  {outsideAddress(m) !== undefined ? ' · Outside Viatik' : ''}
                </span>
              </span>
              <Amount value={signedAmount(m)} size="sm" signed tone={isInflow(m) ? 'positive' : 'default'} />
            </div>
          )}
        />
      </section>
      {receipts.drawer}
      <ReturnToInvestorSheet
        open={returnOpen}
        onOpenChange={setReturnOpen}
        agencyId={agencyId}
        accountId={account.id}
      />
    </div>
  )
}

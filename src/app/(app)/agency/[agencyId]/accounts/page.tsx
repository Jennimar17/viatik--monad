'use client'

import { ArrowLeftRight, Landmark, Plus } from 'lucide-react'
import Link from 'next/link'

import { accountHistory, accountIcons, isHeldAccount } from '@/components/app/account-parts'
import { ButtonLink } from '@/components/app/button-link'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { Sparkline } from '@/components/viatik/charts'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader } from '@/components/viatik/layout'
import { Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { accountTemplate } from '@/domain/labels'
import { sum } from '@/domain/money'
import { accountBalance, agencyCapital, budgetBalance } from '@/domain/selectors'
import { pluralize } from '@/lib/format'

export default function AccountsPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId)
  const capital = agencyCapital(state, agencyId, now)
  const total = sum(accounts, (a) => accountBalance(state, a.id))
  const createButton = can('create_account') ? (
    <ButtonLink href={href('accounts/new')} size="pill">
      <Plus data-icon="inline-start" /> Create account
    </ButtonLink>
  ) : null

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Accounts"
        description="Accounts hold the Agency’s money. Budgets take their funds from here."
        actions={
          <>
            {can('transfer_funds') && accounts.length > 1 ? (
              <ButtonLink href={href('accounts/transfer')} variant="outline" size="pill">
                <ArrowLeftRight data-icon="inline-start" /> Transfer funds
              </ButtonLink>
            ) : null}
            {createButton}
          </>
        }
      />

      {accounts.length === 0 ? (
        <EmptyState
          icon={<Landmark />}
          title="No accounts yet"
          description="Accounts receive released funding. Start with an Operations account, then fund budgets from it."
          action={createButton}
        />
      ) : (
        <>
          <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
            <KpiTile label="Total in accounts" value={total} emphasis />
            <KpiTile
              label="Available to operate"
              value={capital.availableToOperate}
              hint="Excludes reserve and taxes"
            />
            <KpiTile
              label="Held in reserve"
              value={capital.heldInReserve}
              hint="Reserve and taxes accounts"
            />
            <KpiTile label="Allocated to budgets" value={capital.allocated} hint="Available inside budgets" />
          </HairlineGrid>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((account) => {
              const history = accountHistory(state, account, now)
              const funded = state.budgets.filter((b) => b.sourceAccountId === account.id)
              const inBudgets = sum(funded, (b) => budgetBalance(state, b.id))
              return (
                <Link
                  key={account.id}
                  href={href(`accounts/${account.id}`)}
                  className="surface flex flex-col gap-4 rounded-xl p-5 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border text-subtle [&_svg]:size-5">
                        {accountIcons[account.template]}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{account.name}</span>
                        <span className="text-xs text-subtle">{accountTemplate[account.template].label}</span>
                      </span>
                    </span>
                    {isHeldAccount(account) ? <Tag>Held</Tag> : null}
                    {account.status === 'frozen' ? <Tag>Frozen</Tag> : null}
                  </div>
                  <Amount value={accountBalance(state, account.id)} size="lg" />
                  <Sparkline data={history.map((h) => h.balance)} />
                  <div className="flex justify-between text-xs text-subtle">
                    <span>{pluralize(funded.length, 'budget')} funded</span>
                    <span>
                      <Amount value={inBudgets} size="xs" /> in budgets
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

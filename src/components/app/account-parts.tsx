import { Banknote, Building2, Landmark, PiggyBank, Receipt, Users } from 'lucide-react'
import type * as React from 'react'

import { accountTemplate } from '@/domain/labels'
import { balanceOf, lastMonths } from '@/domain/selectors'
import type { Account, AccountTemplate, ViatikState } from '@/domain/types'

export const accountIcons: Record<AccountTemplate, React.ReactNode> = {
  operations: <Landmark />,
  people: <Users />,
  vendors: <Building2 />,
  taxes: <Receipt />,
  reserve: <PiggyBank />,
  project: <Banknote />,
}

/** Reserve and taxes hold money back from day-to-day operations. */
export const isHeldAccount = (account: Pick<Account, 'template'>) =>
  account.template === 'reserve' || account.template === 'taxes'

export function accountTemplateOptions() {
  return (Object.keys(accountTemplate) as AccountTemplate[]).map((key) => ({ key, ...accountTemplate[key] }))
}

/** End-of-month balances for a sparkline or chart. */
export function accountHistory(state: ViatikState, account: Account, now: string, months = 6) {
  return lastMonths(now, months).map((bucket) => ({
    month: bucket.label,
    balance: balanceOf(state.movements, { kind: 'account', accountId: account.id }, bucket.end),
  }))
}

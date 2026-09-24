'use client'

import { Building2, FileText, type LucideIcon, PieChart, Plus, Send, UserRound } from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { useViatikState } from '@/data/react'
import { formatUsd } from '@/domain/money'
import { destinationName, recipientName, userName } from '@/domain/queries'

import { NAVIGATION } from '../nav'
import { useHref, usePermissions, useRole } from '../role-context'

/** ⌘K: jump to any screen of the current role or find its records. */
export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state } = useViatikState()
  const { role, agencyId } = useRole()
  const { canView, can } = usePermissions()
  const href = useHref()
  const router = useRouter()
  const go = (target: Route) => {
    onOpenChange(false)
    router.push(target)
  }

  const nav = [...NAVIGATION[role].primary, ...NAVIGATION[role].secondary].filter(
    (item) => !item.capability || canView(item.capability),
  )
  const inScope = <T extends { agencyId: string }>(items: T[]) =>
    agencyId ? items.filter((i) => i.agencyId === agencyId) : items

  const actions: { label: string; path: string; icon: LucideIcon }[] = []
  if (role === 'investor') {
    actions.push({ label: 'Create funding agreement', path: 'funding/new', icon: Plus })
    actions.push({ label: 'Create Agency', path: 'agencies/new', icon: Plus })
    actions.push({ label: 'Add funds', path: 'vaults/add-funds', icon: Plus })
  }
  if (role === 'agency_admin') {
    if (can('create_budget')) actions.push({ label: 'Create budget', path: 'budgets/new', icon: Plus })
    if (can('send_payment')) actions.push({ label: 'Send payment', path: 'payments/new', icon: Send })
    if (can('manage_bills')) actions.push({ label: 'Add bill', path: 'bills/new', icon: Plus })
    actions.push({ label: 'Request funding', path: 'funding', icon: Plus })
  }
  if (role === 'member') {
    actions.push({ label: 'New request', path: 'requests/new', icon: Send })
    actions.push({ label: 'Add expense', path: 'expenses/new', icon: Plus })
  }

  const agencies = role === 'investor' ? state.agencies : []
  const budgets = role === 'member' ? state.budgets : inScope(state.budgets)
  const payments = inScope(state.payments).slice(-40).reverse()
  const bills = role === 'agency_admin' ? inScope(state.bills).slice(-30).reverse() : []
  const members =
    role === 'agency_admin'
      ? state.memberships.filter(
          (m) => m.scope.kind === 'agency' && m.scope.agencyId === agencyId && m.status === 'active',
        )
      : []

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search Viatik"
      description="Jump to a screen or find a record"
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput placeholder="Search screens, budgets, payments…" />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>No results.</CommandEmpty>
          <CommandGroup heading="Actions">
            {actions.map((action) => (
              <CommandItem key={action.label} onSelect={() => go(href(action.path))}>
                <action.icon /> {action.label}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Go to">
            {nav.map((item) => (
              <CommandItem key={item.key} onSelect={() => go(href(item.path))}>
                <item.icon /> {item.label}
              </CommandItem>
            ))}
          </CommandGroup>
          {agencies.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading="Agencies">
                {agencies.map((agency) => (
                  <CommandItem
                    key={agency.id}
                    value={`agency ${agency.name}`}
                    onSelect={() => go(href(`agencies/${agency.id}`))}
                  >
                    <Building2 /> {agency.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
          {budgets.length > 0 ? (
            <CommandGroup heading="Budgets">
              {budgets.map((budget) => (
                <CommandItem
                  key={budget.id}
                  value={`budget ${budget.name}`}
                  onSelect={() => go(href(`${role === 'member' ? 'budget' : 'budgets'}/${budget.id}`))}
                >
                  <PieChart /> {budget.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {members.length > 0 ? (
            <CommandGroup heading="Team">
              {members.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`member ${userName(state, m.userId)}`}
                  onSelect={() => go(href(`team/${m.userId}`))}
                >
                  <UserRound /> {userName(state, m.userId)}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {bills.length > 0 ? (
            <CommandGroup heading="Bills">
              {bills.map((bill) => (
                <CommandItem
                  key={bill.id}
                  value={`bill ${bill.number} ${destinationName(state, bill.destinationId)}`}
                  onSelect={() => go(href(`bills/${bill.id}`))}
                >
                  <FileText /> {destinationName(state, bill.destinationId)} · {bill.number}
                  <span className="ml-auto text-xs text-subtle num">{formatUsd(bill.amount)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {role !== 'investor' && payments.length > 0 ? (
            <CommandGroup heading="Payments">
              {payments.map((payment) => (
                <CommandItem
                  key={payment.id}
                  value={`payment ${payment.memo} ${recipientName(state, payment.recipient)}`}
                  onSelect={() => go(href('payments'))}
                >
                  <Send /> {recipientName(state, payment.recipient)} · {payment.memo}
                  <span className="ml-auto text-xs text-subtle num">{formatUsd(payment.amount)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

import { destinationKindLabel } from '@/components/app/money-setup'
import { categoryLabel } from '@/domain/labels'
import { sum } from '@/domain/money'
import { billState } from '@/domain/queries'
import type { StatusDescriptor } from '@/domain/status'
import type { Movement, Payment, PaymentDestination, SpendingCategory, ViatikState } from '@/domain/types'

/**
 * Providers are the Agency's payment destinations (vendors, services and
 * contractors) seen as records to manage: what was paid to each, where it is
 * used, and whether it can be paid right now.
 */

export type ProviderStatus = PaymentDestination['status']

export const providerStatus: Record<ProviderStatus, StatusDescriptor> = {
  approved: { label: 'Approved', tone: 'success' },
  pending_review: { label: 'Pending review', tone: 'warning' },
  paused: { label: 'Paused', tone: 'warning' },
  archived: { label: 'Archived', tone: 'neutral' },
}

export const providerKindOptions = (Object.keys(destinationKindLabel) as PaymentDestination['kind'][]).map(
  (kind) => ({ value: kind, label: destinationKindLabel[kind] }),
)

export const providerCategoryOptions = (Object.keys(categoryLabel) as SpendingCategory[]).map((category) => ({
  value: category,
  label: categoryLabel[category],
}))

/** "Vendor · Software and tools": what the provider is, in one line. */
export const providerKindLine = (provider: Pick<PaymentDestination, 'kind' | 'category'>) =>
  `${destinationKindLabel[provider.kind]} · ${categoryLabel[provider.category]}`

export const isPaymentTo = (payment: Payment, providerId: string) =>
  payment.recipient.kind === 'destination' && payment.recipient.destinationId === providerId

export const isMovementTo = (movement: Movement, providerId: string) =>
  movement.to.kind === 'recipient' &&
  movement.to.recipient.kind === 'destination' &&
  movement.to.recipient.destinationId === providerId

/** A website worth linking to: only plain web addresses become links. */
export function providerWebsiteHref(website: string | undefined): string | undefined {
  if (!website) return undefined
  return /^https?:\/\/\S+$/i.test(website.trim()) ? website.trim() : undefined
}

/** What the Agency paid and owes a provider, and where it is used. */
export function providerSummary(state: ViatikState, provider: PaymentDestination, now: string) {
  const payments = state.payments.filter(
    (p) => p.agencyId === provider.agencyId && isPaymentTo(p, provider.id),
  )
  const completed = payments.filter((p) => p.status === 'completed')
  const scheduled = payments.filter((p) => p.status === 'scheduled')
  const month = now.slice(0, 7)
  const thisMonth = completed.filter((p) => (p.completedAt ?? '').startsWith(month))
  const lastPaidAt = completed.reduce<string | undefined>((latest, p) => {
    const at = p.completedAt ?? p.scheduledFor
    return !latest || at > latest ? at : latest
  }, undefined)
  const bills = state.bills.filter((b) => b.agencyId === provider.agencyId && b.destinationId === provider.id)
  const openBills = bills.filter((b) => {
    const status = billState(b, now)
    return status === 'to_pay' || status === 'scheduled' || status === 'overdue'
  })
  const overdueBills = openBills.filter((b) => billState(b, now) === 'overdue')
  const budgets = state.budgets.filter(
    (b) => b.agencyId === provider.agencyId && b.allowedDestinationIds.includes(provider.id),
  )
  const agents = state.agents.filter(
    (a) => a.agencyId === provider.agencyId && a.allowedDestinationIds.includes(provider.id),
  )
  return {
    payments,
    completed,
    totalPaid: sum(completed, (p) => p.amount),
    thisMonth,
    paidThisMonth: sum(thisMonth, (p) => p.amount),
    scheduled,
    scheduledTotal: sum(scheduled, (p) => p.amount),
    lastPaidAt,
    bills,
    openBills,
    openBillsTotal: sum(openBills, (b) => b.amount),
    overdueBills,
    budgets,
    agents,
  }
}

export type ProviderSummary = ReturnType<typeof providerSummary>

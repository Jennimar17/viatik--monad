'use client'

import { ShieldCheck } from 'lucide-react'

import { requestRecipientLabel, requestTypeCopy } from '@/components/app/request-parts'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { AgentAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { actorName, agencyName, budgetName } from '@/domain/queries'
import { requestStatusFor } from '@/domain/status'
import type { PaymentRequest } from '@/domain/types'
import { formatRelative } from '@/lib/format'

/**
 * Requests waiting for a decision (or already decided), with one review action
 * per row. Each row says what kind of request it is and what follows once it
 * is paid (receipts within 30 days, a pay-back, always reviewed, straight to the vendor).
 */
export function RequestQueue({
  requests,
  onReview,
  showAgency = false,
  actionLabel = 'Review request',
  actionVariant = 'default',
  empty,
}: {
  requests: PaymentRequest[]
  onReview: (request: PaymentRequest) => void
  showAgency?: boolean
  actionLabel?: string
  actionVariant?: 'default' | 'outline'
  empty: { title: string; description: string }
}) {
  const { state, now, userId } = useViatikState()
  if (requests.length === 0) {
    return <EmptyState icon={<ShieldCheck />} title={empty.title} description={empty.description} />
  }
  return (
    <ul className="surface flex flex-col divide-y divide-border overflow-hidden rounded-xl">
      {requests.map((request) => {
        const name = actorName(state, request.requester)
        const automation = request.requester.kind === 'ai_agent'
        const copy = requestTypeCopy(state, request, userId)
        return (
          <li key={request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
            <span className="flex min-w-0 flex-1 items-start gap-3">
              {automation ? <AgentAvatar size="md" /> : <PersonAvatar name={name} size="md" />}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 truncate text-sm font-medium">{request.purpose}</span>
                  <Tag className="shrink-0">{copy.label}</Tag>
                </span>
                <span className="text-xs text-pretty text-subtle">
                  {name}
                  {automation ? ' · AI Agent' : ''}
                  {showAgency ? ` · ${agencyName(state, request.agencyId)}` : ''} ·{' '}
                  {budgetName(state, request.budgetId)} to {requestRecipientLabel(state, request, userId)} ·{' '}
                  {formatRelative(request.createdAt, now)}
                </span>
                <span className="text-xs text-pretty text-muted-foreground">{copy.rowNote}</span>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-3 sm:justify-end">
              <StatusBadge status={requestStatusFor(request)} />
              <Amount value={request.amount} size="md" className="ml-auto sm:ml-0" />
              <Button
                size="pill-sm"
                variant={actionVariant}
                className="w-full sm:w-auto"
                onClick={() => onReview(request)}
              >
                {actionLabel}
              </Button>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

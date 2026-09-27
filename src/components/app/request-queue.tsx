'use client'

import { ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { AgentAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { actorName, agencyName, budgetName, recipientName } from '@/domain/queries'
import { requestStatus } from '@/domain/status'
import type { PaymentRequest } from '@/domain/types'
import { formatRelative } from '@/lib/format'

/** Requests waiting for a decision (or already decided), with one review action per row. */
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
  const { state, now } = useViatikState()
  if (requests.length === 0) {
    return <EmptyState icon={<ShieldCheck />} title={empty.title} description={empty.description} />
  }
  return (
    <ul className="surface flex flex-col divide-y divide-border overflow-hidden rounded-xl">
      {requests.map((request) => {
        const name = actorName(state, request.requester)
        const automation = request.requester.kind === 'ai_agent'
        return (
          <li key={request.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
            <span className="flex min-w-0 flex-1 items-center gap-3">
              {automation ? <AgentAvatar size="md" /> : <PersonAvatar name={name} size="md" />}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{request.purpose}</span>
                <span className="truncate text-xs text-subtle">
                  {name}
                  {automation ? ' · AI Agent' : ''}
                  {showAgency ? ` · ${agencyName(state, request.agencyId)}` : ''} ·{' '}
                  {budgetName(state, request.budgetId)} to {recipientName(state, request.destination)} ·{' '}
                  {formatRelative(request.createdAt, now)}
                </span>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-3 sm:justify-end">
              <StatusBadge status={requestStatus[request.status]} />
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

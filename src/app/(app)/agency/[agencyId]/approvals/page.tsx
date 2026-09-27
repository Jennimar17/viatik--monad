'use client'

import * as React from 'react'

import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { PageTabs } from '@/components/app/page-tabs'
import { RequestQueue } from '@/components/app/request-queue'
import { RequestReviewSheet } from '@/components/app/request-review-sheet'
import { useRole } from '@/components/app/role-context'
import { PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { adminApprovals } from '@/domain/queries'
import type { PaymentRequest } from '@/domain/types'

const REQUESTER_OPTIONS = [
  { value: 'all', label: 'People and AI Agents' },
  { value: 'people', label: 'People only' },
  { value: 'automation', label: 'AI Agents only' },
]

export default function ApprovalsPage() {
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const [budget, setBudget] = React.useState('all')
  const [requester, setRequester] = React.useState('all')
  // The reviewed request stays mounted while the sheet animates closed.
  const [reviewingId, setReviewingId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const matches = (r: PaymentRequest) =>
    (budget === 'all' || r.budgetId === budget) &&
    (requester === 'all' ||
      (requester === 'automation' ? r.requester.kind === 'ai_agent' : r.requester.kind === 'user'))
  const { mine, withInvestor } = adminApprovals(state, agencyId)
  const decided = state.requests
    .filter(
      (r) =>
        r.agencyId === agencyId &&
        r.decidedAt &&
        (r.status === 'completed' ||
          r.status === 'declined' ||
          r.status === 'approved' ||
          r.status === 'processing') &&
        r.decision.outcome === 'needs_approval',
    )
    .sort((a, b) => ((a.decidedAt ?? '') < (b.decidedAt ?? '') ? 1 : -1))
    .slice(0, 20)
  const budgets = state.budgets.filter((b) => b.agencyId === agencyId)
  const anyRequests = mine.length + withInvestor.length + decided.length > 0

  const review = (request: PaymentRequest) => {
    setReviewingId(request.id)
    setOpen(true)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Approvals"
        description="Requests above a budget’s automatic limit wait here. You cannot approve your own."
      />

      {anyRequests ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:max-w-2xl">
          <FormField label="Budget" htmlFor="approvals-budget">
            <SimpleSelect
              id="approvals-budget"
              value={budget}
              onValueChange={setBudget}
              options={[
                { value: 'all', label: 'All budgets' },
                ...budgets.map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
          </FormField>
          <FormField label="Requested by" htmlFor="approvals-requester">
            <SimpleSelect
              id="approvals-requester"
              value={requester}
              onValueChange={setRequester}
              options={REQUESTER_OPTIONS}
            />
          </FormField>
        </div>
      ) : null}

      <PageTabs
        tabs={[
          {
            value: 'waiting',
            label: 'Waiting for you',
            count: mine.length,
            content: (
              <RequestQueue
                requests={mine.filter(matches)}
                onReview={review}
                empty={{
                  title: 'Nothing needs your attention',
                  description: 'Requests that require your decision will appear here.',
                }}
              />
            ),
          },
          {
            value: 'investor',
            label: 'With the Investor',
            count: withInvestor.length,
            content: (
              <RequestQueue
                requests={withInvestor.filter(matches)}
                onReview={review}
                actionLabel="View"
                actionVariant="outline"
                empty={{
                  title: 'No exceptions pending',
                  description: 'Requests above the agreement’s exception threshold go to the Investor.',
                }}
              />
            ),
          },
          {
            value: 'decided',
            label: 'Recently decided',
            content: (
              <RequestQueue
                requests={decided.filter(matches)}
                onReview={review}
                actionLabel="View"
                actionVariant="outline"
                empty={{
                  title: 'No decisions yet',
                  description: 'Approved and declined requests will be listed here.',
                }}
              />
            ),
          },
        ]}
      />

      {/* Keyed by request so a new review never inherits the previous one's operation state. */}
      <RequestReviewSheet
        key={reviewingId ?? 'none'}
        requestId={reviewingId}
        open={open}
        onOpenChange={setOpen}
        onClosed={() => setReviewingId(null)}
      />
    </div>
  )
}

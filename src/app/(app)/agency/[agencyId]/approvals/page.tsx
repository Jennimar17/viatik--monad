'use client'

import * as React from 'react'

import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { PageTabs } from '@/components/app/page-tabs'
import { requestTypeOptions } from '@/components/app/request-parts'
import { RequestQueue } from '@/components/app/request-queue'
import { RequestReviewSheet } from '@/components/app/request-review-sheet'
import { useRole } from '@/components/app/role-context'
import { PageHeader } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { requestTypeLabel } from '@/domain/labels'
import { adminApprovals } from '@/domain/queries'
import type { PaymentRequest, RequestType } from '@/domain/types'
import { pluralize } from '@/lib/format'

const REQUESTER_OPTIONS = [
  { value: 'all', label: 'People and AI Agents' },
  { value: 'people', label: 'People only' },
  { value: 'automation', label: 'AI Agents only' },
]

export default function ApprovalsPage() {
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const [budget, setBudget] = React.useState('all')
  const [type, setType] = React.useState('all')
  const [requester, setRequester] = React.useState('all')
  // The reviewed request stays mounted while the sheet animates closed.
  const [reviewingId, setReviewingId] = React.useState<string | null>(null)
  const [open, setOpen] = React.useState(false)

  const matches = (r: PaymentRequest) =>
    (budget === 'all' || r.budgetId === budget) &&
    (type === 'all' || r.type === type) &&
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
  // The tabs count and list what the filters keep.
  const mineShown = mine.filter(matches)
  const withInvestorShown = withInvestor.filter(matches)
  const decidedShown = decided.filter(matches)
  const filtered = budget !== 'all' || type !== 'all' || requester !== 'all'
  const typeLabel = type === 'all' ? undefined : requestTypeLabel[type as RequestType]
  /** A tab left empty by the filters says so, naming the type, instead of its "nothing here" copy. */
  const emptyCopy = (
    all: PaymentRequest[],
    where: { type: string; none: string },
    fallback: { title: string; description: string },
  ) =>
    filtered
      ? {
          title: typeLabel ? `No “${typeLabel}” requests ${where.type}` : where.none,
          description:
            all.length > 0
              ? `The filters above hide ${pluralize(all.length, 'request')}.${typeLabel ? ' Choose “All types” to see every type.' : ''}`
              : fallback.description,
        }
      : fallback

  const review = (request: PaymentRequest) => {
    setReviewingId(request.id)
    setOpen(true)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Approvals"
        description="Requests above a budget’s automatic limit, and every payment for work, wait here. You cannot approve your own."
      />

      {anyRequests ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:max-w-4xl">
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
          <FormField label="Type" htmlFor="approvals-type">
            <SimpleSelect
              id="approvals-type"
              value={type}
              onValueChange={setType}
              options={requestTypeOptions}
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
            count: mineShown.length,
            content: (
              <RequestQueue
                requests={mineShown}
                onReview={review}
                empty={emptyCopy(
                  mine,
                  { type: 'waiting for you', none: 'Nothing waiting for you matches these filters' },
                  {
                    title: 'Nothing needs your attention',
                    description: 'Requests that require your decision will appear here.',
                  },
                )}
              />
            ),
          },
          {
            value: 'investor',
            label: 'With the Investor',
            count: withInvestorShown.length,
            content: (
              <RequestQueue
                requests={withInvestorShown}
                onReview={review}
                actionLabel="View"
                actionVariant="outline"
                empty={emptyCopy(
                  withInvestor,
                  { type: 'with the Investor', none: 'Nothing with the Investor matches these filters' },
                  {
                    title: 'No exceptions pending',
                    description: 'Requests above the agreement’s exception threshold go to the Investor.',
                  },
                )}
              />
            ),
          },
          {
            value: 'decided',
            label: 'Recently decided',
            content: (
              <RequestQueue
                requests={decidedShown}
                onReview={review}
                actionLabel="View"
                actionVariant="outline"
                empty={emptyCopy(
                  decided,
                  { type: 'decided recently', none: 'No recent decision matches these filters' },
                  {
                    title: 'No decisions yet',
                    description: 'Approved and declined requests will be listed here.',
                  },
                )}
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

'use client'

import { ArrowRight, FileClock, ShieldCheck } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { ReleaseTrancheSheet } from '@/components/app/release-tranche-sheet'
import { RequestQueue } from '@/components/app/request-queue'
import { RequestReviewSheet } from '@/components/app/request-review-sheet'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { agencyName, investorApprovals, userName } from '@/domain/queries'
import { trancheStatusFor } from '@/domain/status'
import type { PaymentRequest, Tranche } from '@/domain/types'
import { formatDate, formatRelative } from '@/lib/format'

export default function InvestorApprovalsPage() {
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const [reviewingId, setReviewingId] = React.useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  // The tranche being released stays mounted while its sheet animates closed.
  const [releasingId, setReleasingId] = React.useState<string | null>(null)
  const [releaseOpen, setReleaseOpen] = React.useState(false)

  const { tranches: requested, exceptions } = investorApprovals(state, portfolioId)
  // Tranches without a milestone that are simply available (Manual, Scheduled, Recurring): the
  // Investor can release them without waiting for a request. They are not approvals, so they do not
  // count in the sidebar badge.
  const portfolioAgreements = new Set(
    state.agreements.filter((a) => a.portfolioId === portfolioId && a.status === 'active').map((a) => a.id),
  )
  const ready = state.tranches.filter(
    (t) =>
      portfolioAgreements.has(t.agreementId) &&
      t.status === 'available' &&
      t.releaseCondition !== 'milestone',
  )
  const tranches = [...requested, ...ready]

  const review = (request: PaymentRequest) => {
    setReviewingId(request.id)
    setReviewOpen(true)
  }
  const openRelease = (tranche: Tranche) => {
    setReleasingId(tranche.id)
    setReleaseOpen(true)
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Approvals"
        description="You set the boundaries; only tranche releases and exceptions come to you."
      />

      <PageTabs
        tabs={[
          {
            value: 'tranches',
            label: 'Tranche requests',
            // Only real requests count, like the sidebar badge; the ready ones are listed with them.
            count: requested.length,
            content:
              tranches.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck />}
                  title="Nothing needs your attention"
                  description="Tranche requests from your Agencies, and tranches ready to release, will appear here."
                />
              ) : (
                <ul className="surface flex flex-col divide-y divide-border overflow-hidden rounded-xl">
                  {tranches.map((tranche) => {
                    const agreement = state.agreements.find((a) => a.id === tranche.agreementId)
                    const milestone = state.milestones.find((m) => m.id === tranche.milestoneId)
                    const agency = agencyName(state, agreement?.agencyId)
                    return (
                      <li
                        key={tranche.id}
                        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-3">
                          <OrgAvatar name={agency} size="md" />
                          <span className="flex min-w-0 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium">
                              {tranche.name}
                              {milestone ? ` · ${milestone.title}` : ''}
                            </span>
                            <span className="truncate text-xs text-subtle">
                              {agency} · {agreement?.title}
                              {tranche.status === 'available' && tranche.scheduledFor
                                ? ` · planned for ${formatDate(tranche.scheduledFor)}`
                                : ''}
                              {tranche.requestedBy
                                ? ` · requested by ${userName(state, tranche.requestedBy)}`
                                : ''}
                              {tranche.requestedAt ? ` · ${formatRelative(tranche.requestedAt, now)}` : ''}
                            </span>
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-3 sm:justify-end">
                          <StatusBadge status={trancheStatusFor(tranche, 'investor')} />
                          <Amount value={tranche.amount} size="md" className="ml-auto sm:ml-0" />
                          {milestone && agreement ? (
                            <ButtonLink
                              href={href(`funding/${agreement.id}/milestones/${milestone.id}`)}
                              size="pill-sm"
                              className="w-full sm:w-auto"
                            >
                              Review <ArrowRight data-icon="inline-end" />
                            </ButtonLink>
                          ) : (
                            <Button
                              size="pill-sm"
                              className="w-full sm:w-auto"
                              onClick={() => openRelease(tranche)}
                            >
                              {tranche.status !== 'available'
                                ? 'Release tranche'
                                : tranche.scheduledFor && tranche.scheduledFor > now
                                  ? 'Release early'
                                  : 'Release now'}
                            </Button>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ),
          },
          {
            value: 'exceptions',
            label: 'Exceptions',
            count: exceptions.length,
            content: (
              <RequestQueue
                requests={exceptions}
                onReview={review}
                showAgency
                actionLabel="Review exception"
                empty={{
                  title: 'No exceptions pending',
                  description:
                    'Operations above an agreement’s exception threshold come here for your decision.',
                }}
              />
            ),
          },
          {
            value: 'policy',
            label: 'Policy changes',
            content: (
              <EmptyState
                icon={<FileClock />}
                title="No policy changes pending"
                description="Agency requests to change budgets or boundaries above your thresholds will appear here."
              />
            ),
          },
        ]}
      />

      <RequestReviewSheet
        key={`review-${reviewingId ?? 'none'}`}
        requestId={reviewingId}
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onClosed={() => setReviewingId(null)}
      />

      <ReleaseTrancheSheet
        key={`release-${releasingId ?? 'none'}`}
        trancheId={releasingId}
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        onClosed={() => setReleasingId(null)}
      />
    </div>
  )
}

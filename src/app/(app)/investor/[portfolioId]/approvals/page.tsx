'use client'

import { ArrowRight, FileClock, ShieldCheck } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { PageTabs } from '@/components/app/page-tabs'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { RequestQueue } from '@/components/app/request-queue'
import { RequestReviewSheet } from '@/components/app/request-review-sheet'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd } from '@/domain/money'
import { accountName, agencyName, investorApprovals, receiptFor, userName } from '@/domain/queries'
import { agreementCapital } from '@/domain/selectors'
import { trancheStatus } from '@/domain/status'
import type { PaymentRequest, Tranche } from '@/domain/types'
import { formatRelative } from '@/lib/format'

export default function InvestorApprovalsPage() {
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const release = useCommand('releaseTranche')
  const [reviewingId, setReviewingId] = React.useState<string | null>(null)
  const [reviewOpen, setReviewOpen] = React.useState(false)
  // The tranche being released stays mounted while its sheet animates closed.
  const [releasingId, setReleasingId] = React.useState<string | null>(null)
  const [releaseOpen, setReleaseOpen] = React.useState(false)

  const { tranches, exceptions } = investorApprovals(state, portfolioId)
  const releasing = state.tranches.find((t) => t.id === releasingId)
  const releasingAgreement = state.agreements.find((a) => a.id === releasing?.agreementId)
  const releasingAgency = releasingAgreement ? agencyName(state, releasingAgreement.agencyId) : 'the Agency'
  const releasingCapital = releasingAgreement ? agreementCapital(state, releasingAgreement.id) : undefined
  const destination = releasing?.destinationAccountId
    ? accountName(state, releasing.destinationAccountId)
    : (state.accounts.find(
        (a) =>
          a.agencyId === releasingAgreement?.agencyId && a.template === 'operations' && a.status === 'active',
      )?.name ?? 'Operations')
  const releaseReceipt = receiptFor(state, releasing?.receiptId)
  const releaseBlocked = Boolean(
    releasing && releasingCapital && releasingCapital.released + releasing.amount > releasingCapital.funded,
  )

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
            count: tranches.length,
            content:
              tranches.length === 0 ? (
                <EmptyState
                  icon={<ShieldCheck />}
                  title="Nothing needs your attention"
                  description="Tranche requests from your Agencies will appear here."
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
                              {tranche.requestedBy
                                ? ` · requested by ${userName(state, tranche.requestedBy)}`
                                : ''}
                              {tranche.requestedAt ? ` · ${formatRelative(tranche.requestedAt, now)}` : ''}
                            </span>
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-3 sm:justify-end">
                          <StatusBadge status={trancheStatus[tranche.status]} />
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
                              Release tranche
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

      <ApprovalSheet
        key={`release-${releasingId ?? 'none'}`}
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        onClosed={() => {
          release.reset()
          setReleasingId(null)
        }}
        title="Release tranche"
        description={releasing ? `${releasing.name} · ${releasingAgreement?.title ?? ''}` : undefined}
        summary={{
          what: releasing
            ? `${formatUsd(releasing.amount, { withCode: true })} moves from the ${releasingAgency} Funding Vault into the Agency’s ${destination} account.`
            : '',
          amount: releasing?.amount,
          from: `${releasingAgency} Funding Vault`,
          to: `${releasingAgency} · ${destination}`,
          reversible:
            'Cannot be undone once released. The Agency operates with it under the agreement’s policy.',
          policy:
            'Released capital can never exceed funded capital; the funding contract enforces it, not only the app.',
        }}
        confirmLabel="Release tranche"
        disabled={!releasing || releaseBlocked}
        phase={release.phase}
        error={release.error}
        onConfirm={() => releasing && release.run({ trancheId: releasing.id })}
        success={{
          title: 'Funding released',
          body: releasing
            ? `${formatUsd(releasing.amount, { withCode: true })} is now available in the ${releasingAgency} ${destination} account.`
            : '',
          actions: <ReceiptDetailsButton receipt={releaseReceipt} />,
        }}
      >
        {releaseBlocked && releasingCapital ? (
          <p className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty">
            Fund the agreement first: only {formatUsd(releasingCapital.inFundingVault, { withCode: true })} is
            in the Funding Vault.
          </p>
        ) : null}
      </ApprovalSheet>
    </div>
  )
}

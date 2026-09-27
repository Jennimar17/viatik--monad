'use client'

import { ArrowRight, HandCoins } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import {
  AgreementProgress,
  AgreementTerms,
  EvidenceList,
  MilestoneTimelineFor,
} from '@/components/app/funding-parts'
import { PageTabs } from '@/components/app/page-tabs'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { activeAgreement, receiptFor } from '@/domain/queries'
import { agreementStatus } from '@/domain/status'
import type { MilestoneStatus } from '@/domain/types'
import { formatDate } from '@/lib/format'

/** Milestones the Agency can (re)submit evidence for. */
const SUBMITTABLE: ReadonlySet<MilestoneStatus> = new Set(['not_started', 'in_progress', 'changes_requested'])

export default function AgencyFundingPage() {
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const accept = useCommand('acceptAgreement')
  const receipts = useReceiptDrawer()
  const [acceptOpen, setAcceptOpen] = React.useState(false)

  const agreement = activeAgreement(state, agencyId)
  const investor = agreement ? state.portfolios.find((p) => p.id === agreement.portfolioId)?.name : undefined

  if (!agreement) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Funding" />
        <EmptyState
          icon={<HandCoins />}
          title="No active funding agreement"
          description="Once an Investor creates and activates an agreement, its tranches and milestones will appear here."
        />
      </div>
    )
  }

  const pending = agreement.status === 'pending_acceptance'
  const releases = state.tranches
    .filter((t) => t.agreementId === agreement.id && t.status === 'released')
    .sort((a, b) => a.index - b.index)
  const submitted = state.milestones.filter((m) => m.agreementId === agreement.id && m.evidence.length > 0)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Tag>Funding</Tag>
            <span>From {investor}</span>
          </>
        }
        title={agreement.title}
        description={agreement.purpose}
        meta={
          <>
            <StatusBadge status={agreementStatus[agreement.status]} size="md" />
            <span className="text-sm text-subtle">
              {formatDate(agreement.startDate)} – {formatDate(agreement.endDate)}
            </span>
          </>
        }
        actions={
          pending && can('request_tranche') ? (
            <Button size="pill" onClick={() => setAcceptOpen(true)}>
              Accept agreement
            </Button>
          ) : null
        }
      />

      {pending ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          {investor} sent you this agreement. Review the terms and accept it to start receiving funding.
        </div>
      ) : null}

      <Panel>
        <AgreementProgress state={state} agreement={agreement} />
      </Panel>

      <PageTabs
        tabs={[
          {
            value: 'tranches',
            label: 'Tranches and milestones',
            content: (
              <Panel
                title="Release schedule"
                description="Submit evidence for a milestone to request its tranche."
              >
                <MilestoneTimelineFor
                  state={state}
                  agreementId={agreement.id}
                  actionFor={(tranche, milestone) => {
                    if (tranche.status === 'released' && tranche.receiptId) {
                      return (
                        <Button
                          variant="ghost"
                          size="pill-sm"
                          onClick={() => receipts.show(receiptFor(state, tranche.receiptId))}
                        >
                          Verified details
                        </Button>
                      )
                    }
                    if (agreement.status !== 'active' || !can('submit_milestone_evidence')) return null
                    if (milestone && SUBMITTABLE.has(milestone.status)) {
                      return (
                        <ButtonLink href={href(`funding/milestones/${milestone.id}/submit`)} size="pill-sm">
                          Submit evidence <ArrowRight data-icon="inline-end" />
                        </ButtonLink>
                      )
                    }
                    if (!milestone && (tranche.status === 'available' || tranche.status === 'planned')) {
                      return (
                        <ButtonLink
                          href={href(`funding/tranches/${tranche.id}/request`)}
                          variant={tranche.status === 'available' ? 'default' : 'outline'}
                          size="pill-sm"
                        >
                          Request funding
                        </ButtonLink>
                      )
                    }
                    return null
                  }}
                />
              </Panel>
            ),
          },
          {
            value: 'terms',
            label: 'Agreement terms',
            content: (
              <Panel>
                <AgreementTerms state={state} agreement={agreement} />
              </Panel>
            ),
          },
          {
            value: 'evidence',
            label: 'Submitted evidence',
            count: submitted.length,
            content:
              submitted.length === 0 ? (
                <Panel>
                  <EmptyState
                    compact
                    title="No evidence submitted yet"
                    description="Evidence you submit for milestones is listed here."
                  />
                </Panel>
              ) : (
                <div className="flex flex-col gap-6">
                  {submitted.map((m) => (
                    <Panel
                      key={m.id}
                      title={m.title}
                      description={m.submittedAt ? `Submitted ${formatDate(m.submittedAt)}` : undefined}
                    >
                      <EvidenceList milestone={m} />
                    </Panel>
                  ))}
                </div>
              ),
          },
          {
            value: 'releases',
            label: 'Release history',
            count: releases.length,
            content: (
              <Panel title="Released tranches" description="Each release has a verifiable receipt.">
                {releases.length === 0 ? (
                  <EmptyState
                    compact
                    title="No tranches released yet"
                    description="Releases appear here once the Investor approves a milestone."
                  />
                ) : (
                  <ul className="flex flex-col">
                    {releases.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium">{t.name}</span>
                          <span className="text-xs text-subtle">
                            {t.releasedAt ? `Released ${formatDate(t.releasedAt)}` : 'Released'}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Amount value={t.amount} size="sm" />
                          <Button
                            variant="ghost"
                            size="pill-sm"
                            onClick={() => receipts.show(receiptFor(state, t.receiptId))}
                          >
                            Verified details
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ),
          },
        ]}
      />

      <ApprovalSheet
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        onClosed={accept.reset}
        title="Accept agreement"
        summary={{
          what: `You accept ${agreement.title} and its conditions: tranches, milestones, spending policy, and return conditions.`,
          amount: agreement.committed,
          reversible: 'The Investor can pause the agreement; changes to its terms need an amendment.',
          policy:
            'Viatik Funding Agreements are operational funding policies, not legal equity or debt agreements.',
        }}
        confirmLabel="Accept agreement"
        phase={accept.phase}
        error={accept.error}
        onConfirm={() => accept.run({ agreementId: agreement.id })}
        success={{
          title: 'Agreement accepted',
          body: `${investor} was notified. You can request the first tranche now.`,
        }}
      />
      {receipts.drawer}
    </div>
  )
}

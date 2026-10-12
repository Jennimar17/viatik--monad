'use client'

import {
  ArrowRight,
  Download,
  FileText,
  HandCoins,
  MoreHorizontal,
  PauseCircle,
  PlayCircle,
} from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ActivityList } from '@/components/app/activity'
import { ButtonLink } from '@/components/app/button-link'
import { CapitalTrailPanel } from '@/components/app/capital-trail-panel'
import { FundAgreementSheet } from '@/components/app/fund-agreement-sheet'
import {
  AgreementProgress,
  AgreementTerms,
  EvidenceList,
  MilestoneTimelineFor,
} from '@/components/app/funding-parts'
import { PageTabs } from '@/components/app/page-tabs'
import { ReleaseTrancheSheet } from '@/components/app/release-tranche-sheet'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { OrgAvatar } from '@/components/viatik/people'
import { PolicySummary } from '@/components/viatik/policy'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { categoryLabel, releaseModelLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { governingAgreement, receiptFor } from '@/domain/queries'
import { agreementBadge, agreementCapital, isFullyReleased } from '@/domain/selectors'
import { formatDate } from '@/lib/format'

export default function AgreementDetailPage() {
  const { agreementId } = useParams<{ agreementId: string }>()
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const [fundOpen, setFundOpen] = React.useState(false)
  // The tranche being released stays selected while its sheet animates closed.
  const [releasingId, setReleasingId] = React.useState<string | null>(null)
  const [releaseOpen, setReleaseOpen] = React.useState(false)
  const [pauseOpen, setPauseOpen] = React.useState(false)
  // Fixed when the sheet opens: the refreshed status must not flip its copy.
  const [resuming, setResuming] = React.useState(false)
  const receipts = useReceiptDrawer()
  const pause = useCommand('setAgreementPaused')

  const agreement = state.agreements.find((a) => a.id === agreementId && a.portfolioId === portfolioId)
  if (!agreement) {
    return (
      <ScreenUnavailable
        title="Agreement not found"
        description="It may belong to another portfolio, or the link is out of date."
      />
    )
  }

  const agency = state.agencies.find((a) => a.id === agreement.agencyId)
  const tranches = state.tranches.filter((t) => t.agreementId === agreement.id)
  const withEvidence = state.milestones.filter((m) => m.agreementId === agreement.id && m.evidence.length > 0)
  const paused = agreement.status === 'paused'
  // Every tranche released (or rejected): nothing more to fund, release or pause.
  const settled = isFullyReleased(state, agreement.id)
  // What the tranches still to release can take; funding more would leave it in the Funding Vault.
  const fundable = agreementCapital(state, agreement.id).fundable
  const policy = agreement.spendingPolicy
  // The first agreement in force governs the Agency's payments, also once its tranches are released.
  const governing = governingAgreement(state, agreement.agencyId)
  const milestoneHref = (milestoneId: string) => href(`funding/${agreement.id}/milestones/${milestoneId}`)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href={href('funding')} className="hover:text-foreground">
              Funding
            </Link>
            <span aria-hidden="true">/</span>
            <span className="flex items-center gap-2">
              <OrgAvatar name={agency?.name ?? 'Agency'} size="xs" /> {agency?.name}
            </span>
          </>
        }
        title={agreement.title}
        description={agreement.purpose}
        meta={
          <>
            <StatusBadge status={agreementBadge(state, agreement)} size="md" />
            <Tag>{releaseModelLabel[agreement.releaseModel].label}</Tag>
            <span className="text-sm text-subtle">
              {formatDate(agreement.startDate)} – {formatDate(agreement.endDate)}
            </span>
          </>
        }
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="icon-pill" aria-label="More actions" />}
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 p-1.5">
                {(agreement.status === 'active' || paused) && !settled ? (
                  <DropdownMenuItem
                    className="gap-2 rounded-lg"
                    onClick={() => {
                      setResuming(paused)
                      setPauseOpen(true)
                    }}
                  >
                    {paused ? <PlayCircle className="size-4" /> : <PauseCircle className="size-4" />}
                    {paused ? 'Resume agreement' : 'Pause agreement'}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => window.print()}>
                  <Download className="size-4" /> Download summary
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {settled || fundable <= 0 ? null : (
              <Button size="pill" onClick={() => setFundOpen(true)}>
                <HandCoins data-icon="inline-start" /> Fund agreement
              </Button>
            )}
          </>
        }
      />

      {settled ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-pretty">
          {tranches.some((t) => t.status === 'rejected')
            ? 'No tranche is left to release.'
            : 'Every tranche has been released.'}{' '}
          Nothing more can be funded or released under this agreement; {agency?.name ?? 'the Agency'} keeps
          operating with the released capital.
        </div>
      ) : paused ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          This agreement is paused. Tranche releases are on hold and the Agency was notified.
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
            count: tranches.length,
            content: (
              <Panel
                title="Release schedule"
                description={
                  agreement.releaseModel === 'milestone'
                    ? 'Each tranche is released after its milestone is approved.'
                    : 'You release each tranche yourself, in order. The Agency can also request one; it then comes to Approvals.'
                }
              >
                <MilestoneTimelineFor
                  state={state}
                  agreementId={agreement.id}
                  reader="investor"
                  actionFor={(tranche, milestone) => {
                    // No milestone to review and nothing the Agency has to request: the Investor can release it.
                    if (
                      agreement.status === 'active' &&
                      tranche.status === 'available' &&
                      tranche.releaseCondition !== 'milestone'
                    )
                      return (
                        <Button
                          size="pill-sm"
                          onClick={() => {
                            setReleasingId(tranche.id)
                            setReleaseOpen(true)
                          }}
                        >
                          Release now
                        </Button>
                      )
                    if (milestone?.status === 'ready_for_review')
                      return (
                        <ButtonLink href={milestoneHref(milestone.id)} size="pill-sm">
                          Review milestone <ArrowRight data-icon="inline-end" />
                        </ButtonLink>
                      )
                    if (tranche.receiptId)
                      return (
                        <Button
                          variant="ghost"
                          size="pill-sm"
                          onClick={() => receipts.show(receiptFor(state, tranche.receiptId))}
                        >
                          Verified details
                        </Button>
                      )
                    if (milestone)
                      return (
                        <ButtonLink href={milestoneHref(milestone.id)} variant="ghost" size="pill-sm">
                          Details
                        </ButtonLink>
                      )
                    return null
                  }}
                />
              </Panel>
            ),
          },
          {
            value: 'trail',
            label: 'Capital trail',
            content: <CapitalTrailPanel state={state} agreementId={agreement.id} />,
          },
          {
            value: 'policy',
            label: 'Policy',
            content: (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <Panel title="Agreement terms">
                  <AgreementTerms state={state} agreement={agreement} />
                </Panel>
                <Panel title="Operating boundaries" description="What the Agency can do without asking you.">
                  <PolicySummary
                    title="Spending policy"
                    lines={[
                      `Approved uses agreed with the Agency: ${policy.allowedCategories.map((c) => categoryLabel[c].toLowerCase()).join(', ')}. The Agency’s budgets set which categories each payment can use.`,
                      governing && governing.id !== agreement.id
                        ? `${governing.title} governs ${agency?.name ?? 'the Agency'}’s payments: single operations above ${formatUsd(governing.spendingPolicy.exceptionThreshold, { withCode: true })} come to you as exceptions.`
                        : `Any single operation above ${formatUsd(policy.exceptionThreshold, { withCode: true })} comes to you as an exception.`,
                      'Nobody can approve their own request, including Agency Admins.',
                      'Budgets and Member limits are enforced by the funding contract, not only in the app.',
                    ]}
                  />
                </Panel>
              </div>
            ),
          },
          {
            value: 'documents',
            label: 'Documents',
            count: withEvidence.reduce((n, m) => n + m.evidence.length, 0),
            content: (
              <div className="flex flex-col gap-6">
                {withEvidence.length === 0 ? (
                  <Panel>
                    <EmptyState
                      compact
                      icon={<FileText />}
                      title="No documents yet"
                      description="Milestone evidence will appear here once the Agency submits it."
                    />
                  </Panel>
                ) : (
                  withEvidence.map((m) => (
                    <Panel
                      key={m.id}
                      title={m.title}
                      description={m.submittedAt ? `Submitted ${formatDate(m.submittedAt)}` : undefined}
                    >
                      <EvidenceList milestone={m} />
                    </Panel>
                  ))
                )}
              </div>
            ),
          },
          {
            value: 'activity',
            label: 'Activity',
            content: (
              <Panel>
                <ActivityList
                  state={state}
                  records={state.activity.filter((a) => a.agencyId === agreement.agencyId).slice(0, 30)}
                  now={now}
                  grouped
                />
              </Panel>
            ),
          },
        ]}
      />

      <ReleaseTrancheSheet
        trancheId={releasingId}
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        onClosed={() => setReleasingId(null)}
      />
      <FundAgreementSheet agreement={agreement} open={fundOpen} onOpenChange={setFundOpen} />
      <ApprovalSheet
        open={pauseOpen}
        onOpenChange={setPauseOpen}
        onClosed={pause.reset}
        title={resuming ? 'Resume agreement' : 'Pause agreement'}
        summary={{
          what: resuming
            ? 'The agreement becomes active again. Pending tranche requests can be reviewed and released.'
            : 'No tranche can be released while the agreement is paused. Money already released to the Agency is not affected.',
          reversible: resuming
            ? 'You can pause it again at any time.'
            : 'You can resume the agreement at any time.',
          policy: 'Only the Investor can pause or freeze a funding agreement.',
        }}
        confirmLabel={resuming ? 'Resume agreement' : 'Pause agreement'}
        confirmVariant={resuming ? 'default' : 'destructive'}
        phase={pause.phase}
        error={pause.error}
        onConfirm={() => pause.run({ agreementId: agreement.id, paused: !resuming })}
        success={{
          title: resuming ? 'Agreement resumed' : 'Agreement paused',
          body: resuming ? 'Releases are enabled again.' : 'Releases are on hold. The Agency was notified.',
        }}
      />
      {receipts.drawer}
    </div>
  )
}

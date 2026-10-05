'use client'

import { FileText, Link2 } from 'lucide-react'
import type * as React from 'react'

import { OpenFileButton } from '@/components/app/open-file'
import { Amount } from '@/components/viatik/amount'
import {
  FundingProgress,
  MilestoneTimeline,
  type TimelineItem,
  type TrancheSegment,
} from '@/components/viatik/finance'
import { KeyValueList } from '@/components/viatik/layout'
import { StatusBadge } from '@/components/viatik/status'
import { categoryLabel, releaseModelLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { userName } from '@/domain/queries'
import { agreementCapital } from '@/domain/selectors'
import { milestoneStatus, trancheStatus } from '@/domain/status'
import type { FundingAgreement, Milestone, Tranche, ViatikState } from '@/domain/types'
import { formatBytes, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const tranchesOf = (state: ViatikState, agreementId: string) =>
  state.tranches.filter((t) => t.agreementId === agreementId).sort((a, b) => a.index - b.index)

function segmentState(tranche: Tranche): TrancheSegment['state'] {
  switch (tranche.status) {
    case 'released':
      return 'released'
    case 'requested':
    case 'under_review':
    case 'approved':
      return 'review'
    case 'available':
      return 'available'
    case 'rejected':
      return 'rejected'
    default:
      return 'planned'
  }
}

export function trancheSegments(state: ViatikState, agreementId: string): TrancheSegment[] {
  return tranchesOf(state, agreementId).map((t) => ({
    id: t.id,
    label: t.name,
    amount: t.amount,
    state: segmentState(t),
  }))
}

function timelineState(tranche: Tranche, milestone: Milestone | undefined): TimelineItem['state'] {
  if (tranche.status === 'released') return 'done'
  if (
    tranche.status === 'under_review' ||
    tranche.status === 'requested' ||
    milestone?.status === 'ready_for_review'
  )
    return 'current'
  if (tranche.status === 'rejected' || milestone?.status === 'changes_requested') return 'blocked'
  return 'upcoming'
}

export function trancheTimeline(
  state: ViatikState,
  agreementId: string,
  actionFor?: (tranche: Tranche, milestone?: Milestone) => React.ReactNode,
): TimelineItem[] {
  return tranchesOf(state, agreementId).map((tranche) => {
    const milestone = tranche.milestoneId
      ? state.milestones.find((m) => m.id === tranche.milestoneId)
      : undefined
    const date = tranche.releasedAt
      ? `Released ${formatDate(tranche.releasedAt)}`
      : milestone
        ? `Milestone due ${formatDate(milestone.dueDate)}`
        : tranche.scheduledFor
          ? `Planned for ${formatDate(tranche.scheduledFor)}`
          : undefined
    return {
      id: tranche.id,
      title: (
        <>
          {tranche.name}
          {milestone ? <span className="text-muted-foreground"> · {milestone.title}</span> : null}
        </>
      ),
      subtitle: milestone?.description,
      date,
      amount: tranche.amount,
      // Until a tranche is released, its milestone is what people track.
      status:
        milestone && tranche.status !== 'released'
          ? milestoneStatus[milestone.status]
          : trancheStatus[tranche.status],
      state: timelineState(tranche, milestone),
      action: actionFor?.(tranche, milestone),
    }
  })
}

/** Committed, funded, released and remaining, over the tranche bar. */
export function AgreementProgress({
  state,
  agreement,
  className,
}: {
  state: ViatikState
  agreement: FundingAgreement
  className?: string
}) {
  const capital = agreementCapital(state, agreement.id)
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure label="Committed" value={<Amount value={capital.committed} size="md" />} />
        <Figure label="Funded" value={<Amount value={capital.funded} size="md" />} />
        <Figure label="Released" value={<Amount value={capital.released} size="md" />} />
        <Figure
          label="Remaining commitment"
          value={<Amount value={capital.remainingCommitment} size="md" />}
        />
      </div>
      <FundingProgress segments={trancheSegments(state, agreement.id)} />
    </div>
  )
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-subtle">{label}</span>
      {value}
    </div>
  )
}

const cadenceLabel: Record<FundingAgreement['spendingPolicy']['reportingCadence'], string> = {
  per_milestone: 'Per milestone',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
}

export function AgreementTerms({ state, agreement }: { state: ViatikState; agreement: FundingAgreement }) {
  const policy = agreement.spendingPolicy
  const prose = (text: string) => <span className="max-w-xs text-pretty">{text}</span>
  return (
    <KeyValueList
      items={[
        { label: 'Purpose', value: prose(agreement.purpose) },
        { label: 'Release model', value: releaseModelLabel[agreement.releaseModel].label },
        { label: 'Term', value: `${formatDate(agreement.startDate)} – ${formatDate(agreement.endDate)}` },
        {
          label: 'Exception threshold',
          value: formatUsd(policy.exceptionThreshold, { withCode: true }),
          hint: 'Operations above this need Investor review',
        },
        { label: 'Reporting', value: cadenceLabel[policy.reportingCadence] },
        {
          label: 'Approved uses',
          value: prose(policy.allowedCategories.map((c) => categoryLabel[c]).join(', ')),
        },
        { label: 'Return conditions', value: prose(policy.returnConditions) },
        { label: 'Evidence requirements', value: prose(agreement.evidenceRequirements) },
        { label: 'Created by', value: userName(state, agreement.createdBy) },
      ]}
    />
  )
}

export function MilestoneTimelineFor({
  state,
  agreementId,
  actionFor,
}: {
  state: ViatikState
  agreementId: string
  actionFor?: (tranche: Tranche, milestone?: Milestone) => React.ReactNode
}) {
  return <MilestoneTimeline items={trancheTimeline(state, agreementId, actionFor)} />
}

/** Submitted evidence. Documents stay private; only their fingerprints are recorded. */
export function EvidenceList({ milestone }: { milestone: Milestone }) {
  if (milestone.evidence.length === 0)
    return <p className="text-sm text-muted-foreground">No evidence submitted yet.</p>
  return (
    <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {milestone.evidence.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
            {item.kind === 'link' ? (
              <Link2 className="size-4" aria-hidden="true" />
            ) : (
              <FileText className="size-4" aria-hidden="true" />
            )}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm font-medium underline-offset-4 hover:underline"
              >
                {item.name}
              </a>
            ) : item.kind === 'file' ? (
              <OpenFileButton evidence={item} className="text-sm font-medium" />
            ) : (
              <span className="truncate text-sm font-medium">{item.name}</span>
            )}
            <span className="truncate font-mono text-2xs text-subtle">
              {item.sizeBytes ? `${formatBytes(item.sizeBytes)} · ` : ''}fingerprint{' '}
              {item.sha256.slice(0, 12)}…
            </span>
          </span>
          <StatusBadge status={{ label: 'Private', tone: 'neutral' }} />
        </li>
      ))}
    </ul>
  )
}

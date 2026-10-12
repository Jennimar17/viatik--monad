'use client'

import { CheckCircle2, MessageSquareText, ShieldCheck } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FundShortfall } from '@/components/app/fund-agreement-sheet'
import { EvidenceList } from '@/components/app/funding-parts'
import { ReceiptDetailsButton, trancheRequestRecord } from '@/components/app/receipt-details'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { FormActions } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { VerifiedDetailsButton } from '@/components/viatik/verified-details-drawer'
import { useCommand, useViatikState } from '@/data/react'
import { add, cents, clampToZero, formatUsd, subtract, sum } from '@/domain/money'
import { accountName, receiptFor, userName } from '@/domain/queries'
import { agreementCapital, isLastTranche, trancheIsOver } from '@/domain/selectors'
import { milestoneStatus, trancheStatus } from '@/domain/status'
import { formatDate, formatDateTime } from '@/lib/format'

type ChangesMode = 'changes' | 'reject'

export default function MilestoneReviewPage() {
  const { agreementId, milestoneId } = useParams<{ agreementId: string; milestoneId: string }>()
  const { state, userId } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const release = useCommand('releaseTranche')
  const changes = useCommand('requestMilestoneChanges')
  const [draftChecked, setDraftChecked] = React.useState<number[]>([])
  const [note, setNote] = React.useState('')
  const [releaseOpen, setReleaseOpen] = React.useState(false)
  const [changesMode, setChangesMode] = React.useState<ChangesMode | null>(null)
  // Keeps the sheet's copy stable while it animates out.
  const [lastChangesMode, setLastChangesMode] = React.useState<ChangesMode>('changes')

  const milestone = state.milestones.find((m) => m.id === milestoneId && m.agreementId === agreementId)
  const agreement = state.agreements.find((a) => a.id === agreementId && a.portfolioId === portfolioId)
  const tranche = state.tranches.find((t) => t.id === milestone?.trancheId)
  const reviewable = milestone?.status === 'ready_for_review'
  const canDecide =
    reviewable &&
    agreement?.status === 'active' &&
    can('release_tranche', {
      createdBy: tranche?.requestedBy ? { kind: 'user', userId: tranche.requestedBy } : undefined,
    })
  // Reviewable but not decidable: say why instead of showing a form with no buttons.
  const blockedReason =
    !reviewable || canDecide
      ? null
      : agreement?.status !== 'active'
        ? agreement?.status === 'paused'
          ? 'This agreement is paused. Resume it to release or return this milestone.'
          : 'This agreement is not active yet, so this milestone cannot be decided.'
        : tranche?.requestedBy === userId
          ? 'You submitted this evidence as the Agency’s admin, so another Investor of the portfolio has to decide.'
          : 'You cannot decide on this milestone.'
  // The action bar sits at the bottom on phones while a decision is open.
  useBottomBar(canDecide)
  if (!milestone || !agreement || !tranche) {
    return (
      <ScreenUnavailable
        title="Milestone not found"
        description="It may belong to another portfolio, or the link is out of date."
      />
    )
  }

  const agency = state.agencies.find((a) => a.id === agreement.agencyId)
  const agencyLabel = agency?.name ?? 'the Agency'
  const capital = agreementCapital(state, agreement.id)
  const covered = capital.released + tranche.amount <= capital.funded
  // The Agency picks the account when it submits evidence; until then there is none.
  const destination = tranche.destinationAccountId
    ? accountName(state, tranche.destinationAccountId)
    : undefined
  // A decided milestone shows the criteria the Investor confirmed at the time.
  const checked = milestone.decision ? milestone.decision.checkedCriteria : draftChecked
  const allChecked = checked.length === milestone.acceptanceCriteria.length
  const releaseReceipt = receiptFor(state, tranche.receiptId)
  // What the ledger recorded when the evidence was submitted with the tranche request.
  const submission = milestone.submissionVerified ? trancheRequestRecord(state, tranche) : undefined
  const rejecting = (changesMode ?? lastChangesMode) === 'reject'
  // Rejected, this tranche never releases: what the Funding Vault holds beyond the other tranches
  // still to release stays there, since only a release moves money out. Counted without this
  // tranche, so the copy holds once it is rejected.
  const othersToRelease = sum(
    state.tranches.filter((t) => t.agreementId === agreement.id && t.id !== tranche.id && !trancheIsOver(t)),
    (t) => t.amount,
  )
  const stranded = clampToZero(cents(capital.inFundingVault - othersToRelease))

  const openChanges = (mode: ChangesMode) => {
    setLastChangesMode(mode)
    setChangesMode(mode)
  }

  const decisionPanel = (
    <Panel
      title="Decision"
      description={
        reviewable
          ? 'Check the criteria against the evidence, then decide.'
          : milestone.decision
            ? 'This milestone has been decided.'
            : 'Waiting for the Agency to submit evidence.'
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-subtle">{tranche.name} · release amount</span>
          <Amount value={tranche.amount} size="xl" />
          <span className="text-sm text-muted-foreground">
            To {agencyLabel}
            {destination ? ` · ${destination}` : ''}
          </span>
        </div>

        {blockedReason ? (
          <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-sm text-pretty">
            {blockedReason}
          </p>
        ) : null}

        {reviewable ? (
          covered ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span className="text-pretty text-muted-foreground">
                Funded capital covers this release.{' '}
                {formatUsd(subtract(capital.inFundingVault, tranche.amount), { withCode: true })} stays in the
                Funding Vault afterwards.
              </span>
            </div>
          ) : null
        ) : null}
        {reviewable && canDecide ? (
          <FundShortfall
            agreement={agreement}
            needed={covered ? undefined : subtract(add(capital.released, tranche.amount), capital.funded)}
          />
        ) : null}

        <fieldset className="flex flex-col gap-3" disabled={!canDecide}>
          <legend className="mb-2 text-sm font-medium">Acceptance criteria</legend>
          {milestone.acceptanceCriteria.map((criterion, index) => {
            const id = `criterion-${index}`
            return (
              <div key={criterion} className="flex items-start gap-3">
                <Checkbox
                  id={id}
                  checked={checked.includes(index)}
                  disabled={!canDecide}
                  onCheckedChange={(value) =>
                    setDraftChecked((prev) => (value ? [...prev, index] : prev.filter((i) => i !== index)))
                  }
                  className="mt-0.5"
                />
                <Label
                  htmlFor={id}
                  className="text-sm leading-snug font-normal text-pretty text-muted-foreground"
                >
                  {criterion}
                </Label>
              </div>
            )
          })}
          <p className="text-xs text-subtle">
            {checked.length} of {milestone.acceptanceCriteria.length} confirmed
          </p>
        </fieldset>

        {canDecide ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="decision-note">Note to the Agency (optional)</Label>
            <Textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Share context for your decision"
              className="min-h-20 rounded-xl"
            />
          </div>
        ) : milestone.decision ? (
          <KeyValueList
            dense
            items={[
              { label: 'Outcome', value: milestoneStatus[milestone.status].label },
              { label: 'Decided by', value: userName(state, milestone.decision.decidedBy) },
              { label: 'Date', value: formatDateTime(milestone.decision.decidedAt) },
              ...(milestone.decision.note ? [{ label: 'Note', value: milestone.decision.note }] : []),
            ]}
          />
        ) : null}

        {canDecide ? (
          <div className="hidden flex-col gap-2 lg:flex">
            <Button size="pill" disabled={!covered} onClick={() => setReleaseOpen(true)}>
              <ShieldCheck data-icon="inline-start" /> Release tranche
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="pill-sm" onClick={() => openChanges('changes')}>
                Request changes
              </Button>
              <Button variant="destructive" size="pill-sm" onClick={() => openChanges('reject')}>
                Reject
              </Button>
            </div>
            {!allChecked ? (
              <p className="text-xs text-subtle">
                You can release with unchecked criteria; the decision records which ones you confirmed.
              </p>
            ) : null}
          </div>
        ) : null}
        <ReceiptDetailsButton receipt={releaseReceipt} className="w-fit" />
      </div>
    </Panel>
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href={href('funding')} className="hover:text-foreground">
              Funding
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={href(`funding/${agreement.id}`)} className="hover:text-foreground">
              {agencyLabel} · {agreement.title}
            </Link>
          </>
        }
        title={milestone.title}
        description={milestone.description}
        meta={
          <>
            <StatusBadge status={milestoneStatus[milestone.status]} size="md" />
            <StatusBadge status={trancheStatus[tranche.status]} />
            <span className="text-sm text-subtle">Due {formatDate(milestone.dueDate)}</span>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          {milestone.submittedAt ? (
            <Panel title="Submission">
              <div className="flex gap-3">
                <PersonAvatar name={userName(state, milestone.submittedBy)} size="md" />
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm">
                    <span className="font-medium">{userName(state, milestone.submittedBy)}</span>
                    <span className="text-subtle">
                      {' '}
                      · {agencyLabel} · {formatDateTime(milestone.submittedAt)}
                    </span>
                  </p>
                  {milestone.submissionNote ? (
                    <p className="flex gap-2 rounded-xl border border-border bg-muted/30 p-3 text-sm text-pretty text-muted-foreground">
                      <MessageSquareText className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
                      {milestone.submissionNote}
                    </p>
                  ) : null}
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="Submission">
              <EmptyState
                compact
                title="Nothing submitted yet"
                description={`${agencyLabel} has not submitted evidence for this milestone.`}
              />
            </Panel>
          )}

          <Panel
            title="Evidence"
            description="Documents stay private. Only their fingerprints are kept in the verified record."
          >
            <EvidenceList milestone={milestone} />
            {milestone.evidenceHash ? (
              <p className="mt-3 font-mono text-2xs text-subtle">
                Evidence fingerprint {milestone.evidenceHash.slice(0, 18)}…
              </p>
            ) : null}
            {submission ? (
              <VerifiedDetailsButton record={submission} label="Verified submission" className="mt-3 w-fit" />
            ) : null}
          </Panel>

          <Panel title="Agreement status">
            <KeyValueList
              items={[
                { label: 'Committed', value: <Amount value={capital.committed} size="sm" /> },
                { label: 'Funded', value: <Amount value={capital.funded} size="sm" /> },
                { label: 'Released so far', value: <Amount value={capital.released} size="sm" /> },
                { label: 'In the Funding Vault', value: <Amount value={capital.inFundingVault} size="sm" /> },
                { label: 'Requested by', value: userName(state, tranche.requestedBy) },
                {
                  label: 'Destination account',
                  value: destination ?? 'Chosen by the Agency when it submits evidence',
                },
              ]}
            />
          </Panel>
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">{decisionPanel}</div>
      </div>

      {canDecide ? (
        <FormActions className="lg:hidden">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button variant="destructive" size="pill-sm" onClick={() => openChanges('reject')}>
              Reject
            </Button>
            <Button variant="outline" size="pill-sm" onClick={() => openChanges('changes')}>
              Request changes
            </Button>
          </div>
          <Button size="pill-sm" disabled={!covered} onClick={() => setReleaseOpen(true)}>
            <ShieldCheck data-icon="inline-start" /> Release tranche
          </Button>
        </FormActions>
      ) : null}

      <ApprovalSheet
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        onClosed={release.reset}
        title="Release tranche"
        description={`${tranche.name} · ${milestone.title}`}
        summary={{
          what: `The milestone is approved and ${tranche.name} moves from the Funding Vault to ${agencyLabel}’s ${destination ?? 'Operations'} account.`,
          amount: tranche.amount,
          from: `${agencyLabel} Funding Vault`,
          to: `${agencyLabel} · ${destination ?? 'Operations'}`,
          reversible:
            'Cannot be undone from Viatik. Once released, the capital is available for the Agency to operate.',
          policy:
            'Released capital cannot exceed funded capital. Only the Investor can release, and never their own request.',
        }}
        confirmLabel="Release tranche"
        phase={release.phase}
        error={release.error}
        onConfirm={() => release.run({ trancheId: tranche.id, checkedCriteria: checked, note })}
        success={{
          title: 'Funding released',
          body: `${formatUsd(tranche.amount, { withCode: true })} is now available in the ${agencyLabel} ${destination ?? 'Operations'} account.${
            isLastTranche(state, tranche) ? ` That was the last tranche: ${agreement.title} is complete.` : ''
          }`,
          actions: (
            <>
              <ButtonLink href={href(`funding/${agreement.id}`)} size="pill-sm">
                View capital trail
              </ButtonLink>
              <ReceiptDetailsButton receipt={releaseReceipt} />
            </>
          ),
        }}
      />

      <ApprovalSheet
        open={changesMode !== null}
        onOpenChange={(open) => !open && setChangesMode(null)}
        onClosed={changes.reset}
        title={rejecting ? 'Reject milestone' : 'Request changes'}
        summary={{
          what: rejecting
            ? `The milestone is rejected and ${tranche.name} will never be released.${
                stranded > 0
                  ? ` ${formatUsd(stranded, { withCode: true })} already funded will stay in the Funding Vault: Viatik cannot move it back yet.`
                  : capital.inFundingVault > 0
                    ? ' Capital funded so far can still pay the other tranches.'
                    : ''
              }`
            : 'The Agency is asked to update the evidence. The tranche stays in the Funding Vault.',
          reversible: rejecting
            ? 'Cannot be undone. To fund this work again, create a new agreement.'
            : 'The Agency can resubmit at any time.',
          policy: 'Your note is shared with the Agency Admins.',
        }}
        confirmLabel={rejecting ? 'Reject milestone' : 'Send request'}
        confirmVariant={rejecting ? 'destructive' : 'default'}
        disabled={note.trim().length < 3}
        phase={changes.phase}
        error={changes.error}
        onConfirm={() => changes.run({ milestoneId: milestone.id, note, reject: rejecting })}
        success={{
          title: rejecting ? 'Milestone rejected' : 'Changes requested',
          body: `${agencyLabel} was notified.`,
        }}
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="changes-note">What should the Agency change?</Label>
          <Textarea
            id="changes-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="min-h-28 rounded-xl"
            placeholder="Be specific so the Agency can resubmit quickly."
          />
        </div>
      </ApprovalSheet>
    </div>
  )
}

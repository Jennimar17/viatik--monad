'use client'

import { CheckCircle2, CircleAlert, MessageSquareText, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { EvidenceList } from '@/components/app/funding-parts'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref, usePermissions } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { cents, formatUsd } from '@/domain/money'
import { accountName, receiptFor, userName } from '@/domain/queries'
import { agreementCapital } from '@/domain/selectors'
import { milestoneStatus, trancheStatus } from '@/domain/status'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type ChangesMode = 'changes' | 'reject'

export default function MilestoneReviewPage() {
  const { agreementId, milestoneId } = useParams<{ agreementId: string; milestoneId: string }>()
  const { state } = useViatikState()
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
  const agreement = state.agreements.find((a) => a.id === agreementId)
  const tranche = state.tranches.find((t) => t.id === milestone?.trancheId)
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
  const reviewable = milestone.status === 'ready_for_review'
  const destination = tranche.destinationAccountId
    ? accountName(state, tranche.destinationAccountId)
    : 'Operations'
  const canDecide =
    reviewable &&
    can('release_tranche', {
      createdBy: tranche.requestedBy ? { kind: 'user', userId: tranche.requestedBy } : undefined,
    })
  // A decided milestone shows the criteria the Investor confirmed at the time.
  const checked = milestone.decision ? milestone.decision.checkedCriteria : draftChecked
  const allChecked = checked.length === milestone.acceptanceCriteria.length
  const releaseReceipt = receiptFor(state, tranche.receiptId)
  const rejecting = (changesMode ?? lastChangesMode) === 'reject'

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
          : 'This milestone has been decided.'
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-subtle">{tranche.name} · release amount</span>
          <Amount value={tranche.amount} size="xl" />
          <span className="text-sm text-muted-foreground">
            To {agencyLabel} · {destination}
          </span>
        </div>

        {reviewable ? (
          <div
            className={cn(
              'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
              covered ? 'border-success/30 bg-success-soft' : 'border-danger/35 bg-danger-soft',
            )}
          >
            {covered ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            )}
            <span className="text-pretty text-muted-foreground">
              {covered
                ? `Funded capital covers this release. ${formatUsd(cents(capital.funded - capital.released - tranche.amount), { withCode: true })} stays in the Funding Vault afterwards.`
                : `Released capital cannot exceed funded capital. Fund the agreement with at least ${formatUsd(cents(capital.released + tranche.amount - capital.funded), { withCode: true })} first.`}
            </span>
          </div>
        ) : null}

        <fieldset className="flex flex-col gap-3" disabled={!reviewable}>
          <legend className="mb-2 text-sm font-medium">Acceptance criteria</legend>
          {milestone.acceptanceCriteria.map((criterion, index) => {
            const id = `criterion-${index}`
            return (
              <div key={criterion} className="flex items-start gap-3">
                <Checkbox
                  id={id}
                  checked={checked.includes(index)}
                  disabled={!reviewable}
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

        {reviewable ? (
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
    <div className="flex flex-col gap-8 pb-20 lg:pb-0">
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
            <Panel>
              <p className="text-sm text-muted-foreground">
                {agencyLabel} has not submitted evidence for this milestone yet.
              </p>
            </Panel>
          )}

          <Panel
            title="Evidence"
            description="Documents stay private. Only their fingerprints are recorded on Monad."
          >
            <EvidenceList milestone={milestone} />
            {milestone.evidenceHash ? (
              <p className="mt-3 font-mono text-2xs text-subtle">
                Evidence fingerprint {milestone.evidenceHash.slice(0, 18)}…
              </p>
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
                { label: 'Destination account', value: destination },
              ]}
            />
          </Panel>
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">{decisionPanel}</div>
      </div>

      {canDecide ? (
        <div className="glass-chrome fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t p-3 lg:hidden">
          <Button variant="outline" size="pill-sm" className="flex-1" onClick={() => openChanges('changes')}>
            Request changes
          </Button>
          <Button size="pill-sm" className="flex-1" disabled={!covered} onClick={() => setReleaseOpen(true)}>
            Release tranche
          </Button>
        </div>
      ) : null}

      <ApprovalSheet
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        onClosed={release.reset}
        title="Release tranche"
        description={`${tranche.name} · ${milestone.title}`}
        summary={{
          what: `The milestone is approved and ${tranche.name} moves from the Funding Vault to ${agencyLabel}’s ${destination} account.`,
          amount: tranche.amount,
          from: `${agencyLabel} Funding Vault`,
          to: `${agencyLabel} · ${destination}`,
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
          body: `${formatUsd(tranche.amount, { withCode: true })} is now available in the ${agencyLabel} ${destination} account.`,
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
            ? 'The milestone is rejected and this tranche will not be released for it.'
            : 'The Agency is asked to update the evidence. The tranche stays in the Funding Vault.',
          reversible: rejecting
            ? 'Cannot be undone. The Agency would need a new agreement amendment.'
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

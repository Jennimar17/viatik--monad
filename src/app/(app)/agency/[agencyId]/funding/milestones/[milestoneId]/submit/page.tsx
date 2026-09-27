'use client'

import { Check } from 'lucide-react'
import { AppLink as Link } from '@/components/viatik/app-link'
import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { EvidenceList } from '@/components/app/funding-parts'
import { useHref, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Amount } from '@/components/viatik/amount'
import { EvidenceUploader, FormActions, type DraftFile } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd } from '@/domain/money'
import { milestoneStatus } from '@/domain/status'
import { formatDate } from '@/lib/format'

export default function SubmitEvidencePage() {
  const { milestoneId } = useParams<{ milestoneId: string }>()
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const submit = useCommand('submitMilestoneEvidence', { silent: true })
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [note, setNote] = React.useState('')
  const [accountId, setAccountId] = React.useState<string | null>(
    accounts.find((a) => a.template === 'operations')?.id ?? accounts[0]?.id ?? null,
  )
  const [done, setDone] = React.useState(false)
  useBottomBar(!done)

  const milestone = state.milestones.find((m) => m.id === milestoneId)
  const agreement = state.agreements.find((a) => a.id === milestone?.agreementId && a.agencyId === agencyId)
  if (!milestone || !agreement) {
    return (
      <ScreenUnavailable
        title="Milestone not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const tranche = state.tranches.find((t) => t.id === milestone.trancheId)
  const investor = state.portfolios.find((p) => p.id === agreement.portfolioId)?.name ?? 'The Investor'
  const busy = submit.phase !== 'idle' && submit.phase !== 'failed' && submit.phase !== 'completed'
  const underReview = milestone.status === 'ready_for_review' || milestone.status === 'approved'

  if (done) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
        <PageHeader
          title="Evidence submitted"
          description={`${investor} will review “${milestone.title}”${tranche ? ` and decide on ${tranche.name}` : ''}. You will be notified when funds are released.`}
        />
        <ButtonLink href={href('funding')} size="pill" className="w-fit">
          Back to funding
        </ButtonLink>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('funding')} className="hover:text-foreground">
            Funding
          </Link>
        }
        title={`Submit evidence · ${milestone.title}`}
        description={milestone.description}
        meta={
          <>
            <StatusBadge status={milestoneStatus[milestone.status]} size="md" />
            <span className="text-sm text-subtle">Due {formatDate(milestone.dueDate)}</span>
          </>
        }
      />

      {milestone.decision?.outcome === 'changes_requested' ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
          <p className="font-medium">{investor} asked for changes</p>
          {milestone.decision.note ? (
            <p className="mt-1 text-pretty text-muted-foreground">{milestone.decision.note}</p>
          ) : null}
        </div>
      ) : null}

      {underReview ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          This milestone is already {milestoneStatus[milestone.status].label.toLowerCase()}. New evidence
          cannot be submitted.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
        <Panel title="What the Investor will check">
          <ul className="flex flex-col gap-2.5">
            {milestone.acceptanceCriteria.map((criterion) => (
              <li key={criterion} className="flex gap-2.5 text-sm text-muted-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden="true" /> {criterion}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-pretty text-subtle">{agreement.evidenceRequirements}</p>
        </Panel>
        <Panel title="Tranche">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{tranche?.name ?? 'No tranche linked'}</span>
            {tranche ? <Amount value={tranche.amount} size="lg" /> : null}
          </div>
        </Panel>
      </div>

      {milestone.evidence.length > 0 ? (
        <Panel title="Already submitted">
          <EvidenceList milestone={milestone} />
        </Panel>
      ) : null}

      <Panel
        title="Evidence"
        description="Files stay private in Viatik. Only a fingerprint of each file is kept in the verified record."
      >
        <EvidenceUploader files={files} onChange={setFiles} />
      </Panel>

      <Panel>
        <div className="flex flex-col gap-5">
          <FormField
            label="Note for the Investor"
            htmlFor="note"
            hint="Summarize what was delivered and anything they should look at first."
          >
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-28 rounded-xl"
            />
          </FormField>
          <FormField
            label="Where should the funds go?"
            htmlFor="destination"
            hint={`When released, ${tranche ? formatUsd(tranche.amount, { withCode: true }) : 'the tranche'} lands in this account.`}
          >
            <SimpleSelect
              id="destination"
              value={accountId}
              onValueChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name, description: a.purpose }))}
            />
          </FormField>
        </div>
      </Panel>

      {submit.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={submit.phase} error={submit.error} />
        </Panel>
      ) : null}

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('funding'))} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="pill-sm"
          disabled={busy || underReview || files.length === 0 || !accountId}
          onClick={async () => {
            if (!accountId) return
            const result = await submit.run({
              milestoneId: milestone.id,
              evidence: files,
              note: note.trim(),
              destinationAccountId: accountId,
            })
            if (result) setDone(true)
          }}
        >
          {busy ? 'Submitting…' : 'Submit evidence'}
        </Button>
      </FormActions>
    </div>
  )
}

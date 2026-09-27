'use client'

import { AppLink as Link } from '@/components/viatik/app-link'
import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Amount } from '@/components/viatik/amount'
import { FormActions } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd } from '@/domain/money'
import { accountName } from '@/domain/queries'
import { trancheStatus } from '@/domain/status'
import { formatDate } from '@/lib/format'

export default function TrancheRequestPage() {
  const { trancheId } = useParams<{ trancheId: string }>()
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const request = useCommand('requestTranche', { silent: true })
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const [accountId, setAccountId] = React.useState<string | null>(
    accounts.find((a) => a.template === 'operations')?.id ?? accounts[0]?.id ?? null,
  )
  const [note, setNote] = React.useState('')
  const [done, setDone] = React.useState(false)
  useBottomBar(!done)

  const tranche = state.tranches.find((t) => t.id === trancheId)
  const agreement = state.agreements.find((a) => a.id === tranche?.agreementId && a.agencyId === agencyId)
  if (!tranche || !agreement) {
    return (
      <ScreenUnavailable
        title="Tranche not found"
        description="It may belong to another Agency, or the link is out of date."
      />
    )
  }

  const investor = state.portfolios.find((p) => p.id === agreement.portfolioId)?.name ?? 'The Investor'
  const busy = request.phase !== 'idle' && request.phase !== 'failed' && request.phase !== 'completed'
  const requestable = tranche.status === 'available' || tranche.status === 'planned'

  if (done) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
        <PageHeader
          title="Funding requested"
          description={`${investor} will review your request for ${tranche.name}. ${formatUsd(tranche.amount, { withCode: true })} lands in ${accountName(state, accountId ?? undefined)} when it is released.`}
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
        title={`Request ${tranche.name}`}
        description={agreement.title}
        meta={<StatusBadge status={trancheStatus[tranche.status]} size="md" />}
      />

      {requestable ? null : (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          This tranche cannot be requested right now: it is{' '}
          {trancheStatus[tranche.status].label.toLowerCase()}.
        </div>
      )}

      <Panel>
        <div className="flex flex-col gap-4">
          <Amount value={tranche.amount} size="xl" />
          <KeyValueList
            items={[
              { label: 'Agreement', value: agreement.title },
              {
                label: 'Release condition',
                value:
                  tranche.releaseCondition === 'scheduled'
                    ? `Scheduled${tranche.scheduledFor ? ` for ${formatDate(tranche.scheduledFor)}` : ''}`
                    : 'Released by the Investor on request',
              },
              { label: 'Reviewer', value: investor },
            ]}
          />
        </div>
      </Panel>

      <Panel title="Where should the funds go?">
        <div className="flex flex-col gap-5">
          <FormField
            label="Destination account"
            htmlFor="account"
            hint={`${formatUsd(tranche.amount, { withCode: true })} lands here when released.`}
          >
            <SimpleSelect
              id="account"
              value={accountId}
              onValueChange={setAccountId}
              options={accounts.map((a) => ({ value: a.id, label: a.name, description: a.purpose }))}
            />
          </FormField>
          <FormField label="Note for the Investor" htmlFor="note" optional>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="min-h-24 rounded-xl"
              placeholder="What will this tranche fund?"
            />
          </FormField>
        </div>
      </Panel>

      {request.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={request.phase} error={request.error} />
        </Panel>
      ) : null}

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('funding'))} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="pill-sm"
          disabled={busy || !accountId || !requestable}
          onClick={async () => {
            if (!accountId) return
            const result = await request.run({
              trancheId: tranche.id,
              destinationAccountId: accountId,
              note: note.trim() || undefined,
            })
            if (result) setDone(true)
          }}
        >
          {busy ? 'Requesting…' : 'Request funding'}
        </Button>
      </FormActions>
    </div>
  )
}

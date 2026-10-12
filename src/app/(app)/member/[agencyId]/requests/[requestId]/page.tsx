'use client'

import Link from '@/components/viatik/link'
import { Plus, Undo2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { AdvanceReceiptsAndReturns, returnHint } from '@/components/app/member-advances'
import { MemberReturnSheet } from '@/components/app/member-return-sheet'
import { receiptHref } from '@/components/app/nav'
import { AttachmentNames } from '@/components/app/open-file'
import { ReceiptDetailsButton, requestRecord } from '@/components/app/receipt-details'
import { advanceFollowUp, requestFollowUp, requestRecipientLabel } from '@/components/app/request-parts'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { Steps, type Step } from '@/components/viatik/operation'
import { PolicyVerdict } from '@/components/viatik/policy'
import { StatusBadge } from '@/components/viatik/status'
import { VerifiedDetailsButton } from '@/components/viatik/verified-details-drawer'
import { useCommand, useViatikState } from '@/data/react'
import { advanceStanding, returnableFor } from '@/domain/accountability'
import { categoryLabel, requestTypeLabel } from '@/domain/labels'
import { ZERO } from '@/domain/money'
import { policyForReader } from '@/domain/policy'
import { budgetName, receiptFor, userName } from '@/domain/queries'
import { justificationState, justificationStatus, requestStatusFor } from '@/domain/status'
import type { PaymentRequest, ViatikState } from '@/domain/types'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const policyDetail: Record<PaymentRequest['decision']['outcome'], string> = {
  approved: 'Within the budget rules',
  needs_approval: 'Needs an Agency Admin',
  rejected: 'Outside the budget rules',
}

/** The request's path so far. A stopped request ends at the step that stopped it. */
function progressSteps(state: ViatikState, request: PaymentRequest, completedAt?: string): Step[] {
  const { status } = request
  const submitted: Step = {
    id: 'submitted',
    label: 'Submitted',
    detail: formatDateTime(request.createdAt),
    state: 'done',
  }
  if (status === 'rejected') {
    // Payment for work above the Investor's exception threshold is refused by that rule, not the budget's.
    const aboveException = request.decision.reason?.rule === 'exception_threshold'
    return [
      submitted,
      {
        id: 'policy',
        label: 'Policy check',
        // Only a rejection the ledger recorded can be said to come from settlement.
        detail: aboveException
          ? "Above the Investor's exception threshold. Nothing was paid."
          : request.ledger?.outcome === 'rejected'
            ? 'Outside the budget rules, so settlement refused it. Nothing was paid.'
            : 'Outside the budget rules. Nothing was paid.',
        state: 'failed',
      },
    ]
  }
  const policy: Step = {
    id: 'policy',
    label: 'Policy check',
    // Above the exception threshold the Investor decides, not an Agency Admin.
    detail:
      request.decision.reason?.rule === 'exception_threshold' && request.decision.outcome === 'needs_approval'
        ? 'Needs the Investor'
        : policyDetail[request.decision.outcome],
    state: 'done',
  }
  if (status === 'declined') {
    return [
      submitted,
      policy,
      { id: 'decision', label: 'Declined', detail: request.declinedReason, state: 'failed' },
    ]
  }
  if (status === 'cancelled') {
    return [
      submitted,
      policy,
      {
        id: 'decision',
        label: 'Cancelled',
        detail: 'Withdrawn before a decision. Nothing was paid.',
        state: 'failed',
      },
    ]
  }
  return [
    submitted,
    policy,
    {
      id: 'decision',
      label: status === 'needs_approval' ? 'Waiting for approval' : 'Approved',
      detail: request.approvedBy
        ? `By ${userName(state, request.approvedBy)}`
        : request.decision.outcome === 'approved'
          ? 'Automatically, by policy'
          : undefined,
      state: status === 'needs_approval' ? 'current' : 'done',
    },
    {
      id: 'processing',
      label: 'Processing',
      state: status === 'processing' ? 'current' : status === 'completed' ? 'done' : 'upcoming',
    },
    {
      id: 'completed',
      label: 'Completed',
      detail: completedAt ? formatDateTime(completedAt) : undefined,
      state: status === 'completed' ? 'done' : 'upcoming',
    },
  ]
}

export default function RequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const cancel = useCommand('cancelRequest')
  const cancelSteps = useSigningSteps(cancel.phase, {
    prepared: 'Viatik checks that the request is still waiting for a decision.',
    done: { label: 'Recorded on Monad', detail: 'The request is closed. Nothing was paid.' },
  })
  const [cancelOpen, setCancelOpen] = React.useState(false)
  const [returnOpen, setReturnOpen] = React.useState(false)

  // Members see their own requests in their Agency only.
  const request = state.requests.find(
    (r) =>
      r.id === requestId &&
      r.agencyId === agencyId &&
      r.requester.kind === 'user' &&
      r.requester.userId === userId,
  )
  if (!request) {
    return (
      <ScreenUnavailable
        title="Request not found"
        description="It may have been removed, or the link is out of date."
      />
    )
  }

  const agencyName = state.agencies.find((a) => a.id === agencyId)?.name ?? 'your Agency'
  const payment = state.payments.find((p) => p.id === request.paymentId)
  const receipt = receiptFor(state, payment?.receiptId)
  const steps = progressSteps(state, request, payment?.completedAt)
  const recipient = requestRecipientLabel(state, request, userId)
  const paysMe = request.destination.kind === 'member'
  // Money for purchases: receipts by the due date, or the rest goes back. Once paid, the advance
  // says where it stands (due, overdue or justified); nothing to say once the request stopped.
  const stopped =
    request.status === 'rejected' || request.status === 'declined' || request.status === 'cancelled'
  const standing =
    payment?.type === 'advance' && payment.status === 'completed'
      ? advanceStanding(state, payment, now)
      : undefined
  const followUp = stopped
    ? undefined
    : standing
      ? advanceFollowUp(state, standing, userId)
      : requestFollowUp(state, request, userId)
  // "Return the rest": what is pending and still in the Viatik balance (money already sent out
  // can only be justified with receipts). Returning takes the person's own balance.
  const canMove = can('receive_payout', { ownerUserId: userId })
  const returnable = standing && canMove ? returnableFor(state, standing) : ZERO
  const canReturn = returnable > 0
  const partialReturn = standing && canMove ? returnHint(standing, returnable) : undefined
  // What the ledger recorded when it was sent, while that is still the latest word on it:
  // once paid the receipt is the record, and a closed request has moved on.
  const ledgerRecord =
    request.status === 'rejected' || request.status === 'needs_approval'
      ? requestRecord(state, request)
      : undefined

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('requests')} className="hover:text-foreground">
            Requests
          </Link>
        }
        title={request.purpose}
        meta={<StatusBadge status={requestStatusFor(request)} size="md" />}
        actions={
          request.status === 'needs_approval' ? (
            <Button variant="outline" size="pill" onClick={() => setCancelOpen(true)}>
              Cancel request
            </Button>
          ) : receipt ? (
            <ButtonLink href={receiptHref(receipt.id)} size="pill">
              View receipt
            </ButtonLink>
          ) : null
        }
      />

      <Panel>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">
              {paysMe ? 'Into your Viatik balance' : `To ${recipient}`}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Amount value={request.amount} size="xl" />
              {standing ? <StatusBadge status={justificationStatus[justificationState(standing)]} /> : null}
            </span>
            {followUp ? (
              <span className={cn('text-sm text-pretty', standing?.overdue ? 'text-danger' : 'text-subtle')}>
                {followUp}
              </span>
            ) : null}
            {partialReturn ? (
              <span className="text-xs text-pretty text-muted-foreground">{partialReturn}</span>
            ) : null}
          </div>
          {standing && standing.pending > 0 ? (
            <div className="flex flex-wrap gap-2">
              <ButtonLink
                href={href(`expenses/new?advance=${standing.payment.id}&from=request`)}
                variant="outline"
                size="pill"
              >
                <Plus data-icon="inline-start" /> Add receipt
              </ButtonLink>
              {canReturn ? (
                <Button variant="outline" size="pill" onClick={() => setReturnOpen(true)}>
                  <Undo2 data-icon="inline-start" /> Return the rest
                </Button>
              ) : null}
            </div>
          ) : null}
          <ReceiptDetailsButton receipt={receipt} />
          {ledgerRecord ? <VerifiedDetailsButton record={ledgerRecord} /> : null}
        </div>
      </Panel>

      {standing ? (
        <Panel
          title="Receipts and returns"
          description={`What this money paid for, and what went back to ${agencyName}.`}
        >
          <AdvanceReceiptsAndReturns standing={standing} agencyName={agencyName} />
        </Panel>
      ) : null}

      <Panel title="Progress">
        <Steps steps={steps} />
      </Panel>

      <PolicyVerdict decision={policyForReader(request.decision)} />

      <Panel title="Details">
        <KeyValueList
          items={[
            { label: 'Type', value: requestTypeLabel[request.type] },
            { label: 'Budget', value: budgetName(state, request.budgetId) },
            { label: 'Category', value: categoryLabel[request.category] },
            { label: paysMe ? 'Paid into' : 'Destination', value: recipient },
            ...(request.merchant ? [{ label: 'Merchant', value: request.merchant }] : []),
            ...(request.spentAt ? [{ label: 'Date paid', value: formatDate(request.spentAt) }] : []),
            {
              label: 'Attachments',
              value: <AttachmentNames items={request.attachments} />,
            },
            ...(request.declinedReason ? [{ label: 'Reason', value: request.declinedReason }] : []),
          ]}
        />
      </Panel>

      <ApprovalSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        onClosed={cancel.reset}
        title="Cancel request"
        summary={{
          what: 'The request is withdrawn and your Agency Admin will no longer see it in their queue.',
          amount: request.amount,
          reversible: 'Cannot be undone. You can create a new request later.',
          policy: 'Only the person who made a request can cancel it.',
        }}
        confirmLabel="Cancel request"
        confirmVariant="destructive"
        phase={cancel.phase}
        error={cancel.error}
        // Payment for work waiting for an Admin is not on Monad yet: cancelling it stays in Viatik.
        steps={request.type === 'work' ? undefined : cancelSteps}
        onConfirm={() => cancel.run({ requestId: request.id })}
        success={{ title: 'Request cancelled', body: 'Nothing was paid.' }}
      />
      {standing ? (
        <MemberReturnSheet
          // Not gated on what is left: once returned, the sheet stays open on its receipt.
          open={returnOpen && canMove}
          onOpenChange={setReturnOpen}
          agencyId={agencyId}
          agencyName={agencyName}
          advanceId={standing.payment.id}
        />
      ) : null}
    </div>
  )
}

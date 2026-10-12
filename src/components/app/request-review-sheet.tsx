'use client'

import { Info } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { receiptHref } from '@/components/app/nav'
import { AttachmentNames } from '@/components/app/open-file'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { requestRecipientLabel, requestTypeCopy } from '@/components/app/request-parts'
import { usePermissions } from '@/components/app/role-context'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KeyValueList } from '@/components/viatik/layout'
import { PolicyVerdict } from '@/components/viatik/policy'
import { Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { addDays, JUSTIFY_WITHIN_DAYS, paidAt } from '@/domain/accountability'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, ZERO } from '@/domain/money'
import {
  aboveExceptionThreshold,
  governingAgreement,
  actorName,
  budgetName,
  isException,
  receiptFor,
  userName,
} from '@/domain/queries'
import type { PaymentRequest } from '@/domain/types'
import { formatDate, formatDateTime } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

/** What already happened to a request that no longer needs a decision. */
function decidedCopy(request: PaymentRequest, approver: string | undefined): string {
  const when = request.decidedAt ? ` on ${formatDateTime(request.decidedAt)}` : ''
  switch (request.status) {
    case 'approved':
    case 'processing':
    case 'completed':
      return `Approved${approver ? ` by ${approver}` : ''}${when}. The payment is in the verified record.`
    case 'declined':
      return `Declined${when}.${request.declinedReason ? ` Reason: ${request.declinedReason}` : ''}`
    case 'rejected':
      return 'Rejected by the budget rules before anyone had to decide. Nothing was paid.'
    case 'cancelled':
      return 'Cancelled by the requester.'
    case 'needs_approval':
      return ''
  }
}

/**
 * Approve or decline a request that needed a decision. States what happens,
 * how much, where it goes, and which rule authorizes it. Self-approval is
 * never offered: the sheet says who can approve instead.
 */
export function RequestReviewSheet({
  requestId,
  open,
  onOpenChange,
  onClosed,
}: {
  /** The request to show; kept by the parent until the sheet has closed. */
  requestId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: () => void
}) {
  const { state, userId } = useViatikState()
  const { can } = usePermissions()
  const approve = useCommand('approveRequest')
  const decline = useCommand('declineRequest')
  const [mode, setMode] = React.useState<'review' | 'decline'>('review')
  const [reason, setReason] = React.useState('')
  const steps = useSigningSteps(approve.phase, {
    prepared: "Viatik checks the request again against its budget's limits and the ledger's rules.",
    done: { label: 'Paid', detail: 'Recorded on Monad, with its receipt.' },
  })

  const request = state.requests.find((r) => r.id === requestId)
  if (!request) return null

  // Payment for work is always decided by an Agency Admin: it never goes to the Investor, and above
  // the exception threshold it cannot be paid at all (the ledger's `pay` refuses it).
  const work = request.type === 'work'
  const exception = isException(state, request)
  const workAboveThreshold = work && aboveExceptionThreshold(state, request)
  const ownRequest = request.requester.kind === 'user' && request.requester.userId === userId
  const decidable = request.status === 'needs_approval'
  const allowed =
    decidable &&
    can('approve_payment', {
      agencyId: request.agencyId,
      agencies: state.agencies,
      createdBy: request.requester,
      isException: exception,
    })
  const budget = state.budgets.find((b) => b.id === request.budgetId)
  const account = state.accounts.find((a) => a.id === budget?.sourceAccountId)
  const agreement = governingAgreement(state, request.agencyId)
  const otherAdmins = state.memberships
    .filter(
      (m) =>
        m.role === 'agency_admin' &&
        m.status === 'active' &&
        m.scope.kind === 'agency' &&
        m.scope.agencyId === request.agencyId &&
        m.userId !== userId,
    )
    .map((m) => userName(state, m.userId))
  const active = mode === 'decline' ? decline : approve
  const payment = state.payments.find((p) => p.requestId === request.id)
  const receipt = receiptFor(state, payment?.receiptId)
  const requester = actorName(state, request.requester)
  const destination = requestRecipientLabel(state, request, userId)
  // What this kind of request means once paid: receipts, a pay-back, work, or straight to the vendor.
  const copy = requestTypeCopy(state, request, userId)
  const justifies = request.type === 'funds' && request.destination.kind === 'member'
  const declining = mode === 'decline'
  const thresholdText = formatUsd(agreement?.spendingPolicy.exceptionThreshold ?? ZERO, { withCode: true })

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setMode('review')
        setReason('')
        approve.reset()
        decline.reset()
        onClosed?.()
      }}
      title={declining ? 'Decline request' : exception ? 'Review exception' : 'Review request'}
      description={`${requester} · ${formatDateTime(request.createdAt)}`}
      summary={{
        what: declining
          ? 'The request is declined. No money moves and the requester is told why.'
          : copy.what,
        amount: request.amount,
        from: `${account?.name ?? 'Account'} · ${budget?.name ?? 'Budget'}`,
        to: destination,
        reversible: declining
          ? 'The requester can send a new request.'
          : 'Cannot be undone once the payment completes. A refund would be a new payment.',
        policy: exception
          ? `Above the ${thresholdText} exception threshold of the funding agreement, so the Investor decides.`
          : work
            ? `Payment for work is always reviewed by an Agency Admin and paid from ${budget?.name ?? 'the budget'}. Nobody approves their own request.`
            : `${budget?.name ?? 'This budget'}: requests above ${formatUsd(budget?.approvalThreshold ?? ZERO, { withCode: true })} need an Agency Admin. Nobody approves their own request.`,
      }}
      confirmLabel={declining ? 'Decline request' : 'Approve and pay'}
      confirmVariant={declining ? 'destructive' : 'default'}
      disabled={!allowed || (declining ? reason.trim().length < 3 : workAboveThreshold)}
      phase={active.phase}
      error={active.error}
      // Previewed only for someone who can approve; once approving, they stay in place.
      steps={!declining && (allowed || approve.phase !== 'idle') ? steps : undefined}
      onConfirm={() =>
        declining
          ? decline.run({ requestId: request.id, reason: reason.trim() })
          : approve.run({ requestId: request.id })
      }
      secondaryAction={
        allowed && !declining ? (
          <Button
            variant="ghost"
            size="pill-sm"
            className="text-danger hover:text-danger"
            onClick={() => setMode('decline')}
          >
            Decline
          </Button>
        ) : null
      }
      success={
        declining
          ? { title: 'Request declined', body: `${requester} was notified with your reason.` }
          : {
              title: 'Payment completed',
              body: `${copy.paid} The receipt is in the verified record.`,
              actions: (
                <>
                  {receipt ? (
                    <ButtonLink href={receiptHref(receipt.id)} variant="outline" size="pill-sm">
                      View receipt
                    </ButtonLink>
                  ) : null}
                  <ReceiptDetailsButton receipt={receipt} />
                </>
              ),
            }
      }
    >
      {!decidable ? (
        <div className="rounded-xl border border-border bg-mist/5 p-4 text-sm text-muted-foreground">
          {decidedCopy(request, request.approvedBy ? userName(state, request.approvedBy) : undefined)}
        </div>
      ) : null}
      {decidable && !allowed ? (
        <div className="flex gap-3 rounded-xl border border-info/30 bg-info-soft p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">
            {ownRequest
              ? `You created this request. Another Agency Admin has to approve it${otherAdmins.length ? `: ${otherAdmins.join(' or ')} can.` : '.'}`
              : exception
                ? 'This request is above the exception threshold of the funding agreement. It is waiting for the Investor.'
                : work
                  ? 'Payment for work is always decided by an Agency Admin.'
                  : 'You do not have permission to decide this request.'}
          </p>
        </div>
      ) : null}
      {decidable && allowed && workAboveThreshold && !declining ? (
        <div className="flex gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <p className="text-pretty text-muted-foreground">
            {`Payment for work above the ${thresholdText} exception threshold cannot be paid. Decline it.`}
          </p>
        </div>
      ) : null}
      {declining ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="decline-reason" className="text-sm font-medium">
            Reason
          </label>
          <Textarea
            id="decline-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="min-h-24 rounded-xl"
            placeholder="Tell the requester what to change."
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-mist/5 p-4">
            <Tag className="w-fit">{copy.label}</Tag>
            <p className="text-sm text-pretty text-muted-foreground">{copy.reviewNote}</p>
          </div>
          <KeyValueList
            dense
            items={[
              { label: 'Requested by', value: requester },
              { label: 'Pays', value: destination },
              ...(justifies
                ? [
                    {
                      label: 'Receipts due',
                      value: payment
                        ? formatLocalDate(addDays(paidAt(payment), JUSTIFY_WITHIN_DAYS))
                        : `${JUSTIFY_WITHIN_DAYS} days after payment`,
                    },
                  ]
                : []),
              { label: 'Budget', value: budgetName(state, request.budgetId) },
              { label: 'Category', value: categoryLabel[request.category] },
              ...(request.merchant ? [{ label: 'Merchant', value: request.merchant }] : []),
              ...(request.spentAt ? [{ label: 'Date paid', value: formatDate(request.spentAt) }] : []),
              {
                label: 'Attachments',
                value: <AttachmentNames items={request.attachments} />,
              },
            ]}
          />
          <PolicyVerdict decision={request.decision} perspective="reviewer" />
        </>
      )}
    </ApprovalSheet>
  )
}

'use client'

import { Check, CircleDashed, X } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { receiptHref } from '@/components/app/nav'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { useHref } from '@/components/app/role-context'
import { ScreenUnavailable } from '@/components/app/screen-unavailable'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PolicyVerdict } from '@/components/viatik/policy'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { categoryLabel, requestTypeLabel } from '@/domain/labels'
import { budgetName, receiptFor, recipientName, userName } from '@/domain/queries'
import { requestStatus } from '@/domain/status'
import type { PaymentRequest, ViatikState } from '@/domain/types'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type StepState = 'done' | 'current' | 'upcoming' | 'failed'
type Step = { label: string; detail?: string; state: StepState }

const policyDetail: Record<PaymentRequest['decision']['outcome'], string> = {
  approved: 'Within the budget rules',
  needs_approval: 'Needs an Agency Admin',
  rejected: 'Outside the budget rules',
}

/** The request's path so far. A stopped request ends at the step that stopped it. */
function progressSteps(state: ViatikState, request: PaymentRequest, completedAt?: string): Step[] {
  const { status } = request
  const submitted: Step = { label: 'Submitted', detail: formatDateTime(request.createdAt), state: 'done' }
  if (status === 'rejected') {
    return [
      submitted,
      {
        label: 'Policy check',
        detail: 'Outside the budget rules, and rejected on Monad as well. Nothing was paid.',
        state: 'failed',
      },
    ]
  }
  const policy: Step = {
    label: 'Policy check',
    detail: policyDetail[request.decision.outcome],
    state: 'done',
  }
  if (status === 'declined') {
    return [submitted, policy, { label: 'Declined', detail: request.declinedReason, state: 'failed' }]
  }
  if (status === 'cancelled') {
    return [
      submitted,
      policy,
      { label: 'Cancelled', detail: 'Withdrawn before a decision. Nothing was paid.', state: 'failed' },
    ]
  }
  return [
    submitted,
    policy,
    {
      label: status === 'needs_approval' ? 'Waiting for approval' : 'Approved',
      detail: request.approvedBy
        ? `By ${userName(state, request.approvedBy)}`
        : request.decision.outcome === 'approved'
          ? 'Automatically, by policy'
          : undefined,
      state: status === 'needs_approval' ? 'current' : 'done',
    },
    {
      label: 'Processing',
      state: status === 'processing' ? 'current' : status === 'completed' ? 'done' : 'upcoming',
    },
    {
      label: 'Completed',
      detail: completedAt ? formatDateTime(completedAt) : undefined,
      state: status === 'completed' ? 'done' : 'upcoming',
    },
  ]
}

export default function RequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const { state } = useViatikState()
  const href = useHref()
  const cancel = useCommand('cancelRequest')
  const [cancelOpen, setCancelOpen] = React.useState(false)

  const request = state.requests.find((r) => r.id === requestId)
  if (!request) {
    return (
      <ScreenUnavailable
        title="Request not found"
        description="It may have been removed, or the link is out of date."
      />
    )
  }

  const payment = state.payments.find((p) => p.id === request.paymentId)
  const receipt = receiptFor(state, payment?.receiptId)
  const steps = progressSteps(state, request, payment?.completedAt)
  const recipient = recipientName(state, request.destination)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        eyebrow={
          <Link href={href('requests')} className="hover:text-foreground">
            Requests
          </Link>
        }
        title={request.purpose}
        meta={<StatusBadge status={requestStatus[request.status]} size="md" />}
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
            <span className="text-sm text-muted-foreground">To {recipient}</span>
            <Amount value={request.amount} size="xl" />
          </div>
          <ReceiptDetailsButton receipt={receipt} />
        </div>
      </Panel>

      <Panel title="Progress">
        <ol className="flex flex-col gap-4">
          {steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
                  step.state === 'done' && 'border-sage bg-sage text-primary-foreground',
                  step.state === 'current' && 'border-warning text-warning',
                  step.state === 'upcoming' && 'border-border text-subtle',
                  step.state === 'failed' && 'border-danger bg-danger-soft text-danger',
                )}
                aria-hidden="true"
              >
                {step.state === 'done' ? (
                  <Check className="size-3.5" />
                ) : step.state === 'failed' ? (
                  <X className="size-3.5" />
                ) : (
                  <CircleDashed className="size-3.5" />
                )}
              </span>
              <span className="flex flex-col">
                <span className={cn('text-sm font-medium', step.state === 'upcoming' && 'text-subtle')}>
                  {step.label}
                </span>
                {step.detail ? <span className="text-sm text-muted-foreground">{step.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Panel>

      <PolicyVerdict decision={request.decision} />

      <Panel title="Details">
        <KeyValueList
          items={[
            { label: 'Type', value: requestTypeLabel[request.type] },
            { label: 'Budget', value: budgetName(state, request.budgetId) },
            { label: 'Category', value: categoryLabel[request.category] },
            { label: 'Destination', value: recipient },
            {
              label: 'Attachments',
              value:
                request.attachments.length > 0 ? request.attachments.map((a) => a.name).join(', ') : 'None',
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
        onConfirm={() => cancel.run({ requestId: request.id })}
        success={{ title: 'Request cancelled', body: 'Nothing was paid.' }}
      />
    </div>
  )
}

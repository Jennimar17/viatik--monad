'use client'

import { ArrowLeft, FilePlus2, Printer } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import * as React from 'react'

import { AddInvoiceSheet } from '@/components/app/add-invoice-sheet'
import { ButtonLink } from '@/components/app/button-link'
import { roleHome } from '@/components/app/nav'
import { OpenFileButton } from '@/components/app/open-file'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { resolveScope, RoleProvider } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/viatik/feedback'
import { ReceiptView, type ReceiptRow } from '@/components/viatik/receipt-view'
import { useViatik } from '@/data/react'
import { receiptKindLabel } from '@/domain/labels'
import { isOutsidePayment } from '@/domain/queries'
import type { Evidence, Membership, Receipt, Reconciliation, ViatikState } from '@/domain/types'
import { shortHash } from '@/lib/format'
import { useSession } from '@/lib/session'

/** Private documents behind a receipt, including those linked when it was reconciled. */
function evidenceFor(state: ViatikState, receipt: Receipt, reconciliation?: Reconciliation): Evidence[] {
  // The same evidence can sit in two places (a request's attachment becomes its expense's receipt).
  // Releases saved before 03/10 can lack the list.
  const ids = new Set([...(receipt.evidenceIds ?? []), ...(reconciliation?.evidenceIds ?? [])])
  // An outside payment's invoice can be attached after its receipt was issued.
  const proof = state.payments.find((p) => p.id === receipt.operationId)?.proof
  if (proof) ids.add(proof.id)
  const found = new Map<string, Evidence>()
  for (const item of [
    ...state.milestones.flatMap((m) => m.evidence),
    ...state.bills.map((b) => b.document),
    ...state.expenses.flatMap((e) => (e.receipt ? [e.receipt] : [])),
    ...state.requests.flatMap((r) => r.attachments),
    ...state.payments.flatMap((p) => (p.proof ? [p.proof] : [])),
  ]) {
    if (ids.has(item.id) && !found.has(item.id)) found.set(item.id, item)
  }
  return [...found.values()]
}

/**
 * "Add invoice" for an outside payment still waiting for its invoice. The receipt page sits outside
 * the role workspaces, so the sheet gets the Admin's scope here; it renders nothing for anyone who
 * cannot pay outside Viatik (the Investor, a Member). Once the invoice is attached only the button
 * goes: the sheet stays mounted so its success screen and signing steps remain visible.
 */
function AddInvoiceButton({
  paymentId,
  membership,
  attached,
}: {
  paymentId: string
  membership: Membership
  /** The payment already has its invoice: no button, the sheet only finishes. */
  attached: boolean
}) {
  const { state } = useViatik()
  const [open, setOpen] = React.useState(false)
  const scope = React.useMemo(
    () => resolveScope(membership, (agencyId) => state?.agencies.find((a) => a.id === agencyId)?.portfolioId),
    [membership, state?.agencies],
  )
  if (!scope) return null
  return (
    <RoleProvider value={scope}>
      {attached ? null : (
        <Button variant="outline" size="pill-sm" onClick={() => setOpen(true)}>
          <FilePlus2 data-icon="inline-start" /> Add invoice
        </Button>
      )}
      <AddInvoiceSheet paymentId={paymentId} open={open} onOpenChange={setOpen} />
    </RoleProvider>
  )
}

/** A verifiable receipt on paper, outside the workspace shell so it prints cleanly. */
export default function ReceiptPage() {
  const { receiptId } = useParams<{ receiptId: string }>()
  const router = useRouter()
  const { userId } = useSession()
  const { state, isLoading, isError, refetch, memberships } = useViatik()
  const home = memberships[0] ? roleHome(memberships[0]) : '/sign-in'

  if (userId === null) {
    return (
      <main id="main" className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          titleAs="h1"
          title="Sign in to view this receipt"
          description="Receipts are private to the people involved in the operation."
          action={
            <ButtonLink href="/sign-in" size="pill">
              Sign in
            </ButtonLink>
          }
        />
      </main>
    )
  }
  if (isError) {
    return (
      <main id="main" className="mx-auto max-w-md px-4 py-24">
        <ErrorState titleAs="h1" onRetry={refetch} />
      </main>
    )
  }
  if (userId === undefined || isLoading || !state) {
    return (
      <main id="main" className="mx-auto max-w-2xl px-4 py-16" aria-busy="true">
        <Skeleton className="h-[520px] rounded-2xl" />
      </main>
    )
  }

  const receipt = state.receipts.find((r) => r.id === receiptId)
  if (!receipt) {
    return (
      <main id="main" className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          titleAs="h1"
          title="Receipt not found"
          description="It may belong to a workspace you do not have access to."
          action={
            <ButtonLink href={home} size="pill">
              Go to my workspace
            </ButtonLink>
          }
        />
      </main>
    )
  }

  const reconciliation = state.reconciliations.find((r) => r.receiptId === receipt.id)
  const bill = reconciliation?.billId ? state.bills.find((b) => b.id === reconciliation.billId) : undefined
  // An outside payment's full address, for the people allowed to see it (the Agency's Admins and Investors).
  const payment = state.payments.find((p) => p.id === receipt.operationId)
  const paidTo = payment?.recipient
  // An outside payment's Agency Admin can attach its invoice from here while it has none. Worked out
  // whether or not the invoice is in, so the sheet stays mounted when the invoice it attaches arrives.
  const invoiceAdmin =
    receipt.kind === 'outside_payment' &&
    payment &&
    isOutsidePayment(payment) &&
    payment.status === 'completed'
      ? memberships.find(
          (m) =>
            m.role === 'agency_admin' && m.scope.kind === 'agency' && m.scope.agencyId === payment.agencyId,
        )
      : undefined
  const address = paidTo && paidTo.kind === 'address' ? paidTo.address : undefined
  const organization =
    state.agencies.find((a) => a.id === receipt.agencyId)?.name ??
    state.portfolios.find((p) => p.id === receipt.portfolioId)?.name ??
    'Viatik'
  const rows: ReceiptRow[] = [
    { label: 'From', value: receipt.fromLabel },
    { label: 'To', value: receipt.toLabel },
    { label: 'Organization', value: organization },
    { label: 'Policy applied', value: receipt.policyLabel },
    ...(bill ? [{ label: 'Bill', value: bill.number }] : []),
    ...(address ? [{ label: 'Paid to address', value: address, mono: true }] : []),
    ...(receipt.verified.receiptHash
      ? [{ label: 'Receipt hash', value: shortHash(receipt.verified.receiptHash, 10, 8), mono: true }]
      : []),
  ]

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col gap-5 px-4 py-8 sm:py-14">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="pill-sm"
          onClick={() => (window.history.length > 1 ? router.back() : router.push(home))}
        >
          <ArrowLeft data-icon="inline-start" /> Back
        </Button>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="pill-sm" onClick={() => window.print()}>
            <Printer data-icon="inline-start" /> Print
          </Button>
          {invoiceAdmin && payment ? (
            <AddInvoiceButton
              paymentId={payment.id}
              membership={invoiceAdmin}
              attached={Boolean(payment.proof)}
            />
          ) : null}
          <ReceiptDetailsButton receipt={receipt} />
        </div>
      </div>

      <ReceiptView
        kindLabel={receiptKindLabel[receipt.kind]}
        number={receipt.number}
        description={receipt.description}
        amount={receipt.amount}
        issuedAt={receipt.issuedAt}
        rows={rows}
        evidence={evidenceFor(state, receipt, reconciliation).map((e) => ({
          id: e.id,
          name: e.kind === 'file' ? <OpenFileButton evidence={e} /> : e.name,
          label: e.name,
          fingerprint: e.sha256,
        }))}
      />
    </main>
  )
}

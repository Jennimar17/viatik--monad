'use client'

import { Info, TriangleAlert } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { receiptHref } from '@/components/app/nav'
import { OpenFileButton } from '@/components/app/open-file'
import { ReceiptDetailsButton } from '@/components/app/receipt-details'
import { usePermissions } from '@/components/app/role-context'
import { useSigningSteps } from '@/components/app/signing-steps'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EvidenceUploader, pendingUploads, toEvidence, type DraftFile } from '@/components/viatik/forms'
import { useCommand, useEvidenceFiles, useLedger, useViatikState } from '@/data/react'
import { paidAt } from '@/domain/accountability'
import { shortAddress } from '@/domain/address'
import { formatUsd } from '@/domain/money'
import { accountName, budgetName, isOutsidePayment, receiptFor } from '@/domain/queries'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { formatDate } from '@/lib/format'

/**
 * Attach the invoice of a payment made outside Viatik (`addPaymentProof`). One
 * file, attached once: its fingerprint is recorded once and can never be
 * replaced, and a file already used for another payment or expense is refused
 * (the engine's message shows in the sheet). Renders nothing for a viewer who
 * cannot pay outside Viatik, so the Investor never gets it.
 *
 * Keep `paymentId` set while the sheet closes (clear it in `onClosed`), as with
 * the expenses page's upload sheet, so the closing sheet does not go blank:
 *
 *   const [invoiceFor, setInvoiceFor] = React.useState<string | null>(null)
 *   const [invoiceOpen, setInvoiceOpen] = React.useState(false)
 *   <Button onClick={() => { setInvoiceFor(p.id); setInvoiceOpen(true) }}>Add invoice</Button>
 *   <AddInvoiceSheet paymentId={invoiceFor} open={invoiceOpen} onOpenChange={setInvoiceOpen} />
 */
export function AddInvoiceSheet({
  paymentId,
  open,
  onOpenChange,
  onClosed,
}: {
  /** The outside payment to document. */
  paymentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Runs once the sheet has closed, after its own reset. */
  onClosed?: () => void
}) {
  const { state } = useViatikState()
  const { can } = usePermissions()
  const { view } = useLedger()
  const attach = useCommand('addPaymentProof')
  const evidenceFiles = useEvidenceFiles()
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const steps = useSigningSteps(attach.phase, {
    prepared: "Viatik checks the invoice against the ledger's rules.",
    done: { label: 'Recorded', detail: "The invoice's fingerprint is recorded on Monad, once." },
  })

  const payment = state.payments.find((p) => p.id === paymentId)
  if (!payment || !isOutsidePayment(payment) || !can('pay_outside', { agencyId: payment.agencyId }))
    return null

  const recipient = payment.recipient.kind === 'address' ? payment.recipient : undefined
  const payee = recipient?.payee ?? 'the payee'
  const amount = formatUsd(payment.amount, { withCode: true })
  const from = payment.budgetId
    ? `${accountName(state, payment.sourceAccountId)} · ${budgetName(state, payment.budgetId)}`
    : accountName(state, payment.sourceAccountId)
  const receipt = receiptFor(state, payment.receiptId)
  const monad = view?.settlement === 'monad'
  // Monad unreachable: the invoice's fingerprint cannot be recorded, so nothing is uploaded or signed.
  const paused = view?.settlement === 'monad' && !view.available
  // Already documented (another tab or another Admin was faster): nothing to attach, unless this
  // sheet just attached it and shows its success.
  const alreadyAttached = Boolean(payment.proof) && attach.phase === 'idle'
  const waiting = pendingUploads(files)
  const file = files[0]

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        attach.reset()
        setFiles([])
        onClosed?.()
      }}
      title="Add invoice"
      description={`${payee} · paid ${formatDate(paidAt(payment))}`}
      summary={{
        what: `The invoice is attached to the ${amount} paid to ${payee} outside Viatik. Its fingerprint is recorded once and the Investor can see it.`,
        amount: payment.amount,
        from,
        to: recipient?.address ? `${payee} · ${shortAddress(recipient.address)}` : payee,
        reversible:
          'Cannot be replaced once attached: the invoice is recorded once. A file already used for another payment or expense is refused.',
        policy:
          'Only payments made outside Viatik take an invoice here. The file stays private; only its fingerprint is recorded.',
      }}
      confirmLabel="Attach invoice"
      disabled={alreadyAttached || !file || Boolean(waiting) || paused}
      phase={attach.phase}
      error={attach.error}
      onConfirm={() => {
        if (file) return attach.run({ paymentId: payment.id, proof: toEvidence(file) })
      }}
      success={{
        title: 'Invoice attached',
        body: `The invoice for the ${amount} paid to ${payee} is attached${monad ? ' and its fingerprint is recorded' : ''}. The Investor can see it now.`,
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
      }}
      steps={steps}
    >
      {alreadyAttached && payment.proof ? (
        <p className="flex gap-2 rounded-xl border border-info/30 bg-info-soft p-4 text-sm text-pretty">
          <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
          <span>
            This payment already has its invoice:{' '}
            <OpenFileButton evidence={payment.proof} className="font-medium" />. It cannot be replaced.
          </span>
        </p>
      ) : (
        <EvidenceUploader
          files={files}
          onChange={setFiles}
          onUpload={evidenceFiles.upload}
          maxFiles={1}
          allowLinks={false}
          label="Drop the invoice here or browse"
          hint="One file: PDF, PNG, JPG, WEBP or HEIC, up to 10 MB. It stays private; only its fingerprint is recorded."
        />
      )}
      {paused && !alreadyAttached ? (
        <p className="flex gap-2 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-pretty">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          Invoices are paused: Viatik cannot reach {
            networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK).name
          }{' '}
          right now. Try again later.
        </p>
      ) : null}
    </ApprovalSheet>
  )
}

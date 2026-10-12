'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Plus, Upload, WalletCards } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import {
  justifyHint,
  justifySummary,
  MemberAdvanceList,
  useMemberAccountability,
} from '@/components/app/member-advances'
import { MemberReturnSheet } from '@/components/app/member-return-sheet'
import { advanceTitle } from '@/components/app/request-parts'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { EvidenceUploader, pendingUploads, toEvidence, type DraftFile } from '@/components/viatik/forms'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useEvidenceFiles, useViatikState } from '@/data/react'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, sum } from '@/domain/money'
import { budgetName } from '@/domain/queries'
import type { Expense, Id } from '@/domain/types'
import { formatDate, pluralize } from '@/lib/format'

const receiptStatus = (expense: Expense) =>
  expense.receipt
    ? ({ label: 'Receipt attached', tone: 'success' } as const)
    : ({ label: 'Missing receipt', tone: 'warning' } as const)

export default function ExpensesPage() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const attach = useCommand('attachReceipt')
  const evidenceFiles = useEvidenceFiles()
  // The expense being completed is fixed when its sheet opens; the sheet reads the live record.
  const [uploadingId, setUploadingId] = React.useState<string | null>(null)
  const [files, setFiles] = React.useState<DraftFile[]>([])
  // One return sheet for the page. The money for purchases it opens on is kept while it closes,
  // so its choice does not flip during the closing animation.
  const [returnOpen, setReturnOpen] = React.useState(false)
  const [returnFor, setReturnFor] = React.useState<Id | undefined>(undefined)
  const canMove = can('receive_payout', { ownerUserId: userId })
  const agencyName = state.agencies.find((a) => a.id === agencyId)?.name ?? 'your Agency'
  const acc = useMemberAccountability(agencyId)

  const expenses = state.expenses
    .filter((e) => e.agencyId === agencyId && e.userId === userId)
    .sort((a, b) => (a.spentAt < b.spentAt ? 1 : -1))
  // Receipts for money for purchases come with their expense; what can still miss one is an
  // expense for something Viatik paid a vendor for you.
  const missing = acc.missing
  // The money for purchases an expense justifies, named after the row's details.
  const forText = (expense: Expense) => {
    const advance = expense.paymentId ? acc.all.find((s) => s.payment.id === expense.paymentId) : undefined
    return advance ? ` · For “${advanceTitle(advance)}”` : ''
  }
  const month = now.slice(0, 7)
  const thisMonth = expenses.filter((e) => e.spentAt.startsWith(month))
  const uploading = state.expenses.find((e) => e.id === uploadingId)
  const budgets = Array.from(new Set(expenses.map((e) => e.budgetId)))

  const startUpload = (expense: Expense) => {
    setFiles([])
    setUploadingId(expense.id)
  }

  const openReturn = (paymentId: Id) => {
    setReturnFor(paymentId)
    setReturnOpen(true)
  }

  const missingSentence =
    missing.length > 0
      ? `${pluralize(missing.length, 'expense needs', 'expenses need')} a receipt so your Agency can reconcile the payment.`
      : null

  const columns: ColumnDef<Expense, unknown>[] = [
    {
      accessorKey: 'spentAt',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDate(row.original.spentAt)}
        </span>
      ),
    },
    {
      accessorKey: 'merchant',
      header: 'Merchant',
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{row.original.merchant}</span>
          <span className="text-xs text-subtle">
            {categoryLabel[row.original.category]} · {budgetName(state, row.original.budgetId)}
            {forText(row.original)}
          </span>
        </span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.amount} size="sm" />,
    },
    {
      id: 'receipt',
      header: 'Receipt',
      cell: ({ row }) =>
        row.original.receipt ? (
          <StatusBadge status={receiptStatus(row.original)} />
        ) : (
          <Button size="pill-sm" variant="outline" onClick={() => startUpload(row.original)}>
            <Upload data-icon="inline-start" /> Upload receipt
          </Button>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Expenses"
        description={
          acc.pending > 0
            ? `${formatUsd(acc.pending, { withCode: true })} still to justify. Add receipts or return what you do not use.${missingSentence ? ` ${missingSentence}` : ''}`
            : (missingSentence ??
              (acc.all.length > 0
                ? 'Your money for purchases is justified and every expense has its receipt.'
                : 'Every expense has its receipt.'))
        }
        actions={
          <ButtonLink href={href('expenses/new')} size="pill">
            <Plus data-icon="inline-start" /> Add receipt
          </ButtonLink>
        }
      />

      {acc.all.length > 0 ? (
        <Panel title="Money to justify" description={justifySummary(acc)}>
          <MemberAdvanceList advances={acc.all} onReturn={openReturn} />
        </Panel>
      ) : null}

      {expenses.length === 0 && acc.all.length === 0 ? (
        <EmptyState
          icon={<WalletCards />}
          title="No expenses yet"
          description="What you buy with money for purchases, and what Viatik pays for you, shows up here with its receipt."
          action={
            <ButtonLink href={href('expenses/new')} size="pill-sm">
              <Plus data-icon="inline-start" /> Add receipt
            </ButtonLink>
          }
        />
      ) : (
        <>
          <HairlineGrid className={acc.all.length > 0 ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-3'}>
            <KpiTile
              label="This month"
              value={sum(thisMonth, (e) => e.amount)}
              hint={pluralize(thisMonth.length, 'expense')}
            />
            {acc.all.length > 0 ? (
              <KpiTile label="To justify" value={acc.pending} hint={justifyHint(acc)} />
            ) : null}
            <KpiTile
              label="Missing receipts"
              value={<span className="font-display text-2xl leading-none">{missing.length}</span>}
              hint={missing.length ? 'Upload them below' : 'All set'}
            />
            <KpiTile
              label="All time"
              value={sum(expenses, (e) => e.amount)}
              hint={pluralize(expenses.length, 'expense')}
            />
          </HairlineGrid>

          <DataTable
            data={expenses}
            columns={columns}
            caption="Your expenses"
            searchPlaceholder="Search expenses"
            searchText={(e) => `${e.merchant} ${categoryLabel[e.category]} ${budgetName(state, e.budgetId)}`}
            facets={[
              {
                id: 'receipt',
                label: 'Receipt',
                accessor: (e) => (e.receipt ? 'attached' : 'missing'),
                options: [
                  { value: 'missing', label: 'Missing receipt' },
                  { value: 'attached', label: 'Receipt attached' },
                ],
              },
              {
                id: 'budget',
                label: 'Budget',
                accessor: (e) => e.budgetId,
                options: budgets.map((id) => ({ value: id, label: budgetName(state, id) })),
              },
            ]}
            initialSorting={[{ id: 'spentAt', desc: true }]}
            renderMobile={(e) => (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">{e.merchant}</span>
                    <span className="text-xs text-pretty text-subtle">
                      {formatDate(e.spentAt)} · {categoryLabel[e.category]}
                      {forText(e)}
                    </span>
                  </span>
                  <Amount value={e.amount} size="sm" />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge status={receiptStatus(e)} />
                  {e.receipt ? null : (
                    <Button size="pill-sm" variant="outline" onClick={() => startUpload(e)}>
                      <Upload data-icon="inline-start" /> Upload receipt
                    </Button>
                  )}
                </div>
              </div>
            )}
            empty={
              expenses.length === 0 ? (
                <EmptyState
                  compact
                  icon={<WalletCards />}
                  title="No receipts yet"
                  description="Each receipt you add for money for purchases shows here as an expense."
                />
              ) : (
                <EmptyState
                  compact
                  title="No expenses here"
                  description="Expenses matching these filters will appear here."
                />
              )
            }
          />
        </>
      )}

      <ApprovalSheet
        open={Boolean(uploadingId)}
        onOpenChange={(open) => !open && setUploadingId(null)}
        onClosed={() => {
          attach.reset()
          setFiles([])
        }}
        title="Upload receipt"
        description={uploading ? `${uploading.merchant} · ${formatDate(uploading.spentAt)}` : undefined}
        summary={{
          what: 'The receipt is attached to this expense so your Agency can reconcile the payment.',
          amount: uploading?.amount,
          reversible: 'Once attached, the receipt stays with the expense for reconciliation.',
          irreversible: true,
          policy: 'The file stays private; only its fingerprint goes into the verified record.',
        }}
        confirmLabel="Attach receipt"
        disabled={files.length === 0 || Boolean(pendingUploads(files))}
        phase={attach.phase}
        error={attach.error}
        onConfirm={() => {
          const receipt = files[0]
          if (uploading && receipt)
            return attach.run({ expenseId: uploading.id, receipt: toEvidence(receipt) })
        }}
        success={{ title: 'Receipt attached', body: 'The expense is complete.' }}
      >
        <EvidenceUploader
          files={files}
          onChange={setFiles}
          onUpload={evidenceFiles.upload}
          maxFiles={1}
          allowLinks={false}
          label="Drop the receipt here or browse"
          hint="PDF, PNG, JPG, WEBP or HEIC, up to 10 MB. It stays private; only its fingerprint is recorded."
        />
      </ApprovalSheet>
      <MemberReturnSheet
        open={returnOpen && canMove}
        onOpenChange={setReturnOpen}
        agencyId={agencyId}
        agencyName={agencyName}
        advanceId={returnFor}
      />
    </div>
  )
}

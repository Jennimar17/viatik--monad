'use client'

import { ArrowUpRight, FileWarning, Plus, ReceiptText, TriangleAlert, Undo2, Wallet } from 'lucide-react'
import * as React from 'react'

import { AdvanceRows, JustificationBar } from '@/components/app/accountability-parts'
import { ButtonLink } from '@/components/app/button-link'
import { OpenFileButton } from '@/components/app/open-file'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { advanceTitle } from '@/components/app/request-parts'
import { useHref, usePermissions } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import Link from '@/components/viatik/link'
import { useViatikState } from '@/data/react'
import {
  advancesOf,
  lastReminded,
  missingReceipts,
  returnableFor,
  type AdvanceStanding,
} from '@/domain/accountability'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, sum, ZERO, type Cents } from '@/domain/money'
import { receiptFor } from '@/domain/queries'
import type { Expense, Id, ISODate } from '@/domain/types'
import { formatRelative, formatShortDate, pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The Member's money for purchases (advances) in one Agency: what is still
 * to justify, the list with its actions, the Overview banner and the
 * receipts and returns of one advance. Payments, Expenses, Overview and the
 * request page all read the same numbers from `useMemberAccountability`.
 *
 * None of these parts holds a sheet: each page owns a single
 * MemberReturnSheet and opens it through `onReturn(paymentId)`.
 */

const usd = (value: Cents) => formatUsd(value, { withCode: true })

/** Due first at the top. */
const byDueDate = (a: AdvanceStanding, b: AdvanceStanding) => Date.parse(a.dueAt) - Date.parse(b.dueAt)

export type MemberAccountability = {
  /** Every advance the person received in this Agency, newest first. */
  all: AdvanceStanding[]
  /** Advances with something still to justify or return, newest first. */
  open: AdvanceStanding[]
  /** Advances that receipts and returns cover in full. */
  settled: AdvanceStanding[]
  /** Still to justify or return, across the open advances. */
  pending: Cents
  /** The part of `pending` past its due date. */
  overdue: Cents
  overdueCount: number
  /** Open advances past their due date, the one due first at the top. */
  late: AdvanceStanding[]
  /** The open advance due first (overdue ones included). */
  nextDue?: AdvanceStanding
  /** Expenses for something Viatik paid a vendor for the person, still without a receipt. */
  missing: Expense[]
  /** When an Agency Admin last reminded the person about receipts here. */
  lastRemindedAt?: ISODate
}

/** The signed-in Member's money for purchases in one Agency, and their missing vendor receipts. */
export function useMemberAccountability(agencyId: Id): MemberAccountability {
  const { state, now, userId } = useViatikState()
  return React.useMemo(() => {
    const all = advancesOf(state, { agencyId, userId }, now)
    const open = all.filter((s) => s.pending > 0)
    const late = open.filter((s) => s.overdue).sort(byDueDate)
    return {
      all,
      open,
      settled: all.filter((s) => s.settled),
      pending: sum(open, (s) => s.pending),
      overdue: sum(late, (s) => s.pending),
      overdueCount: late.length,
      late,
      nextDue: [...open].sort(byDueDate)[0],
      missing: missingReceipts(state, { agencyId, userId }),
      lastRemindedAt: lastReminded(state, agencyId, userId),
    }
  }, [state, agencyId, userId, now])
}

/**
 * One line for a panel or tab: "750.00 USD to justify · 1 overdue" or "… · next due
 * Nov 1". With nothing pending it only says what the list holds (the list itself
 * says everything is justified).
 */
export function justifySummary(acc: MemberAccountability): string {
  if (acc.pending <= 0) return 'What you received for purchases, and the receipts and returns that cover it.'
  const when =
    acc.overdueCount > 0
      ? `${acc.overdueCount} overdue`
      : acc.nextDue
        ? `${acc.open.length > 1 ? 'next due' : 'due'} ${formatShortDate(acc.nextDue.dueAt)}`
        : null
  return [`${usd(acc.pending)} to justify`, when].filter(Boolean).join(' · ')
}

/** The hint under a "To justify" figure: how many are overdue, when the next one is due, or all justified. */
export function justifyHint(acc: MemberAccountability): React.ReactNode {
  if (acc.overdueCount > 0) return <span className="text-danger">{acc.overdueCount} overdue</span>
  if (acc.nextDue) return `${acc.open.length > 1 ? 'Next due' : 'Due'} ${formatShortDate(acc.nextDue.dueAt)}`
  return 'All justified'
}

/**
 * Why "Return the rest" gives back less than what is pending: part of the
 * money already left the Viatik balance, and only receipts can justify it now.
 */
export function returnHint(standing: AdvanceStanding, returnable: Cents): string | undefined {
  if (standing.pending <= 0 || returnable >= standing.pending) return undefined
  return returnable > 0
    ? `Only ${usd(returnable)} is still in your Viatik balance: add receipts for the rest.`
    : 'None of it is still in your Viatik balance: add receipts for what is left.'
}

/**
 * The Member's money for purchases, open ones first, justified ones behind
 * "Show N justified". Each open row offers "Add receipt" and, when the person
 * can move their own balance and some of it is still there, "Return the rest";
 * every row links to its request.
 *
 * - `onReturn(paymentId)`: opens the page's single MemberReturnSheet on that advance.
 * - `from`: where "Add receipt" brings the person back after adding it.
 */
export function MemberAdvanceList({
  advances,
  onReturn,
  from,
  className,
}: {
  /** `useMemberAccountability(agencyId).all`. */
  advances: AdvanceStanding[]
  onReturn: (paymentId: Id) => void
  from?: 'payments'
  className?: string
}) {
  const { state, userId } = useViatikState()
  const href = useHref()
  const { can } = usePermissions()
  // Returning takes the person's own balance, like sending it out.
  const canMove = can('receive_payout', { ownerUserId: userId })

  const actions = (s: AdvanceStanding) => {
    const title = advanceTitle(s)
    const returnable = canMove && !s.settled ? returnableFor(state, s) : ZERO
    const hint = canMove ? returnHint(s, returnable) : undefined
    return (
      <>
        {hint ? <p className="w-full text-xs text-pretty text-muted-foreground">{hint}</p> : null}
        {s.settled ? null : (
          <ButtonLink
            href={href(`expenses/new?advance=${s.payment.id}${from ? `&from=${from}` : ''}`)}
            variant="outline"
            size="pill-sm"
          >
            <Plus data-icon="inline-start" /> Add receipt
            <span className="sr-only"> for “{title}”</span>
          </ButtonLink>
        )}
        {returnable > 0 ? (
          <Button variant="outline" size="pill-sm" onClick={() => onReturn(s.payment.id)}>
            <Undo2 data-icon="inline-start" /> Return the rest
            <span className="sr-only"> of “{title}”</span>
          </Button>
        ) : null}
        {s.request ? (
          <ButtonLink
            href={href(`requests/${s.request.id}`)}
            variant="ghost"
            size="pill-sm"
            className="ml-auto"
          >
            Details
            <span className="sr-only"> of “{title}”</span>
            <ArrowUpRight data-icon="inline-end" />
          </ButtonLink>
        ) : null}
      </>
    )
  }

  return (
    <AdvanceRows
      advances={advances}
      perspective="member"
      actions={actions}
      className={className}
      empty={
        <EmptyState
          compact
          icon={<ReceiptText />}
          title="Nothing to justify"
          description="Money for purchases you receive shows here until receipts for what you bought, or what you return, cover it."
          action={
            <ButtonLink href={href('requests/new?type=funds')} size="pill-sm">
              <Wallet data-icon="inline-start" /> Request money for purchases
            </ButtonLink>
          }
        />
      }
    />
  )
}

/** “Conference supplies”, “Conference supplies” and “Offsite snacks”, or “Conference supplies” and 2 more. */
function titles(advances: AdvanceStanding[]): string {
  const quoted = advances.map((s) => `“${advanceTitle(s)}”`)
  if (quoted.length <= 2) return quoted.join(' and ')
  return `${quoted[0] ?? ''} and ${quoted.length - 1} more`
}

/**
 * One banner on the Member's Overview for everything still open: money for
 * purchases to justify (red once something is overdue, amber while only
 * pending) and expenses still missing a vendor receipt. The whole banner links
 * to Expenses, where each advance has its actions. Nothing renders when
 * nothing is open.
 */
export function MemberAccountabilityBanner({ agencyId }: { agencyId: Id }) {
  const { now } = useViatikState()
  const href = useHref()
  const acc = useMemberAccountability(agencyId)
  const { pending, overdue, late, open, nextDue, missing, lastRemindedAt } = acc

  if (pending <= 0 && missing.length === 0) return null

  // The overdue one due first: its date says since when.
  const firstLate = late[0]
  const isLate = Boolean(firstLate)
  const missingText =
    missing.length > 0 ? `${pluralize(missing.length, 'expense needs', 'expenses need')} a receipt` : null

  let headline: string
  let body: string
  if (pending > 0) {
    headline = firstLate
      ? `${usd(pending)} to justify · ${usd(overdue)} overdue`
      : `${usd(pending)} to justify · ${open.length > 1 ? 'next due' : 'due'} ${formatShortDate(nextDue?.dueAt ?? now)}`
    body = firstLate
      ? `${titles(late)} ${late.length === 1 ? 'was due' : 'are overdue, the first since'} ${formatShortDate(firstLate.dueAt)}. Add receipts for what you bought or return what you did not use.`
      : `Add receipts for what you bought with ${titles(open)}, or return what you do not use.`
  } else {
    headline = missingText ?? ''
    body = 'Upload them so your Agency can reconcile the payments.'
  }
  const meta = [
    pending > 0 && missingText
      ? `${pluralize(missing.length, 'expense')} also ${missing.length === 1 ? 'needs' : 'need'} a receipt`
      : null,
    // A reminder is about money for purchases: once that is justified it no longer applies.
    pending > 0 && lastRemindedAt ? `Reminded ${formatRelative(lastRemindedAt, now)}` : null,
  ].filter(Boolean)
  const cta = pending > 0 ? 'Add receipts' : 'Upload receipts'
  const Icon = isLate ? TriangleAlert : FileWarning

  return (
    <Link
      href={href('expenses')}
      className={cn(
        'flex items-start gap-4 rounded-xl border p-4 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
        isLate
          ? 'border-danger/30 bg-danger-soft hover:bg-danger/20'
          : 'border-warning/30 bg-warning-soft hover:bg-warning/20',
      )}
    >
      <Icon
        className={cn('mt-0.5 size-5 shrink-0', isLate ? 'text-danger' : 'text-warning')}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium text-pretty">{headline}</span>
        <span className="text-sm text-pretty text-muted-foreground">{body}</span>
        {meta.length > 0 ? <span className="text-xs text-pretty text-subtle">{meta.join(' · ')}</span> : null}
        <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium sm:hidden">
          {cta} <ArrowUpRight className="size-4" aria-hidden="true" />
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-1.5 self-center text-sm font-medium sm:inline-flex">
        {cta} <ArrowUpRight className="size-4" aria-hidden="true" />
      </span>
    </Link>
  )
}

/**
 * Where one advance stands, in detail: the bar, then each receipt that
 * justifies it (the file opens) and each return (its receipt opens).
 */
export function AdvanceReceiptsAndReturns({
  standing,
  agencyName,
}: {
  standing: AdvanceStanding
  agencyName: string
}) {
  const { state } = useViatikState()
  const receipts = useReceiptDrawer()
  const expenses = [...standing.expenses].sort((a, b) => Date.parse(b.spentAt) - Date.parse(a.spentAt))
  const returns = [...standing.returns].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

  return (
    <div className="flex flex-col gap-4">
      <JustificationBar standing={standing} />
      {expenses.length === 0 && returns.length === 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">
          No receipts or returns yet. Each receipt you add for this money shows here.
        </p>
      ) : (
        <ul className="flex flex-col" aria-label="Receipts and returns">
          {expenses.map((expense) => (
            <li
              key={expense.id}
              className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                <ReceiptText className="size-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium">{expense.merchant}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-subtle">
                  <span>
                    {formatShortDate(expense.spentAt)} · {categoryLabel[expense.category]}
                  </span>
                  {expense.receipt ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <OpenFileButton evidence={expense.receipt} className="max-w-48 text-muted-foreground" />
                    </>
                  ) : (
                    <span className="text-warning">· No receipt yet</span>
                  )}
                </span>
              </span>
              <Amount value={expense.amount} size="sm" />
            </li>
          ))}
          {returns.map((movement) => {
            const receipt = receiptFor(state, movement.receiptId)
            const content = (
              <>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                  <Undo2 className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium underline-offset-4 group-hover:underline">
                    Returned to {agencyName}
                  </span>
                  <span className="truncate text-xs text-subtle">
                    {formatShortDate(movement.createdAt)} · Unused
                  </span>
                </span>
                <Amount value={movement.amount} size="sm" />
                {receipt ? <span className="sr-only">, view receipt</span> : null}
              </>
            )
            return (
              <li key={movement.id} className="border-t border-border first:border-t-0">
                {receipt ? (
                  <button
                    type="button"
                    onClick={() => receipts.show(receipt)}
                    className="group flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 py-3">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {receipts.drawer}
    </div>
  )
}

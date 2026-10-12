'use client'

import type { ColumnDef } from '@tanstack/react-table'
import {
  BellRing,
  CalendarClock,
  ChevronDown,
  FileCheck2,
  ReceiptText,
  ShieldCheck,
  Undo2,
  UserRound,
} from 'lucide-react'
import type { Route } from 'next'
import * as React from 'react'

import { OpenFileButton } from '@/components/app/open-file'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { advanceDueText, advanceTitle } from '@/components/app/request-parts'
import { usePermissions } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { Amount } from '@/components/viatik/amount'
import { DataTable, type Facet } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid } from '@/components/viatik/layout'
import Link from '@/components/viatik/link'
import { CopyButton } from '@/components/viatik/operation'
import { OrgAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag, type StatusDescriptor } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import {
  accountabilityByPerson,
  addDays,
  agencyAccountability,
  paidAt,
  PROOF_WITHIN_DAYS,
  REMIND_EVERY_HOURS,
  remindersDue,
  type AdvanceStanding,
  type PersonAccountability,
  type ProofStanding,
  type ReminderDue,
} from '@/domain/accountability'
import { shortAddress } from '@/domain/address'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, percentOf, sum, type Cents } from '@/domain/money'
import { accountName, budgetName, isOutsidePayment, receiptFor, userName } from '@/domain/queries'
import { returnedCapital } from '@/domain/selectors'
import {
  justificationState,
  justificationStatus,
  proofState,
  proofStatus,
  reminderStatus,
  type ProofState,
} from '@/domain/status'
import type { Id, ISODate, Payment, Reminder, ViatikState } from '@/domain/types'
import {
  daysUntil,
  dueLabel,
  formatRelative,
  formatShortDate,
  instantDueLabel,
  pluralize,
} from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'
import { cn } from '@/lib/utils'

/**
 * Accountability, shown the same way to everyone who may see it: what people
 * still have to justify for money for purchases, outside payments waiting for
 * their invoice, the record of payments made outside Viatik, capital returned
 * to the Investor and monthly payments.
 *
 * Every part is read-only. Screens add their own buttons through `action`
 * render-props, gated with `usePermissions().can(…)` (`pay_outside`,
 * `manage_reminders`): the Agency Admin gets "Add invoice", "Send reminder" and
 * "Pay now"; the Investor (who only has `canView`) gets none. Parts read names
 * from the viewer's scoped state, so a Member sees only their own records and
 * an outside payment's address may be missing (`recipient.address` undefined).
 *
 * Product language: these parts never name the network; the Investor's
 * Accountability tab is not one of the places where it may appear.
 */

const usd = (value: Cents) => formatUsd(value, { withCode: true })

// ─── Small shared pieces ─────────────────────────────────────────────────────

/** Where an outside payment's invoice stands, computed as `outsidePaymentsWithoutProof` does. */
export function invoiceStanding(
  payment: Payment,
  now: ISODate,
): { state: ProofState; dueAt: ISODate; overdue: boolean } {
  const dueAt = addDays(paidAt(payment), PROOF_WITHIN_DAYS)
  const overdue = !payment.proof && Date.parse(now) > Date.parse(dueAt)
  return { state: proofState(payment, overdue), dueAt, overdue }
}

/**
 * A person's money to justify as one status: receipts overdue, receipts
 * pending, only vendor receipts missing, or nothing open.
 */
export function personStatus(
  person: Pick<PersonAccountability, 'pending' | 'overdueCount' | 'missingReceipts'>,
): StatusDescriptor {
  if (person.overdueCount > 0) return justificationStatus.overdue
  if (person.pending > 0) return justificationStatus.pending
  if (person.missingReceipts > 0) return { label: 'Missing receipts', tone: 'warning' }
  return justificationStatus.justified
}

/**
 * A monthly payment is due on a day, not at an instant. `remindersDue` puts its
 * `dueAt` at midnight UTC of that day and marks it `overdue` from then on, but
 * screens say "Due today" all that day: it counts as overdue only once the due
 * day has passed. Use this (not `ReminderDue.overdue`) for red badges, banners
 * and nav counts.
 */
export function isMonthlyOverdue(due: Pick<ReminderDue, 'dueAt'>, now: ISODate): boolean {
  return daysUntil(due.dueAt, now) < 0
}

/** A monthly payment that is due now: due today or overdue (see `isMonthlyOverdue`). */
export function isMonthlyDueNow(due: Pick<ReminderDue, 'dueAt'>, now: ISODate): boolean {
  return daysUntil(due.dueAt, now) <= 0
}

/**
 * A due date as a badge ("Due in 3 days", "Due today", "2 days overdue"):
 * danger once the due day has passed, warning within three days, neutral before.
 */
export function DueBadge({
  dueAt,
  now,
  overdue,
  className,
}: {
  dueAt: ISODate
  now: ISODate
  /** Overrides the day comparison, e.g. with a standing's own `overdue`. */
  overdue?: boolean
  className?: string
}) {
  const days = daysUntil(dueAt, now)
  // Same rule as the label: red only from "1 day overdue", never on "Due today".
  const late = overdue ?? days < 0
  const tone = late ? 'danger' : days <= 3 ? 'warning' : 'neutral'
  return <StatusBadge status={{ label: dueLabel(dueAt, now), tone }} className={className} />
}

/** The full address of an outside payment with a copy button, or a plain note when the viewer may not see it. */
function PayeeAddress({ address, short = false }: { address: string | undefined; short?: boolean }) {
  if (!address) return <span className="text-xs text-subtle">Address not shown</span>
  return (
    <span className="inline-flex max-w-full min-w-0 items-start gap-1">
      <span
        // whitespace-normal: table cells are nowrap, and the full address must wrap inside its column.
        className={cn(
          'min-w-0 font-mono text-xs text-foreground',
          short ? 'truncate' : 'break-all whitespace-normal',
        )}
        title={address}
      >
        {short ? shortAddress(address) : address}
      </span>
      <CopyButton value={address} label="Copy the full address" className="-mt-1" />
    </span>
  )
}

/** "Operations" or "Operations · Tools budget": where an outside payment was paid from. */
function paidFrom(state: ViatikState, payment: Payment): string {
  const account = accountName(state, payment.sourceAccountId)
  return payment.budgetId ? `${account} · ${budgetName(state, payment.budgetId)}` : account
}

const payeeOf = (payment: Payment) =>
  payment.recipient.kind === 'address' ? payment.recipient.payee : 'Outside Viatik'
const addressOf = (payment: Payment) =>
  payment.recipient.kind === 'address' ? payment.recipient.address : undefined

/** A "Show N more" / "Show fewer" toggle under a shortened list. */
function ShowMore({
  shown,
  total,
  open,
  onToggle,
  noun,
}: {
  shown: number
  total: number
  open: boolean
  onToggle: () => void
  /** What the hidden rows are, e.g. "justified" in "Show 3 justified". */
  noun?: string
}) {
  if (total <= shown && !open) return null
  return (
    <Button variant="ghost" size="pill-sm" className="mt-1 w-fit" aria-expanded={open} onClick={onToggle}>
      {open ? 'Show fewer' : noun ? `Show ${total - shown} ${noun}` : `Show all ${total}`}
      <ChevronDown
        data-icon="inline-end"
        className={cn('transition-transform', open && 'rotate-180')}
        aria-hidden="true"
      />
    </Button>
  )
}

// ─── Money for purchases ─────────────────────────────────────────────────────

/**
 * How much of an advance receipts justify, what was given back and what is
 * still to justify, as one bar with a legend. The pending part turns red only
 * when it is overdue (unlike UsageBar, which reddens as it fills).
 */
export function JustificationBar({
  standing,
  legend = true,
  className,
}: {
  standing: Pick<AdvanceStanding, 'amount' | 'justified' | 'returned' | 'pending' | 'overdue'>
  /** "500.00 justified · 300.00 to justify" under the bar (parts at zero are left out). */
  legend?: boolean
  className?: string
}) {
  const { justified, returned, pending, overdue } = standing
  const total = (justified + returned + pending || standing.amount) as Cents
  const parts = [
    { key: 'justified', value: justified, label: 'justified', bar: 'bg-sage' },
    { key: 'returned', value: returned, label: 'returned', bar: 'bg-mist/60' },
    // The rest of the track: empty while on time, red once overdue.
    { key: 'pending', value: pending, label: 'to justify', bar: overdue ? 'bg-danger/60' : 'bg-transparent' },
  ]
  const spoken = parts
    .filter((p) => p.value > 0)
    .map((p) => `${usd(p.value)} ${p.key === 'pending' && overdue ? 'overdue' : p.label}`)
    .join(', ')
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        role="img"
        aria-label={`${spoken || 'Nothing to justify'} of ${usd(standing.amount)}`}
        className="flex h-1.5 overflow-hidden rounded-[2px] bg-muted"
      >
        {parts.map((part) =>
          part.value > 0 ? (
            <span
              key={part.key}
              className={cn('h-full', part.bar)}
              style={{ width: `${percentOf(part.value, total)}%` }}
            />
          ) : null,
        )}
      </div>
      {legend ? (
        <p className="flex flex-wrap gap-x-1.5 text-xs text-subtle" aria-hidden="true">
          {parts
            .filter((p) => p.value > 0)
            .map((part, index) => (
              <span key={part.key} className={cn(part.key === 'pending' && overdue && 'text-danger')}>
                {index > 0 ? '· ' : ''}
                <span
                  className={cn('num', part.key === 'pending' && overdue ? 'text-danger' : 'text-foreground')}
                >
                  {formatUsd(part.value)}
                </span>{' '}
                {part.label}
              </span>
            ))}
        </p>
      ) : null}
    </div>
  )
}

/**
 * One person's money for purchases (advances), open ones first and the
 * justified ones behind "Show N justified". Each row: what it was for, the
 * amount, its status, when it was paid and is due, and a JustificationBar.
 *
 * - `perspective`: 'member' reads "Received Oct 2" (the person's own list),
 *   'agency' reads "Paid Oct 2" (Admin and Investor).
 * - `showReceipts`: list the receipts (open-file links) and returns under each row.
 * - `actions`: buttons under a row, e.g. the Member's "Add receipt" / "Return the rest".
 */
export function AdvanceRows({
  advances,
  perspective = 'agency',
  showReceipts = false,
  actions,
  empty,
  className,
}: {
  /** From `advancesOf(...)` (newest first) or a person's `PersonAccountability.advances`. */
  advances: AdvanceStanding[]
  perspective?: 'member' | 'agency'
  showReceipts?: boolean
  actions?: (standing: AdvanceStanding) => React.ReactNode
  /** Replaces the empty state when there is no advance at all. */
  empty?: React.ReactNode
  className?: string
}) {
  const [showSettled, setShowSettled] = React.useState(false)
  const open = advances.filter((s) => !s.settled)
  const settled = advances.filter((s) => s.settled)

  if (advances.length === 0) {
    return (
      empty ?? (
        <EmptyState
          compact
          icon={<ReceiptText />}
          title="Nothing to justify"
          description="Money for purchases shows here until its receipts, or what is given back, cover it."
        />
      )
    )
  }

  const shown = showSettled ? [...open, ...settled] : open
  return (
    <div className={cn('flex flex-col', className)}>
      {open.length === 0 ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <FileCheck2 className="size-4 text-sage" aria-hidden="true" />
          Everything is justified.
        </p>
      ) : null}
      {shown.length > 0 ? (
        <ul className="flex flex-col">
          {shown.map((s) => (
            <AdvanceRow
              key={s.payment.id}
              standing={s}
              perspective={perspective}
              showReceipts={showReceipts}
              actions={actions}
            />
          ))}
        </ul>
      ) : null}
      {settled.length > 0 ? (
        <ShowMore
          shown={open.length}
          total={advances.length}
          open={showSettled}
          onToggle={() => setShowSettled((value) => !value)}
          noun="justified"
        />
      ) : null}
    </div>
  )
}

function AdvanceRow({
  standing: s,
  perspective,
  showReceipts,
  actions,
}: {
  standing: AdvanceStanding
  perspective: 'member' | 'agency'
  showReceipts: boolean
  actions?: (standing: AdvanceStanding) => React.ReactNode
}) {
  const { state } = useViatikState()
  const paid = formatLocalDate(paidAt(s.payment), { withYear: false })
  const meta = [
    `${perspective === 'member' ? 'Received' : 'Paid'} ${paid}`,
    // A budget the person no longer spends from may be out of their view: then it is left out.
    state.budgets.find((b) => b.id === s.payment.budgetId)?.name,
    s.settled ? null : advanceDueText(s, { short: true }),
  ].filter(Boolean)
  const action = actions?.(s)
  return (
    <li className="flex flex-col gap-3 border-t border-border py-4 first:border-t-0 first:pt-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium text-foreground">{advanceTitle(s)}</span>
          <span className={cn('text-xs', s.overdue ? 'text-danger' : 'text-subtle')}>{meta.join(' · ')}</span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <Amount value={s.amount} size="sm" />
          <StatusBadge status={justificationStatus[justificationState(s)]} />
        </div>
      </div>
      <JustificationBar standing={s} />
      {showReceipts && (s.expenses.length > 0 || s.returns.length > 0) ? (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
          {s.expenses.map((expense) => (
            <li key={expense.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-foreground">
                {expense.merchant}
                <span className="text-subtle"> · {formatShortDate(expense.spentAt)}</span>
              </span>
              {expense.receipt ? (
                <OpenFileButton evidence={expense.receipt} className="max-w-40 text-muted-foreground" />
              ) : (
                <span className="text-warning">No receipt yet</span>
              )}
              <Amount value={expense.amount} size="xs" />
            </li>
          ))}
          {s.returns.map((movement) => (
            <li key={movement.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-foreground">
                Returned
                <span className="text-subtle">
                  {' '}
                  · {formatLocalDate(movement.createdAt, { withYear: false })}
                </span>
              </span>
              <Amount value={movement.amount} size="xs" />
            </li>
          ))}
        </ul>
      ) : null}
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </li>
  )
}

/**
 * Everyone with money to justify (or vendor receipts missing), most overdue
 * first: avatar, name, what is pending and overdue, how many advances, the
 * next due date and when they were last reminded.
 *
 * - `action`: e.g. the Admin's `<RemindButton agencyId person={p} />`.
 * - `personHref`: makes the name a link (the Admin's `href(`team/${id}`)`).
 * - `expandable`: each person opens to their advances (the Investor's view).
 * - `limit`: rows shown before "Show all N".
 */
export function PeopleToJustifyList({
  people,
  now,
  action,
  personHref,
  expandable = false,
  limit,
  empty,
  className,
}: {
  /** From `accountabilityByPerson(state, agencyId, now)`. */
  people: PersonAccountability[]
  now: ISODate
  action?: (person: PersonAccountability) => React.ReactNode
  personHref?: (userId: Id) => Route | undefined
  expandable?: boolean
  limit?: number
  empty?: React.ReactNode
  className?: string
}) {
  const [showAll, setShowAll] = React.useState(false)
  if (people.length === 0) {
    return (
      empty ?? (
        <EmptyState
          compact
          icon={<UserRound />}
          title="Everyone is up to date"
          description="People who received money for purchases show here until its receipts cover it."
        />
      )
    )
  }
  const cap = limit ?? people.length
  const shown = showAll ? people : people.slice(0, cap)
  return (
    <div className={cn('@container flex flex-col', className)}>
      <ul className="flex flex-col">
        {shown.map((person) => (
          <PersonRow
            key={person.userId}
            person={person}
            now={now}
            action={action}
            href={personHref?.(person.userId)}
            expandable={expandable}
          />
        ))}
      </ul>
      <ShowMore shown={cap} total={people.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
    </div>
  )
}

function PersonRow({
  person,
  now,
  action,
  href,
  expandable,
}: {
  person: PersonAccountability
  now: ISODate
  action?: (person: PersonAccountability) => React.ReactNode
  href?: Route
  expandable: boolean
}) {
  const { state } = useViatikState()
  const name = userName(state, person.userId)
  const next = [...person.advances].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]
  const meta = [
    person.advances.length > 0 ? `${person.advances.length} open` : null,
    person.overdue > 0 ? `${formatUsd(person.overdue)} overdue` : null,
    next ? advanceDueText(next, { short: true }) : null,
    person.missingReceipts > 0 ? pluralize(person.missingReceipts, 'missing receipt') : null,
    person.lastRemindedAt ? `reminded ${formatRelative(person.lastRemindedAt, now)}` : 'never reminded',
  ].filter(Boolean)
  const sentence = meta.join(' · ')
  const rendered = action?.(person)
  const canExpand = expandable && person.advances.length > 0

  const row = (
    <div className="flex flex-col gap-3 py-3.5 @2xl:flex-row @2xl:items-center @2xl:gap-4">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <PersonAvatar name={name} size="md" />
        <span className="flex min-w-0 flex-col gap-0.5">
          {href ? (
            <Link
              href={href}
              className="truncate rounded-sm text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
          )}
          <span className="text-xs text-pretty text-subtle">
            {sentence.charAt(0).toUpperCase() + sentence.slice(1)}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2 @2xl:justify-end">
        {person.pending > 0 ? (
          <span className="flex items-baseline gap-1 text-sm">
            <Amount value={person.pending} size="sm" />
            <span className="text-xs text-subtle">to justify</span>
          </span>
        ) : null}
        <StatusBadge status={personStatus(person)} />
        {rendered}
        {canExpand ? (
          <CollapsibleTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="group rounded-full"
                aria-label={`Show ${name}’s money for purchases`}
              />
            }
          >
            <ChevronDown
              className="size-4 transition-transform group-data-[panel-open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
        ) : null}
      </span>
    </div>
  )

  return (
    <li className="border-t border-border first:border-t-0">
      {canExpand ? (
        <Collapsible>
          {row}
          <CollapsibleContent className="pb-3 sm:pl-12">
            <AdvanceRows advances={person.advances} showReceipts />
          </CollapsibleContent>
        </Collapsible>
      ) : (
        row
      )}
    </li>
  )
}

// ─── Reminders about receipts ────────────────────────────────────────────────

const HOUR_MS = 60 * 60 * 1000

/** Whether the signed-in Admin may remind a person now, and why not otherwise. */
export type RemindEligibility =
  | { ok: true }
  | {
      ok: false
      /** 'recent': reminded within the last REMIND_EVERY_HOURS (shown, disabled); the rest are hidden. */
      why: 'not_allowed' | 'self' | 'not_member' | 'nothing_pending' | 'recent'
      reason: string
    }

/**
 * The same rules the engine applies to `remindReceipts`, so a screen never
 * offers a reminder it would refuse: not yourself, only active members of the
 * Agency, only people with money for purchases still pending (missing vendor
 * receipts do not count), and at most once every REMIND_EVERY_HOURS.
 */
export function useRemindEligibility(agencyId: Id): (person: PersonAccountability) => RemindEligibility {
  const { state, userId, now } = useViatikState()
  const { can } = usePermissions()
  const allowed = can('manage_reminders', { agencyId })
  return React.useCallback(
    (person: PersonAccountability): RemindEligibility => {
      if (!allowed) return { ok: false, why: 'not_allowed', reason: 'Only Agency Admins send reminders.' }
      if (person.userId === userId) return { ok: false, why: 'self', reason: 'You cannot remind yourself.' }
      const member = state.memberships.some(
        (m) =>
          m.userId === person.userId &&
          m.status === 'active' &&
          m.scope.kind === 'agency' &&
          m.scope.agencyId === agencyId,
      )
      if (!member) return { ok: false, why: 'not_member', reason: 'No longer in this Agency.' }
      if (person.pending <= 0)
        return { ok: false, why: 'nothing_pending', reason: 'No money for purchases to justify.' }
      if (
        person.lastRemindedAt &&
        Date.parse(now) - Date.parse(person.lastRemindedAt) < REMIND_EVERY_HOURS * HOUR_MS
      ) {
        return { ok: false, why: 'recent', reason: `Reminded ${formatRelative(person.lastRemindedAt, now)}` }
      }
      return { ok: true }
    },
    [allowed, userId, state.memberships, agencyId, now],
  )
}

/**
 * "Send reminder" for one person (`person`), or "Remind everyone (n)" for a list
 * (`people`): one click, a toast, nothing else. Inside the 24-hour window it shows
 * disabled ("Reminded 3 hours ago"); when the engine would refuse for any other
 * reason (yourself, nothing pending, no longer a member, no permission) it renders nothing.
 */
export function RemindButton({
  agencyId,
  person,
  people,
  variant = 'outline',
  size = 'pill-sm',
  className,
}: {
  agencyId: Id
  /** Remind this person. */
  person?: PersonAccountability
  /** Or remind everyone eligible in this list (`accountabilityByPerson(...)`). */
  people?: PersonAccountability[]
  variant?: 'outline' | 'ghost' | 'secondary' | 'default'
  size?: 'pill' | 'pill-sm' | 'sm' | 'default'
  className?: string
}) {
  const { state } = useViatikState()
  const eligibility = useRemindEligibility(agencyId)
  const remind = useCommand('remindReceipts', {
    success: (result) =>
      result.notified.length === 1
        ? `Reminder sent to ${userName(state, result.notified[0])}.`
        : `Reminder sent to ${pluralize(result.notified.length, 'person', 'people')}.`,
  })
  const sending = remind.isPending

  if (person) {
    const check = eligibility(person)
    if (!check.ok && check.why !== 'recent') return null
    const name = userName(state, person.userId)
    return (
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={!check.ok || sending}
        aria-label={check.ok ? `Send reminder to ${name}` : `${check.reason}, ${name}`}
        onClick={() => void remind.run({ agencyId, userId: person.userId })}
      >
        {sending ? (
          <>
            <Spinner data-icon="inline-start" /> Sending…
          </>
        ) : check.ok ? (
          <>
            <BellRing data-icon="inline-start" /> Send reminder
          </>
        ) : (
          check.reason
        )}
      </Button>
    )
  }

  const checks = (people ?? []).map((p) => eligibility(p))
  const eligible = checks.filter((c) => c.ok).length
  const recent = checks.filter((c) => !c.ok && c.why === 'recent').length
  if (eligible === 0 && recent === 0) return null
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={eligible === 0 || sending}
      onClick={() => void remind.run({ agencyId })}
    >
      {sending ? (
        <>
          <Spinner data-icon="inline-start" /> Sending…
        </>
      ) : eligible === 0 ? (
        'Everyone was reminded recently'
      ) : (
        <>
          <BellRing data-icon="inline-start" /> Remind everyone ({eligible})
        </>
      )}
    </Button>
  )
}

// ─── Outside payments ────────────────────────────────────────────────────────

/**
 * Outside payments still waiting for their invoice, the one due first at the
 * top: payee, address, where it was paid from, amount, invoice status and due date.
 * `action`: e.g. the Admin's "Add invoice" button.
 */
export function InvoicesPendingList({
  items,
  now,
  action,
  limit,
  showAddress = true,
  empty,
  className,
}: {
  /** From `outsidePaymentsWithoutProof(state, agencyId, now)` (or `agencyAccountability(...).withoutProof`). */
  items: ProofStanding[]
  now: ISODate
  action?: (payment: Payment) => React.ReactNode
  limit?: number
  /** The short address with a copy button (full address on hover and in the copy). */
  showAddress?: boolean
  empty?: React.ReactNode
  className?: string
}) {
  const { state } = useViatikState()
  const [showAll, setShowAll] = React.useState(false)
  if (items.length === 0) {
    return (
      empty ?? (
        <EmptyState
          compact
          icon={<FileCheck2 />}
          title="Every invoice is in"
          description="Payments made outside Viatik show here until their invoice is attached."
        />
      )
    )
  }
  const cap = limit ?? items.length
  const shown = showAll ? items : items.slice(0, cap)
  return (
    <div className={cn('@container flex flex-col', className)}>
      <ul className="flex flex-col">
        {shown.map(({ payment, dueAt, overdue }) => {
          const payee = payeeOf(payment)
          const rendered = action?.(payment)
          return (
            <li
              key={payment.id}
              className="flex flex-col gap-2.5 border-t border-border py-3.5 first:border-t-0 @2xl:flex-row @2xl:items-center @2xl:gap-4"
            >
              <span className="flex min-w-0 flex-1 items-start gap-3">
                <OrgAvatar name={payee} size="md" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{payee}</span>
                  {showAddress ? <PayeeAddress address={addressOf(payment)} short /> : null}
                  <span className="text-xs text-pretty text-subtle">
                    Paid {formatLocalDate(paidAt(payment), { withYear: false })} from{' '}
                    {paidFrom(state, payment)}
                    {payment.memo ? ` · ${payment.memo}` : ''}
                  </span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 @2xl:justify-end">
                <Amount value={payment.amount} size="sm" />
                <StatusBadge status={proofStatus[proofState(payment, overdue)]} />
                <span className={cn('text-xs', overdue ? 'text-danger' : 'text-subtle')}>
                  {instantDueLabel(dueAt, now, overdue)}
                </span>
                {rendered}
              </span>
            </li>
          )
        })}
      </ul>
      <ShowMore shown={cap} total={items.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
    </div>
  )
}

/**
 * Every payment made outside Viatik: date, payee, the full address with a copy
 * button, where it was paid from, amount and invoice status (the invoice opens
 * when attached). The shield button opens the operation's verified receipt.
 * Non-outside payments in `payments` are ignored.
 * `action`: e.g. the Admin's "Add invoice" button for rows without one, shown
 * under the invoice status (no column of its own, so the table fits at 1280 px).
 */
export function OutsidePaymentsTable({
  payments,
  now,
  action,
  pageSize = 10,
  toolbar,
  empty,
}: {
  payments: Payment[]
  now: ISODate
  action?: (payment: Payment) => React.ReactNode
  pageSize?: number
  toolbar?: React.ReactNode
  empty?: React.ReactNode
}) {
  const { state } = useViatikState()
  const receipts = useReceiptDrawer()
  const rows = React.useMemo(
    () => payments.filter(isOutsidePayment).sort((a, b) => Date.parse(paidAt(b)) - Date.parse(paidAt(a))),
    [payments],
  )
  // Stable, so the table does not refilter on every render.
  const facets = React.useMemo<Facet<Payment>[]>(
    () => [
      {
        id: 'invoice',
        label: 'Invoice',
        options: [
          { value: 'missing', label: 'Invoice pending' },
          { value: 'overdue', label: 'Invoice overdue' },
          { value: 'attached', label: 'Invoice attached' },
        ],
        accessor: (p) => invoiceStanding(p, now).state,
      },
    ],
    [now],
  )

  const details = (p: Payment) => {
    const receipt = receiptFor(state, p.receiptId)
    return receipt ? (
      <button
        type="button"
        aria-label={`View verified details of the payment to ${payeeOf(p)}`}
        onClick={() => receipts.show(receipt)}
        className="inline-flex size-8 items-center justify-center rounded-full text-subtle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ShieldCheck className="size-4" />
      </button>
    ) : null
  }
  // The invoice status, then the file or its due date, then the row's `action` (e.g. "Add invoice"):
  // in this cell rather than a column of its own, so the table fits a 1280 px screen.
  const invoice = (p: Payment, rendered?: React.ReactNode) => {
    const standing = invoiceStanding(p, now)
    return (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge status={proofStatus[standing.state]} />
        {p.proof ? (
          <OpenFileButton evidence={p.proof} className="max-w-40 text-xs text-muted-foreground" />
        ) : (
          <span className={cn('text-xs', standing.overdue ? 'text-danger' : 'text-subtle')}>
            {instantDueLabel(standing.dueAt, now, standing.overdue)}
          </span>
        )}
        {rendered ? <span className="mt-1 flex flex-wrap items-center gap-2">{rendered}</span> : null}
      </span>
    )
  }

  const columns: ColumnDef<Payment, unknown>[] = [
    {
      id: 'date',
      header: 'Date',
      accessorFn: (p) => paidAt(p),
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatLocalDate(paidAt(row.original))}
        </span>
      ),
    },
    {
      id: 'payee',
      header: 'Payee',
      cell: ({ row }) => (
        <span className="flex max-w-48 min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{payeeOf(row.original)}</span>
          <span className="truncate text-xs text-subtle">
            {row.original.memo} · {categoryLabel[row.original.category]}
          </span>
        </span>
      ),
    },
    {
      id: 'address',
      header: 'Address',
      cell: ({ row }) => (
        // A fixed width: the address wraps over two lines instead of squeezing to one character per line.
        <span className="block w-48">
          <PayeeAddress address={addressOf(row.original)} />
        </span>
      ),
    },
    {
      id: 'from',
      header: 'Paid from',
      cell: ({ row }) => (
        // "Operations · Tools budget" wraps rather than widening the table.
        <span className="block max-w-36 text-sm text-pretty whitespace-normal text-muted-foreground">
          {paidFrom(state, row.original)}
        </span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.amount} size="sm" />,
    },
    { id: 'invoice', header: 'Invoice', cell: ({ row }) => invoice(row.original, action?.(row.original)) },
    {
      id: 'details',
      header: () => <span className="sr-only">Verified details</span>,
      meta: { align: 'right' },
      cell: ({ row }) => details(row.original),
    },
  ]

  return (
    <>
      <DataTable
        data={rows}
        columns={columns}
        pageSize={pageSize}
        facets={facets}
        toolbar={toolbar}
        caption="Payments made outside Viatik"
        searchPlaceholder="Search outside payments"
        searchText={(p) =>
          `${payeeOf(p)} ${p.memo} ${addressOf(p) ?? ''} ${paidFrom(state, p)} ${categoryLabel[p.category]}`
        }
        initialSorting={[{ id: 'date', desc: true }]}
        empty={
          empty ?? (
            <EmptyState
              compact
              icon={<ReceiptText />}
              title="Nothing paid outside Viatik"
              description="Payments an Agency Admin makes to an address outside Viatik show here, with their invoice."
            />
          )
        }
        renderMobile={(p) => {
          const rendered = action?.(p)
          return (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{payeeOf(p)}</span>
                    <Tag className="shrink-0">Outside Viatik</Tag>
                  </span>
                  <span className="truncate text-xs text-subtle">
                    {formatLocalDate(paidAt(p))} · {paidFrom(state, p)}
                  </span>
                </span>
                <Amount value={p.amount} size="sm" />
              </div>
              <PayeeAddress address={addressOf(p)} />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {invoice(p)}
                <span className="flex items-center gap-1">
                  {rendered}
                  {details(p)}
                </span>
              </div>
            </div>
          )
        }}
      />
      {receipts.drawer}
    </>
  )
}

// ─── Capital returned ────────────────────────────────────────────────────────

/**
 * Money an Agency Admin sent back from an Agency account to the Investor's
 * Portfolio Vault, newest first: the note, from → to, the agreement it counts
 * in, date and amount. A row opens its verified receipt. The total is
 * `returnedCapital(state, { agencyId })`.
 */
export function ReturnsList({
  agencyId,
  limit,
  empty,
  className,
}: {
  agencyId: Id
  limit?: number
  empty?: React.ReactNode
  className?: string
}) {
  const { state } = useViatikState()
  const receipts = useReceiptDrawer()
  const [showAll, setShowAll] = React.useState(false)
  const returns = state.movements
    .filter((m) => m.kind === 'capital_return' && m.agencyId === agencyId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const portfolio = state.portfolios.find((p) => p.id === returns[0]?.portfolioId)

  if (returns.length === 0) {
    return (
      empty ?? (
        <EmptyState
          compact
          icon={<Undo2 />}
          title="Nothing returned yet"
          description="Money an Agency Admin sends back to the Portfolio Vault shows here."
        />
      )
    )
  }
  const cap = limit ?? returns.length
  const shown = showAll ? returns : returns.slice(0, cap)
  return (
    <div className={cn('flex flex-col', className)}>
      <ul className="flex flex-col">
        {shown.map((movement) => {
          const receipt = receiptFor(state, movement.receiptId)
          const from =
            movement.from.kind === 'account' ? accountName(state, movement.from.accountId) : 'Agency'
          const to = receipt?.toLabel ?? `${portfolio?.name ?? 'Portfolio'} · Portfolio Vault`
          const agreement = state.agreements.find((a) => a.id === movement.agreementId)
          const content = (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                <Undo2 className="size-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium underline-offset-4 group-hover:underline">
                  {receipt?.description ?? 'Capital returned'}
                </span>
                <span className="text-xs text-pretty text-subtle">
                  {from} → {to} · {formatLocalDate(movement.createdAt, { withYear: false })}
                  {agreement ? ` · counted in “${agreement.title}”` : ''}
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
      <ShowMore shown={cap} total={returns.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
      {receipts.drawer}
    </div>
  )
}

// ─── Monthly payments (reminders) ────────────────────────────────────────────

/** A monthly payment as lists show it: active ones carry their next due date, paused ones none. */
export type RecurringEntry = { reminder: Reminder; due?: ReminderDue }

/**
 * An Agency's monthly payments: active ones by next due date (from
 * `remindersDue`), then paused ones (`includePaused`). Archived ones are final
 * and never listed. `dueOnly` keeps only the active ones due now (due today or
 * overdue, `isMonthlyDueNow`); paused ones are never due, so it leaves them out.
 */
export function recurringEntries(
  state: ViatikState,
  agencyId: Id,
  now: ISODate,
  { includePaused = true, dueOnly = false }: { includePaused?: boolean; dueOnly?: boolean } = {},
): RecurringEntry[] {
  const active = remindersDue(state, agencyId, now)
    .filter((due) => !dueOnly || isMonthlyDueNow(due, now))
    .map((due) => ({ reminder: due.reminder, due }))
  const paused =
    includePaused && !dueOnly
      ? state.reminders
          .filter((r) => r.agencyId === agencyId && r.status === 'paused')
          .sort((a, b) => a.title.localeCompare(b.title))
          .map((reminder) => ({ reminder }))
      : []
  return [...active, ...paused]
}

/**
 * Monthly payments made outside Viatik: title, payee, usual amount, the day
 * it is due, the next due date (red only once the due day has passed) and the
 * last payment with its invoice status. Read-only; `action` adds e.g. "Pay now"
 * and a menu for the Admin.
 */
export function RecurringPaymentsList({
  entries,
  now,
  action,
  limit,
  empty,
  className,
}: {
  /** From `recurringEntries(state, agencyId, now)`. */
  entries: RecurringEntry[]
  now: ISODate
  action?: (entry: RecurringEntry) => React.ReactNode
  limit?: number
  empty?: React.ReactNode
  className?: string
}) {
  const [showAll, setShowAll] = React.useState(false)
  if (entries.length === 0) {
    return (
      empty ?? (
        <EmptyState
          compact
          icon={<CalendarClock />}
          title="No monthly payments"
          description="Tools and subscriptions paid outside Viatik every month show here, with when each is due."
        />
      )
    )
  }
  const cap = limit ?? entries.length
  const shown = showAll ? entries : entries.slice(0, cap)
  return (
    <div className={cn('@container flex flex-col', className)}>
      <ul className="flex flex-col">
        {shown.map((entry) => {
          const { reminder, due } = entry
          const last = due?.lastPayment
          const rendered = action?.(entry)
          return (
            <li
              key={reminder.id}
              className="flex flex-col gap-2.5 border-t border-border py-3.5 first:border-t-0 @2xl:flex-row @2xl:items-center @2xl:gap-4"
            >
              <span className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                  <CalendarClock className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-foreground">{reminder.title}</span>
                  <span className="text-xs text-pretty text-subtle">
                    {reminder.payee} · {categoryLabel[reminder.category]} · day {reminder.dayOfMonth} of each
                    month
                  </span>
                  {last ? (
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
                      Last paid {formatLocalDate(paidAt(last), { withYear: false })} ·{' '}
                      {formatUsd(last.amount)}
                      <StatusBadge status={proofStatus[invoiceStanding(last, now).state]} />
                    </span>
                  ) : due ? (
                    <span className="text-xs text-subtle">Not paid yet</span>
                  ) : null}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 @2xl:justify-end">
                {reminder.amount !== undefined ? (
                  <span className="flex items-baseline gap-1">
                    <span className="text-xs text-subtle">About</span>
                    <Amount value={reminder.amount} size="sm" />
                  </span>
                ) : (
                  <span className="text-xs text-subtle">Amount varies</span>
                )}
                {due ? (
                  <>
                    <span className="text-xs text-subtle">Due {formatShortDate(due.dueAt)}</span>
                    <DueBadge dueAt={due.dueAt} now={now} overdue={isMonthlyOverdue(due, now)} />
                  </>
                ) : (
                  <StatusBadge status={reminderStatus[reminder.status]} />
                )}
                {rendered}
              </span>
            </li>
          )
        })}
      </ul>
      <ShowMore shown={cap} total={entries.length} open={showAll} onToggle={() => setShowAll((v) => !v)} />
    </div>
  )
}

// ─── KPIs ────────────────────────────────────────────────────────────────────

/**
 * Four tiles for an Agency's accountability: paid outside Viatik, invoices
 * pending, still to justify and returned to the Investor. `viewer` words the
 * last tile: "Returned to you" for the Investor, "Returned to the Investor" for
 * the Agency Admin.
 */
export function AccountabilityKpis({
  agencyId,
  viewer = 'investor',
  className,
}: {
  agencyId: Id
  viewer?: 'investor' | 'agency'
  className?: string
}) {
  const { state, now } = useViatikState()
  const acc = agencyAccountability(state, agencyId, now)
  const outside = state.payments.filter(
    (p) => p.agencyId === agencyId && isOutsidePayment(p) && p.status === 'completed',
  )
  const returns = state.movements.filter((m) => m.kind === 'capital_return' && m.agencyId === agencyId)
  const returned = returnedCapital(state, { agencyId })
  const owing = accountabilityByPerson(state, agencyId, now).filter((p) => p.pending > 0).length
  return (
    <HairlineGrid className={cn('grid-cols-2 lg:grid-cols-4', className)}>
      <KpiTile
        label="Paid outside Viatik"
        value={sum(outside, (p) => p.amount)}
        hint={outside.length > 0 ? pluralize(outside.length, 'payment') : 'No payments yet'}
      />
      <KpiTile
        label="Invoices pending"
        value={<span className="font-display text-2xl leading-none num">{acc.withoutProof.length}</span>}
        hint={
          acc.withoutProof.length === 0
            ? 'Every invoice is in'
            : acc.proofOverdue > 0
              ? `${acc.proofOverdue} overdue`
              : `Due within ${PROOF_WITHIN_DAYS} days of paying`
        }
      />
      <KpiTile
        label="Still to justify"
        value={acc.pending}
        hint={
          acc.overdue > 0
            ? `${formatUsd(acc.overdue)} overdue · ${pluralize(acc.peopleOverdue, 'person', 'people')}`
            : owing > 0
              ? `${pluralize(owing, 'person', 'people')} · nothing overdue`
              : 'Nothing to justify'
        }
      />
      <KpiTile
        label={viewer === 'investor' ? 'Returned to you' : 'Returned to the Investor'}
        value={returned}
        hint={returns.length > 0 ? pluralize(returns.length, 'return') : 'Nothing returned yet'}
      />
    </HairlineGrid>
  )
}

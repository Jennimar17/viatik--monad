'use client'

import {
  CalendarClock,
  CalendarX2,
  CircleAlert,
  Info,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Send,
  Timer,
  XCircle,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { ButtonLink } from '@/components/app/button-link'
import { PillInput } from '@/components/app/form-controls'
import { receiptHref } from '@/components/app/nav'
import { useHref, usePermissions } from '@/components/app/role-context'
import { useSigningSteps } from '@/components/app/signing-steps'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { SectionLabel } from '@/components/viatik/layout'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useSubject, useViatikState } from '@/data/react'
import { keeperSummary, useRunDuePayments } from '@/data/use-keeper'
import { scheduleCadenceLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { accountName, budgetName, destinationName, recipientName, userName } from '@/domain/queries'
import {
  actsAsInvestor,
  automaticRunsOn,
  firstRunProblem,
  isUnscheduledPayment,
  keeperStatusFor,
  SCHEDULE_QUICK_MINUTES,
  scheduleActions,
  schedulesOf,
  scheduleState,
  type ScheduleState,
} from '@/domain/schedules'
import { scheduleStatus } from '@/domain/status'
import type { Id, ISODate, KeeperRun, Payment, Schedule, ViatikState } from '@/domain/types'
import { formatDate, formatRelative } from '@/lib/format'
import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
  fromLocalInputs,
  localTimeZone,
  toLocalInputs,
} from '@/lib/local-time'
import { cn } from '@/lib/utils'

/**
 * Scheduled payments on screen: the "When to pay" field of Send payment and
 * Pay bill (a date and time on the person's own clock, or "In 5 minutes"),
 * the list of an Agency's schedules with Pause, Resume and Cancel (each a
 * review sheet with its signing steps, gated by `scheduleActions`), the
 * Admin's "Run due payments" and what the keeper last did.
 *
 * Product language: once the timer runs (an automatic pass ran recently,
 * `automaticRunsOn`), Viatik pays a scheduled payment "within about 10
 * minutes" of its time, only if the money is there then. Until it does (and in
 * the demo, where nothing runs on a timer) a due payment is paid when an Agency
 * Admin presses Run due payments, and screens say so (`usePayTiming`). The
 * keeper is never named. Times show on the viewer's clock, with the zone where
 * a person chooses one.
 */

/** How promptly a due payment is paid when the timer runs (every 10 minutes). */
const PAID_WITHIN = 'within about 10 minutes'

const MINUTE_MS = 60_000

/**
 * How due scheduled payments are paid here:
 * - automatic: the timer runs (an automatic pass ran recently): within about 10 minutes of their time;
 * - manual: no timer has run (yet, or for hours): when an Agency Admin presses Run due payments;
 * - demo: this browser's demo, where nothing runs on a timer (screens add "In this demo").
 */
export type PayTiming = 'automatic' | 'manual' | 'demo'

/** The viewer's `PayTiming`, from the keeper's last automatic pass on their state. */
export function usePayTiming(now?: ISODate): PayTiming {
  const { state, mode, now: loadedAt } = useViatikState()
  if (mode === 'demo') return 'demo'
  return automaticRunsOn(state, now ?? loadedAt) ? 'automatic' : 'manual'
}

/**
 * How a scheduled payment is paid once `time` comes, as a sentence without its
 * period: "Viatik pays it within about 10 minutes of that time", or "Once that
 * time comes, it is paid when an Agency Admin presses Run due payments".
 */
export function paidAtText(timing: PayTiming, time = 'that time'): string {
  return timing === 'automatic'
    ? `Viatik pays it ${PAID_WITHIN} of ${time}`
    : `Once ${time} comes, it is paid when an Agency Admin presses Run due payments`
}

/** When a payment that is already due is paid: "within about 10 minutes", or "the next time due payments run". */
export function paidWhenDueText(timing: PayTiming): string {
  return timing === 'automatic' ? PAID_WITHIN : 'the next time due payments run'
}

/** What happens to a due run that could not be paid, as a sentence. */
export function triedAgainText(timing: PayTiming): string {
  return timing === 'automatic'
    ? 'Viatik tries again about every 10 minutes.'
    : 'It is tried again each time due payments run.'
}

/** The time on the viewer's clock, read again every `intervalMs`, so "due" and "In 5 minutes" stay true. */
export function useClock(intervalMs = 15_000): ISODate {
  const [now, setNow] = React.useState(() => new Date().toISOString())
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date().toISOString()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

// ─── When to pay ─────────────────────────────────────────────────────────────

/** "Pay now", or "Schedule" at a date and time (`at`) or in a few minutes (`quick`). */
export type WhenChoice = { mode: 'now' | 'schedule'; how: 'at' | 'quick'; date: string; time: string }

export const PAY_NOW: WhenChoice = { mode: 'now', how: 'at', date: '', time: '' }

/** A first run "In 5 minutes" from `fromMs`, on a whole minute (so it reads "3:47 PM"). */
export function quickRunAt(fromMs: number): ISODate {
  return new Date(
    Math.ceil((fromMs + SCHEDULE_QUICK_MINUTES * MINUTE_MS) / MINUTE_MS) * MINUTE_MS,
  ).toISOString()
}

/** Tomorrow at 9:00 on the viewer's clock, or `suggested` when it is still ahead: where a new schedule starts. */
function defaultSlot(now: ISODate, suggested?: ISODate): { date: string; time: string } {
  if (suggested && Date.parse(suggested) > Date.parse(now) + 30 * MINUTE_MS) {
    return { date: toLocalInputs(suggested).date, time: '09:00' }
  }
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return { date: toLocalInputs(tomorrow.toISOString()).date, time: '09:00' }
}

/** A choice to schedule, starting at `at` (on the viewer's clock) or tomorrow at 9:00. */
export function scheduleChoice(now: ISODate, at?: ISODate): WhenChoice {
  return { mode: 'schedule', how: 'at', ...defaultSlot(now, at) }
}

export type ResolvedWhen =
  | { scheduled: false }
  | {
      scheduled: true
      /** The first run, when the choice names a valid one. */
      at?: ISODate
      error?: string
      quick: boolean
    }

/** What a choice means at `now`: pay now, or the first run it names (with why it cannot be used). */
export function resolveWhen(choice: WhenChoice, now: ISODate): ResolvedWhen {
  if (choice.mode === 'now') return { scheduled: false }
  if (choice.how === 'quick') return { scheduled: true, at: quickRunAt(Date.parse(now)), quick: true }
  const at = fromLocalInputs(choice.date, choice.time)
  if (!at) return { scheduled: true, error: 'Choose a date and a time.', quick: false }
  const problem = firstRunProblem(at, now)
  return problem ? { scheduled: true, error: problem, quick: false } : { scheduled: true, at, quick: false }
}

/** The first run to send when the person confirms: "In 5 minutes" counts from the click. */
export function firstRunFor(resolved: ResolvedWhen): ISODate | undefined {
  if (!resolved.scheduled) return undefined
  return resolved.quick ? quickRunAt(Date.now()) : resolved.at
}

/** "Mon, Oct 12, 2026, 9:00 AM GMT-5", or "In 5 minutes (about 3:47 PM)". */
export function whenText(resolved: ResolvedWhen): string {
  if (!resolved.scheduled || !resolved.at) return 'now'
  return resolved.quick
    ? `in ${SCHEDULE_QUICK_MINUTES} minutes (about ${formatLocalTime(resolved.at)})`
    : `on ${formatLocalDateTime(resolved.at, { withWeekday: true, withYear: true, withZone: true })}`
}

const pill = (active: boolean) =>
  cn(
    'flex h-11 items-center justify-center gap-2 rounded-full border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    active ? 'border-mist bg-mist/10 text-foreground' : 'border-border text-muted-foreground hover:bg-muted',
  )

const chip = (active: boolean) =>
  cn(
    'h-9 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    active
      ? 'border-mist bg-mist/10 text-foreground'
      : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
  )

/**
 * Pay now or schedule: a date and a time on the person's own clock (their
 * time zone is named), or "In 5 minutes" for a quick demo. The money has to be
 * there today as well: the form's own checks block scheduling without it.
 */
export function WhenToPayField({
  id,
  value,
  onChange,
  now,
  suggested,
  error,
  disabled,
}: {
  id: string
  value: WhenChoice
  onChange: (value: WhenChoice) => void
  /** The ticking clock (`useClock`). */
  now: ISODate
  /** Where a new schedule starts when its date is still ahead, e.g. a bill's due date. */
  suggested?: ISODate
  /** Why the chosen time cannot be used (`resolveWhen`), shown once the person tried. */
  error?: string
  disabled?: boolean
}) {
  const scheduling = value.mode === 'schedule'
  const today = toLocalInputs(now).date
  const zone = localTimeZone()
  const resolved = resolveWhen(value, now)
  const timing = usePayTiming(now)
  const choose = (mode: WhenChoice['mode']) => {
    if (mode === value.mode) return
    if (mode === 'now') onChange({ ...value, mode })
    else onChange(value.date ? { ...value, mode } : { ...scheduleChoice(now, suggested), how: value.how })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="When to pay">
        {(['now', 'schedule'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={value.mode === mode}
            disabled={disabled}
            onClick={() => choose(mode)}
            className={pill(value.mode === mode)}
          >
            {mode === 'now' ? (
              <Send className="size-4" aria-hidden="true" />
            ) : (
              <CalendarClock className="size-4" aria-hidden="true" />
            )}
            {mode === 'now' ? 'Pay now' : 'Schedule'}
          </button>
        ))}
      </div>
      {scheduling ? (
        <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Schedule it for">
            <button
              type="button"
              role="radio"
              aria-checked={value.how === 'at'}
              disabled={disabled}
              onClick={() => onChange({ ...value, how: 'at' })}
              className={chip(value.how === 'at')}
            >
              A date and time
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={value.how === 'quick'}
              disabled={disabled}
              onClick={() => onChange({ ...value, how: 'quick' })}
              className={cn(chip(value.how === 'quick'), 'inline-flex items-center gap-1.5')}
            >
              <Timer className="size-3.5" aria-hidden="true" /> In {SCHEDULE_QUICK_MINUTES} minutes
            </button>
          </div>
          {value.how === 'at' ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor={`${id}-date`} className="text-sm font-medium">
                  Date
                </label>
                <PillInput
                  id={`${id}-date`}
                  type="date"
                  value={value.date}
                  min={today}
                  disabled={disabled}
                  aria-invalid={Boolean(error) || undefined}
                  onChange={(event) => onChange({ ...value, date: event.target.value })}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-2">
                <label htmlFor={`${id}-time`} className="text-sm font-medium">
                  Time
                </label>
                <PillInput
                  id={`${id}-time`}
                  type="time"
                  value={value.time}
                  disabled={disabled}
                  aria-invalid={Boolean(error) || undefined}
                  onChange={(event) => onChange({ ...value, time: event.target.value })}
                />
              </div>
            </div>
          ) : resolved.scheduled && resolved.at ? (
            <p className="text-sm text-pretty text-foreground">
              Scheduled for about {formatLocalTime(resolved.at)}: {SCHEDULE_QUICK_MINUTES} minutes from when
              you confirm it.
            </p>
          ) : null}
          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <p className="flex gap-2 text-xs text-pretty text-subtle">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Times are on this device’s clock ({zone.replace(/_/g, ' ')}). {paidAtText(timing)}, if the money
              is still there.
              {timing === 'demo' ? ' In this demo nothing runs on a timer.' : ''} You can pause or cancel it
              until then.
            </span>
          </p>
        </div>
      ) : null}
    </div>
  )
}

// ─── Reading a schedule ──────────────────────────────────────────────────────

/** "Operations" or "Operations · Tools budget": where a scheduled payment pays from. */
export function scheduleSourceLabel(
  state: ViatikState,
  schedule: Pick<Schedule, 'sourceAccountId' | 'budgetId'>,
) {
  const account = accountName(state, schedule.sourceAccountId)
  return schedule.budgetId ? `${account} · ${budgetName(state, schedule.budgetId)}` : account
}

/** Who a scheduled payment pays, by name. */
export function scheduleRecipientLabel(state: ViatikState, schedule: Pick<Schedule, 'recipient'>) {
  return schedule.recipient.kind === 'destination'
    ? destinationName(state, schedule.recipient.destinationId)
    : recipientName(state, schedule.recipient)
}

/** The schedule that pays a bill now (scheduled), if the viewer can see it. */
export function billSchedule(state: ViatikState, bill: { scheduleId?: Id; status: string }) {
  return bill.status === 'scheduled' && bill.scheduleId
    ? state.schedules.find((s) => s.id === bill.scheduleId)
    : undefined
}

/** The time a schedule shows: its next run, or when it ended. */
function shownTime(schedule: Schedule, shown: ScheduleState): string {
  if (shown === 'completed') return `Paid ${formatLocalDateTime(schedule.completedAt ?? schedule.nextRunAt)}`
  if (shown === 'cancelled') return `Was due ${formatLocalDateTime(schedule.nextRunAt)}`
  return formatLocalDateTime(schedule.nextRunAt)
}

/** The line that says what happens next, or what stops it, under a schedule. */
function ScheduleNote({
  schedule,
  shown,
  now,
  demo,
  canRun,
}: {
  schedule: Schedule
  shown: ScheduleState
  now: ISODate
  demo: boolean
  canRun: boolean
}) {
  const { state, userId } = useViatikState()
  const subject = useSubject()
  const timing = usePayTiming(now)
  const name = (id: Id | undefined) => (id === userId ? 'you' : userName(state, id))
  const source = scheduleSourceLabel(state, schedule)

  if (shown === 'needs_attention' && schedule.failure) {
    const fix =
      schedule.failure.code === 'insufficient_funds'
        ? `Add money to ${source}, or pause or cancel it.`
        : 'Fix what stops it, or pause or cancel it.'
    return (
      <p className="flex gap-2 rounded-lg border border-danger/35 bg-danger-soft p-3 text-sm text-pretty text-foreground">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <span>
          Could not be paid {formatRelative(schedule.failure.at, now)}: {schedule.failure.message}{' '}
          {demo ? 'In this demo it is tried again each time due payments run.' : triedAgainText(timing)} {fix}
        </span>
      </p>
    )
  }
  if (shown === 'stopped') {
    return (
      <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty text-foreground">
        <CalendarX2 className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>
          {userName(state, schedule.createdBy)}, who scheduled it, is no longer an Agency Admin, so it will
          not be paid.{' '}
          {canRun
            ? 'Cancel it, and schedule it again if it is still needed.'
            : 'Cancel it; an Agency Admin can schedule it again if it is still needed.'}
        </span>
      </p>
    )
  }
  if (shown === 'paused') {
    const actions = scheduleActions(state, subject, schedule)
    const byInvestor = schedule.pausedByInvestor === true
    return (
      <p className="flex gap-2 text-xs text-pretty text-subtle">
        <PauseCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Paused{schedule.pausedBy ? ` by ${name(schedule.pausedBy)}` : ''}
          {byInvestor ? ' (the Investor)' : ''}
          {schedule.pausedAt ? ` ${formatRelative(schedule.pausedAt, now)}` : ''}. Nothing is paid while it is
          paused
          {schedule.intervalSeconds === 0 && schedule.runs <= 1
            ? '; if its time passes, it is paid as soon as it resumes.'
            : '; dates that pass meanwhile are skipped, not paid.'}
          {actions.resumeBlocked ? ` ${actions.resumeBlocked}` : ''}
        </span>
      </p>
    )
  }
  if (shown === 'due') {
    return (
      <p className="flex gap-2 text-xs text-pretty text-subtle">
        <Timer className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Due since {formatLocalTime(schedule.nextRunAt)}.{' '}
          {timing === 'automatic'
            ? `Viatik pays it ${PAID_WITHIN} of its time.`
            : `${demo ? 'In this demo nothing runs on a timer: ' : ''}${
                canRun
                  ? `${demo ? 'press' : 'Press'} Run due payments to pay it.`
                  : `${demo ? 'it' : 'It'} is paid when an Agency Admin runs due payments.`
              }`}
        </span>
      </p>
    )
  }
  if (shown === 'cancelled' && schedule.cancelledBy) {
    return (
      <p className="text-xs text-subtle">
        Cancelled by {name(schedule.cancelledBy)}
        {schedule.cancelledAt ? ` on ${formatLocalDate(schedule.cancelledAt)}` : ''}. Nothing was paid
        {schedule.paymentIds.length > 0 ? ' after that' : ''}.
      </p>
    )
  }
  return null
}

export type ScheduleAction = 'pause' | 'resume' | 'cancel'

/**
 * One Pause / Resume / Cancel sheet for a screen: `act` opens it for a
 * schedule, `sheet` renders it. Keep it above lists that a change moves a
 * schedule out of (a paused one leaves "Upcoming"), so its success stays.
 */
export function useScheduleActionSheet(now: ISODate) {
  // Kept while the sheet closes, so it does not go blank.
  const [acting, setActing] = React.useState<{ id: Id; action: ScheduleAction } | null>(null)
  const [open, setOpen] = React.useState(false)
  const act = React.useCallback((id: Id, action: ScheduleAction) => {
    setActing({ id, action })
    setOpen(true)
  }, [])
  const sheet = (
    <ScheduleActionSheet
      scheduleId={acting?.id ?? null}
      action={acting?.action ?? 'pause'}
      now={now}
      open={open}
      onOpenChange={setOpen}
      onClosed={() => setActing(null)}
    />
  )
  return { act, sheet }
}

/**
 * Schedules as rows: who it pays and what for, where from, how often and who
 * scheduled it; the amount, the next run on the viewer's clock and its state
 * badge; what stops it or happens next; and Pause, Resume or Cancel for whoever
 * may (`scheduleActions`: the Agency's Admins and its Investor), each opening a
 * review sheet (its own, or the screen's through `onAction`). `manage={false}`
 * keeps the list read-only.
 */
export function ScheduleList({
  schedules,
  now,
  manage = true,
  links = true,
  onAction,
  className,
}: {
  schedules: Schedule[]
  /** The ticking clock (`useClock`), so a schedule turns "Due" on time. */
  now: ISODate
  manage?: boolean
  /** Offer "Open bill" and "Schedule again" (Agency Admins only). */
  links?: boolean
  /** The screen's sheet (`useScheduleActionSheet`), when the list itself may unmount after a change. */
  onAction?: (scheduleId: Id, action: ScheduleAction) => void
  className?: string
}) {
  const { state, mode } = useViatikState()
  const subject = useSubject()
  const href = useHref()
  const { can } = usePermissions()
  const own = useScheduleActionSheet(now)
  const demo = mode === 'demo'

  return (
    <>
      <ul className={cn('@container flex flex-col', className)}>
        {schedules.map((schedule) => {
          const shown = scheduleState(state, schedule, now)
          const actions = manage
            ? scheduleActions(state, subject, schedule)
            : { pause: false, resume: false, cancel: false }
          const admin = can('send_payment', { agencyId: schedule.agencyId })
          const lastPayment = schedule.paymentIds.at(-1)
          const receiptId = state.payments.find((p) => p.id === lastPayment)?.receiptId
          const bill = schedule.billId ? state.bills.find((b) => b.id === schedule.billId) : undefined
          const recipient = scheduleRecipientLabel(state, schedule)
          const act = (action: ScheduleAction) => (onAction ?? own.act)(schedule.id, action)
          return (
            <li
              key={schedule.id}
              className="flex flex-col gap-2.5 border-t border-border py-3.5 first:border-t-0"
            >
              <div className="flex flex-col gap-2.5 @2xl:flex-row @2xl:items-center @2xl:gap-4">
                <span className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                    <CalendarClock className="size-4" aria-hidden="true" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{recipient}</span>
                      {bill ? <Tag className="shrink-0">Bill {bill.number}</Tag> : null}
                    </span>
                    <span className="text-xs text-pretty text-subtle">
                      {schedule.memo} · from {scheduleSourceLabel(state, schedule)}
                    </span>
                    <span className="text-xs text-pretty text-subtle">
                      {scheduleCadenceLabel(schedule)} · scheduled by {userName(state, schedule.createdBy)} on{' '}
                      {formatLocalDate(schedule.createdAt)}
                    </span>
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 @2xl:justify-end">
                  <Amount value={schedule.amount} size="sm" />
                  <span className="text-xs text-subtle">{shownTime(schedule, shown)}</span>
                  <StatusBadge status={scheduleStatus[shown]} pulse={shown === 'due'} />
                  {receiptId ? (
                    <ButtonLink href={receiptHref(receiptId)} variant="ghost" size="pill-sm">
                      View receipt
                    </ButtonLink>
                  ) : null}
                  {links && admin && bill ? (
                    <ButtonLink href={href(`bills/${bill.id}`)} variant="ghost" size="pill-sm">
                      Open bill
                    </ButtonLink>
                  ) : null}
                  {links && admin && !bill && shown === 'cancelled' ? (
                    <ButtonLink
                      href={href(`payments/new?again=${schedule.id}`)}
                      variant="ghost"
                      size="pill-sm"
                    >
                      Schedule again
                    </ButtonLink>
                  ) : null}
                  {actions.pause ? (
                    <Button variant="outline" size="pill-sm" onClick={() => act('pause')}>
                      <PauseCircle data-icon="inline-start" /> Pause
                      <span className="sr-only"> the payment to {recipient}</span>
                    </Button>
                  ) : null}
                  {actions.resume ? (
                    <Button variant="outline" size="pill-sm" onClick={() => act('resume')}>
                      <PlayCircle data-icon="inline-start" /> Resume
                      <span className="sr-only"> the payment to {recipient}</span>
                    </Button>
                  ) : null}
                  {actions.cancel ? (
                    <Button
                      variant="ghost"
                      size="pill-sm"
                      className="text-danger hover:text-danger"
                      onClick={() => act('cancel')}
                    >
                      <XCircle data-icon="inline-start" /> Cancel
                      <span className="sr-only"> the payment to {recipient}</span>
                    </Button>
                  ) : null}
                </span>
              </div>
              <div className="@2xl:pl-12">
                <ScheduleNote
                  schedule={schedule}
                  shown={shown}
                  now={now}
                  demo={demo}
                  canRun={can('send_payment', { agencyId: schedule.agencyId })}
                />
              </div>
            </li>
          )
        })}
      </ul>
      {manage && !onAction ? own.sheet : null}
    </>
  )
}

// ─── Pause, resume, cancel ───────────────────────────────────────────────────

const ACTION_COPY: Record<ScheduleAction, { title: string; confirm: string; done: string }> = {
  pause: { title: 'Pause scheduled payment', confirm: 'Pause payment', done: 'Scheduled payment paused' },
  resume: { title: 'Resume scheduled payment', confirm: 'Resume payment', done: 'Scheduled payment resumed' },
  cancel: {
    title: 'Cancel scheduled payment',
    confirm: 'Cancel scheduled payment',
    done: 'Scheduled payment cancelled',
  },
}

/**
 * Pause, resume or cancel one schedule: what happens, whether it can be
 * undone and who may do it, then the person signs it (Prepared → Approved →
 * done on Monad). Cancelling is final and asks with a destructive button.
 */
export function ScheduleActionSheet({
  scheduleId,
  action,
  now,
  open,
  onOpenChange,
  onClosed,
}: {
  scheduleId: Id | null
  action: ScheduleAction
  /** The ticking clock (`useClock`): whether a single run's time already passed. */
  now: ISODate
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed?: () => void
}) {
  const { state, userId } = useViatikState()
  const timing = usePayTiming(now)
  const pause = useCommand('pauseSchedule', { silent: true })
  const resume = useCommand('resumeSchedule', { silent: true })
  const cancel = useCommand('cancelSchedule', { silent: true })
  const command = action === 'pause' ? pause : action === 'resume' ? resume : cancel
  const copy = ACTION_COPY[action]
  const steps = useSigningSteps(command.phase, {
    prepared: 'Viatik checks that you may change this scheduled payment.',
    done: {
      label: action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : 'Cancelled',
      detail:
        action === 'pause'
          ? 'Recorded on Monad. Nothing is paid until it resumes.'
          : action === 'resume'
            ? timing === 'automatic'
              ? 'Recorded on Monad. Viatik pays it when it is due.'
              : 'Recorded on Monad. It is paid once it is due and due payments run.'
            : 'Recorded on Monad. It will not be paid.',
    },
  })
  // Found in every status, so the success screen stays after the change.
  const schedule = state.schedules.find((s) => s.id === scheduleId)
  if (!schedule) return null

  const recipient = scheduleRecipientLabel(state, schedule)
  const amount = formatUsd(schedule.amount, { withCode: true })
  const once = schedule.intervalSeconds === 0 || schedule.runs <= 1
  const investor = actsAsInvestor(state, userId, schedule.agencyId)
  const bill = schedule.billId ? state.bills.find((b) => b.id === schedule.billId) : undefined
  const overdue = Date.parse(schedule.nextRunAt) <= Date.parse(now)
  const at = formatLocalDateTime(schedule.nextRunAt, { withYear: true, withZone: true })
  const policy =
    'Agency Admins and the Investor can pause, resume or cancel scheduled payments. When the Investor pauses one, only the Investor resumes it.'

  const what: Record<ScheduleAction, string> = {
    pause: `${amount} to ${recipient} is not paid while it is paused.${
      once
        ? ` If ${at} passes meanwhile, it is paid as soon as it resumes.`
        : ' Dates that pass meanwhile are skipped, not paid.'
    }`,
    resume: once
      ? overdue
        ? `${amount} to ${recipient} is paid as soon as possible, ${paidWhenDueText(timing)}.`
        : timing === 'automatic'
          ? `${amount} to ${recipient} is paid on ${at}, ${PAID_WITHIN} of that time.`
          : `${amount} to ${recipient} is due on ${at}, and paid the first time due payments run after that.`
      : `${amount} to ${recipient} runs again. Dates that passed while it was paused are skipped.`,
    cancel: `${amount} to ${recipient} will not be paid.${bill ? ` Bill ${bill.number} goes back to To pay.` : ''}`,
  }
  const reversible: Record<ScheduleAction, string> = {
    pause: investor
      ? 'Only you, as the Investor, can resume it.'
      : 'You, another Agency Admin or the Investor can resume it.',
    resume: 'You can pause or cancel it again until it is paid.',
    // The Investor does not schedule payments: an Agency Admin would.
    cancel: investor
      ? 'Cannot be undone. An Agency Admin can schedule a new payment if it is still needed.'
      : 'Cannot be undone. Schedule it again if it is still needed.',
  }
  const done: Record<ScheduleAction, string> = {
    pause: `${amount} to ${recipient} is paused. Nothing is paid until it resumes.${
      investor ? ' The Agency Admins were told.' : ''
    }`,
    resume:
      schedule.status !== 'active'
        ? `${amount} to ${recipient} is scheduled again.`
        : Date.parse(schedule.nextRunAt) <= Date.parse(now) + MINUTE_MS
          ? `${amount} to ${recipient} is due now: it is paid ${paidWhenDueText(timing)}.`
          : `${amount} to ${recipient} is scheduled again for ${formatLocalDateTime(schedule.nextRunAt, { withZone: true })}.`,
    cancel: `${amount} to ${recipient} will not be paid.${bill ? ` Bill ${bill.number} is back in To pay.` : ''}`,
  }

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        pause.reset()
        resume.reset()
        cancel.reset()
        onClosed?.()
      }}
      title={copy.title}
      description={`${recipient} · ${schedule.memo}`}
      summary={{
        what: what[action],
        amount: schedule.amount,
        from: scheduleSourceLabel(state, schedule),
        to: recipient,
        reversible: reversible[action],
        policy,
      }}
      confirmLabel={copy.confirm}
      confirmVariant={action === 'cancel' ? 'destructive' : 'default'}
      disabled={
        command.phase === 'idle' &&
        (action === 'pause'
          ? schedule.status !== 'active'
          : action === 'resume'
            ? schedule.status !== 'paused'
            : schedule.status !== 'active' && schedule.status !== 'paused')
      }
      phase={command.phase}
      error={command.error}
      steps={steps}
      onConfirm={() => command.run({ scheduleId: schedule.id })}
      success={{ title: copy.done, body: done[action] }}
    >
      {timing === 'demo' ? (
        <p className="flex gap-2 rounded-lg border border-border bg-muted/50 p-3 text-sm text-pretty text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          This demo is simulated: the change is recorded, nothing real is paid or stopped.
        </p>
      ) : null}
    </ApprovalSheet>
  )
}

// ─── Run due payments, and the keeper's last pass ────────────────────────────

/** After a press that ran (the server refuses presses within 30 seconds of a run). */
const RUN_COOLDOWN_MS = 30_000
/** After a press that failed (the server rests a failed press for 15 seconds). */
const FAILED_COOLDOWN_MS = 15_000

/**
 * "Run due payments" for an Agency Admin (`send_payment`): pays the Agency's
 * due scheduled payments now and tells due monthly payments, instead of
 * waiting for the timer. A toast says what it did; it rests for a few seconds
 * after each press, one that failed included (as the server does).
 */
export function RunDuePaymentsButton({ agencyId, className }: { agencyId: Id; className?: string }) {
  const { can } = usePermissions()
  const { run, isPending, error } = useRunDuePayments(agencyId)
  const [restingMs, setRestingMs] = React.useState(0)
  const resting = restingMs > 0
  React.useEffect(() => {
    if (!restingMs) return
    const id = window.setTimeout(() => setRestingMs(0), restingMs)
    return () => window.clearTimeout(id)
  }, [restingMs])
  if (!can('send_payment', { agencyId })) return null

  return (
    <div className={cn('flex flex-col items-start gap-1.5 sm:items-end', className)}>
      <Button
        variant="outline"
        size="pill-sm"
        disabled={isPending || resting}
        title={
          resting
            ? error
              ? 'It did not run. You can try again in a few seconds.'
              : 'Just ran. You can run it again in a few seconds.'
            : undefined
        }
        onClick={async () => {
          const answer = await run()
          // An error shows under the button, and the button rests too: pressing again at once would fail the same way.
          setRestingMs(answer ? RUN_COOLDOWN_MS : FAILED_COOLDOWN_MS)
          if (!answer) return
          if (answer.status === 'busy') toast(keeperSummary(answer))
          else toast.success(keeperSummary(answer))
        }}
      >
        <RefreshCw data-icon="inline-start" className={cn(isPending && 'animate-spin')} />
        {isPending ? 'Running…' : 'Run due payments'}
      </Button>
      {error && !isPending ? (
        <p className="max-w-xs text-xs text-pretty text-danger sm:text-right" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** What one pass did, as a short sentence. */
function passSummary(run: KeeperRun): string {
  return keeperSummary({ status: 'done', ...run, recovered: 0, more: false })
}

/**
 * When Viatik last ran due payments: the timer's last pass (every 10 minutes
 * once it is set up), and the last pass that looked at this Agency when it was
 * someone's "Run due payments". In the demo nothing runs on a timer.
 */
export function KeeperStatusNote({
  agencyId,
  now,
  className,
}: {
  agencyId: Id
  now: ISODate
  className?: string
}) {
  const { state, userId } = useViatikState()
  const { can } = usePermissions()
  const timing = usePayTiming(now)
  const { lastAutomaticAt, lastRun } = keeperStatusFor(state, agencyId)
  const manual =
    lastRun?.trigger === 'manual' &&
    (!lastAutomaticAt || Date.parse(lastRun.at) > Date.parse(lastAutomaticAt))
      ? lastRun
      : undefined
  const canRun = can('send_payment', { agencyId })

  return (
    <div className={cn('flex flex-col gap-1 text-xs text-pretty text-subtle', className)}>
      <p className="flex gap-2">
        <Timer className="mt-px size-3.5 shrink-0" aria-hidden="true" />
        <span>
          {timing === 'automatic'
            ? `Viatik pays each scheduled payment ${PAID_WITHIN} of its time, if the money is there. Last automatic run ${formatRelative(lastAutomaticAt ?? now, now)}.`
            : timing === 'demo'
              ? canRun
                ? 'In this demo nothing runs on a timer: press Run due payments once a scheduled payment is due.'
                : 'In this demo scheduled payments are paid when an Agency Admin runs due payments.'
              : `Once a scheduled payment is due, it is paid when an Agency Admin presses Run due payments, if the money is there. ${
                  lastAutomaticAt
                    ? `Last automatic run ${formatRelative(lastAutomaticAt, now)}.`
                    : 'No automatic run yet.'
                }`}
        </span>
      </p>
      {manual ? (
        <p className="pl-5.5">
          Last run by {manual.by === userId ? 'you' : userName(state, manual.by)}{' '}
          {formatRelative(manual.at, now)}: {passSummary(manual)}
        </p>
      ) : null}
    </div>
  )
}

// ─── An Agency's scheduled payments ──────────────────────────────────────────

const FINISHED_SHOWN = 5

/**
 * Every scheduled payment of an Agency, grouped: needing attention (a due run
 * that could not pay, or stopped), upcoming, paused, payments saved as
 * scheduled before they ran automatically (Admins: "Schedule again" or "Dismiss"), and
 * finished ones (completed or cancelled, the latest first). Agency Admins get
 * "Run due payments"; the Investor manages them from the agency page.
 */
export function ScheduledPayments({
  agencyId,
  viewer,
  className,
}: {
  agencyId: Id
  viewer: 'agency' | 'investor'
  className?: string
}) {
  const { state } = useViatikState()
  const href = useHref()
  const { can } = usePermissions()
  const now = useClock()
  // One sheet for every section: a change moves the schedule to another section (or out of one).
  const actions = useScheduleActionSheet(now)
  const [showFinished, setShowFinished] = React.useState(false)
  const admin = viewer === 'agency' && can('send_payment', { agencyId })

  const all = schedulesOf(state, { agencyId })
  const byState = (states: ScheduleState[]) =>
    all.filter((s) => states.includes(scheduleState(state, s, now)))
  const attention = byState(['needs_attention', 'stopped'])
  const upcoming = byState(['due', 'scheduled'])
  const paused = byState(['paused'])
  const finished = byState(['completed', 'cancelled'])
  const unscheduled = admin
    ? state.payments.filter((p) => p.agencyId === agencyId && isUnscheduledPayment(p))
    : []
  const nothing = all.length === 0 && unscheduled.length === 0

  const section = (title: string, rows: Schedule[], extra?: React.ReactNode, total = rows.length) =>
    rows.length > 0 ? (
      <div className="flex flex-col gap-1">
        <SectionLabel>
          {title} · {total}
        </SectionLabel>
        <ScheduleList schedules={rows} now={now} links={viewer === 'agency'} onAction={actions.act} />
        {extra}
      </div>
    ) : null

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <KeeperStatusNote agencyId={agencyId} now={now} />
        {admin ? <RunDuePaymentsButton agencyId={agencyId} className="shrink-0" /> : null}
      </div>
      {nothing ? (
        <EmptyState
          compact
          icon={<CalendarClock />}
          title="No scheduled payments"
          description={
            viewer === 'agency'
              ? 'Schedule a payment for a later date in Send payment, or schedule a bill. Viatik pays it when it is due.'
              : 'Payments the Agency Admin schedules show here. You can pause, resume or cancel them.'
          }
          action={
            admin ? (
              <ButtonLink href={href('payments/new?when=schedule')} variant="outline" size="pill-sm">
                <CalendarClock data-icon="inline-start" /> Schedule a payment
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <>
          {section('Needs attention', attention)}
          {section('Upcoming', upcoming)}
          {section('Paused', paused)}
          {unscheduled.length > 0 ? (
            <div className="flex flex-col gap-1">
              <SectionLabel>Not scheduled · {unscheduled.length}</SectionLabel>
              <UnscheduledPayments payments={unscheduled} />
            </div>
          ) : null}
          {section(
            'Finished',
            showFinished ? finished : finished.slice(0, FINISHED_SHOWN),
            finished.length > FINISHED_SHOWN ? (
              <Button
                variant="ghost"
                size="pill-sm"
                className="mt-1 w-fit"
                aria-expanded={showFinished}
                onClick={() => setShowFinished((value) => !value)}
              >
                {showFinished ? 'Show fewer' : `Show all ${finished.length}`}
              </Button>
            ) : undefined,
            finished.length,
          )}
        </>
      )}
      {actions.sheet}
    </div>
  )
}

/**
 * Payments saved as scheduled before scheduled payments ran automatically:
 * nothing ever paid them and none was authorized for later, so they are not
 * scheduled. The Admin can schedule each one again (Send payment, filled in:
 * the new schedule replaces it) or dismiss it.
 */
export function UnscheduledPayments({ payments }: { payments: Payment[] }) {
  const { state } = useViatikState()
  const href = useHref()
  // Kept while the sheet closes (and once dismissed, when it is gone from the state).
  const [dismissing, setDismissing] = React.useState<Payment | null>(null)
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <ul className="@container flex flex-col">
        {payments.map((payment) => (
          <li
            key={payment.id}
            className="flex flex-col gap-2.5 border-t border-border py-3.5 first:border-t-0 @2xl:flex-row @2xl:items-center @2xl:gap-4"
          >
            <span className="flex min-w-0 flex-1 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
                <CalendarX2 className="size-4" aria-hidden="true" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {recipientName(state, payment.recipient)}
                </span>
                <span className="text-xs text-pretty text-subtle">
                  {payment.memo} · was meant for {formatDate(payment.scheduledFor)}. Saved before scheduled
                  payments ran automatically: it was never paid.
                </span>
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-2 @2xl:justify-end">
              <Amount value={payment.amount} size="sm" />
              <StatusBadge status={UNSCHEDULED_STATUS} />
              <ButtonLink href={href(`payments/new?again=${payment.id}`)} variant="outline" size="pill-sm">
                <CalendarClock data-icon="inline-start" /> Schedule again
              </ButtonLink>
              <Button
                variant="ghost"
                size="pill-sm"
                onClick={() => {
                  setDismissing(payment)
                  setOpen(true)
                }}
              >
                <XCircle data-icon="inline-start" /> Dismiss
                <span className="sr-only"> the payment to {recipientName(state, payment.recipient)}</span>
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <DismissUnscheduledSheet
        payment={dismissing}
        open={open}
        onOpenChange={setOpen}
        onClosed={() => setDismissing(null)}
      />
    </>
  )
}

/** Dismiss one payment saved as scheduled before schedules existed: it leaves the list, nothing is paid. */
function DismissUnscheduledSheet({
  payment,
  open,
  onOpenChange,
  onClosed,
}: {
  payment: Payment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
}) {
  const { state } = useViatikState()
  const dismiss = useCommand('dismissUnscheduledPayment', { silent: true })
  if (!payment) return null
  const recipient = recipientName(state, payment.recipient)
  const amount = formatUsd(payment.amount, { withCode: true })
  const stillThere = state.payments.some((p) => p.id === payment.id)
  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        dismiss.reset()
        onClosed()
      }}
      title="Dismiss payment"
      description={`${recipient} · ${payment.memo}`}
      summary={{
        what: `${amount} to ${recipient}, meant for ${formatDate(payment.scheduledFor)}, leaves Not scheduled. It was never paid, and nothing is paid now.`,
        amount: payment.amount,
        to: recipient,
        reversible: 'Cannot be undone. Send or schedule a new payment if it is still needed.',
        policy: 'Agency Admins manage the Agency’s payments.',
      }}
      confirmLabel="Dismiss payment"
      confirmVariant="destructive"
      disabled={dismiss.phase === 'idle' && !stillThere}
      phase={dismiss.phase}
      error={dismiss.error}
      onConfirm={() => dismiss.run({ paymentId: payment.id })}
      success={{
        title: 'Payment dismissed',
        body: `${amount} to ${recipient} is no longer listed. Nothing was paid.`,
      }}
    />
  )
}

/** The badge of a payment saved as scheduled before schedules existed (`isUnscheduledPayment`). */
export const UNSCHEDULED_STATUS = { label: 'Not scheduled', tone: 'warning' } as const

/** "2 upcoming", "1 needs attention", "1 paused": the hint under a Scheduled tile. */
export function scheduledHint(upcoming: number, attention: number, paused = 0): string {
  const parts: string[] = []
  if (upcoming > 0 || attention > 0) parts.push(`${upcoming} upcoming`)
  if (attention > 0) parts.push(`${attention} ${attention === 1 ? 'needs' : 'need'} attention`)
  if (paused > 0) parts.push(`${paused} paused`)
  return parts.length > 0 ? parts.join(' · ') : 'Nothing scheduled'
}

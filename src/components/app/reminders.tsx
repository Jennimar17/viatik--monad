'use client'

import { Archive, ArrowUpRight, MoreHorizontal, PauseCircle, PlayCircle } from 'lucide-react'
import * as React from 'react'

import {
  recurringEntries,
  RecurringPaymentsList,
  type RecurringEntry,
} from '@/components/app/accountability-parts'
import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect, type Option } from '@/components/app/form-controls'
import { useHref, usePermissions } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { MoneyInput } from '@/components/viatik/forms'
import { useCommand, useViatikState } from '@/data/react'
import { remindersDue } from '@/domain/accountability'
import { categoryLabel } from '@/domain/labels'
import { formatUsd, type Cents } from '@/domain/money'
import { accountBalance } from '@/domain/selectors'
import type { Id, Reminder, SpendingCategory } from '@/domain/types'
import { daysUntil, formatDate } from '@/lib/format'

/**
 * Monthly payments: tools and subscriptions an Agency Admin pays outside Viatik
 * every month (`Reminder`). Nothing is scheduled and nothing is paid
 * automatically: each one shows as due on its day of the month until a payment
 * outside Viatik is made for it ("Pay now"), and its invoice is then expected
 * like any other outside payment. Admins create, pause, resume and archive
 * them; Investors only see them (read-only `RecurringPaymentsList`).
 */

/** Day of the month a monthly payment can fall on: 1–28, so it exists in every month. */
const DAYS: Option[] = Array.from({ length: 28 }, (_, index) => ({
  value: String(index + 1),
  label: String(index + 1),
}))

const CATEGORIES: Option[] = (Object.keys(categoryLabel) as SpendingCategory[]).map((category) => ({
  value: category,
  label: categoryLabel[category],
}))

const NO_ACCOUNT = 'none'

/** A monthly payment that is due now (overdue, or due today) and not paid yet. */
export const isDueNow = (due: { dueAt: string; overdue: boolean }, now: string) =>
  due.overdue || daysUntil(due.dueAt, now) <= 0

/**
 * An Agency's monthly payments with the Admin's actions: "Pay now" opens Pay
 * outside Viatik filled in from the monthly payment, and a menu pauses,
 * resumes or archives it (archiving asks first: it is final). Without the
 * permissions the list is read-only.
 */
export function MonthlyPayments({
  agencyId,
  limit,
  includePaused = true,
  dueOnly = false,
  manage = true,
  empty,
  className,
}: {
  agencyId: Id
  /** Rows shown before "Show all N". */
  limit?: number
  /** Also list paused monthly payments, after the active ones. */
  includePaused?: boolean
  /** Only the active ones due now (overdue or due today), e.g. a follow-up panel. */
  dueOnly?: boolean
  /** Show the pause, resume and archive menu (compact lists only keep "Pay now"). */
  manage?: boolean
  empty?: React.ReactNode
  className?: string
}) {
  const { state, now } = useViatikState()
  const href = useHref()
  const { can } = usePermissions()
  const payable = state.accounts.some((a) => a.agencyId === agencyId && a.status === 'active')
  const canPay = can('pay_outside', { agencyId }) && payable
  const canManage = manage && can('manage_reminders', { agencyId })
  const setStatus = useCommand('setReminderStatus', {
    success: (reminder) =>
      reminder.status === 'paused'
        ? `“${reminder.title}” is paused. It no longer shows as due.`
        : `“${reminder.title}” is active again.`,
  })
  // Kept while the archive sheet closes, so it does not go blank.
  const [archivingId, setArchivingId] = React.useState<Id | null>(null)
  const [archiveOpen, setArchiveOpen] = React.useState(false)
  const entries = recurringEntries(state, agencyId, now, { includePaused, dueOnly })

  const action = ({ reminder, due }: RecurringEntry) => (
    <>
      {due && canPay ? (
        <ButtonLink
          href={href(`accounts/pay-outside?reminder=${reminder.id}`)}
          variant={isDueNow(due, now) ? 'default' : 'outline'}
          size="pill-sm"
        >
          <ArrowUpRight data-icon="inline-start" /> Pay now
          <span className="sr-only"> for “{reminder.title}”</span>
        </ButtonLink>
      ) : null}
      {canManage ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-full"
                aria-label={`More actions for ${reminder.title}`}
              />
            }
          >
            <MoreHorizontal />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 p-1.5">
            {reminder.status === 'active' ? (
              <DropdownMenuItem
                className="gap-2 rounded-lg"
                disabled={setStatus.isPending}
                onClick={() => void setStatus.run({ reminderId: reminder.id, status: 'paused' })}
              >
                <PauseCircle className="size-4" /> Pause
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                className="gap-2 rounded-lg"
                disabled={setStatus.isPending}
                onClick={() => void setStatus.run({ reminderId: reminder.id, status: 'active' })}
              >
                <PlayCircle className="size-4" /> Resume
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              className="gap-2 rounded-lg"
              onClick={() => {
                setArchivingId(reminder.id)
                setArchiveOpen(true)
              }}
            >
              <Archive className="size-4" /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )

  return (
    <>
      <RecurringPaymentsList
        entries={entries}
        now={now}
        action={canPay || canManage ? action : undefined}
        limit={limit}
        empty={empty}
        className={className}
      />
      {canManage ? (
        <ArchiveReminderSheet
          reminderId={archivingId}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          onClosed={() => setArchivingId(null)}
        />
      ) : null}
    </>
  )
}

/** Archiving a monthly payment is final: it asks first and says what stays. */
function ArchiveReminderSheet({
  reminderId,
  open,
  onOpenChange,
  onClosed,
}: {
  reminderId: Id | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onClosed: () => void
}) {
  const { state } = useViatikState()
  const archive = useCommand('setReminderStatus')
  // Looked up across every status: once archived it is still found, for the success screen.
  const reminder = state.reminders.find((r) => r.id === reminderId)
  const title = reminder ? `“${reminder.title}”` : 'This monthly payment'

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        archive.reset()
        onClosed()
      }}
      title="Archive monthly payment"
      description={reminder ? `${reminder.payee} · day ${reminder.dayOfMonth} of each month` : undefined}
      summary={{
        what: `${title} stops showing as due in Bills. Payments already made for it, and their invoices, stay in the record.`,
        reversible: 'Cannot be undone. Create a new monthly payment if you need it again.',
        policy: 'Only Agency Admins manage monthly payments.',
      }}
      confirmLabel="Archive"
      confirmVariant="destructive"
      disabled={!reminder || (reminder.status === 'archived' && archive.phase === 'idle')}
      phase={archive.phase}
      error={archive.error}
      onConfirm={() => reminder && archive.run({ reminderId: reminder.id, status: 'archived' })}
      success={{
        title: 'Monthly payment archived',
        body: `${title} no longer shows in Bills. Its past payments stay in Payments ▸ Outside Viatik.`,
      }}
    />
  )
}

/**
 * Create a monthly payment: what it is, who gets paid, its usual amount and
 * category, the day of the month it is due and, optionally, the Agency account
 * it is usually paid from. Nothing is paid automatically.
 */
export function NewReminderSheet({
  open,
  onOpenChange,
  agencyId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  agencyId: Id
  /** Runs once it is created, e.g. to show the Monthly tab. */
  onCreated?: (reminder: Reminder) => void
}) {
  const { state, now } = useViatikState()
  const create = useCommand('createReminder')
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const today = new Date(now).getUTCDate()
  const [title, setTitle] = React.useState('')
  const [payee, setPayee] = React.useState('')
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [category, setCategory] = React.useState<SpendingCategory>('software')
  const [day, setDay] = React.useState(String(Math.min(today, 28)))
  const [accountId, setAccountId] = React.useState(NO_ACCOUNT)
  const [createdId, setCreatedId] = React.useState<Id | null>(null)

  const busy = create.isPending
  const dayOfMonth = Number(day)
  const account = accounts.find((a) => a.id === accountId)
  const created = remindersDue(state, agencyId, now).find((r) => r.reminder.id === createdId)
  const nothingAmount = amount !== null && amount <= 0
  const subject = title.trim() ? `“${title.trim()}”` : 'this monthly payment'
  const who = payee.trim() || 'the payee'
  const usual = amount && amount > 0 ? ` about ${formatUsd(amount, { withCode: true })}` : ''

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        create.reset()
        setTitle('')
        setPayee('')
        setAmount(null)
        setCategory('software')
        setDay(String(Math.min(today, 28)))
        setAccountId(NO_ACCOUNT)
        setCreatedId(null)
      }}
      title="New monthly payment"
      description="Something the Agency pays outside Viatik every month, such as a tool or a subscription."
      summary={{
        what: `Every month on day ${dayOfMonth}, ${subject} shows as due in Bills until you pay ${who}${usual} outside Viatik. Nothing is paid automatically.`,
        reversible: 'You can pause or archive it at any time.',
        policy: 'Only Agency Admins manage monthly payments. The Investor can see them.',
      }}
      confirmLabel="Create monthly payment"
      disabled={!title.trim() || !payee.trim() || nothingAmount}
      phase={create.phase}
      error={create.error}
      onConfirm={async () => {
        const reminder = await create.run({
          agencyId,
          title: title.trim(),
          payee: payee.trim(),
          amount: amount && amount > 0 ? amount : undefined,
          category,
          dayOfMonth,
          sourceAccountId: account?.id,
        })
        if (reminder) {
          setCreatedId(reminder.id)
          onCreated?.(reminder)
        }
      }}
      success={{
        title: 'Monthly payment created',
        body: !created
          ? `It shows in Bills ▸ Monthly. Use Pay now when it is time to pay ${who}.`
          : daysUntil(created.dueAt, now) < 0
            ? `“${created.reminder.title}” shows as overdue: day ${created.reminder.dayOfMonth} has passed this month. Use Pay now in Bills ▸ Monthly to pay ${created.reminder.payee}; after that it is due on day ${created.reminder.dayOfMonth} of each month.`
            : `“${created.reminder.title}” is due ${daysUntil(created.dueAt, now) === 0 ? 'today' : formatDate(created.dueAt)}, then on day ${created.reminder.dayOfMonth} of each month. Use Pay now in Bills ▸ Monthly when it is time to pay ${created.reminder.payee}.`,
      }}
    >
      <div className="flex flex-col gap-5">
        <FormField label="What it is" htmlFor="reminder-title" hint="As the Agency calls it.">
          <PillInput
            id="reminder-title"
            value={title}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Claude Teams"
          />
        </FormField>
        <FormField label="Payee" htmlFor="reminder-payee" hint="Who gets paid.">
          <PillInput
            id="reminder-payee"
            value={payee}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setPayee(event.target.value)}
            placeholder="e.g. Anthropic"
          />
        </FormField>
        <FormField
          label="Usual amount"
          htmlFor="reminder-amount"
          optional
          error={nothingAmount ? 'Enter an amount above zero, or leave it empty.' : undefined}
          hint="Leave it empty if it changes every month. You enter the exact amount when you pay."
        >
          <MoneyInput
            id="reminder-amount"
            value={amount}
            onChange={setAmount}
            invalid={nothingAmount}
            disabled={busy}
          />
        </FormField>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Category" htmlFor="reminder-category">
            <SimpleSelect
              id="reminder-category"
              value={category}
              onValueChange={(value) => setCategory(value as SpendingCategory)}
              options={CATEGORIES}
              disabled={busy}
            />
          </FormField>
          <FormField
            label="Due on day"
            htmlFor="reminder-day"
            hint={
              dayOfMonth === today
                ? `Day ${dayOfMonth} is today, so it is due right away.`
                : dayOfMonth < today
                  ? `Day ${dayOfMonth} has passed this month, so it shows as overdue right away.`
                  : 'From 1 to 28, so it falls in every month.'
            }
          >
            <SimpleSelect
              id="reminder-day"
              value={day}
              onValueChange={setDay}
              options={DAYS}
              disabled={busy}
            />
          </FormField>
        </div>
        <FormField
          label="Usually paid from"
          htmlFor="reminder-account"
          optional
          hint="Pay now starts from this Agency account. You can change it when you pay."
        >
          <SimpleSelect
            id="reminder-account"
            value={accountId}
            onValueChange={setAccountId}
            disabled={busy}
            options={[
              { value: NO_ACCOUNT, label: 'No usual account' },
              ...accounts.map((a) => ({
                value: a.id,
                label: a.name,
                description: `${formatUsd(accountBalance(state, a.id))} available`,
              })),
            ]}
          />
        </FormField>
      </div>
    </ApprovalSheet>
  )
}

import { calendarDaysUntil, dayIn } from '@/domain/days'

import {
  formatLocalDate,
  formatLocalDateTime,
  localHour,
  localTimeZone,
  type LocalDateTimeOptions,
} from './local-time'

/**
 * Formatting for dates, hashes and file sizes. Amounts use formatUsd from the
 * money module; nothing here touches money.
 *
 * Calendar dates (due, issue and expiry dates, spent on, an agreement's or a
 * tranche's date, budget months) are stored as midnight UTC and format in UTC,
 * so everyone sees the same day. Times of day, today's date, the days a feed is
 * grouped by and the greeting are on the viewer's clock (`local-time.ts`, client
 * screens only).
 */
const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let value = cache.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options })
    cache.set(key, value)
  }
  return value
}

const DAY = 24 * 60 * 60 * 1000

export function formatDate(iso: string, locale = 'en-US') {
  return formatter(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
}

export function formatShortDate(iso: string, locale = 'en-US') {
  return formatter(locale, { day: 'numeric', month: 'short' }).format(new Date(iso))
}

/** "Oct 12, 2:13 AM": an instant on the viewer's clock; `withZone` adds "GMT-3", `withYear` the year. */
export function formatDateTime(iso: string, options: LocalDateTimeOptions = {}) {
  return formatLocalDateTime(iso, options)
}

/** A date input's "yyyy-mm-dd" as midnight UTC, matching how dates are displayed. */
export function fromDateInput(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  // A partly typed or out-of-range date (e.g. a five-digit year) is just not a date yet.
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * One quoted CSV cell. Text that a spreadsheet would run as a formula
 * (names and notes other people typed) is prefixed so it stays text.
 */
export function csvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/**
 * "2 hours ago", "in 3 days", "yesterday"; past 30 days, the day the instant falls on in the
 * viewer's time zone ("Sep 2, 2026"), as lists and detail pages print it. `timeZone` replaces the
 * viewer's (tests).
 */
export function formatRelative(iso: string, now: string, { timeZone }: { timeZone?: string } = {}) {
  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' })
  const diff = new Date(iso).getTime() - new Date(now).getTime()
  const abs = Math.abs(diff)
  if (abs < 60 * 1000) return 'just now'
  if (abs < 60 * 60 * 1000) return rtf.format(Math.round(diff / (60 * 1000)), 'minute')
  if (abs < DAY) return rtf.format(Math.round(diff / (60 * 60 * 1000)), 'hour')
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day')
  return formatLocalDate(iso, { timeZone })
}

/** "Today", "Yesterday" or a long date, for grouping feeds by the viewer's day. */
export function dayGroup(
  iso: string,
  now: string,
  { timeZone = localTimeZone() }: { timeZone?: string } = {},
) {
  const diff = Math.round((Date.parse(dayIn(now, timeZone)) - Date.parse(dayIn(iso, timeZone))) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return formatter('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(
    new Date(iso),
  )
}

/**
 * Calendar days from today on the viewer's clock to a due date's day (its UTC
 * date, as printed): 0 on the due day, −1 the day after. `timeZone` replaces the
 * viewer's (tests).
 */
export function daysUntil(iso: string, now: string, { timeZone }: { timeZone?: string } = {}) {
  return calendarDaysUntil(iso, now, timeZone)
}

/** "Due in 3 days", "Due today", "2 days overdue", counted in calendar days (`daysUntil`). */
export function dueLabel(iso: string, now: string, options: { timeZone?: string } = {}) {
  const days = daysUntil(iso, now, options)
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

/**
 * The due label of a window that closes at an instant rather than on a day (an outside payment's
 * invoice): counted to the day it closes on the viewer's clock, and "Overdue today" once it has
 * closed (`overdue`) while that day lasts, matching the red status. `timeZone` replaces the
 * viewer's (tests).
 */
export function instantDueLabel(
  dueAt: string,
  now: string,
  overdue: boolean,
  { timeZone = localTimeZone() }: { timeZone?: string } = {},
) {
  // The day it closes on the viewer's clock, as midnight UTC: the shape `daysUntil` counts to.
  const dueDay = `${dayIn(dueAt, timeZone)}T00:00:00Z`
  return overdue && daysUntil(dueDay, now, { timeZone }) >= 0
    ? 'Overdue today'
    : dueLabel(dueDay, now, { timeZone })
}

/**
 * "morning" (5:00–11:59), "afternoon" (12:00–17:59) or "evening" (18:00–4:59) on the
 * viewer's clock. `timeZone` replaces the viewer's (tests).
 */
export function partOfDay(now: string, options: { timeZone?: string } = {}) {
  const hour = localHour(now, options)
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  return 'evening'
}

/** "0x12ab…9f3c" — keeps the head and tail of a hash or address. */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 1) return hash
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

/** "1 bill", "3 bills". Pass `plural` for irregular nouns. */
export function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** A starting point for someone's name from their email: "maya.chen+x@example.com" → "Maya Chen". */
export function nameFromEmail(email: string | null | undefined): string {
  const local = email?.split('@')[0]?.split('+')[0] ?? ''
  return local
    .split(/[._-]+/)
    .filter((word) => /^[a-z]+$/i.test(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

const WEI_DECIMALS = 18

/**
 * MON from wei (18 decimals), for the network's own test stake only: "3 MON", "0.0122 MON",
 * "26,739,948 MON". Never app money (that is integer cents, `formatUsd`), and BigInt math so
 * screens never bundle viem. Rounds down to `digits` decimals and drops trailing zeros; an
 * amount too small to show reads "< 0.0001 MON". Anything that is not a whole number of wei
 * reads "—".
 */
export function formatMon(wei: bigint | string, digits = 4): string {
  let value: bigint
  try {
    value = typeof wei === 'bigint' ? wei : BigInt(wei)
  } catch {
    return '—'
  }
  const places = Math.min(WEI_DECIMALS, Math.max(0, Math.trunc(digits)))
  const negative = value < 0n
  const abs = negative ? -value : value
  const shown = abs / 10n ** BigInt(WEI_DECIMALS - places)
  if (shown === 0n && abs > 0n) return `< ${places === 0 ? '1' : `0.${'1'.padStart(places, '0')}`} MON`
  const unit = 10n ** BigInt(places)
  const fraction = places > 0 ? (shown % unit).toString().padStart(places, '0').replace(/0+$/, '') : ''
  return `${negative ? '−' : ''}${(shown / unit).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} MON`
}

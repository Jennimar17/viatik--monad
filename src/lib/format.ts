/**
 * Locale-aware formatting for dates, hashes and file sizes. Amounts use
 * formatUsd from the money module; nothing here touches money.
 *
 * Dates format in UTC by default so server and client render the same text.
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

export function formatDateTime(iso: string, locale = 'en-US') {
  return formatter(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  )
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

/** "2 hours ago", "in 3 days", "yesterday". */
export function formatRelative(iso: string, now: string, locale = 'en-US') {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const diff = new Date(iso).getTime() - new Date(now).getTime()
  const abs = Math.abs(diff)
  if (abs < 60 * 1000) return 'just now'
  if (abs < 60 * 60 * 1000) return rtf.format(Math.round(diff / (60 * 1000)), 'minute')
  if (abs < DAY) return rtf.format(Math.round(diff / (60 * 60 * 1000)), 'hour')
  if (abs < 30 * DAY) return rtf.format(Math.round(diff / DAY), 'day')
  return formatDate(iso, locale)
}

/** "Today", "Yesterday" or a long date, for grouping feeds by day. */
export function dayGroup(iso: string, now: string, locale = 'en-US') {
  const startOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const diff = Math.round((startOf(new Date(now)) - startOf(new Date(iso))) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return formatter(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
}

export function daysUntil(iso: string, now: string) {
  return Math.ceil((new Date(iso).getTime() - new Date(now).getTime()) / DAY)
}

/** "Due in 3 days", "Due today", "2 days overdue". */
export function dueLabel(iso: string, now: string) {
  const days = daysUntil(iso, now)
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} overdue`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${days} days`
}

/** "morning", "afternoon" or "evening" in the viewer's local time. */
export function partOfDay(now: string) {
  const hour = new Date(now).getHours()
  if (hour < 12) return 'morning'
  if (hour < 18) return 'afternoon'
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

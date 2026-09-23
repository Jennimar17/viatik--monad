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

/** "0x12ab…9f3c" — keeps the head and tail of a hash or address. */
export function shortHash(hash: string, head = 6, tail = 4): string {
  if (hash.length <= head + tail + 1) return hash
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

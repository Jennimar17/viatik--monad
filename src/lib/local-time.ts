/**
 * Dates and times on the viewer's own clock, in their time zone. Everything in
 * `format.ts` formats in UTC so server and client render the same text; a
 * scheduled payment is chosen and shown at a time of day, which only makes
 * sense in the person's own zone. Client components only (the server's zone
 * is not the person's): screens render these after the state has loaded.
 */

const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options)
  let value = cache.get(key)
  if (!value) {
    value = new Intl.DateTimeFormat('en-US', options)
    cache.set(key, value)
  }
  return value
}

/** The viewer's time zone, e.g. "America/Bogota" ("UTC" when the browser does not say). */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * "Oct 12, 9:00 AM" in the viewer's time zone. `withZone` adds the zone's short
 * name ("Oct 12, 9:00 AM GMT-5"), `withYear` the year, `withWeekday` the day.
 */
export function formatLocalDateTime(
  iso: string,
  { withZone = false, withYear = false, withWeekday = false } = {},
): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return formatter({
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: 'numeric',
    minute: '2-digit',
    ...(withZone ? { timeZoneName: 'short' } : {}),
  }).format(date)
}

/** "9:00 AM" in the viewer's time zone. */
export function formatLocalTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return formatter({ hour: 'numeric', minute: '2-digit' }).format(date)
}

const pad = (value: number) => String(value).padStart(2, '0')

/** An instant as the values of a date input ("2026-10-12") and a time input ("09:00"), on the viewer's clock. */
export function toLocalInputs(iso: string): { date: string; time: string } {
  const date = new Date(iso)
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

/**
 * A date input's "yyyy-mm-dd" and a time input's "hh:mm" as the instant they
 * name on the viewer's clock (ISO, UTC). Undefined until both are complete.
 */
export function fromLocalInputs(date: string, time: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}(:\d{2})?$/.test(time)) return undefined
  // A date-time without an offset is read in the local time zone.
  const at = new Date(`${date}T${time}`)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

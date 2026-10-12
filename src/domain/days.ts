import type { ISODate } from './types'

/**
 * Calendar days. A due date is a day, not an instant: it is kept as midnight
 * UTC (or as an instant whose UTC day is the one screens print), while "today"
 * is a day in someone's time zone. Pure: the zone is passed in, or it is this
 * process's own (the device's, in a browser).
 */

const DAY = 24 * 60 * 60 * 1000

/** The calendar day (YYYY-MM-DD) an instant falls on in a time zone; UTC when the zone is unknown. */
export function dayIn(iso: ISODate, timeZone: string | undefined): string {
  const date = new Date(iso)
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
    return `${part('year')}-${part('month')}-${part('day')}`
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/**
 * Whole days from today to a due date: the due date's UTC day (the day screens
 * print) against today in `timeZone`, or on this process's clock when it is left
 * out. 0 on the due day, 1 the day before, −1 the day after.
 */
export function calendarDaysUntil(due: ISODate, now: ISODate, timeZone?: string): number {
  const dueDate = new Date(due)
  const dueDay = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate())
  const today = new Date(now)
  const todayDay = timeZone
    ? Date.parse(`${dayIn(now, timeZone)}T00:00:00Z`)
    : Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  // Both are midnight UTC, so a daylight saving change in between does not shift the count.
  return Math.round((dueDay - todayDay) / DAY)
}

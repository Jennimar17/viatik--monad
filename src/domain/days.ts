import type { ISODate } from './types'

/**
 * Calendar days. A due date is a day, not an instant: it is kept as midnight
 * UTC (or as an instant whose UTC day is the one screens print), while "today"
 * is a day in someone's time zone. Pure: the zone is passed in.
 */

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

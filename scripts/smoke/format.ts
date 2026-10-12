import { dayGroup, formatDate, formatDateTime, formatShortDate } from '@/lib/format'
import { formatLocalDate, formatLocalDateTime, formatLocalTime } from '@/lib/local-time'

import { checkSame, type Checker } from './harness'

/**
 * Format: how dates and times read on screen. Times of day, today's date and
 * the days a feed is grouped by are on the viewer's clock; calendar dates (due,
 * issue, agreement dates) stay UTC so everyone sees the same day. Every check
 * names its time zone, so nothing depends on the machine's. Pure.
 */

/** Buenos Aires: GMT-3 all year (no daylight saving time). */
const BA = 'America/Argentina/Buenos_Aires'

/** Some ICU versions put a narrow no-break space before AM/PM: every space reads as a plain one. */
const plain = (text: string) => text.replace(/\s/g, ' ')

export default async function format(t: Checker) {
  await t.scenario('T1. Times of day on the viewer’s clock', () => times(t))
  await t.scenario('T2. Today and the day groups on the viewer’s clock; calendar dates in UTC', () => days(t))
}

// ─── T1. Times of day ────────────────────────────────────────────────────────

function times(t: Checker) {
  checkSame(
    t,
    'T1 5:13 UTC reads 2:13 AM in Buenos Aires',
    plain(formatDateTime('2026-10-12T05:13:00Z', { timeZone: BA })),
    'Oct 12, 2:13 AM',
  )
  checkSame(
    t,
    'T1 Verified details and receipts name the year and the zone',
    plain(formatDateTime('2026-10-12T05:37:00Z', { timeZone: BA, withYear: true, withZone: true })),
    'Oct 12, 2026, 2:37 AM GMT-3',
  )
  checkSame(
    t,
    'T1 a viewer in UTC sees the zone named UTC',
    plain(formatDateTime('2026-10-12T05:37:00Z', { timeZone: 'UTC', withYear: true, withZone: true })),
    'Oct 12, 2026, 5:37 AM UTC',
  )
  checkSame(
    t,
    'T1 "Bill added" and "Payment scheduled for" read on the same clock',
    formatDateTime('2026-10-12T05:13:00Z', { timeZone: BA }),
    formatLocalDateTime('2026-10-12T05:13:00Z', { timeZone: BA }),
  )
  checkSame(t, 'T1 a time alone', plain(formatLocalTime('2026-10-12T05:13:00Z', { timeZone: BA })), '2:13 AM')
  checkSame(t, 'T1 a date that is not a date reads "—"', formatDateTime('nope'), '—')
}

// ─── T2. Days ────────────────────────────────────────────────────────────────

function days(t: Checker) {
  checkSame(
    t,
    'T2 today’s date is the viewer’s: 01:30 UTC on the 12th is still the 11th in Buenos Aires',
    formatLocalDate('2026-10-12T01:30:00Z', { timeZone: BA }),
    'Oct 11, 2026',
  )
  checkSame(
    t,
    'T2 without the year',
    formatLocalDate('2026-10-12T01:30:00Z', { timeZone: BA, withYear: false }),
    'Oct 11',
  )
  checkSame(t, 'T2 a date that is not a date reads "—"', formatLocalDate('nope'), '—')

  const now = '2026-10-12T05:00:00Z' // 2:00 AM on the 12th in Buenos Aires
  checkSame(
    t,
    'T2 10 PM last night in Buenos Aires is "Yesterday" there',
    dayGroup('2026-10-12T01:00:00Z', now, { timeZone: BA }),
    'Yesterday',
  )
  checkSame(
    t,
    'T2 … and "Today" for a viewer in UTC',
    dayGroup('2026-10-12T01:00:00Z', now, { timeZone: 'UTC' }),
    'Today',
  )
  checkSame(
    t,
    'T2 1 AM is "Today" in Buenos Aires',
    dayGroup('2026-10-12T04:00:00Z', now, { timeZone: BA }),
    'Today',
  )
  checkSame(
    t,
    'T2 older days are named on the viewer’s clock',
    dayGroup('2026-10-10T02:30:00Z', now, { timeZone: BA }),
    'Friday, October 9',
  )

  // A due date is stored as midnight UTC: it must not move a day back west of UTC.
  checkSame(t, 'T2 a calendar date keeps its day', formatDate('2026-10-15T00:00:00.000Z'), 'Oct 15, 2026')
  checkSame(t, 'T2 … also without the year', formatShortDate('2026-10-15T00:00:00.000Z'), 'Oct 15')
}

import { advanceDueText } from '@/components/app/request-parts'
import { addDays, JUSTIFY_WITHIN_DAYS, PROOF_WITHIN_DAYS } from '@/domain/accountability'
import { calendarDaysUntil } from '@/domain/days'
import { cents, parseUsdInput, toInputString, usdInputHint } from '@/domain/money'
import { billState } from '@/domain/queries'
import type { Bill } from '@/domain/types'
import {
  dayGroup,
  daysUntil,
  dueLabel,
  formatDate,
  formatDateTime,
  formatRelative,
  formatShortDate,
  instantDueLabel,
  partOfDay,
} from '@/lib/format'
import { formatLocalDate, formatLocalDateTime, formatLocalTime } from '@/lib/local-time'

import { checkSame, type Checker } from './harness'

/**
 * Format: how dates, times and amounts read on screen. Times of day, today's
 * date and the days a feed is grouped by are on the viewer's clock; calendar
 * dates (due, issue, agreement dates) stay UTC so everyone sees the same day.
 * Every check names its time zone, so nothing depends on the machine's. The
 * amount input reads a dot for cents and commas for thousands only. Pure.
 */

/** Buenos Aires: GMT-3 all year (no daylight saving time). */
const BA = 'America/Argentina/Buenos_Aires'
/** Tokyo: GMT+9 all year (no daylight saving time). */
const TOKYO = 'Asia/Tokyo'

/** Some ICU versions put a narrow no-break space before AM/PM: every space reads as a plain one. */
const plain = (text: string) => text.replace(/\s/g, ' ')

/**
 * Runs `run` with this process in `zone`, for what reads the device's clock when no zone is
 * named (Node reads TZ again when it is set), then puts the zone back.
 */
function withTimeZone(zone: string, run: () => void) {
  const before = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  process.env.TZ = zone
  try {
    run()
  } finally {
    process.env.TZ = before
  }
}

export default async function format(t: Checker) {
  await t.scenario('T1. Times of day on the viewer’s clock', () => times(t))
  await t.scenario('T2. Today and the day groups on the viewer’s clock; calendar dates in UTC', () => days(t))
  await t.scenario('T3. Days to a due date are calendar days', () => dueDays(t))
  await t.scenario('T4. The amount input refuses a comma for cents', () => amounts(t))
  await t.scenario('T5. The greeting follows the hour on the viewer’s clock', () => greeting(t))
  await t.scenario('T6. Deadlines that close at an instant count on the viewer’s clock', () =>
    instantDeadlines(t),
  )
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

// ─── T3. Days to a due date ──────────────────────────────────────────────────

function dueDays(t: Checker) {
  const UTC = { timeZone: 'UTC' }
  const BOGOTA = { timeZone: 'America/Bogota' } // UTC-5
  // The seed's bills are due at noon UTC; looked at on the morning of the 12th.
  const morning = '2026-10-12T09:00:00Z'
  checkSame(
    t,
    'T3 due the 15th at noon, the morning of the 12th: 3 days (not 4)',
    daysUntil('2026-10-15T12:00:00Z', morning, UTC),
    3,
  )
  checkSame(t, 'T3 due the 21st: 9 days', daysUntil('2026-10-21T12:00:00Z', morning, UTC), 9)
  checkSame(t, 'T3 due the 8th: 4 days overdue (not 3)', daysUntil('2026-10-08T12:00:00Z', morning, UTC), -4)
  checkSame(t, 'T3 due the 9th at 16:00: 3 days overdue', daysUntil('2026-10-09T16:00:00Z', morning, UTC), -3)
  checkSame(
    t,
    'T3 a monthly payment due the 26th: 14 days',
    daysUntil('2026-10-26T00:00:00Z', morning, UTC),
    14,
  )
  checkSame(
    t,
    'T3 the labels',
    [
      dueLabel('2026-10-15T12:00:00Z', morning, UTC),
      dueLabel('2026-10-13T00:00:00Z', morning, UTC),
      dueLabel('2026-10-12T23:00:00Z', morning, UTC),
      dueLabel('2026-10-11T00:00:00Z', morning, UTC),
      dueLabel('2026-10-08T12:00:00Z', morning, UTC),
    ],
    ['Due in 3 days', 'Due tomorrow', 'Due today', '1 day overdue', '4 days overdue'],
  )

  // 9 PM on the 12th in Bogota is already the 13th in UTC.
  const evening = '2026-10-13T02:00:00Z'
  checkSame(
    t,
    'T3 west of UTC it is still the 12th: due the 13th reads "Due tomorrow"',
    dueLabel('2026-10-13T00:00:00Z', evening, BOGOTA),
    'Due tomorrow',
  )
  checkSame(t, 'T3 … and the 26th is 14 days away', daysUntil('2026-10-26T00:00:00Z', evening, BOGOTA), 14)
  checkSame(
    t,
    'T3 east of UTC the 13th comes first: due the 13th reads "Due today" at 4 AM in Singapore',
    calendarDaysUntil('2026-10-13T00:00:00Z', '2026-10-12T20:00:00Z', 'Asia/Singapore'),
    0,
  )

  const bill = { status: 'to_pay', dueDate: '2026-10-12T00:00:00.000Z' } as Bill
  checkSame(
    t,
    'T3 a bill is not overdue on its due day',
    billState(bill, '2026-10-12T15:00:00Z', UTC),
    'to_pay',
  )
  checkSame(t, 'T3 … it is the day after', billState(bill, '2026-10-13T01:00:00Z', UTC), 'overdue')
  checkSame(
    t,
    'T3 … but not while the due day lasts west of UTC',
    billState(bill, '2026-10-13T01:00:00Z', BOGOTA),
    'to_pay',
  )
  checkSame(
    t,
    'T3 a scheduled bill is overdue the day after too',
    billState({ ...bill, status: 'scheduled' }, '2026-10-13T01:00:00Z', UTC),
    'overdue',
  )
  checkSame(
    t,
    'T3 a paid bill is never overdue',
    billState({ ...bill, status: 'paid' }, '2026-11-01T00:00:00Z', UTC),
    'paid',
  )

  // Screens name no zone: today is then this device's day.
  withTimeZone('America/Bogota', () =>
    checkSame(
      t,
      'T3 with no zone named, the device’s day counts (Bogota)',
      [daysUntil('2026-10-13T00:00:00Z', evening), billState(bill, '2026-10-13T01:00:00Z')],
      [1, 'to_pay'],
    ),
  )
  withTimeZone('UTC', () =>
    checkSame(
      t,
      'T3 with no zone named, the device’s day counts (UTC)',
      [daysUntil('2026-10-13T00:00:00Z', evening), billState(bill, '2026-10-13T01:00:00Z')],
      [0, 'overdue'],
    ),
  )
}

// ─── T4. Amount input ────────────────────────────────────────────────────────

function amounts(t: Checker) {
  checkSame(
    t,
    'T4 a comma for cents is refused, not read as hundreds',
    ['12,50', '1 250,50', '1.234,56', '1,25'].map(parseUsdInput),
    [null, null, null, null],
  )
  checkSame(
    t,
    'T4 a dot for cents, commas for thousands',
    ['1,250.50', '1250', '12.5', '1,234,567.89', '$1,250 USD', '1 250.50'].map(parseUsdInput),
    [125050, 125000, 1250, 123456789, 125000, 125050],
  )
  checkSame(t, 'T4 commas only in groups of three', ['1,2500', ',500', '12,5,00'].map(parseUsdInput), [
    null,
    null,
    null,
  ])
  checkSame(
    t,
    'T4 the field’s own text reads back the same amount',
    parseUsdInput(toInputString(cents(125050))),
    125050,
  )
  checkSame(
    t,
    'T4 a comma for cents says to use a dot',
    ['12,50', '1.234,56', '1250,5'].map(usdInputHint),
    Array(3).fill('Use a dot for cents, as in 12.50.'),
  )
  checkSame(
    t,
    'T4 nothing to say otherwise',
    ['1,250.50', '1,250', '12.50', '', '1,2345'].map(usdInputHint),
    [null, null, null, null, null],
  )
}

// ─── T5. Greeting ────────────────────────────────────────────────────────────

function greeting(t: Checker) {
  // Buenos Aires is UTC-3: 05:13 UTC is 2:13 AM there.
  const at = (utc: string) => partOfDay(`2026-10-12T${utc}:00Z`, { timeZone: BA })
  checkSame(t, 'T5 2:13 AM is evening, not morning', at('05:13'), 'evening')
  checkSame(t, 'T5 midnight is evening', at('03:00'), 'evening')
  checkSame(t, 'T5 4:59 AM is still evening', at('07:59'), 'evening')
  checkSame(t, 'T5 morning starts at 5:00', at('08:00'), 'morning')
  checkSame(t, 'T5 11:59 AM is morning', at('14:59'), 'morning')
  checkSame(t, 'T5 afternoon starts at noon', at('15:00'), 'afternoon')
  checkSame(t, 'T5 5:59 PM is afternoon', at('20:59'), 'afternoon')
  checkSame(t, 'T5 evening starts at 6:00 PM', at('21:00'), 'evening')
  checkSame(
    t,
    'T5 the same instant is morning in UTC',
    partOfDay('2026-10-12T08:00:00Z', { timeZone: 'UTC' }),
    'morning',
  )
}

// ─── T6. Deadlines that close at an instant ──────────────────────────────────

function instantDeadlines(t: Checker) {
  const tokyo = { timeZone: TOKYO }
  // Paid outside Viatik at 8:00 AM on Oct 5 in Tokyo, still Oct 4 in UTC: the invoice is due 7
  // days later, at 8:00 AM on Oct 12 in Tokyo.
  const paid = '2026-10-04T23:00:00Z'
  const invoiceDue = addDays(paid, PROOF_WITHIN_DAYS)
  const invoice = (now: string, timeZone = TOKYO) =>
    instantDueLabel(invoiceDue, now, Date.parse(now) > Date.parse(invoiceDue), { timeZone })
  checkSame(
    t,
    'T6 the invoice of a payment made at 8 AM on Oct 5 in Tokyo is due at 8 AM on Oct 12 there',
    plain(formatLocalDateTime(invoiceDue, tokyo)),
    'Oct 12, 8:00 AM',
  )
  checkSame(
    t,
    'T6 in Tokyo: Due tomorrow on Oct 11, Due today until 8 AM on Oct 12 (not "1 day overdue"), then Overdue today',
    [
      invoice('2026-10-11T03:00:00Z'), // Oct 11, noon
      invoice('2026-10-11T22:00:00Z'), // Oct 12, 7:00 AM: not overdue yet
      invoice('2026-10-11T23:30:00Z'), // Oct 12, 8:30 AM
      invoice('2026-10-12T16:00:00Z'), // Oct 13, 1:00 AM
    ],
    ['Due tomorrow', 'Due today', 'Overdue today', '1 day overdue'],
  )
  checkSame(
    t,
    'T6 … and in UTC, where the same window closes at 11 PM on Oct 11',
    [invoice('2026-10-11T22:00:00Z', 'UTC'), invoice('2026-10-11T23:30:00Z', 'UTC')],
    ['Due today', 'Overdue today'],
  )

  // Money for purchases is justified within 30 days of the payment: received and due read on the
  // same clock, 30 days apart.
  const receivedInTokyo = '2026-10-04T23:00:00Z' // 8:00 AM on Oct 5 in Tokyo
  const open = { dueAt: addDays(receivedInTokyo, JUSTIFY_WITHIN_DAYS), overdue: false, settled: false }
  checkSame(
    t,
    'T6 money for purchases received Oct 5 in Tokyo is due Nov 4 there (not Nov 3)',
    [
      formatLocalDate(receivedInTokyo, { ...tokyo, withYear: false }),
      advanceDueText(open, { short: true, ...tokyo }),
      advanceDueText(open, tokyo),
    ],
    ['Oct 5', 'due Nov 4', 'due Nov 4, 2026'],
  )
  const receivedInBogota = '2026-10-05T02:00:00Z' // 9:00 PM on Oct 4 in Bogota
  const late = { dueAt: addDays(receivedInBogota, JUSTIFY_WITHIN_DAYS), overdue: true, settled: false }
  checkSame(
    t,
    'T6 … received Oct 4 in Bogota, it is overdue since Nov 3 there (not Nov 4)',
    [
      formatLocalDate(receivedInBogota, { timeZone: 'America/Bogota', withYear: false }),
      advanceDueText(late, { short: true, timeZone: 'America/Bogota' }),
    ],
    ['Oct 4', 'overdue since Nov 3'],
  )

  // Past 30 days, a relative time reads the day on the viewer's clock, as the request page does.
  const sent = '2026-09-03T01:00:00Z' // 10:00 PM on Sep 2 in Buenos Aires
  const now = '2026-10-12T15:00:00Z'
  checkSame(
    t,
    'T6 a request sent 40 days ago reads Sep 2 in Buenos Aires, its day there',
    [formatRelative(sent, now, { timeZone: BA }), formatLocalDate(sent, { timeZone: BA })],
    ['Sep 2, 2026', 'Sep 2, 2026'],
  )
  checkSame(t, 'T6 … and Sep 3 in UTC', formatRelative(sent, now, { timeZone: 'UTC' }), 'Sep 3, 2026')
  checkSame(
    t,
    'T6 within 30 days it stays relative',
    formatRelative('2026-10-10T15:00:00Z', now, { timeZone: BA }),
    '2 days ago',
  )
}

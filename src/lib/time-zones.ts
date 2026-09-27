/** Time zones offered in profile and workspace forms; any stored zone is added on top. */
export const TIME_ZONES = [
  'UTC',
  'Europe/Lisbon',
  'Europe/Dublin',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Bogota',
  'Africa/Lagos',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Seoul',
  'Asia/Tokyo',
]

export const timeZoneOptions = (current?: string) =>
  (current && !TIME_ZONES.includes(current) ? [current, ...TIME_ZONES] : TIME_ZONES).map((zone) => ({
    value: zone,
    label: zone.replace(/_/g, ' '),
  }))

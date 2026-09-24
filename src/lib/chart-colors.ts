/** Brand-derived series colors, in a stable order. */
export const SERIES_COLORS = [
  'var(--color-mist)',
  'var(--color-sage)',
  'var(--color-info)',
  'var(--color-warning)',
  'var(--color-stone)',
  'var(--color-chart-5)',
  'var(--color-chart-4)',
]

export const seriesColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length]!

/** Chart config keys become CSS variable names, so record ids are mapped to safe keys. */
export const seriesKey = (index: number) => `s${index}`

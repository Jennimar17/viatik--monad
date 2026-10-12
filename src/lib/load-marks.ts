/**
 * Marks a step of the first load on the browser's performance timeline, once per page load, so a
 * change can be measured before and after: DevTools ▸ Performance (Timings), or
 * `performance.getEntriesByType('mark')` in the console. Measurement only.
 */
export function markLoadStep(name: 'privy-ready' | 'session' | 'state') {
  try {
    const mark = `viatik:${name}`
    if (performance.getEntriesByName(mark, 'mark').length === 0) performance.mark(mark)
  } catch {
    // No performance timeline here: nothing to measure.
  }
}

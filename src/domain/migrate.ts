import type { ViatikState } from './types'

/**
 * A stored state may predate fields that screens now read. Fills them with empty
 * defaults, so a world saved by an older version keeps working. Changes the
 * state in place and returns it.
 */
export function upgradeState(state: ViatikState): ViatikState {
  state.payoutAddresses ??= []
  state.reminders ??= []
  return state
}

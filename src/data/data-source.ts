import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import type { ViatikState } from '@/domain/types'
import type { LedgerStatus } from '@/ledger/types'

/** Human operation lifecycle shown while a command settles. */
export type OperationPhase = LedgerStatus

export type DispatchOptions = {
  onPhase?: (phase: OperationPhase) => void
  /** Retries with the same key never double-spend. Generated when omitted. */
  idempotencyKey?: string
}

/**
 * The only way screens read or change data. Swapping the implementation
 * (demo ↔ API) never touches UI code.
 */
export interface DataSource {
  readonly kind: 'mock' | 'api'
  /** Everything the signed-in user is allowed to see. */
  load(userId: string): Promise<ViatikState>
  dispatch<N extends CommandName>(
    userId: string,
    name: N,
    input: CommandInput<N>,
    options?: DispatchOptions,
  ): Promise<CommandResult<N>>
  reset?(): Promise<void>
}

/** Errors carry product-language messages that can be shown as-is. */
export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'DataSourceError'
  }
}

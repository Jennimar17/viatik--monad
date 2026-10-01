import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import type { Invitation, Role, ViatikState } from '@/domain/types'
import type { LedgerStatus } from '@/ledger/types'

/** Human operation lifecycle shown while a command settles. */
export type OperationPhase = LedgerStatus

/**
 * How the person entered: one of the demo people (no sign-in), or a real
 * account verified by the server. The mode picks the data source.
 */
export type SessionMode = 'demo' | 'account'

/** What the server verified about a real account; used to create its profile the first time. */
export type SessionProfile = { name: string | null; email: string | null }

export type LoadOptions = {
  /** A real account's verified profile; the person is added if the data does not know them yet. */
  profile?: SessionProfile | null
}

export type DispatchOptions = {
  onPhase?: (phase: OperationPhase) => void
  /** Retries with the same key never double-spend. Generated when omitted. */
  idempotencyKey?: string
}

/** What an invitation link may show before anyone signs in. */
export type InvitationPreview = {
  code: string
  name: string
  email: string
  role: Role
  status: Invitation['status']
  workspace: string
  invitedBy: string
}

/**
 * The only way screens read or change data. Swapping the implementation
 * (demo ↔ API) never touches UI code.
 */
export interface DataSource {
  readonly kind: 'mock' | 'api'
  /** Everything the signed-in user is allowed to see. */
  load(userId: string, options?: LoadOptions): Promise<ViatikState>
  /** Public details of an invitation link; null when the code is unknown. */
  lookupInvitation(code: string): Promise<InvitationPreview | null>
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

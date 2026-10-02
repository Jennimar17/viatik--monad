import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import type { InvitationPreview, VerifiedProfile } from '@/domain/identity'
import type { Evidence, ViatikState } from '@/domain/types'
import type { LedgerStatus } from '@/ledger/types'

import type { ApiCredentials } from './api'

/** Human operation lifecycle shown while a command settles. */
export type OperationPhase = LedgerStatus

/**
 * How the person entered: one of the demo people (no sign-in), or a real
 * account verified by the server. The mode picks the data source.
 */
export type SessionMode = 'demo' | 'account'

/** What the server verified about a real account; used to create its profile the first time. */
export type SessionProfile = VerifiedProfile

/** Fresh Privy tokens for each request (they rotate); the demo needs none. */
export type CredentialsProvider = () => Promise<ApiCredentials>

export type LoadOptions = {
  /** A real account's verified profile; the person is added if the data does not know them yet. */
  profile?: SessionProfile | null
  credentials?: CredentialsProvider
}

export type DispatchOptions = {
  onPhase?: (phase: OperationPhase) => void
  /** Retries with the same key never double-spend. Generated when omitted. */
  idempotencyKey?: string
  credentials?: CredentialsProvider
}

/** A file stored privately and verified, ready to be attached to a command. */
export type UploadedFile = { kind: 'file'; name: string; mimeType: string; sizeBytes: number; sha256: string }

export type EvidenceOptions = { credentials?: CredentialsProvider }

export type { InvitationPreview }

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
  /** Stores a file privately and returns how a command refers to it (its fingerprint). */
  uploadEvidence(file: File, options?: EvidenceOptions): Promise<UploadedFile>
  /** A short-lived link to open a stored file the person can see. */
  evidenceLink(userId: string, evidenceId: string, options?: EvidenceOptions): Promise<string>
  /** Whether a file has a copy that can be opened here (example files and, in the demo, files from other tabs do not). */
  canOpenEvidence(evidence: Evidence): boolean
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

import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import type { InvitationPreview, VerifiedProfile } from '@/domain/identity'
import type { Evidence, ViatikState } from '@/domain/types'
import type { LedgerStatus } from '@/ledger/types'

import type { ApiCredentials } from './api'
import type { LedgerAccount, LedgerView, PendingCall } from './api-contract'

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

/**
 * Signs a transaction Viatik prepared, from the person's own account with
 * sponsored gas, and returns its hash. A real account's session provides it;
 * the demo settles without one.
 */
export type SendCall = (call: PendingCall) => Promise<`0x${string}`>

export type DispatchOptions = {
  onPhase?: (phase: OperationPhase) => void
  /** Retries with the same key never double-spend. Generated when omitted. */
  idempotencyKey?: string
  credentials?: CredentialsProvider
  /** Needed when the world settles on Monad. */
  sendCall?: SendCall
  /** The command and its input as the screen sent them, so a reload can find this operation again. */
  fingerprint?: string
}

/** An operation that was signed (or may have been) and is not confirmed yet. */
export type OpenOperation = {
  key: string
  name: CommandName
  userId: string
  /** The signed transaction, when its hash came back. */
  hash: `0x${string}` | null
  /** When it was sent for signing. */
  at: string
  /** `DispatchOptions.fingerprint`: the same command and input, retried after a reload, reuse this key. */
  fingerprint?: string
  /** When the person was last told it is still unsettled, so a later visit does not say it again. */
  notifiedAt?: string
}

/** A file stored privately and verified, ready to be attached to a command. */
export type UploadedFile = { kind: 'file'; name: string; mimeType: string; sizeBytes: number; sha256: string }

export type EvidenceOptions = { credentials?: CredentialsProvider }

export type LedgerOptions = {
  credentials?: CredentialsProvider
  /** Read Monad's balances again before answering. */
  refresh?: boolean
}

export type { InvitationPreview, LedgerAccount, LedgerView }

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
  /** Calls `listener` when another tab on this device changed the data; returns the unsubscribe. */
  subscribe?(listener: () => void): () => void
  /** Operations of this person left open on this device (a reload or a closed tab after signing). */
  openOperations?(userId: string): OpenOperation[]
  /** Confirms one of them. */
  resume?(operation: OpenOperation, options?: DispatchOptions): Promise<ResumeOutcome>
  /** Where the person's workspaces settle and Monad's balances for them; without it, the demo ledger. */
  ledger?(userId: string, options?: LedgerOptions): Promise<LedgerView>
  /** The person's own account on Monad (TestUSD held and allowed to the ledger); only with real accounts. */
  ledgerAccount?(userId: string, options?: LedgerOptions): Promise<LedgerAccount>
}

/** Endings that are not failures: the operation may still settle, and shows up when it does. */
export const UNSETTLED_CODES: ReadonlySet<string> = new Set(['still_processing', 'expired'])

/** What confirming an operation left open on this device came to. */
export type ResumeOutcome =
  | { status: 'confirmed' }
  /** Still not final; `firstTime` when the person has not been told yet. */
  | { status: 'unsettled'; message: string; firstTime: boolean }
  | { status: 'failed'; message: string }

/** Errors carry product-language messages that can be shown as-is. */
export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    /** Nothing reached Monad (the signature failed or was refused): trying again starts afresh. */
    readonly notSent = false,
  ) {
    super(message)
    this.name = 'DataSourceError'
  }
}

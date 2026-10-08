import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import { newId } from '@/domain/ids'
import { hasStoredCopy } from '@/domain/evidence'
import type { Evidence, ViatikState } from '@/domain/types'

import { apiFetch, apiRequest } from './api'
import {
  CONNECTION_FAILED,
  type CommandAnswer,
  type ConfirmAnswer,
  type EvidenceLink,
  type EvidenceUploadTicket,
  type LedgerAccount,
  type LedgerView,
  type VerifiedUpload,
} from './api-contract'
import {
  DataSourceError,
  type CredentialsProvider,
  type DataSource,
  type DispatchOptions,
  type EvidenceOptions,
  type InvitationPreview,
  type LedgerOptions,
  type LoadOptions,
  type OpenOperation,
  type OperationPhase,
  type ResumeOutcome,
  UNSETTLED_CODES,
  type UploadedFile,
} from './data-source'
import { assertEvidenceFile, sha256Hex } from './evidence-files'
import { forgetOpen, openOperation, openOperationsOf, rememberOpen } from './open-operations'

const PHASE_ORDER: OperationPhase[] = ['preparing', 'waiting_for_confirmation', 'processing', 'completed']

/** Waits before resending an operation whose answer never arrived (same key, so never applied twice). */
const RESEND_AFTER_MS = [800, 2000]

/**
 * No answer from Viatik itself: the connection dropped, or the hosting
 * platform answered for it (a gateway error without Viatik's error body).
 */
const UNANSWERED = new Set([CONNECTION_FAILED, '502', '503', '504'])

/** Waits between confirmations of a transaction that is not final yet (about a minute in all). */
const CONFIRM_AFTER_MS = [1_000, 2_000, 3_000, 5_000, 5_000, 8_000, 10_000, 10_000, 15_000]

/**
 * On a later visit, a short look only: nobody is waiting on a sheet, and the
 * server keeps searching Monad for it on its own (the sweep of `GET /v1/state`).
 */
const RESUME_CONFIRM_AFTER_MS = [3_000]

/** What a person is told while an operation's outcome is not known yet. */
const NOT_FINAL_YET =
  'We could not confirm it on Monad yet. If it went through, it shows up here on its own; if not, nothing was paid.'

/** Answers that leave a signed operation's outcome open: confirm again, never sign again. */
const CONFIRM_AGAIN = new Set([...UNANSWERED, 'network_unavailable', 'not_configured', 'still_processing'])

/** Answers about the request, not the operation (session, Viatik itself): keep it to confirm later. */
const KEEP_OPEN = new Set([
  'unauthenticated',
  'session_changed',
  'accounts_unavailable',
  'accounts_not_configured',
  'storage_not_configured',
  'unknown',
  'expired',
])

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Files uploaded at once; the rest wait their turn (each one is read into memory to hash it). */
const PARALLEL_UPLOADS = 3

/** A stalled upload fails after this, scaled to the file so slow connections still finish. */
const uploadDeadline = (bytes: number) => 30_000 + Math.ceil(bytes / 50)

function requireCredentials(credentials: CredentialsProvider | undefined): CredentialsProvider {
  if (!credentials) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
  return credentials
}

/**
 * Real accounts. The state lives on the server (`/api/v1`), shared by every
 * person and device; the server runs the same domain engine and ledger rules
 * the demo runs in the browser, for the person its token proves. On a world
 * bound to Monad, a command that moves something is prepared by the server,
 * signed here with the person's account (sponsored gas) and confirmed once
 * Monad has it.
 */
export class ApiDataSource implements DataSource {
  readonly kind = 'api' as const
  /** Last state read and its version, so polling an unchanged state costs a 304. */
  private copy: { userId: string; etag: string; state: ViatikState } | null = null

  async load(userId: string, options: LoadOptions = {}): Promise<ViatikState> {
    const credentials = await requireCredentials(options.credentials)()
    const known = this.copy?.userId === userId ? this.copy : null
    const response = await apiRequest('/v1/state', {
      credentials,
      ifNoneMatch: known?.etag,
      expectedUserId: userId,
    })
    // Same object as before: the query keeps its data and screens do not re-render.
    if (response.status === 304 && known) return known.state

    const state = (await response.json()) as ViatikState
    const etag = response.headers.get('etag')
    this.copy = etag ? { userId, etag, state } : null
    return state
  }

  async ledger(userId: string, options: LedgerOptions = {}): Promise<LedgerView> {
    const credentials = await requireCredentials(options.credentials)()
    return apiFetch<LedgerView>(options.refresh ? '/v1/ledger/refresh' : '/v1/ledger', {
      method: options.refresh ? 'POST' : 'GET',
      credentials,
      expectedUserId: userId,
    })
  }

  async ledgerAccount(userId: string, options: LedgerOptions = {}): Promise<LedgerAccount> {
    const credentials = await requireCredentials(options.credentials)()
    return apiFetch<LedgerAccount>('/v1/ledger/account', { method: 'GET', credentials, expectedUserId: userId })
  }

  async lookupInvitation(code: string): Promise<InvitationPreview | null> {
    try {
      return await apiFetch<InvitationPreview>(`/v1/invitations/${encodeURIComponent(code)}`, {
        credentials: { accessToken: null },
      })
    } catch (error) {
      if (error instanceof DataSourceError && error.code === 'not_found') return null
      throw error
    }
  }

  async dispatch<N extends CommandName>(
    userId: string,
    name: N,
    input: CommandInput<N>,
    options: DispatchOptions = {},
  ): Promise<CommandResult<N>> {
    const credentials = requireCredentials(options.credentials)
    const key = options.idempotencyKey ?? newId('op')

    // Phases only move forward: preparing (the request), waiting for
    // confirmation (the signature), processing (Monad confirming), completed.
    // A command that settles at once (offchain, or a world on the demo ledger)
    // goes from preparing to completed. An operation still unsettled when this
    // gives up stays in processing: it is not a failure.
    let current = -1
    const emit = (phase: OperationPhase) => {
      if (phase === 'failed') return options.onPhase?.('failed')
      const index = PHASE_ORDER.indexOf(phase)
      if (index > current) {
        current = index
        options.onPhase?.(phase)
      }
    }

    emit('preparing')
    let signing = false
    try {
      const prepare = () => this.prepare<CommandResult<N>>(userId, name, input, key, credentials)
      let { answer, replayed } = await prepare()
      // A role permit that expired before it was signed: the server prepares it again under the same key.
      if (
        'pending' in answer &&
        answer.pending.expiresAt &&
        Date.parse(answer.pending.expiresAt) <= Date.now()
      ) {
        ;({ answer, replayed } = await prepare())
      }
      if ('result' in answer) {
        emit('completed')
        return answer.result
      }

      // Signing the same key's transaction again is safe: once one of them lands, the other is
      // refused onchain (the ids repeat). Only a hash in hand for this same preparation (a replayed
      // answer) means "never sign, confirm"; a fresh preparation replaces an attempt that ended.
      const known = openOperation(key)
      const operation: OpenOperation = known ?? {
        key,
        name,
        userId,
        hash: null,
        at: new Date().toISOString(),
        fingerprint: options.fingerprint,
      }
      if (!replayed) operation.hash = null
      if (!operation.hash) {
        if (!options.sendCall) {
          throw new DataSourceError(
            'Your account is still being set up. Try again in a moment.',
            'account_not_ready',
            true,
          )
        }
        emit('waiting_for_confirmation')
        // Kept before signing: if the tab closes mid-signature, the next visit looks for it on Monad.
        rememberOpen(operation)
        signing = true
        try {
          operation.hash = await options.sendCall(answer.pending)
          rememberOpen(operation)
        } catch (error) {
          const notSent = error instanceof DataSourceError && error.notSent
          // The sponsor refusing a transaction this key may already have sent: it most likely landed.
          const mayHaveLanded = error instanceof DataSourceError && error.code === 'reverted' && replayed
          if (notSent && !mayHaveLanded) {
            if (!known) {
              forgetOpen(key)
              signing = false
              // The server stops looking for a transaction that was never sent.
              if (!replayed) void this.abandon(userId, name, key, credentials)
            }
            throw error
          }
          // Otherwise it is unclear whether it went out (a lost answer, a timeout): look for it on Monad.
        }
      }

      emit('processing')
      const result = await this.confirm<CommandResult<N>>(operation, credentials)
      emit('completed')
      return result
    } catch (error) {
      if (error instanceof DataSourceError && UNSETTLED_CODES.has(error.code)) throw error
      emit('failed')
      if (error instanceof DataSourceError) throw error
      throw signing
        ? new DataSourceError(NOT_FINAL_YET, 'still_processing')
        : new DataSourceError('Something went wrong. Nothing was changed.', 'unknown')
    }
  }

  openOperations(userId: string): OpenOperation[] {
    return openOperationsOf(userId)
  }

  async resume(operation: OpenOperation, options: DispatchOptions = {}): Promise<ResumeOutcome> {
    try {
      await this.confirm(operation, requireCredentials(options.credentials), RESUME_CONFIRM_AFTER_MS)
      return { status: 'confirmed' }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'An operation you started earlier did not go through.'
      const kept = openOperation(operation.key)
      if (!kept) return { status: 'failed', message }
      // Still open: say so once, not on every visit. An expired one is kept too, and checked again
      // quietly on later visits (one request each, until the device forgets it after a day): should
      // its transaction land late, it is still recorded, and sending it again reuses its key.
      rememberOpen({ ...kept, notifiedAt: new Date().toISOString() })
      const notFound = error instanceof DataSourceError && error.code === 'expired' && !kept.hash
      return {
        status: 'unsettled',
        message: notFound
          ? 'An operation you started earlier was not found on Monad, so nothing was paid. If it arrives late, Viatik records it.'
          : message,
        firstTime: !kept.notifiedAt,
      }
    }
  }

  /**
   * Sends the command. It settles at once (`result`), or comes back prepared
   * for the person's signature (`pending`); `replayed` when this key was
   * prepared before. An answer that never arrived is sent again with the
   * same key, which never applies it twice.
   */
  private async prepare<R>(
    userId: string,
    name: CommandName,
    input: unknown,
    idempotencyKey: string,
    credentials: CredentialsProvider,
  ): Promise<{ answer: CommandAnswer<R>; replayed: boolean }> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await apiRequest(`/v1/commands/${name}`, {
          method: 'POST',
          body: input,
          credentials: await credentials(),
          idempotencyKey,
          expectedUserId: userId,
        })
        const answer = (await response.json().catch(() => null)) as CommandAnswer<R> | null
        if (!answer)
          throw new DataSourceError(
            'We could not reach Viatik. Check your connection and try again.',
            CONNECTION_FAILED,
          )
        return { answer, replayed: response.headers.get('idempotent-replayed') === 'true' }
      } catch (error) {
        const unclear =
          error instanceof DataSourceError &&
          (UNANSWERED.has(error.code) || error.code === 'still_processing')
        const delay = RESEND_AFTER_MS[attempt]
        if (!unclear || delay === undefined) throw error
        await wait(delay)
      }
    }
  }

  /** Tells Viatik a prepared operation was never signed, so it stops looking for it (best effort). */
  private async abandon(
    userId: string,
    name: CommandName,
    idempotencyKey: string,
    credentials: CredentialsProvider,
  ) {
    try {
      await apiRequest(`/v1/commands/${name}/confirm`, {
        method: 'POST',
        body: { abandoned: true },
        credentials: await credentials(),
        idempotencyKey,
        expectedUserId: userId,
      })
    } catch {
      // The server's sweep marks it expired later anyway.
    }
  }

  /**
   * Asks Viatik to confirm a signed operation until it is final: settled, or
   * refused for good. Not final yet (202), no answer, or a hiccup: ask again,
   * a little later each time, and never sign again. A hash that is not this
   * operation's is dropped so Viatik searches Monad for the real one. The
   * entry on this device is forgotten only once the outcome is final.
   */
  private async confirm<R>(
    operation: OpenOperation,
    credentials: CredentialsProvider,
    schedule: readonly number[] = CONFIRM_AFTER_MS,
  ): Promise<R> {
    let hash = operation.hash
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await apiRequest(`/v1/commands/${operation.name}/confirm`, {
          method: 'POST',
          body: hash ? { txHash: hash } : {},
          credentials: await credentials(),
          idempotencyKey: operation.key,
          expectedUserId: operation.userId,
        })
        const answer = (await response.json().catch(() => null)) as ConfirmAnswer<R> | null
        if (answer && 'result' in answer) {
          forgetOpen(operation.key)
          return answer.result
        }
      } catch (error) {
        if (error instanceof DataSourceError) {
          if (error.code === 'unrelated_transaction') {
            hash = null
            rememberOpen({ ...openOperation(operation.key), ...operation, hash: null })
          } else if (!CONFIRM_AGAIN.has(error.code)) {
            // Not this operation's outcome (signed out, Viatik unavailable): keep it to confirm later.
            if (KEEP_OPEN.has(error.code) || /^\d+$/.test(error.code)) throw error
            forgetOpen(operation.key)
            throw error
          }
        }
        // Anything else (a hiccup in this tab) is not an outcome either: ask again.
      }
      const delay = schedule[attempt]
      if (delay === undefined) throw new DataSourceError(NOT_FINAL_YET, 'still_processing')
      await wait(delay)
    }
  }

  private uploading = 0
  private waiting: (() => void)[] = []

  async uploadEvidence(file: File, options: EvidenceOptions = {}): Promise<UploadedFile> {
    assertEvidenceFile(file)
    const credentials = requireCredentials(options.credentials)
    if (this.uploading >= PARALLEL_UPLOADS) await new Promise<void>((resolve) => this.waiting.push(resolve))
    this.uploading++
    try {
      const sha256 = await sha256Hex(file)
      const ticket = await apiFetch<EvidenceUploadTicket>('/v1/evidence', {
        method: 'POST',
        body: { name: file.name.slice(0, 300), mimeType: file.type, sizeBytes: file.size, sha256 },
        credentials: await credentials(),
      })
      // The bytes go straight to private storage; the API only checks them afterwards.
      const failed = () =>
        new DataSourceError(
          `${file.name} could not be uploaded. Check your connection and try again.`,
          'upload_failed',
        )
      let stored: Response
      try {
        stored = await fetch(ticket.uploadUrl, {
          method: 'PUT',
          headers: { 'content-type': file.type },
          body: file,
          signal: AbortSignal.timeout(uploadDeadline(file.size)),
        })
      } catch {
        throw failed()
      }
      if (!stored.ok) throw failed()
      return await apiFetch<VerifiedUpload>(`/v1/evidence/${encodeURIComponent(ticket.uploadId)}/verify`, {
        method: 'POST',
        credentials: await credentials(),
        signal: AbortSignal.timeout(uploadDeadline(file.size)),
      })
    } finally {
      this.uploading--
      this.waiting.shift()?.()
    }
  }

  canOpenEvidence(evidence: Evidence): boolean {
    return hasStoredCopy(evidence)
  }

  async evidenceLink(userId: string, evidenceId: string, options: EvidenceOptions = {}): Promise<string> {
    const { url } = await apiFetch<EvidenceLink>(`/v1/evidence/${encodeURIComponent(evidenceId)}/link`, {
      credentials: await requireCredentials(options.credentials)(),
      expectedUserId: userId,
    })
    return url
  }
}

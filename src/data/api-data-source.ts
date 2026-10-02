import type { CommandInput, CommandName, CommandResult } from '@/domain/engine'
import { newId } from '@/domain/ids'
import type { ViatikState } from '@/domain/types'

import { apiFetch, apiRequest } from './api'
import { CONNECTION_FAILED } from './api-contract'
import {
  DataSourceError,
  type CredentialsProvider,
  type DataSource,
  type DispatchOptions,
  type InvitationPreview,
  type LoadOptions,
  type OperationPhase,
} from './data-source'

const PHASE_ORDER: OperationPhase[] = ['preparing', 'waiting_for_confirmation', 'processing', 'completed']

/** A request still open after this long is shown as processing. */
const PROCESSING_AFTER_MS = 700

/** Waits before resending an operation whose answer never arrived (same key, so never applied twice). */
const RESEND_AFTER_MS = [800, 2000]

/**
 * No answer from Viatik itself: the connection dropped, or the hosting
 * platform answered for it (a gateway error without Viatik's error body).
 */
const UNANSWERED = new Set([CONNECTION_FAILED, '502', '503', '504'])

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function requireCredentials(credentials: CredentialsProvider | undefined): CredentialsProvider {
  if (!credentials) throw new DataSourceError('Sign in to continue.', 'unauthenticated')
  return credentials
}

/**
 * Real accounts. The state lives on the server (`/api/v1`), shared by every
 * person and device; the server runs the same domain engine and ledger rules
 * the demo runs in the browser, for the person its token proves.
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
    const idempotencyKey = options.idempotencyKey ?? newId('op')

    // Phases only move forward. The server answers once, when the operation
    // is settled; until then the person sees it is on its way.
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
    const processing = setTimeout(() => emit('processing'), PROCESSING_AFTER_MS)
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          const tokens = await credentials()
          emit('waiting_for_confirmation')
          const { result } = await apiFetch<{ result: CommandResult<N> }>(`/v1/commands/${name}`, {
            method: 'POST',
            body: input,
            credentials: tokens,
            idempotencyKey,
            expectedUserId: userId,
          })
          emit('completed')
          return result
        } catch (error) {
          // It may or may not have run: the same key makes resending safe
          // (an operation that did run is answered again, not repeated).
          const unanswered = error instanceof DataSourceError && UNANSWERED.has(error.code)
          const delay = RESEND_AFTER_MS[attempt]
          if (!unanswered || delay === undefined) throw error
          await wait(delay)
        }
      }
    } catch (error) {
      emit('failed')
      if (error instanceof DataSourceError) throw error
      throw new DataSourceError('Something went wrong. Nothing was changed.', 'unknown')
    } finally {
      clearTimeout(processing)
    }
  }
}

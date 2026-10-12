import {
  DomainError,
  runCommand,
  type CommandInput,
  type CommandName,
  type CommandResult,
} from '@/domain/engine'
import { createDemoState } from '@/domain/fixtures'
import { invitationPreview, withVerifiedPerson } from '@/domain/identity'
import { newId } from '@/domain/ids'
import { upgradeState } from '@/domain/migrate'
import { hasStoredCopy } from '@/domain/evidence'
import { can, subjectFor } from '@/domain/permissions'
import { findEvidence } from '@/domain/queries'
import type { Evidence, ViatikState } from '@/domain/types'
import { scopeStateForUser } from '@/domain/visibility'
import { MockLedgerAdapter } from '@/ledger/mock'

import {
  DataSourceError,
  type DataSource,
  type DispatchOptions,
  type InvitationPreview,
  type LoadOptions,
  type OperationPhase,
  type UploadedFile,
} from './data-source'
import { assertEvidenceFile, sha256Hex } from './evidence-files'
import { runDueOnMock, type KeeperDone } from './keeper'
import { applySettlement, planSettlement } from './settlement'

const STORAGE_KEY = 'viatik:demo-state'
/** Bump when the demo story or the state's shape changes: browsers holding an older copy start over. */
const STATE_VERSION = 2

/** Simulated settlement time; Monad finalizes in under a second, the demo stays close. */
const LEDGER_LATENCY_MS = 1400

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const jitter = (min: number, max: number) => min + Math.random() * (max - min)

const PHASE_ORDER: OperationPhase[] = ['preparing', 'waiting_for_confirmation', 'processing', 'completed']

/**
 * Demo data source. Runs the real domain engine in the browser against a
 * seeded state persisted in localStorage, settles money-moving commands on
 * the mock ledger (same limits as the contract) and simulates realistic
 * latency so loading states are real.
 */
export class MockDataSource implements DataSource {
  readonly kind = 'mock' as const
  private state: ViatikState | null = null
  /** Files added in this tab, by fingerprint. The demo stores nothing elsewhere. */
  private files = new Map<string, string>()
  /** Told when another tab changes this device's demo data. */
  private listeners = new Set<() => void>()

  constructor() {
    // Another tab ran an operation or reset the demo: take its copy, so this tab shows the same data.
    if (typeof window !== 'undefined') window.addEventListener('storage', (event) => this.adopt(event))
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Another tab saved the demo data. Anything unreadable is ignored and this tab keeps its copy. */
  private adopt(event: StorageEvent) {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const parsed = JSON.parse(event.newValue) as ViatikState | null
      if (!parsed || parsed.version !== STATE_VERSION) return
      this.state = upgradeState(parsed)
    } catch {
      return
    }
    for (const listener of this.listeners) listener()
  }

  private read(): ViatikState {
    if (this.state) return this.state
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as ViatikState
          if (parsed.version === STATE_VERSION) {
            this.state = upgradeState(parsed)
            return this.state
          }
        }
      } catch {
        // Corrupt or unavailable storage falls back to a fresh seed.
      }
    }
    this.state = createDemoState(new Date().toISOString())
    this.write(this.state)
    return this.state
  }

  private write(state: ViatikState) {
    // Saved under the demo's own version, not the seed's: SeedBuilder writes the state shape's
    // version (1, the server's seed too), so no saved copy was recognized and every reload and
    // every other tab started over.
    state.version = STATE_VERSION
    this.state = state
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // Storage full or blocked: keep working in memory for this session.
    }
  }

  async load(userId: string, options: LoadOptions = {}): Promise<ViatikState> {
    await wait(jitter(300, 900))
    // A real account reading the device's demo data: the same rule the server applies.
    if (options.profile) {
      const next = withVerifiedPerson(this.read(), userId, options.profile, {
        now: new Date().toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      })
      if (next) this.write(next)
    }
    return scopeStateForUser(this.read(), userId)
  }

  async lookupInvitation(code: string): Promise<InvitationPreview | null> {
    await wait(jitter(200, 500))
    return invitationPreview(this.read(), code)
  }

  async dispatch<N extends CommandName>(
    userId: string,
    name: N,
    input: CommandInput<N>,
    options: DispatchOptions = {},
  ): Promise<CommandResult<N>> {
    // Phases only move forward.
    let current = -1
    const emit = (phase: OperationPhase) => {
      if (phase === 'failed') return options.onPhase?.('failed')
      const index = PHASE_ORDER.indexOf(phase)
      if (index > current) {
        current = index
        options.onPhase?.(phase)
      }
    }

    const actor = { kind: 'user' as const, userId }
    const now = new Date().toISOString()
    const idempotencyKey = options.idempotencyKey ?? newId('op')

    emit('preparing')
    await wait(jitter(180, 420))

    const before = this.read()
    let outcome: { state: ViatikState; result: CommandResult<N> }
    try {
      outcome = runCommand(before, { actor, now, idSeed: `${userId}:${idempotencyKey}` }, name, input)
    } catch (error) {
      emit('failed')
      if (error instanceof DomainError) throw new DataSourceError(error.message, error.code)
      throw new DataSourceError('Something went wrong. Nothing was changed.', 'unknown')
    }

    const plan = planSettlement({ before, after: outcome.state, actor })
    if (plan) {
      const ledger = new MockLedgerAdapter({ latencyMs: LEDGER_LATENCY_MS, now: () => now })
      const settled = await ledger.settle(plan, {
        before,
        onStatus: (status) => {
          // `completed` is emitted once the new state is saved.
          if (status !== 'completed') emit(status)
        },
      })
      // What the ledger recorded (receipts, a request, a tranche request) joins the new state.
      applySettlement(before, outcome.state, plan, settled)
      if (settled.status === 'failed') {
        if (plan.keepOnFailure) this.write(outcome.state)
        emit('failed')
        throw new DataSourceError(
          settled.error?.message ?? 'The operation could not be completed. Nothing was moved.',
          settled.error?.code ?? 'ledger_failed',
        )
      }
    }

    this.write(outcome.state)
    emit('completed')
    return outcome.result
  }

  async uploadEvidence(file: File): Promise<UploadedFile> {
    assertEvidenceFile(file)
    const [sha256] = await Promise.all([sha256Hex(file), wait(jitter(250, 600))])
    if (!this.files.has(sha256)) this.files.set(sha256, URL.createObjectURL(file))
    return { kind: 'file', name: file.name.slice(0, 300), mimeType: file.type, sizeBytes: file.size, sha256 }
  }

  async evidenceLink(userId: string, evidenceId: string): Promise<string> {
    const item = findEvidence(scopeStateForUser(this.read(), userId), evidenceId)
    if (!item || item.kind !== 'file') throw new DataSourceError('This file is not available.', 'not_found')
    const url = this.files.get(item.sha256)
    if (!url) {
      throw new DataSourceError(
        'In the demo, a file only opens in the browser tab where it was added. Example files cannot be opened.',
        'not_stored',
      )
    }
    return url
  }

  canOpenEvidence(evidence: Evidence): boolean {
    return hasStoredCopy(evidence) && this.files.has(evidence.sha256)
  }

  /**
   * "Run due payments" in the demo: the keeper's pass for one Agency, on the
   * demo ledger (`runDueOnMock`), as an Agency Admin of it may ask on the server.
   */
  async runDuePayments(userId: string, agencyId: string): Promise<KeeperDone> {
    await wait(jitter(500, 1100))
    const state = this.read()
    if (!can(subjectFor(state, userId), 'send_payment', { agencyId, agencies: state.agencies }))
      throw new DataSourceError('You do not have permission to do this.', 'forbidden')
    const { state: next, answer } = await runDueOnMock(state, {
      now: new Date().toISOString(),
      trigger: 'manual',
      agencyId,
      by: userId,
    })
    this.write(next)
    return answer
  }

  async reset() {
    for (const url of this.files.values()) URL.revokeObjectURL(url)
    this.files.clear()
    this.write(createDemoState(new Date().toISOString()))
  }
}

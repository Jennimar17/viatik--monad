import {
  DomainError,
  runCommand,
  type CommandInput,
  type CommandName,
  type CommandResult,
} from '@/domain/engine'
import { createDemoState } from '@/domain/fixtures'
import { newId } from '@/domain/ids'
import type { ViatikState } from '@/domain/types'
import { scopeStateForUser } from '@/domain/visibility'
import { MockLedgerAdapter } from '@/ledger/mock'

import {
  DataSourceError,
  type DataSource,
  type DispatchOptions,
  type InvitationPreview,
  type LoadOptions,
  type OperationPhase,
  type SessionProfile,
} from './data-source'
import { planSettlement } from './settlement'

/**
 * A real account the demo data has never seen (anyone but Elena, Maya and
 * Alex). They start with no memberships: they create a portfolio or accept an
 * invitation. Their profile comes from what the server verified.
 */
function withNewPerson(state: ViatikState, userId: string, profile: SessionProfile): ViatikState {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  return {
    ...state,
    users: [
      ...state.users,
      {
        id: userId,
        name: profile.name ?? profile.email ?? 'New member',
        email: profile.email ?? '',
        title: '',
        timeZone,
        locale: 'en-US',
        createdAt: new Date().toISOString(),
      },
    ],
  }
}

const STORAGE_KEY = 'viatik:demo-state'
const STATE_VERSION = 1

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

  private read(): ViatikState {
    if (this.state) return this.state
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as ViatikState
          if (parsed.version === STATE_VERSION) {
            this.state = parsed
            return parsed
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
    const state = this.read()
    const profile = options.profile
    const known = state.users.find((u) => u.id === userId)
    if (profile && !known) {
      this.write(withNewPerson(state, userId, profile))
    } else if (profile?.email && known && known.email !== profile.email) {
      // A demo person signed in with a real account: the verified email wins,
      // as it does on the server, so invitations check the address they proved.
      this.write({
        ...state,
        users: state.users.map((u) => (u.id === userId ? { ...u, email: profile.email as string } : u)),
      })
    }
    return scopeStateForUser(this.read(), userId)
  }

  async lookupInvitation(code: string): Promise<InvitationPreview | null> {
    await wait(jitter(200, 500))
    const state = this.read()
    const invitation = state.invitations.find((i) => i.code === code)
    if (!invitation) return null
    const workspace =
      invitation.scope.kind === 'agency'
        ? state.agencies.find((a) => a.id === (invitation.scope as { agencyId: string }).agencyId)?.name
        : state.portfolios.find((p) => p.id === (invitation.scope as { portfolioId: string }).portfolioId)
            ?.name
    return {
      code: invitation.code,
      name: invitation.name,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
      workspace: workspace ?? 'Viatik',
      invitedBy: state.users.find((u) => u.id === invitation.invitedBy)?.name ?? 'Your team',
    }
  }

  async dispatch<N extends CommandName>(
    userId: string,
    name: N,
    input: CommandInput<N>,
    options: DispatchOptions = {},
  ): Promise<CommandResult<N>> {
    // Phases only move forward, even when settlement takes several ledger calls.
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
      outcome = runCommand(before, { actor, now }, name, input)
    } catch (error) {
      emit('failed')
      if (error instanceof DomainError) throw new DataSourceError(error.message, error.code)
      throw new DataSourceError('Something went wrong. Nothing was changed.', 'unknown')
    }

    const plan = planSettlement({
      name,
      input,
      result: outcome.result,
      before,
      after: outcome.state,
      actor,
      idempotencyKey,
    })

    if (plan) {
      const ledger = new MockLedgerAdapter({
        latencyMs: LEDGER_LATENCY_MS,
        now: () => now,
        onStatus: (status) => {
          // `completed` is emitted once the new state is saved.
          if (status !== 'completed') emit(status)
        },
      })
      const settled = await plan.settle(ledger)
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

  async reset() {
    this.write(createDemoState(new Date().toISOString()))
  }
}

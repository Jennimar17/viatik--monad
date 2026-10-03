import { USDC } from '@/web3/addresses'
import { chains, type MonadNetwork } from '@/web3/chains'

import type { Balances, LedgerAdapter, SettlementPlan, SettlementResult } from './types'

export type MonadLedgerConfig = {
  network: MonadNetwork
  rpcUrl?: string
  /** Deployed ViatikLedger contract (contracts phase). */
  ledgerAddress?: `0x${string}`
}

/**
 * Monad implementation of the ledger boundary.
 *
 * Step 8.2 wires this to the deployed ViatikLedger contract with viem: a
 * plan becomes one multicall the person's account signs with sponsored gas,
 * simulated first and confirmed from its events; reads use Multicall3 against
 * Monad directly so balances never depend on the indexer. Until then every
 * plan reports `not_configured` instead of pretending to settle.
 */
export class MonadLedgerAdapter implements LedgerAdapter {
  readonly simulated = false
  readonly network: MonadNetwork

  constructor(private readonly config: MonadLedgerConfig) {
    this.network = config.network
  }

  get chain() {
    return chains[this.network]
  }

  get usdc() {
    return USDC[this.network]
  }

  get isConfigured() {
    return Boolean(this.config.ledgerAddress)
  }

  async settle(plan: SettlementPlan): Promise<SettlementResult> {
    // Refused before the ledger: nothing to send.
    if (plan.ops.length === 0 && plan.uncovered.length === 0)
      return plan.refusal
        ? { status: 'failed', records: [], error: plan.refusal }
        : { status: 'completed', records: [] }
    // Joining needs the registrar's permit, which arrives in step 8.5.
    if (plan.uncovered.length > 0 || plan.ops.some((op) => op.call === 'join')) {
      return {
        status: 'failed',
        records: [],
        error: {
          code: 'not_supported_onchain',
          message: 'This operation is not settled on the ledger yet. Nothing was moved.',
          retryable: false,
        },
      }
    }
    return {
      status: 'failed',
      records: [],
      error: {
        code: 'not_configured',
        message:
          'Onchain settlement is not connected yet. Switch to the demo ledger or finish the Monad setup.',
        retryable: false,
      },
    }
  }

  async readBalances(): Promise<Balances> {
    return { accounts: {}, budgets: {}, vaults: {}, members: {}, readAt: new Date().toISOString() }
  }
}

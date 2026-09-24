import type { Id, VerifiedDetails } from '@/domain/types'
import { USDC } from '@/web3/addresses'
import { chains, type MonadNetwork } from '@/web3/chains'

import type { Balances, LedgerAdapter, LedgerResult } from './types'

export type MonadLedgerConfig = {
  network: MonadNetwork
  rpcUrl?: string
  /** Deployed ViatikLedger contract (contracts phase). */
  ledgerAddress?: `0x${string}`
}

const notConfigured = (operationId: Id): LedgerResult => ({
  status: 'failed',
  operationId,
  error: {
    code: 'not_configured',
    message: 'Onchain settlement is not connected yet. Switch to the demo ledger or finish the Monad setup.',
    retryable: false,
  },
})

/**
 * Monad implementation of the ledger boundary.
 *
 * The contracts phase wires this to the deployed ViatikLedger contract with
 * viem: writes go through the user's smart account with sponsored gas; reads
 * use Multicall3 against Monad directly so balances never depend on the
 * indexer. Until then every call reports `not_configured` instead of
 * pretending to settle.
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

  async createAgency(input: { agencyId: Id }) {
    return notConfigured(input.agencyId)
  }
  async createAgreement(input: { agreementId: Id }) {
    return notConfigured(input.agreementId)
  }
  async fundAgreement(input: { agreementId: Id }) {
    return notConfigured(input.agreementId)
  }
  async requestTranche(input: { trancheId: Id }) {
    return notConfigured(input.trancheId)
  }
  async submitMilestoneEvidence(input: { milestoneId: Id }) {
    return notConfigured(input.milestoneId)
  }
  async releaseTranche(input: { trancheId: Id }) {
    return notConfigured(input.trancheId)
  }
  async createAccount(input: { accountId: Id }) {
    return notConfigured(input.accountId)
  }
  async transfer(input: { fromAccountId: Id }) {
    return notConfigured(input.fromAccountId)
  }
  async createBudget(input: { budgetId: Id }) {
    return notConfigured(input.budgetId)
  }
  async setAllowance(input: { budgetId: Id }) {
    return notConfigured(input.budgetId)
  }
  async requestPayment(input: { requestId: Id }) {
    return notConfigured(input.requestId)
  }
  async approvePayment(input: { requestId: Id }) {
    return notConfigured(input.requestId)
  }
  async capturePayment(input: { paymentId: Id }) {
    return notConfigured(input.paymentId)
  }
  async pauseBudget(input: { budgetId: Id }) {
    return notConfigured(input.budgetId)
  }
  async pauseAgent(input: { agentId: Id }) {
    return notConfigured(input.agentId)
  }
  async readBalances(): Promise<Balances> {
    return { accounts: {}, budgets: {}, vaults: {}, readAt: new Date().toISOString() }
  }
  async getVerifiedDetails(): Promise<VerifiedDetails | null> {
    return null
  }
}

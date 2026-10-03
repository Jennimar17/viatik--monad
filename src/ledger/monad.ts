import {
  createPublicClient,
  createWalletClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  isAddress,
  isAddressEqual,
  parseEventLogs,
  type Address,
  type Chain,
  type Hex,
  type LocalAccount,
  type Log,
  type TransactionReceipt,
} from 'viem'
import { entryPoint07Abi } from 'viem/account-abstraction'

import { formatUsd, type Cents } from '@/domain/money'
import type { Id, ISODate } from '@/domain/types'
import { confirmedVerification } from '@/domain/verification'
import { testUsdAbi } from '@/web3/abi/test-usd'
import { viatikLedgerAbi } from '@/web3/abi/viatik-ledger'
import { ENTRY_POINT_V07 } from '@/web3/addresses'
import { chains, GAS_LIMIT_MULTIPLIER, type MonadNetwork } from '@/web3/chains'

import { encodePlan, LEDGER_ROLE, NotEncodable, receiptHashOf, scopeIdOf, type JoinPermit } from './encode'
import type { Genesis, GenesisRun, GenesisTransaction } from './genesis'
import { ledgerId, witnessesOf, type LedgerEvent, type Witness } from './ids'
import { decodeLedgerError, isRevert, ledgerErrorOf } from './revert'
import type {
  Balances,
  ChainContext,
  ConfirmedTx,
  LedgerAdapter,
  LedgerCall,
  LedgerError,
  LedgerErrorCode,
  LedgerOp,
  LedgerRecord,
  PreparedTx,
  RequestOutcome,
  SettleContext,
  SettlementPlan,
  SettlementResult,
} from './types'
import { centsToUnits, unitsToCents } from './units'

export type MonadLedgerConfig = {
  network: MonadNetwork
  rpcUrl?: string
  /** Deployed ViatikLedger contract. */
  ledgerAddress?: Address
  /** The settlement token the ledger was deployed with (TestUSD on testnet). */
  tokenAddress?: Address
  /** The ledger's deployment block: the earliest worth scanning for its events. */
  deployBlock?: bigint
  /** Server key that signs role permits (`join`) and runs the genesis. */
  registrar?: LocalAccount
  /** Accounts the server may sign with (scripts, a relayer). People sign in their browser. */
  signers?: LocalAccount[]
  /** Another chain with the same contract (a local rehearsal). */
  chain?: Chain
}

/** A genesis goes in one multicall when it fits this much gas (Monad caps a transaction at 30M), in chunks otherwise. */
const GENESIS_CHUNK_GAS = 20_000_000n

/** How long a role permit stays valid after it is prepared. */
const PERMIT_TTL_SECONDS = 60n * 60n
/** `RequestStatus` in the contract. */
const REQUEST_STATUS: Record<number, RequestOutcome | undefined> = {
  1: 'pending',
  2: 'executed',
  3: 'rejected',
}
/** `Reason` in the contract. */
const REASON: Record<number, LedgerErrorCode | undefined> = {
  1: 'budget_paused',
  2: 'destination_not_allowed',
  3: 'limit_exceeded',
  4: 'insufficient_funds',
}

/** Why the ledger would reject a payment the app accepted, as the mock words it. */
const REJECTION_MESSAGE: Partial<Record<LedgerErrorCode, (amount: string) => string>> = {
  budget_paused: () => 'This budget is paused.',
  destination_not_allowed: () => 'This payment destination is not approved for this budget.',
  limit_exceeded: (amount) => `The amount exceeds the per-operation limit of ${amount}.`,
  insufficient_funds: (amount) => `The budget has ${amount} available.`,
}
const DRIFT_MESSAGE = 'The ledger and the app disagree about this payment. Nothing was moved.'
/** Said after a transaction landed, so it never claims that nothing moved. */
const DIVERGED_MESSAGE = 'Monad recorded this differently from what was prepared. It is flagged for review.'
const NOT_THROUGH: LedgerError = {
  code: 'unknown',
  message: 'The transaction did not go through. Nothing was moved.',
  retryable: true,
}

const failed = (code: LedgerErrorCode, message: string, retryable = false): SettlementResult => ({
  status: 'failed',
  records: [],
  error: { code, message, retryable },
})

/** A failure from Monad or the RPC, in product words. */
const failedWith = (error: unknown): SettlementResult => {
  const { raw: _raw, ...decoded } = decodeLedgerError(error)
  return { status: 'failed', records: [], error: decoded }
}

const NOT_CONFIGURED = failed(
  'not_configured',
  'Onchain settlement is not connected yet. Switch to the demo ledger or finish the Monad setup.',
)

export type Prepared = { status: 'ready'; tx: PreparedTx } | { status: 'done'; result: SettlementResult }

/** The logs a transaction emitted for the prepared account alone, or why there are none. */
type OwnLogs =
  | { kind: 'own'; logs: Log[] }
  | { kind: 'failed'; error: LedgerError }
  | { kind: 'unrelated'; problem: string }

/**
 * Monad implementation of the ledger boundary, on the deployed ViatikLedger.
 *
 * A plan becomes one `multicall` transaction. `prepare` encodes it and
 * simulates it from the signer's own account (the rules depend on who calls,
 * and only a simulation returns the error's name); the person signs it in
 * their browser with sponsored gas; `confirm` reads what the ledger recorded
 * from the transaction's events. `settle` does all three for an account the
 * server holds (scripts, a relayer). Balances are read straight from Monad.
 */
export class MonadLedgerAdapter implements LedgerAdapter {
  readonly simulated = false
  readonly network: MonadNetwork
  private readonly client

  constructor(private readonly config: MonadLedgerConfig) {
    this.network = config.network
    this.client = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl) })
  }

  get chain(): Chain {
    return this.config.chain ?? chains[this.network]
  }

  get isConfigured() {
    return Boolean(this.config.ledgerAddress)
  }

  private get ledger(): Address {
    if (!this.config.ledgerAddress) throw new Error('The ledger address is not configured.')
    return this.config.ledgerAddress
  }

  /** The ledger is reachable, on the expected chain, with its token and the registrar's key. */
  async check(): Promise<{ ok: true } | { ok: false; problem: string }> {
    if (!this.isConfigured) return { ok: false, problem: 'not_configured' }
    try {
      const [chainId, token, registrar] = await Promise.all([
        this.client.getChainId(),
        this.client.readContract({ address: this.ledger, abi: viatikLedgerAbi, functionName: 'TOKEN' }),
        this.client.readContract({ address: this.ledger, abi: viatikLedgerAbi, functionName: 'registrar' }),
      ])
      if (chainId !== this.chain.id)
        return { ok: false, problem: `chain ${chainId}, expected ${this.chain.id}` }
      if (this.config.tokenAddress && !isAddressEqual(token, this.config.tokenAddress))
        return { ok: false, problem: `token ${token}, expected ${this.config.tokenAddress}` }
      // Without the ledger's registrar key nobody can join a workspace.
      if (!this.config.registrar)
        return { ok: false, problem: `no registrar key (the ledger's is ${registrar})` }
      if (!isAddressEqual(registrar, this.config.registrar.address))
        return { ok: false, problem: `registrar ${registrar}, configured ${this.config.registrar.address}` }
      const decimals = await this.client.readContract({
        address: token,
        abi: testUsdAbi,
        functionName: 'decimals',
      })
      if (decimals !== 6) return { ok: false, problem: `token has ${decimals} decimals, expected 6` }
      return { ok: true }
    } catch (error) {
      return { ok: false, problem: decodeLedgerError(error).raw }
    }
  }

  /** Encodes the plan and simulates it from the signer's account. Never throws: failures come back as results. */
  async prepare(plan: SettlementPlan, context: ChainContext): Promise<Prepared> {
    if (!this.isConfigured) return { status: 'done', result: NOT_CONFIGURED }
    if (plan.ops.length === 0 && plan.uncovered.length === 0) {
      return {
        status: 'done',
        result: plan.refusal
          ? { status: 'failed', records: [], error: plan.refusal }
          : { status: 'completed', records: [] },
      }
    }
    if (plan.uncovered.length > 0)
      return {
        status: 'done',
        result: failed(
          'not_supported_onchain',
          'This operation is not settled on the ledger yet. Nothing was moved.',
        ),
      }
    const chain = withValidAddresses(context)
    const from = plan.signerUserId ? (chain.signerOf ?? chain.addressOf)(plan.signerUserId) : undefined
    if (!from)
      return {
        status: 'done',
        result: failed(
          'account_not_ready',
          'Your account is still being set up. Try again in a moment.',
          true,
        ),
      }

    try {
      const permits = await this.permitsFor(plan.ops, chain)
      const { data } = encodePlan(plan.ops, chain, permits)
      const records = plan.records.map((record) => ({ ...record, receiptHash: receiptHashOf(record, chain) }))
      // Uncached: the confirmation only accepts a transaction from a later block.
      const preparedBlock = Number(await this.client.getBlockNumber({ cacheTime: 0 }))
      const returned = (await this.client.call({ account: from, to: this.ledger, data })).data

      const drift = await this.compareOutcomes(plan, returned, from, chain)
      if (drift) return { status: 'done', result: drift }

      const deadlines = [...permits.values()].map((permit) => Number(permit.deadline))
      return {
        status: 'ready',
        tx: {
          to: this.ledger,
          data,
          chainId: this.chain.id,
          from,
          plan,
          namespace: chain.namespace,
          records,
          preparedBlock,
          expiresAt: deadlines.length > 0 ? new Date(Math.min(...deadlines) * 1000).toISOString() : null,
        },
      }
    } catch (error) {
      if (!(error instanceof NotEncodable)) return { status: 'done', result: failedWith(error) }
      return {
        status: 'done',
        result:
          error.missing === 'registrar'
            ? failed(
                'not_configured',
                'Joining a workspace on the ledger is not set up yet. Nothing was moved.',
              )
            : failed(
                'account_not_ready',
                'Someone in this operation has not finished setting up their account. Try again later.',
                true,
              ),
      }
    }
  }

  /**
   * Reads what the ledger recorded in a transaction and checks it is the one
   * prepared: from a block after the simulation, sent by the prepared account
   * (through its own user operation when gas was sponsored), with every
   * witness and receipt hash. Never throws: an unreadable receipt is pending.
   */
  async confirm(
    tx: PreparedTx,
    hash: Hex,
    context: ChainContext,
    { timeoutMs = 15_000 }: { timeoutMs?: number } = {},
  ): Promise<ConfirmedTx> {
    if (tx.chainId !== this.chain.id || !isAddressEqual(tx.to, this.ledger))
      return { status: 'unrelated', hash, problem: 'prepared for another ledger deployment' }
    let receipt: TransactionReceipt
    let timestamp: ISODate
    try {
      receipt = await this.client.waitForTransactionReceipt({ hash, timeout: timeoutMs })
      const block = await this.client.getBlock({ blockNumber: receipt.blockNumber })
      timestamp = new Date(Number(block.timestamp) * 1000).toISOString()
    } catch (error) {
      return { status: 'pending', hash, problem: decodeLedgerError(error).raw }
    }
    if (receipt.blockNumber <= BigInt(tx.preparedBlock))
      return { status: 'unrelated', hash, problem: 'it landed before this operation was prepared' }

    const done = (landed: boolean, result: SettlementResult): ConfirmedTx => ({
      status: 'confirmed',
      hash,
      block: Number(receipt.blockNumber),
      timestamp,
      landed,
      result,
    })
    const own = this.ownLogs(receipt, tx.from)
    if (own.kind === 'unrelated') return { status: 'unrelated', hash, problem: own.problem }
    if (own.kind === 'failed') return done(false, { status: 'failed', records: [], error: own.error })

    const events = parseEventLogs({ abi: viatikLedgerAbi, logs: own.logs }).filter(
      (event) => event.eventName !== 'Recorded' || isAddressEqual(event.args.actor, tx.from),
    )
    if (events.length === 0) return done(false, { status: 'failed', records: [], error: NOT_THROUGH })

    const chain = withValidAddresses(context)
    const id = (productId: Id) => ledgerId(tx.namespace, productId)
    const recorded = new Map<Hex, Hex>()
    for (const event of events) {
      if (event.eventName === 'Recorded') recorded.set(event.args.opId, event.args.receiptHash)
    }
    const verified = (opId: Id, receiptHash?: Hex) =>
      confirmedVerification({
        network: this.network,
        account: tx.from,
        transaction: hash,
        block: Number(receipt.blockNumber),
        timestamp,
        contract: this.ledger,
        operationRef: id(opId),
        receiptHash,
        contractPolicy: 'ViatikLedger',
      })

    // What landed, with the hashes the ledger emitted (the prepared ones, unless it diverged). A
    // payment request records under its request id while it waits and under its payment id once paid,
    // so both are looked up: a request prepared to wait that the ledger paid still shows what happened.
    const callOf = recordCalls(tx.plan.ops)
    const opIds = new Set(tx.records.map((record) => record.opId))
    for (const op of tx.plan.ops) {
      if (op.call === 'requestPayment') opIds.add(op.requestId).add(op.paymentId)
    }
    const records: LedgerRecord[] = [...opIds]
      .filter((opId) => recorded.has(id(opId)))
      .map((opId) => ({
        opId,
        call: callOf.get(opId) ?? 'requestPayment',
        ...requestOutcome(events, id, opId, tx.plan.ops),
        verified: verified(opId, recorded.get(id(opId))),
      }))
    for (const op of tx.plan.ops) {
      if (op.call !== 'requestTranche') continue
      const tranche = id(op.trancheId)
      if (events.some((event) => event.eventName === 'TrancheRequested' && event.args.tranche === tranche))
        records.push({ opId: op.trancheId, call: 'requestTranche', verified: verified(op.trancheId) })
    }

    const missing = witnessesOf(tx.plan).some(
      (witness) => !events.some((event) => matches(event, witness, tx.namespace, chain)),
    )
    const altered = tx.records.some((record) => recorded.get(id(record.opId)) !== record.receiptHash)
    if (missing || altered)
      return done(true, {
        status: 'failed',
        records,
        error: { code: 'rule_drift', message: DIVERGED_MESSAGE, retryable: false },
      })

    // A rejection the ledger recorded is a successful transaction that still answers no.
    const rejected = records.some((record) => record.outcome === 'rejected')
    return done(
      true,
      rejected
        ? {
            status: 'failed',
            records,
            error: tx.plan.refusal ?? {
              code: 'limit_exceeded',
              message: 'The ledger rejected this payment.',
              retryable: false,
            },
          }
        : { status: 'completed', records },
    )
  }

  /** Prepares, signs with an account the server holds, and confirms. People sign in their browser instead. */
  async settle(plan: SettlementPlan, { chain, onStatus }: SettleContext): Promise<SettlementResult> {
    const emit = onStatus ?? (() => {})
    if (!chain) return NOT_CONFIGURED
    emit('preparing')
    const prepared = await this.prepare(plan, chain)
    if (prepared.status === 'done') {
      emit(prepared.result.status === 'completed' ? 'completed' : 'failed')
      return prepared.result
    }
    const { tx } = prepared
    const signer = this.config.signers?.find((account) => isAddressEqual(account.address, tx.from))
    if (!signer) {
      emit('failed')
      return failed('account_not_ready', 'This account signs in the browser.')
    }
    let hash: Hex
    try {
      emit('waiting_for_confirmation')
      const wallet = createWalletClient({
        account: signer,
        chain: this.chain,
        transport: http(this.config.rpcUrl),
      })
      // Monad charges the gas limit, so the estimate is padded modestly.
      const estimate = await this.client.estimateGas({ account: signer, to: tx.to, data: tx.data })
      const gas = (estimate * BigInt(Math.round(GAS_LIMIT_MULTIPLIER * 100))) / 100n
      hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, gas })
    } catch (error) {
      emit('failed')
      return failedWith(error)
    }
    // The transaction is out: from here a failure is never reported as "not sent".
    emit('processing')
    const confirmed = await this.confirm(tx, hash, chain, { timeoutMs: 30_000 })
    if (confirmed.status !== 'confirmed') {
      emit('failed')
      return failed('still_processing', 'Sent to Monad and not confirmed yet. Check again before retrying.')
    }
    emit(confirmed.result.status === 'completed' ? 'completed' : 'failed')
    return confirmed.result
  }

  /**
   * Sends a genesis from the owner's key (the registrar's on testnet). It is
   * simulated whole first: a call that would revert is named by bisecting
   * the simulation, and nothing is sent. A genesis that fits one transaction
   * goes in one `multicall`, so nobody can take a seeded id halfway; a bigger
   * one goes in chunks, each simulated before it is sent. A failure stops it
   * and nothing is undone: run it again under a fresh namespace.
   */
  async runGenesis(
    genesis: Genesis,
    { onProgress }: { onProgress?: (done: number, total: number) => void } = {},
  ): Promise<GenesisRun> {
    const transactions: GenesisTransaction[] = []
    const stop = (failedAt: string, problem: string): GenesisRun => ({
      status: 'failed',
      namespace: genesis.namespace,
      transactions,
      failedAt,
      problem,
    })
    const owner = this.config.registrar
    if (!this.isConfigured || !owner)
      return stop('setup', 'the ledger or the registrar key is not configured')
    try {
      const onchainOwner = await this.client.readContract({
        address: this.ledger,
        abi: viatikLedgerAbi,
        functionName: 'owner',
      })
      if (!isAddressEqual(onchainOwner, owner.address))
        return stop(
          'setup',
          `the ledger's owner is ${onchainOwner}, not the registrar key's ${owner.address}`,
        )
    } catch (error) {
      return stop('setup', decodeLedgerError(error).raw)
    }
    const wallet = createWalletClient({
      account: owner,
      chain: this.chain,
      transport: http(this.config.rpcUrl),
    })
    const multicall = (calls: Genesis['calls']) =>
      encodeFunctionData({
        abi: viatikLedgerAbi,
        functionName: 'multicall',
        args: [calls.map((c) => c.data)],
      })
    const estimate = (calls: Genesis['calls']) =>
      this.client.estimateGas({ account: owner, to: this.ledger, data: multicall(calls) })
    /** The first call that makes these revert: the shortest reverting prefix, found by simulation only. */
    const firstReverting = async (calls: Genesis['calls'], failure: unknown) => {
      let low = 1
      let high = calls.length
      let error = failure
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        try {
          await estimate(calls.slice(0, middle))
          low = middle + 1
        } catch (cause) {
          if (!isRevert(cause)) throw cause
          high = middle
          error = cause
        }
      }
      return { label: calls[high - 1]!.label, problem: decodeLedgerError(error).raw }
    }

    let index = 0
    while (index < genesis.calls.length) {
      // The rest of the genesis at once, halved only while it does not fit a transaction.
      let size = genesis.calls.length - index
      let gas = 0n
      try {
        for (;;) {
          const chunk = genesis.calls.slice(index, index + size)
          try {
            gas = await estimate(chunk)
            if (gas <= GENESIS_CHUNK_GAS || size === 1) break
          } catch (error) {
            if (isRevert(error)) {
              const failing = await firstReverting(chunk, error)
              return stop(failing.label, failing.problem)
            }
            if (size === 1) return stop(chunk[0]!.label, decodeLedgerError(error).raw)
          }
          size = Math.ceil(size / 2)
        }
      } catch (error) {
        return stop('simulation', decodeLedgerError(error).raw)
      }
      const chunk = genesis.calls.slice(index, index + size)
      let sent: GenesisTransaction | undefined
      try {
        const hash = await wallet.sendTransaction({
          to: this.ledger,
          data: multicall(chunk),
          gas: (gas * BigInt(Math.round(GAS_LIMIT_MULTIPLIER * 100))) / 100n,
        })
        // Kept before waiting: a transaction that times out may still land.
        sent = { hash, calls: size }
        transactions.push(sent)
        const receipt = await this.client.waitForTransactionReceipt({ hash, timeout: 60_000 })
        sent.block = Number(receipt.blockNumber)
        sent.gasUsed = Number(receipt.gasUsed)
        if (receipt.status !== 'success') return stop(chunk[0]!.label, `transaction ${hash} reverted`)
      } catch (error) {
        return stop(chunk[0]!.label, decodeLedgerError(error).raw)
      }
      index += size
      onProgress?.(index, genesis.calls.length)
    }
    return { status: 'completed', namespace: genesis.namespace, transactions }
  }

  async readBalances(input: Parameters<LedgerAdapter['readBalances']>[0]): Promise<Balances> {
    const empty: Balances = {
      accounts: {},
      budgets: {},
      vaults: {},
      members: {},
      readAt: new Date().toISOString(),
    }
    if (!this.isConfigured || !input.chain) return empty
    const chain = withValidAddresses(input.chain)
    const id = (productId: Id) => ledgerId(chain.namespace, productId)
    const locations = [...input.accountIds, ...input.budgetIds, ...input.vaultIds]
    const members = (input.members ?? []).filter((m) => chain.addressOf(m.userId))
    // Every read at one block, so the snapshot is consistent and says which block it is.
    const blockNumber =
      input.block !== undefined ? BigInt(input.block) : await this.client.getBlockNumber({ cacheTime: 0 })
    const contracts = [
      ...locations.map(
        (locationId) =>
          ({
            address: this.ledger,
            abi: viatikLedgerAbi,
            functionName: 'balanceOf',
            args: [id(locationId)],
          }) as const,
      ),
      ...members.map(
        (m) =>
          ({
            address: this.ledger,
            abi: viatikLedgerAbi,
            functionName: 'memberBalance',
            args: [id(m.agencyId), chain.addressOf(m.userId)!],
          }) as const,
      ),
    ]
    // One Multicall3 read where the chain has it (Monad does); one read each otherwise (a local chain).
    const results = this.chain.contracts?.multicall3
      ? await this.client.multicall({ allowFailure: false, contracts, blockNumber, batchSize: 16_384 })
      : await Promise.all([
          ...locations.map((locationId) =>
            this.client.readContract({
              address: this.ledger,
              abi: viatikLedgerAbi,
              functionName: 'balanceOf',
              args: [id(locationId)],
              blockNumber,
            }),
          ),
          ...members.map((m) =>
            this.client.readContract({
              address: this.ledger,
              abi: viatikLedgerAbi,
              functionName: 'memberBalance',
              args: [id(m.agencyId), chain.addressOf(m.userId)!],
              blockNumber,
            }),
          ),
        ])
    const toCents = (units: unknown) => unitsToCents(units as bigint).cents
    const balances: Balances = { ...empty, block: Number(blockNumber) }
    let i = 0
    for (const accountId of input.accountIds) balances.accounts[accountId] = toCents(results[i++])
    for (const budgetId of input.budgetIds) balances.budgets[budgetId] = toCents(results[i++])
    for (const vaultId of input.vaultIds) balances.vaults[vaultId] = toCents(results[i++])
    for (const m of members) {
      balances.members[m.agencyId] = { ...balances.members[m.agencyId], [m.userId]: toCents(results[i++]) }
    }
    return balances
  }

  /**
   * The prepared account's own logs on the ledger. A sponsored transaction is
   * the bundler's `handleOps`: the outer transaction succeeds even when a user
   * operation fails, and it can carry other accounts' operations. Only the
   * logs between the previous user operation (or `BeforeExecution`) and this
   * account's `UserOperationEvent` are its own. A direct transaction must be
   * the account's, to the ledger.
   */
  private ownLogs(receipt: TransactionReceipt, from: Address): OwnLogs {
    const onLedger = (log: Log) => isAddressEqual(log.address, this.ledger)
    const entryPoint = parseEventLogs({
      abi: entryPoint07Abi,
      logs: receipt.logs.filter((log) => isAddressEqual(log.address, ENTRY_POINT_V07)),
    })
    const userOps = entryPoint.filter((event) => event.eventName === 'UserOperationEvent')
    if (userOps.length === 0) {
      // A reverted transaction moved nothing, whoever sent it (a bundle that reverted has no user operations).
      if (receipt.status !== 'success') return { kind: 'failed', error: NOT_THROUGH }
      if (!isAddressEqual(receipt.from, from) || !receipt.to || !isAddressEqual(receipt.to, this.ledger))
        return { kind: 'unrelated', problem: 'not sent by the prepared account' }
      return { kind: 'own', logs: receipt.logs.filter(onLedger) }
    }
    // A bundle holds at most one operation per unstaked account (ERC-7562).
    const mine = userOps.find((event) => isAddressEqual(event.args.sender, from))
    if (!mine) return { kind: 'unrelated', problem: 'no user operation from the prepared account' }
    if (!mine.args.success) {
      const reason = entryPoint.find(
        (event) =>
          event.eventName === 'UserOperationRevertReason' && event.args.userOpHash === mine.args.userOpHash,
      )
      const decoded =
        reason?.eventName === 'UserOperationRevertReason' && ledgerErrorOf(reason.args.revertReason)
      if (!decoded) return { kind: 'failed', error: NOT_THROUGH }
      const { raw: _raw, ...error } = decoded
      return { kind: 'failed', error }
    }
    const start = Math.max(
      -1,
      ...entryPoint
        .filter(
          (event) =>
            (event.eventName === 'UserOperationEvent' || event.eventName === 'BeforeExecution') &&
            event.logIndex < mine.logIndex,
        )
        .map((event) => event.logIndex),
    )
    return {
      kind: 'own',
      logs: receipt.logs.filter(
        (log) => onLedger(log) && log.logIndex > start && log.logIndex < mine.logIndex,
      ),
    }
  }

  /** Role permits for the plan's `join`s, signed by the registrar for the account that joins. */
  private async permitsFor(ops: readonly LedgerOp[], chain: ChainContext) {
    const permits = new Map<LedgerOp, JoinPermit>()
    const joins = ops.filter((op): op is Extract<LedgerOp, { call: 'join' }> => op.call === 'join')
    if (joins.length === 0) return permits
    const registrar = this.config.registrar
    if (!registrar) throw new NotEncodable('registrar')
    const nextNonce = new Map<Address, bigint>()
    const deadline = BigInt(Math.floor(Date.now() / 1000)) + PERMIT_TTL_SECONDS
    for (const op of joins) {
      const account = chain.addressOf(op.userId)
      if (!account) throw new NotEncodable('account', op.userId)
      const nonce =
        nextNonce.get(account) ??
        (await this.client.readContract({
          address: this.ledger,
          abi: viatikLedgerAbi,
          functionName: 'nonces',
          args: [account],
        }))
      nextNonce.set(account, nonce + 1n)
      const signature = await registrar.signTypedData({
        domain: {
          name: 'ViatikLedger',
          version: '1',
          chainId: this.chain.id,
          verifyingContract: this.ledger,
        },
        types: {
          Join: [
            { name: 'account', type: 'address' },
            { name: 'scope', type: 'bytes32' },
            { name: 'role', type: 'uint8' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' },
          ],
        },
        primaryType: 'Join',
        message: {
          account,
          scope: ledgerId(chain.namespace, scopeIdOf(op.scope)),
          role: LEDGER_ROLE[op.role],
          nonce,
          deadline,
        },
      })
      permits.set(op, { nonce, deadline, signature })
    }
    return permits
  }

  /**
   * Compares what the simulation says each payment request would do with what
   * the app decided, the way the mock does: an app rejection the ledger would
   * not make stays offchain; any other disagreement stops before signing.
   * The reason comes from `checkPayment` on the latest state, which matches
   * the simulation while a plan holds one payment request (every command today).
   */
  private async compareOutcomes(
    plan: SettlementPlan,
    returned: Hex | undefined,
    from: Address,
    chain: ChainContext,
  ): Promise<SettlementResult | null> {
    if (!plan.ops.some((op) => op.call === 'requestPayment')) return null
    const results = decodeFunctionResult({
      abi: viatikLedgerAbi,
      functionName: 'multicall',
      data: returned ?? '0x',
    })
    for (const [index, op] of plan.ops.entries()) {
      if (op.call !== 'requestPayment') continue
      const status = decodeFunctionResult({
        abi: viatikLedgerAbi,
        functionName: 'requestPayment',
        data: results[index]!,
      })
      const outcome = REQUEST_STATUS[Number(status)]
      if (outcome === op.expected) continue
      if (op.expected === 'rejected' && plan.refusal)
        return { status: 'failed', records: [], error: plan.refusal }
      if (outcome === 'rejected') {
        const [reason, limit] = await this.client.readContract({
          address: this.ledger,
          abi: viatikLedgerAbi,
          functionName: 'checkPayment',
          args: [
            ledgerId(chain.namespace, op.budgetId),
            from,
            op.destinationId ? ledgerId(chain.namespace, op.destinationId) : `0x${'0'.repeat(64)}`,
            op.memberUserId ? (chain.addressOf(op.memberUserId) ?? from) : `0x${'0'.repeat(40)}`,
            centsToUnits(op.amount),
          ],
        })
        const code = REASON[Number(reason)] ?? 'rule_drift'
        const amount = formatUsd(unitsToCents(limit).cents, { withCode: true })
        const error: LedgerError = {
          code,
          message: REJECTION_MESSAGE[code]?.(amount) ?? DRIFT_MESSAGE,
          retryable: false,
        }
        return { status: 'failed', records: [], error }
      }
      return {
        status: 'failed',
        records: [],
        error: {
          code: 'rule_drift',
          message: DRIFT_MESSAGE,
          retryable: false,
        },
      }
    }
    return null
  }
}

/** People's accounts as checksummed addresses; a malformed one counts as no account. */
function withValidAddresses(chain: ChainContext): ChainContext {
  const valid = (lookup: (userId: Id) => Address | undefined) => (userId: Id) => {
    const address = lookup(userId)
    return address && isAddress(address, { strict: false }) ? getAddress(address) : undefined
  }
  return {
    namespace: chain.namespace,
    addressOf: valid(chain.addressOf),
    signerOf: chain.signerOf && valid(chain.signerOf),
  }
}

/** The call that produced each record, by the record's operation id. */
function recordCalls(ops: readonly LedgerOp[]) {
  const calls = new Map<Id, LedgerCall>()
  for (const op of ops) {
    switch (op.call) {
      case 'deposit':
      case 'fundAgreement':
      case 'transfer':
      case 'allocate':
      case 'returnToAgency':
        calls.set(op.opId, op.call)
        break
      case 'releaseTranche':
        calls.set(op.trancheId, op.call)
        break
      case 'createBudget':
        calls.set(op.budgetId, op.call)
        break
      case 'requestPayment':
        calls.set(op.requestId, op.call)
        calls.set(op.paymentId, op.call)
        break
      case 'approvePayment':
      case 'pay':
        calls.set(op.paymentId, op.call)
        break
    }
  }
  return calls
}

type LedgerEventLog = ReturnType<typeof parseEventLogs<typeof viatikLedgerAbi>>[number]

/** What the ledger did with the payment request behind a record, from its events. */
function requestOutcome(
  events: readonly LedgerEventLog[],
  id: (productId: Id) => Hex,
  opId: Id,
  ops: readonly LedgerOp[],
): Pick<LedgerRecord, 'outcome' | 'reason' | 'limit'> {
  const op = ops.find(
    (o): o is Extract<LedgerOp, { call: 'requestPayment' }> =>
      o.call === 'requestPayment' && (o.requestId === opId || o.paymentId === opId),
  )
  if (!op) return {}
  const requestId = id(op.requestId)
  for (const event of events) {
    if (event.eventName === 'PaymentRejected' && event.args.requestId === requestId)
      return {
        outcome: 'rejected',
        reason: (REASON[Number(event.args.reason)] ?? undefined) as LedgerRecord['reason'],
        limit: unitsToCents(event.args.limit).cents,
      }
    if (event.eventName === 'PaymentPending' && event.args.requestId === requestId)
      return { outcome: 'pending' }
    if (event.eventName === 'PaymentExecuted' && event.args.requestId === requestId)
      return { outcome: 'executed' }
  }
  return {}
}

/** The event argument that carries a witness's id, and the one naming the person. */
const ID_ARG: Record<LedgerEvent, string> = {
  Recorded: 'opId',
  PortfolioCreated: 'portfolio',
  AgencyRegistered: 'agency',
  RoleSet: 'scope',
  LocationCreated: 'id',
  AgreementCreated: 'agreement',
  AgreementAccepted: 'agreement',
  AgreementPausedSet: 'agreement',
  TrancheRequested: 'tranche',
  TrancheChangesRequested: 'tranche',
  BudgetCreated: 'budget',
  BudgetRulesUpdated: 'budget',
  BudgetPausedSet: 'budget',
  AllowanceSet: 'budget',
  PaymentExecuted: 'requestId',
  PaymentPending: 'requestId',
  PaymentRejected: 'requestId',
  RequestClosed: 'requestId',
}
const PERSON_ARG: Partial<Record<LedgerEvent, string>> = { RoleSet: 'account', AllowanceSet: 'holder' }

/** Whether a log is the witness: its event, its id, its person and the values that decide it. */
function matches(event: LedgerEventLog, witness: Witness, namespace: string, chain: ChainContext): boolean {
  const name = event.eventName as LedgerEvent
  if (!witness.events.includes(name)) return false
  const args = event.args as Record<string, unknown>
  if (args[ID_ARG[name]] !== ledgerId(namespace, witness.id)) return false
  const personArg = PERSON_ARG[name]
  if (personArg && witness.userId) {
    const address = chain.addressOf(witness.userId)
    if (!address || !isAddressEqual(args[personArg] as Address, address)) return false
  }
  for (const [key, expected] of Object.entries(witness.args ?? {})) {
    const actual = args[key]
    if (key === 'role') {
      const role = expected === 'none' ? 0 : LEDGER_ROLE[expected as keyof typeof LEDGER_ROLE]
      if (Number(actual) !== role) return false
    } else if (key === 'account') {
      if (actual !== ledgerId(namespace, expected as Id)) return false
    } else if (key === 'perOperationLimit' || key === 'approvalThreshold') {
      if (actual !== centsToUnits(expected as Cents)) return false
    } else if (actual !== expected) return false
  }
  return true
}

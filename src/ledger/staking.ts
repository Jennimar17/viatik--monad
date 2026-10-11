import { createPublicClient, http, type Address, type Hex } from 'viem'

import { monadStakingAbi } from '@/web3/abi/monad-staking'
import { STAKING_PRECOMPILE, TEST_STAKE } from '@/web3/addresses'
import { chains } from '@/web3/chains'

/**
 * Viatik's own test stake on Monad Testnet, read from the staking precompile. Read only and
 * testnet only: it is a preview of how rewards on idle assets would be reported, never anyone's
 * capital, and nothing here signs or sends.
 */

/** The reward accumulators are scaled by 1e36. */
const ACC_SCALE = 10n ** 36n
/** Commission is scaled by 1e18: 1e18 is 100%. */
const COMMISSION_SCALE = 10n ** 18n

/** One RPC call may take this long, with one retry. */
const RPC_TIMEOUT_MS = 5_000

/** Multicall3's own block getters, so the block comes from the same call as the stake. */
const multicallBlockAbi = [
  {
    type: 'function',
    name: 'getBlockNumber',
    inputs: [],
    outputs: [{ name: 'blockNumber', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentBlockTimestamp',
    inputs: [],
    outputs: [{ name: 'timestamp', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

/** The test stake at one block. Amounts in wei (MON has 18 decimals). */
export type TestStakeRead = {
  chainId: number
  block: bigint
  /** The block's timestamp, in seconds. */
  blockTime: bigint
  epoch: bigint
  inEpochDelayPeriod: boolean
  delegator: Address
  validatorId: bigint
  /** Active stake: the part that earns rewards. */
  stake: bigint
  /** Stake added that is not active yet (undelegating is a withdrawal request, not this). */
  pendingStake: bigint
  /** The epoch the pending stake becomes active in; null without one. */
  pendingEpoch: bigint | null
  /** Rewards earned and not claimed. */
  rewards: bigint
  validator: {
    /** In the active set and not flagged. */
    active: boolean
    /** Scaled by 1e18 (1e18 = 100%). */
    commission: bigint
    stake: bigint
  }
  delegateTx: Hex
  activeFromEpoch: number
  activeFrom: string
}

/**
 * Rewards a delegator has earned and not claimed. The precompile updates `unclaimedRewards` live
 * today (the delegator's accumulator equals the validator's at the same block); adding what the
 * accumulators still owe keeps this right if it ever reports only the last update. The validator's
 * accumulator is already net of its commission.
 */
export function unclaimedRewards(input: {
  unclaimed: bigint
  stake: bigint
  validatorAcc: bigint
  delegatorAcc: bigint
}): bigint {
  const owed = input.validatorAcc > input.delegatorAcc ? input.validatorAcc - input.delegatorAcc : 0n
  return input.unclaimed + (input.stake * owed) / ACC_SCALE
}

/** A commission scaled by 1e18 as a percentage with up to two decimals (5e16 → 5). */
export function commissionPercent(commission: bigint): number {
  return Number((commission * 10_000n) / COMMISSION_SCALE) / 100
}

/**
 * A public client of its own, on Monad Testnet: it does not need the ledger to be configured.
 * `rpcUrl` defaults to the chain's public RPC.
 */
export function createStakingClient(rpcUrl?: string) {
  return createPublicClient({
    chain: chains.testnet,
    transport: http(rpcUrl, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }),
  })
}

export type StakingClient = ReturnType<typeof createStakingClient>

/**
 * Reads the test stake in one multicall (one `eth_call`), so every value comes from the same
 * block. Refuses an RPC on another chain than Monad Testnet. Throws when the network cannot be
 * read; a stake that is gone (a testnet reset) reads as zero.
 */
export async function readTestStake(client: StakingClient): Promise<TestStakeRead> {
  const chainId = await client.getChainId()
  if (chainId !== chains.testnet.id)
    throw new Error(`wrong chain ${chainId}: the test stake is on Monad Testnet only`)

  const multicall3 = chains.testnet.contracts.multicall3.address
  const { delegator, validatorId } = TEST_STAKE
  const [block, blockTime, [epoch, inEpochDelayPeriod], delegation, validator] = await client.multicall({
    allowFailure: false,
    contracts: [
      { address: multicall3, abi: multicallBlockAbi, functionName: 'getBlockNumber' },
      { address: multicall3, abi: multicallBlockAbi, functionName: 'getCurrentBlockTimestamp' },
      { address: STAKING_PRECOMPILE, abi: monadStakingAbi, functionName: 'getEpoch' },
      {
        address: STAKING_PRECOMPILE,
        abi: monadStakingAbi,
        functionName: 'getDelegator',
        args: [validatorId, delegator],
      },
      {
        address: STAKING_PRECOMPILE,
        abi: monadStakingAbi,
        functionName: 'getValidator',
        args: [validatorId],
      },
    ],
  })

  const [stake, delegatorAcc, unclaimed, deltaStake, nextDeltaStake, deltaEpoch, nextDeltaEpoch] = delegation
  const [, flags, validatorStake, validatorAcc, commission, , consensusStake] = validator
  return {
    chainId,
    block,
    blockTime,
    epoch,
    inEpochDelayPeriod,
    delegator,
    validatorId,
    stake,
    pendingStake: deltaStake + nextDeltaStake,
    // The later of the two changes, once both are pending: the stake is complete from then on.
    pendingEpoch: nextDeltaStake > 0n ? nextDeltaEpoch : deltaStake > 0n ? deltaEpoch : null,
    rewards: unclaimedRewards({ unclaimed, stake, validatorAcc, delegatorAcc }),
    // Not the set getters (814k gas a page): a validator in consensus has stake there.
    validator: { active: flags === 0n && consensusStake > 0n, commission, stake: validatorStake },
    delegateTx: TEST_STAKE.delegateTx,
    activeFromEpoch: TEST_STAKE.activeFromEpoch,
    activeFrom: TEST_STAKE.activeFrom,
  }
}

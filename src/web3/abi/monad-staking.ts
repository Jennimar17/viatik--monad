/**
 * The reads of Monad's staking precompile (`STAKING_PRECOMPILE`) that Viatik uses, from
 * docs.monad.xyz/reference/staking/api. Commission is scaled by 1e18 (1e18 = 100%) and the
 * reward accumulators by 1e36.
 *
 * The precompile declares these functions nonpayable and accepts only a top-level CALL. They are
 * typed `view` here so viem's `readContract` and `multicall` accept them: an `eth_call`, and
 * Multicall3's `aggregate3` inside one, make a plain CALL, which works. A STATICCALL (a contract's
 * `view` function calling the precompile) fails, so never wrap these reads in a contract view.
 * A call with invalid arguments uses up all its gas.
 */
export const monadStakingAbi = [
  {
    type: 'function',
    name: 'getEpoch',
    inputs: [],
    outputs: [
      { name: 'epoch', type: 'uint64' },
      { name: 'inEpochDelayPeriod', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDelegator',
    inputs: [
      { name: 'validatorId', type: 'uint64' },
      { name: 'delegator', type: 'address' },
    ],
    outputs: [
      { name: 'stake', type: 'uint256' },
      { name: 'accRewardPerToken', type: 'uint256' },
      { name: 'unclaimedRewards', type: 'uint256' },
      { name: 'deltaStake', type: 'uint256' },
      { name: 'nextDeltaStake', type: 'uint256' },
      { name: 'deltaEpoch', type: 'uint64' },
      { name: 'nextDeltaEpoch', type: 'uint64' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getValidator',
    inputs: [{ name: 'validatorId', type: 'uint64' }],
    outputs: [
      { name: 'authAddress', type: 'address' },
      { name: 'flags', type: 'uint64' },
      { name: 'stake', type: 'uint256' },
      { name: 'accRewardPerToken', type: 'uint256' },
      { name: 'commission', type: 'uint256' },
      { name: 'unclaimedRewards', type: 'uint256' },
      { name: 'consensusStake', type: 'uint256' },
      { name: 'consensusCommission', type: 'uint256' },
      { name: 'snapshotStake', type: 'uint256' },
      { name: 'snapshotCommission', type: 'uint256' },
      { name: 'secpPubkey', type: 'bytes' },
      { name: 'blsPubkey', type: 'bytes' },
    ],
    stateMutability: 'view',
  },
] as const

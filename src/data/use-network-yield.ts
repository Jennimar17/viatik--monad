'use client'

import { useQuery } from '@tanstack/react-query'

import { publicEnv } from '@/lib/env'

import type { NetworkYield } from './api-contract'
import { fetchNetworkYield } from './api-data-source'

/** Its own key, outside `STATE_KEY`: reloading the Viatik state never reads the network again. */
export const NETWORK_YIELD_KEY = ['network-yield'] as const

/** What screens show when the preview cannot be loaded at all (offline, no API, or mainnet). */
export const NETWORK_YIELD_UNAVAILABLE: NetworkYield = { available: false }

/** The test stake exists on Monad Testnet only. */
const ON_TESTNET = publicEnv.NEXT_PUBLIC_MONAD_NETWORK === 'testnet'

/**
 * Viatik's own test stake, for the Yield preview on the Investor's Vaults page. Read only, the
 * same for every person and in both modes (the demo shows the real testnet read too). It is never
 * capital: keep it out of balances, balance checks, charts and `Amount` (MON is not USD).
 *
 * `data` is undefined while the first read loads. A refresh that fails keeps the last read; a
 * first read that fails, or a deployment on mainnet, gives `available: false`.
 */
export function useNetworkYield({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: NETWORK_YIELD_KEY,
    // No abort signal: a screen that remounts reuses the read in flight instead of cancelling it.
    queryFn: () => fetchNetworkYield(),
    enabled: enabled && ON_TESTNET,
    // The server and the CDN keep a read for a minute; rewards move slowly.
    staleTime: 60_000,
    refetchInterval: 2 * 60_000,
    retry: 1,
  })
  const data: NetworkYield | undefined = !ON_TESTNET
    ? NETWORK_YIELD_UNAVAILABLE
    : (query.data ?? (query.isError ? NETWORK_YIELD_UNAVAILABLE : undefined))
  return { data, isLoading: ON_TESTNET && query.isLoading }
}

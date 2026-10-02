'use client'

import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth'
import type * as React from 'react'

import { activeChain } from '@/web3/chains'

import { publicEnv } from './env'

/** Real sign-in exists only when a Privy app is configured; otherwise the product runs as the demo. */
export const accountsEnabled = Boolean(publicEnv.NEXT_PUBLIC_PRIVY_APP_ID)

/**
 * Privy's modal in Viatik's colors. The embedded account is created by the
 * Viatik server on the first sign-in (`createOnLogin` is off: Privy's own
 * creation step can stall forever when its wallet iframe is not ready), and
 * the wallet screens stay hidden: people never see gas, chains or
 * confirmations; Viatik shows its own operation states.
 */
const config: PrivyClientConfig = {
  loginMethods: ['email', 'google', 'passkey'],
  appearance: {
    theme: '#22092c',
    accentColor: '#b7ccb8',
    logo: '/brand/viatik-wordmark-light.svg',
    landingHeader: 'Sign in to Viatik',
    loginMessage: 'Your financial account is created automatically. No wallet extension required.',
    showWalletLoginFirst: false,
    walletChainType: 'ethereum-only',
  },
  embeddedWallets: {
    ethereum: { createOnLogin: 'off' },
    showWalletUIs: false,
  },
  // Monad is not in Privy's default chain list, so it is declared here.
  defaultChain: activeChain,
  supportedChains: [activeChain],
  legal: { termsAndConditionsUrl: '/terms', privacyPolicyUrl: '/privacy' },
}

/** Mounts Privy for the product screens only; the landing never loads it. */
export function ViatikPrivyProvider({ children }: { children: React.ReactNode }) {
  const appId = publicEnv.NEXT_PUBLIC_PRIVY_APP_ID
  if (!appId) return children
  return (
    <PrivyProvider appId={appId} config={config}>
      {children}
    </PrivyProvider>
  )
}

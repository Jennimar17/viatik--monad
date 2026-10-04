'use client'

import { useSendTransaction, useWallets } from '@privy-io/react-auth'
import { CircleCheck, ExternalLink } from 'lucide-react'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { translateLedgerError } from '@/ledger/errors'
import { shortHash } from '@/lib/format'
import { withTimeout } from '@/lib/timeout'

type Check =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'done'; hash: `0x${string}` }
  | { status: 'failed'; message: string; raw: string }

const TIMEOUT_MS = 60_000

/**
 * Developer mode: sends an empty operation from the person's embedded account
 * to itself, with gas paid by Viatik's sponsorship. A hash on the explorer
 * proves sponsored settlement works on this network for this account.
 */
export function SponsorshipCheck({
  address,
  chainId,
  explorer,
}: {
  address: `0x${string}`
  chainId: number
  explorer: string
}) {
  const { sendTransaction } = useSendTransaction()
  // Signing needs Privy's wallet iframe and this browser's Privy user to list
  // the account the server created; `useWallets().ready` covers both.
  const { ready: walletsReady, wallets } = useWallets()
  const [check, setCheck] = React.useState<Check>({ status: 'idle' })
  const signable =
    walletsReady &&
    wallets.some(
      (wallet) =>
        wallet.walletClientType === 'privy' && wallet.address.toLowerCase() === address.toLowerCase(),
    )

  const run = async () => {
    setCheck({ status: 'sending' })
    try {
      const { hash } = await withTimeout(
        sendTransaction(
          { to: address, value: 0, chainId },
          { sponsor: true, address, uiOptions: { showWalletUIs: false } },
        ),
        TIMEOUT_MS,
      )
      setCheck({ status: 'done', hash })
    } catch (error) {
      const translated = translateLedgerError(error)
      // Privy sponsors only wallets on its TEE stack; for older wallets retrying never helps.
      const message = /TEE stack/i.test(translated.raw)
        ? 'Sponsored settlement is not available for this account type. Check the embedded wallet settings.'
        : translated.message
      setCheck({ status: 'failed', message, raw: translated.raw })
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Sponsored settlement</p>
        <p className="text-sm text-pretty text-muted-foreground">
          Sends an empty transaction from your account to itself. Viatik pays the gas.
        </p>
      </div>
      {check.status === 'done' ? (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <CircleCheck className="size-4 text-sage" aria-hidden="true" />
          Confirmed on the network:
          <a
            href={`${explorer}/tx/${check.hash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
          >
            {shortHash(check.hash, 10, 8)}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </p>
      ) : null}
      {check.status === 'failed' ? (
        <div className="flex flex-col gap-2" role="alert">
          <p className="text-sm text-danger">{check.message}</p>
          <details className="text-xs text-subtle">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-1 font-mono break-all">{check.raw}</p>
          </details>
        </div>
      ) : null}
      <Button
        variant="outline"
        size="pill-sm"
        className="w-fit"
        disabled={check.status === 'sending' || !signable}
        onClick={() => void run()}
      >
        {!signable ? (
          'Preparing your account…'
        ) : check.status === 'sending' ? (
          <>
            <Spinner data-icon="inline-start" /> Sending…
          </>
        ) : check.status === 'idle' ? (
          'Verify sponsored settlement'
        ) : (
          'Send again'
        )}
      </Button>
    </div>
  )
}

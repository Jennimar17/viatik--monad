'use client'

import { useSendTransaction, useWallets } from '@privy-io/react-auth'
import { CircleCheck, ExternalLink } from 'lucide-react'
import * as React from 'react'
import { encodeFunctionData, maxUint256 } from 'viem'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useLedger, useRefreshLedgerAccount } from '@/data/react'
import { translateLedgerError } from '@/ledger/errors'
import { shortHash } from '@/lib/format'
import { withTimeout } from '@/lib/timeout'
import { testUsdAbi } from '@/web3/abi/test-usd'

type Check =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'done'; hash: `0x${string}` }
  | { status: 'failed'; message: string; raw: string }

type TokenCheck =
  | { status: 'idle' }
  | { status: 'sending'; step: 'mint' | 'approve' }
  | { status: 'done'; mint: `0x${string}`; approve: `0x${string}` }
  | { status: 'failed'; step: 'mint' | 'approve'; message: string; raw: string }

const TIMEOUT_MS = 60_000
/** What the token check mints: 1 TestUSD (6 decimals). */
const TEST_MINT = BigInt(1_000_000)
/** A sent call can take a moment to show up in reads of the account. */
const ACCOUNT_SETTLE_MS = 4_000

/** How each token call reads on screen. */
const TOKEN_STEP = {
  mint: { name: 'mint', sending: 'Minting…' },
  approve: { name: 'authorization', sending: 'Authorizing…' },
} as const

/**
 * Developer mode: sends an empty operation from the person's Viatik account
 * (their embedded account) to itself, with gas paid by Viatik's sponsorship. A
 * hash on the explorer proves sponsored settlement works on this network for
 * this account.
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
  const [tokenCheck, setTokenCheck] = React.useState<TokenCheck>({ status: 'idle' })
  const { view } = useLedger()
  // Add funds shows what the Viatik account holds and allows: read it again after the token calls.
  const refreshAccount = useRefreshLedgerAccount()
  const token = view?.settlement === 'monad' ? view.token : null
  const ledgerContract = view?.settlement === 'monad' ? view.contract : null
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

  /**
   * Sponsored calls to the token itself (not the ledger): mint 1 TestUSD to yourself, then give the
   * ledger the same unlimited authorization Transfer to Portfolio asks for (`useWalletActions`).
   * ERC-20 `approve` replaces the allowance, so a limited amount here would lower the real
   * authorization and Add funds would ask for it again; an unlimited one is idempotent.
   */
  const runToken = async () => {
    if (!token || !ledgerContract) return
    let step: 'mint' | 'approve' = 'mint'
    let minted = false
    setTokenCheck({ status: 'sending', step })
    try {
      const options = { sponsor: true, address, uiOptions: { showWalletUIs: false } } as const
      const mint = await withTimeout(
        sendTransaction(
          {
            to: token,
            data: encodeFunctionData({ abi: testUsdAbi, functionName: 'mint', args: [address, TEST_MINT] }),
            chainId,
          },
          options,
        ),
        TIMEOUT_MS,
      )
      minted = true
      step = 'approve'
      setTokenCheck({ status: 'sending', step })
      const approve = await withTimeout(
        sendTransaction(
          {
            to: token,
            data: encodeFunctionData({
              abi: testUsdAbi,
              functionName: 'approve',
              args: [ledgerContract, maxUint256],
            }),
            chainId,
          },
          options,
        ),
        TIMEOUT_MS,
      )
      setTokenCheck({ status: 'done', mint: mint.hash, approve: approve.hash })
    } catch (error) {
      const translated = translateLedgerError(error)
      setTokenCheck({ status: 'failed', step, message: translated.message, raw: translated.raw })
    } finally {
      // The balance changed with the mint (and the authorization with the approve, when it landed).
      // Once now, and once more after Monad has surely included them.
      if (minted) {
        void refreshAccount()
        setTimeout(() => void refreshAccount(), ACCOUNT_SETTLE_MS)
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Sponsored settlement</p>
        <p className="text-sm text-pretty text-muted-foreground">
          Sends an empty transaction from your Viatik account to itself. Viatik pays the gas.
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
          'Preparing your Viatik account…'
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

      <div className="mt-2 flex flex-col gap-3 border-t border-border pt-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Sponsored token calls</p>
          <p className="text-sm text-pretty text-muted-foreground">
            Mints 1 TestUSD to your Viatik account, then gives the ledger the one-time authorization transfers
            use (unlimited, so it never lowers it). Two sponsored transactions to the token contract: what
            adding funds needs.
          </p>
        </div>
        {tokenCheck.status === 'done' ? (
          <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
            <CircleCheck className="size-4 text-sage" aria-hidden="true" />
            Mint
            <a
              href={`${explorer}/tx/${tokenCheck.mint}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
            >
              {shortHash(tokenCheck.mint, 10, 8)}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            and authorize
            <a
              href={`${explorer}/tx/${tokenCheck.approve}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
            >
              {shortHash(tokenCheck.approve, 10, 8)}
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </p>
        ) : null}
        {tokenCheck.status === 'failed' ? (
          <div className="flex flex-col gap-2" role="alert">
            <p className="text-sm text-danger">
              The {TOKEN_STEP[tokenCheck.step].name} failed: {tokenCheck.message}
            </p>
            <details className="text-xs text-subtle">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 font-mono break-all">{tokenCheck.raw}</p>
            </details>
          </div>
        ) : null}
        <Button
          variant="outline"
          size="pill-sm"
          className="w-fit"
          disabled={tokenCheck.status === 'sending' || !signable || !token || !ledgerContract}
          onClick={() => void runToken()}
        >
          {!token || !ledgerContract ? (
            'Waiting for the ledger…'
          ) : tokenCheck.status === 'sending' ? (
            <>
              <Spinner data-icon="inline-start" /> {TOKEN_STEP[tokenCheck.step].sending}
            </>
          ) : tokenCheck.status === 'idle' ? (
            'Verify sponsored token calls'
          ) : (
            'Send again'
          )}
        </Button>
      </div>
    </div>
  )
}

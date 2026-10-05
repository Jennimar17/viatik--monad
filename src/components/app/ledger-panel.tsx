'use client'

import { CircleCheck, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { KeyValueList } from '@/components/viatik/layout'
import { CopyButton } from '@/components/viatik/operation'
import type { LedgerDifference } from '@/data/ledger-check'
import { useLedger, useViatikState } from '@/data/react'
import { formatUsd, type Cents } from '@/domain/money'
import { agencyName, budgetName, userName } from '@/domain/queries'
import type { ViatikState } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { formatDateTime, formatRelative, pluralize, shortHash } from '@/lib/format'

/** `addFunds` → "Add funds". */
const commandTitle = (name: string) => {
  const words = name.replace(/([A-Z])/g, ' $1').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function differenceName(state: ViatikState, difference: LedgerDifference) {
  switch (difference.kind) {
    case 'member':
      return `${userName(state, difference.userId)} · ${agencyName(state, difference.agencyId)}`
    case 'account': {
      const account = state.accounts.find((a) => a.id === difference.id)
      return account ? `${account.name} · ${agencyName(state, account.agencyId)}` : 'Account'
    }
    case 'budget': {
      const budget = state.budgets.find((b) => b.id === difference.id)
      return `${budgetName(state, difference.id)}${budget ? ` · ${agencyName(state, budget.agencyId)}` : ''}`
    }
    default:
      return state.vaults.find((v) => v.id === difference.id)?.name ?? 'Vault'
  }
}

function TxLink({ hash, explorer }: { hash: string; explorer: string }) {
  return (
    <a
      href={`${explorer}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs underline-offset-4 hover:underline"
    >
      {shortHash(hash, 10, 6)}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  )
}

/**
 * Developer mode: where the person's workspaces settle, and whether what the
 * screens show matches Monad. Lists the balances that differ, the person's
 * operations flagged for review, and the people who need a reset.
 */
export function LedgerPanel() {
  const { state } = useViatikState()
  const { view, checks, isLoading, isError, retry, refresh, refreshing } = useLedger()
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)

  const frame = (children: ReactNode, action?: ReactNode) => (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Ledger</p>
          <p className="text-sm text-pretty text-muted-foreground">
            Where your workspaces settle, and whether the balances you see match it.
          </p>
        </div>
        {action}
      </div>
      {children}
    </div>
  )

  if (isLoading) {
    return frame(
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner /> Reading the ledger…
      </p>,
    )
  }
  if (!view) {
    return frame(
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">The ledger status could not be loaded.</p>
        <Button variant="outline" size="pill-sm" onClick={retry}>
          Try again
        </Button>
      </div>,
    )
  }
  if (view.settlement === 'demo') {
    return frame(
      <p className="text-sm text-pretty text-muted-foreground">
        Your workspaces settle on the demo ledger: the contract&apos;s rules, simulated by Viatik. Nothing is
        sent to {network.name}.
      </p>,
    )
  }

  const differences = checks?.differences ?? []
  const block = view.balances?.block ?? null
  // The time of the read against the clock now: the data-load time of the state can be older.
  const readAgo = view.balances ? formatRelative(view.balances.readAt, new Date().toISOString()) : null
  const reseed = view.needsReseed.map((id) => userName(state, id))

  return frame(
    <>
      {isError ? (
        <p className="text-xs text-subtle">Could not refresh just now; showing the last read.</p>
      ) : null}
      {!view.available ? (
        <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          This deployment cannot reach {network.name}. Operations that move money are refused until it can;
          nothing is queued.
        </p>
      ) : null}
      <KeyValueList
        dense
        items={[
          {
            label: 'Contract',
            value: view.contract ? (
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                <a
                  href={`${network.explorer}/address/${view.contract}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-4 hover:underline"
                >
                  ViatikLedger {shortHash(view.contract, 8, 6)}
                </a>
                <CopyButton value={view.contract} label="Copy contract address" />
              </span>
            ) : (
              'Not configured'
            ),
          },
          {
            label: 'Namespace',
            value: (
              <span className="inline-flex items-center gap-1 font-mono text-xs">
                {view.namespace}
                <CopyButton value={view.namespace} label="Copy namespace" />
              </span>
            ),
          },
          {
            label: 'Last reset',
            value: view.genesis ? (
              <span className="flex flex-col items-end gap-1">
                <span>{formatDateTime(view.genesis.at)}</span>
                {view.genesis.transactions.map((hash) => (
                  <TxLink key={hash} hash={hash} explorer={network.explorer} />
                ))}
              </span>
            ) : (
              'Unknown'
            ),
          },
          {
            label: 'Balances read',
            value: view.balances ? (
              <span className="flex flex-col items-end gap-1">
                {block !== null ? (
                  <a
                    href={`${network.explorer}/block/${block}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs underline-offset-4 hover:underline"
                  >
                    Block {block.toLocaleString('en-US')}
                  </a>
                ) : null}
                <span className="text-xs text-subtle">{readAgo}</span>
              </span>
            ) : (
              'Not read yet'
            ),
          },
        ]}
      />

      {checks ? (
        differences.length === 0 ? (
          <p className="flex items-center gap-2 text-sm" role="status">
            <CircleCheck className="size-4 shrink-0 text-sage" aria-hidden="true" />
            {checks.compared === 0
              ? 'No balances to compare yet.'
              : checks.compared === 1
                ? 'The balance you can see matches Monad.'
                : `All ${checks.compared} balances you can see match Monad.`}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              {differences.length === 1 ? '1 balance differs' : `${differences.length} balances differ`} from
              Monad&apos;s last read. An operation still confirming shows up here until it settles; check
              again in a moment.
            </p>
            <ul className="flex flex-col text-sm">
              {differences.map((difference) => (
                <li
                  key={
                    difference.kind === 'member'
                      ? `${difference.agencyId}|${difference.userId}`
                      : difference.id
                  }
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border py-2 first:border-t-0"
                >
                  <span className="min-w-0 truncate">{differenceName(state, difference)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Viatik {formatUsd(difference.app as Cents)} · Monad{' '}
                    {difference.chain === null ? 'not read yet' : formatUsd(difference.chain as Cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {view.open > 0 ? (
        <p className="text-sm text-pretty text-muted-foreground">
          {pluralize(view.open, 'operation')} of yours {view.open === 1 ? 'is' : 'are'} still being confirmed.
          The balances {view.open === 1 ? 'it touches' : 'they touch'} show as pending until then.
        </p>
      ) : null}

      {view.diverged.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Flagged for review</p>
          <p className="text-sm text-pretty text-muted-foreground">
            Monad recorded these differently from what Viatik prepared, so Viatik did not apply them.
          </p>
          <ul className="flex flex-col text-sm">
            {view.diverged.map((operation) => (
              <li
                key={operation.key}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border py-2 first:border-t-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span>
                    {commandTitle(operation.command)}
                    {operation.amount !== null ? ` · ${formatUsd(operation.amount as Cents)}` : ''}
                  </span>
                  <span className="text-xs text-subtle">
                    {formatDateTime(operation.at)}
                    {operation.earlierReset ? ' · before the last reset' : ''}
                  </span>
                </span>
                {operation.txHash ? <TxLink hash={operation.txHash} explorer={network.explorer} /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reseed.length > 0 ? (
        <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-pretty">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          {reseed.join(', ')} signed in with another account since the last reset. Their roles on Monad stay
          with the earlier account until an admin resets the demo.
        </p>
      ) : null}
    </>,
    <Button
      variant="outline"
      size="pill-sm"
      className="shrink-0"
      disabled={refreshing || !view.available}
      onClick={() => refresh()}
    >
      {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCw data-icon="inline-start" />}
      Check against Monad
    </Button>,
  )
}

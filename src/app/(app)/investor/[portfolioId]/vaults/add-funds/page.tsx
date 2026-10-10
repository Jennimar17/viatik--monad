'use client'

import Link from '@/components/viatik/link'

import { InvestorAccountFunding } from '@/components/app/investor-account-funding'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { useLedger, useViatikState } from '@/data/react'

/**
 * Add funds: the Investor's Viatik account and Portfolio Vault, then Add funds,
 * Get test funds and Transfer to Portfolio (InvestorAccountFunding). The same
 * cards in every mode; only a real account on Monad moves TestUSD, the demo and
 * the test ledger credit test funds on Transfer.
 */
export default function AddFundsPage() {
  const { state, mode } = useViatikState()
  const { portfolioId } = useRole()
  const ledger = useLedger()
  const href = useHref()
  const demo = mode === 'demo'
  // A real account transfers on Monad when its workspace settles there; otherwise (the demo, or the
  // test ledger) Transfer to Portfolio credits test funds.
  const monad = !demo && ledger.view?.settlement === 'monad' ? ledger.view : null
  const loadingLedger = !demo && !ledger.view && ledger.isLoading
  // Where a transfer settles is not known (the ledger status failed to load): no cards, so the copy,
  // the receipt and the steps never describe the wrong ledger.
  const unknownLedger = !demo && !ledger.view && !ledger.isLoading

  const vault = state.vaults.find((v) => v.portfolioId === portfolioId && v.kind === 'portfolio')
  const portfolio = state.portfolios.find((p) => p.id === portfolioId)

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('vaults')} className="hover:text-foreground">
            Vaults
          </Link>
        }
        title="Add funds"
        description={`Bring TestUSD into your Viatik account, then transfer it to ${vault?.name ?? 'your Portfolio Vault'}.`}
      />

      {loadingLedger ? (
        <Panel>
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Spinner /> Loading your Viatik account…
          </p>
        </Panel>
      ) : unknownLedger ? (
        <Panel>
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-pretty text-muted-foreground">
              Add funds could not be loaded. Nothing was changed.
            </p>
            <Button variant="outline" size="pill-sm" onClick={ledger.retry}>
              Try again
            </Button>
          </div>
        </Panel>
      ) : (
        <InvestorAccountFunding
          portfolioId={portfolioId}
          vault={vault}
          organization={portfolio?.organization}
          monad={monad}
        />
      )}
    </div>
  )
}

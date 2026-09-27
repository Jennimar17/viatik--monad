'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { ArrowUpRight, Info, Landmark, Lock, Plus, ShieldCheck, Vault as VaultIcon } from 'lucide-react'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { locationLabel, movementLabel } from '@/components/app/capital-trail-panel'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Amount } from '@/components/viatik/amount'
import { MoneyBarChart } from '@/components/viatik/charts'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { CopyButton } from '@/components/viatik/operation'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { pseudoAddress } from '@/domain/ids'
import { vaultKindLabel } from '@/domain/labels'
import { percentOf, sum, ZERO } from '@/domain/money'
import { agencyName, receiptFor } from '@/domain/queries'
import { accountBalance, agreementCapital, vaultBalance } from '@/domain/selectors'
import type { Movement, Vault } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatDateTime, pluralize, shortHash } from '@/lib/format'

const VAULT_MOVEMENTS: ReadonlySet<Movement['kind']> = new Set([
  'deposit',
  'fund_agreement',
  'release_tranche',
  'capital_return',
])

export default function VaultsPage() {
  const { state } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const receipts = useReceiptDrawer()
  const [assetVault, setAssetVault] = React.useState<Vault | null>(null)
  const [assetOpen, setAssetOpen] = React.useState(false)

  const vaults = state.vaults.filter((v) => v.portfolioId === portfolioId)
  const portfolioVault = vaults.find((v) => v.kind === 'portfolio')
  const fundingVaults = vaults.filter((v) => v.kind === 'funding')
  const yieldVault = vaults.find((v) => v.kind === 'yield')
  const agencyIds = new Set(state.agencies.filter((a) => a.portfolioId === portfolioId).map((a) => a.id))
  const reserves = state.accounts.filter(
    (a) => a.template === 'reserve' && a.status === 'active' && agencyIds.has(a.agencyId),
  )
  const vaultIds = new Set(vaults.map((v) => v.id))
  const movements = state.movements
    .filter(
      (m) =>
        VAULT_MOVEMENTS.has(m.kind) &&
        ((m.from.kind === 'vault' && vaultIds.has(m.from.vaultId)) ||
          (m.to.kind === 'vault' && vaultIds.has(m.to.vaultId))),
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  const available = portfolioVault ? vaultBalance(state, portfolioVault.id) : undefined
  const inFunding = sum(fundingVaults, (v) => vaultBalance(state, v.id))
  const inReserves = sum(reserves, (a) => accountBalance(state, a.id))
  const deposits = movements.filter((m) => m.kind === 'deposit').length

  const showAsset = (vault: Vault) => {
    setAssetVault(vault)
    setAssetOpen(true)
  }

  const columns: ColumnDef<Movement, unknown>[] = [
    {
      accessorKey: 'createdAt',
      header: 'Date',
      cell: ({ row }) => (
        <span className="text-sm whitespace-nowrap text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'Movement',
      cell: ({ row }) => <span className="font-medium">{movementLabel[row.original.kind]}</span>,
    },
    {
      id: 'route',
      header: 'From → to',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {locationLabel(state, row.original.from)} → {locationLabel(state, row.original.to)}
        </span>
      ),
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.amount} size="sm" />,
    },
    {
      id: 'receipt',
      header: 'Receipt',
      cell: ({ row }) =>
        row.original.receiptId ? (
          <ShieldCheck className="size-4 text-sage" role="img" aria-label="Receipt available" />
        ) : null,
    },
  ]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Vaults"
        description="Controlled pools of capital: what is available, what is committed to Agencies, and what is held in reserve."
        actions={
          <ButtonLink href={href('vaults/add-funds')} size="pill">
            <Plus data-icon="inline-start" /> Add funds
          </ButtonLink>
        }
      />

      <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Portfolio Vault" value={available ?? ZERO} hint="Available to commit" emphasis />
        <KpiTile label="In funding vaults" value={inFunding} hint="Funded, not yet released" />
        <KpiTile
          label="Agency reserves"
          value={inReserves}
          hint={
            reserves.length
              ? `Held back by ${pluralize(reserves.length, 'Agency', 'Agencies')}`
              : 'No reserves yet'
          }
        />
        <KpiTile
          label="Yield"
          value={<span className="text-sm text-muted-foreground">Not available in this version</span>}
          hint="No returns are promised"
        />
      </HairlineGrid>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {portfolioVault ? (
          <Panel
            title={portfolioVault.name}
            description={vaultKindLabel.portfolio.description}
            action={<Tag>{portfolioVault.asset}</Tag>}
          >
            <Amount value={available ?? ZERO} size="xl" />
            <KeyValueList
              className="mt-4"
              dense
              items={[
                { label: 'Deposits', value: String(deposits) },
                { label: 'Funding vaults funded from here', value: String(fundingVaults.length) },
              ]}
            />
            <Button
              variant="ghost"
              size="pill-sm"
              className="mt-3 w-fit"
              onClick={() => showAsset(portfolioVault)}
            >
              Vault asset details <ArrowUpRight data-icon="inline-end" />
            </Button>
          </Panel>
        ) : null}
        <Panel title="Funding vaults" description={vaultKindLabel.funding.description}>
          {fundingVaults.length === 0 ? (
            <EmptyState
              compact
              title="No funding vaults yet"
              description="Each funding agreement gets a vault of its own."
            />
          ) : (
            <MoneyBarChart
              layout="horizontal-bars"
              xKey="name"
              className="h-44"
              data={fundingVaults.map((v) => {
                const capital = v.agreementId ? agreementCapital(state, v.agreementId) : undefined
                return {
                  name: agencyName(state, v.agencyId),
                  held: vaultBalance(state, v.id),
                  released: capital?.released ?? 0,
                }
              })}
              series={[
                { key: 'released', label: 'Released', color: 'var(--color-sage)' },
                { key: 'held', label: 'Held in vault', color: 'var(--color-mist)' },
              ]}
            />
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {fundingVaults.map((v) => {
          const capital = v.agreementId ? agreementCapital(state, v.agreementId) : undefined
          return (
            <Panel
              key={v.id}
              title={v.name}
              action={<VaultIcon className="size-4 text-subtle" aria-hidden="true" />}
            >
              <Amount value={vaultBalance(state, v.id)} size="lg" />
              <p className="mt-2 text-xs text-subtle">
                {capital
                  ? `${percentOf(capital.funded, capital.committed)}% of the commitment funded · ${percentOf(capital.released, capital.committed)}% released`
                  : 'No agreement yet'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {v.agreementId ? (
                  <ButtonLink href={href(`funding/${v.agreementId}`)} variant="outline" size="pill-sm">
                    Open agreement
                  </ButtonLink>
                ) : null}
                <Button variant="ghost" size="pill-sm" onClick={() => showAsset(v)}>
                  Asset details
                </Button>
              </div>
            </Panel>
          )
        })}
        <Panel
          title="Agency reserves"
          description={vaultKindLabel.agency_reserve.description}
          action={<Landmark className="size-4 text-subtle" aria-hidden="true" />}
        >
          {reserves.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Agency holds capital in reserve yet.</p>
          ) : (
            <ul className="flex flex-col">
              {reserves.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-3 border-t border-border py-2.5 first:border-t-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {agencyName(state, account.agencyId)}
                    </span>
                    <span className="text-xs text-subtle">{account.name} · read-only</span>
                  </span>
                  <Amount value={accountBalance(state, account.id)} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          title={yieldVault?.name ?? 'Yield Vault'}
          action={<Lock className="size-4 text-subtle" aria-hidden="true" />}
        >
          <StatusBadge status={{ label: 'Not available in this version', tone: 'neutral' }} />
          <p className="mt-3 flex gap-2 text-sm text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {vaultKindLabel.yield.description} Viatik does not promise returns.
          </p>
        </Panel>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-medium">Vault movements</h2>
        <DataTable
          data={movements}
          columns={columns}
          caption="Movements in and out of the portfolio vaults"
          searchPlaceholder="Search movements"
          searchText={(m) =>
            `${movementLabel[m.kind]} ${locationLabel(state, m.from)} ${locationLabel(state, m.to)}`
          }
          facets={[
            {
              id: 'kind',
              label: 'Movement',
              accessor: (m) => m.kind,
              options: [
                { value: 'deposit', label: 'Funds added' },
                { value: 'fund_agreement', label: 'Agreement funded' },
                { value: 'release_tranche', label: 'Tranche released' },
                { value: 'capital_return', label: 'Capital returned' },
              ],
            },
          ]}
          onRowClick={(m) => receipts.show(receiptFor(state, m.receiptId))}
          renderMobile={(m) => (
            <div className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{movementLabel[m.kind]}</span>
                <span className="truncate text-xs text-subtle">
                  {locationLabel(state, m.to)} · {formatDateTime(m.createdAt)}
                </span>
              </span>
              <Amount value={m.amount} size="sm" />
            </div>
          )}
          empty={
            <EmptyState
              compact
              title="No vault movements yet"
              description="Deposits, agreement funding and tranche releases will appear here."
            />
          }
        />
      </section>

      {receipts.drawer}
      <VaultAssetSheet vault={assetVault} open={assetOpen} onOpenChange={setAssetOpen} />
    </div>
  )
}

/** Where blockchain terms are allowed: the asset behind a vault. */
function VaultAssetSheet({
  vault,
  open,
  onOpenChange,
}: {
  vault: Vault | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mobile = useIsMobile()
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  if (!vault) return null
  const address = pseudoAddress(`vault:${vault.id}`)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        className="max-h-[92svh] gap-0 overflow-y-auto p-0 data-[side=bottom]:rounded-t-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="font-display text-xl font-medium">Vault asset details</SheetTitle>
          <SheetDescription>{vault.name}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5">
          <KeyValueList
            items={[
              { label: 'Asset', value: `${vault.asset} (6 decimals)` },
              { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
              {
                label: 'Vault address',
                value: (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {shortHash(address, 10, 6)}
                    <CopyButton value={address} label="Copy vault address" />
                  </span>
                ),
              },
              {
                label: 'Custody',
                value: 'Smart contract vault; only funding contracts can move capital out',
              },
              { label: 'Ledger', value: 'Simulated in this demo; the Monad deployment follows' },
              {
                label: 'Explorer',
                value: (
                  <a
                    href={network.explorer}
                    target="_blank"
                    rel="noreferrer"
                    className="underline-offset-4 hover:underline"
                  >
                    {network.explorer.replace('https://', '')}
                  </a>
                ),
              },
            ]}
          />
          <p className="text-xs text-pretty text-subtle">
            Amounts everywhere else in Viatik are shown in USD. USDC settles them one to one.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

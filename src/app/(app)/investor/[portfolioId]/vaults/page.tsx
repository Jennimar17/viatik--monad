'use client'

import type { ColumnDef } from '@tanstack/react-table'
import {
  ArrowUpFromLine,
  ArrowUpRight,
  Info,
  Landmark,
  Lock,
  Plus,
  ShieldCheck,
  Vault as VaultIcon,
} from 'lucide-react'
import * as React from 'react'

import { BalanceCheckNote } from '@/components/app/balance-check'
import { ButtonLink } from '@/components/app/button-link'
import { locationLabel, movementLabel } from '@/components/app/capital-trail-panel'
import { InvestorWithdrawSheet } from '@/components/app/investor-withdraw-sheet'
import { useReceiptDrawer } from '@/components/app/receipt-details'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Amount } from '@/components/viatik/amount'
import { MoneyBarChart } from '@/components/viatik/charts'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { CopyButton } from '@/components/viatik/operation'
import { StatusBadge, Tag, type StatusDescriptor } from '@/components/viatik/status'
import type { NetworkYield } from '@/data/api-contract'
import { useLedger, useViatik, useViatikState } from '@/data/react'
import { useNetworkYield } from '@/data/use-network-yield'
import { pseudoAddress } from '@/domain/ids'
import { vaultKindLabel } from '@/domain/labels'
import { percentOf, sum, ZERO } from '@/domain/money'
import { agencyName, receiptFor } from '@/domain/queries'
import { accountBalance, agreementCapital, returnedCapital, vaultBalance } from '@/domain/selectors'
import type { Movement, Vault } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { useIsMobile } from '@/hooks/use-mobile'
import { formatDate, formatDateTime, formatMon, formatShortDate, pluralize, shortHash } from '@/lib/format'

const VAULT_MOVEMENTS: ReadonlySet<Movement['kind']> = new Set([
  'deposit',
  'fund_agreement',
  'release_tranche',
  'capital_return',
  'withdrawal',
])

export default function VaultsPage() {
  const { state } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const receipts = useReceiptDrawer()
  const { checks } = useLedger()
  const { can } = usePermissions()
  const [assetVault, setAssetVault] = React.useState<Vault | null>(null)
  const [assetOpen, setAssetOpen] = React.useState(false)
  const [withdrawOpen, setWithdrawOpen] = React.useState(false)
  const [yieldOpen, setYieldOpen] = React.useState(false)
  // Viatik's own test stake: a preview, never capital (kept out of every total on this page).
  const { data: networkYield } = useNetworkYield()

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
  const withdrawals = movements.filter((m) => m.kind === 'withdrawal').length
  // Capital Agency Admins sent back to the Portfolio Vault (also listed in Vault movements).
  const returned = returnedCapital(state, { portfolioId })
  // Only the Portfolio Vault can be withdrawn: funding vaults follow their tranches and returns.
  const canWithdraw = Boolean(portfolioVault) && can('withdraw_funds')

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
        {/* A string, never a number: KpiTile shows numbers as USD. No network terms here. */}
        <KpiTile
          label="Yield"
          value={<span className="font-display text-2xl tracking-tight">Preview</span>}
          hint="Test stake · not your capital"
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
            <BalanceCheckNote check={checks?.check(portfolioVault.id)} className="mt-2" />
            <KeyValueList
              className="mt-4"
              dense
              items={[
                { label: 'Deposits', value: String(deposits) },
                ...(withdrawals > 0 ? [{ label: 'Withdrawals', value: String(withdrawals) }] : []),
                ...(returned > 0
                  ? [{ label: 'Returned by Agencies', value: <Amount value={returned} size="sm" /> }]
                  : []),
                { label: 'Funding vaults funded from here', value: String(fundingVaults.length) },
              ]}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {canWithdraw ? (
                <Button
                  variant="outline"
                  size="pill-sm"
                  disabled={!available || available <= 0}
                  onClick={() => setWithdrawOpen(true)}
                >
                  <ArrowUpFromLine data-icon="inline-start" /> Withdraw
                </Button>
              ) : null}
              <Button variant="ghost" size="pill-sm" onClick={() => showAsset(portfolioVault)}>
                Vault asset details <ArrowUpRight data-icon="inline-end" />
              </Button>
            </div>
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
              <BalanceCheckNote check={checks?.check(v.id)} className="mt-1" />
              <p className="mt-2 text-xs text-subtle">
                {capital
                  ? `${percentOf(capital.funded, capital.committed)}% of the commitment funded · ${percentOf(capital.released, capital.committed)}% released`
                  : 'No agreement yet'}
              </p>
              <p className="mt-2 flex gap-1.5 text-xs text-pretty text-subtle">
                <Lock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                Can’t be withdrawn: committed capital follows the agreement’s tranches and returns.
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
          description={vaultKindLabel.yield.description}
          action={<Tag>Preview</Tag>}
        >
          <StatusBadge status={yieldStatus(networkYield)} />
          <p className="mt-3 flex gap-2 text-sm text-pretty text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Viatik runs a small test stake to show how rewards on idle assets would be reported. It uses
            Viatik’s own test funds, not your capital, and is never counted in your portfolio. No returns are
            promised.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" size="pill-sm" onClick={() => setYieldOpen(true)}>
              Asset details <ArrowUpRight data-icon="inline-end" />
            </Button>
          </div>
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
                { value: 'withdrawal', label: movementLabel.withdrawal },
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
              description="Funds added, agreement funding, tranche releases, capital returned by Agencies and withdrawals will appear here."
            />
          }
        />
      </section>

      {receipts.drawer}
      <VaultAssetSheet vault={assetVault} open={assetOpen} onOpenChange={setAssetOpen} />
      <YieldAssetSheet
        name={yieldVault?.name ?? 'Yield Vault'}
        data={networkYield}
        open={yieldOpen}
        onOpenChange={setYieldOpen}
      />
      {portfolioVault && canWithdraw ? (
        <InvestorWithdrawSheet vault={portfolioVault} open={withdrawOpen} onOpenChange={setWithdrawOpen} />
      ) : null}
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
  const { mode } = useViatik()
  const { view, checks } = useLedger()
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  if (!vault) return null
  // On Monad every vault is a balance inside the ledger contract, under its own ledger id. The demo
  // shows a stand-in address; real accounts on the demo ledger have no address yet. While a real
  // account's ledger status is loading (or failed), nothing is claimed either way.
  const monad = view?.settlement === 'monad' ? view : null
  const unknown = mode === 'account' && !view
  const address = monad ? monad.contract : mode === 'demo' ? pseudoAddress(`vault:${vault.id}`) : null
  const onLedger = monad?.locations.find((location) => location.id === vault.id)
  const check = checks?.check(vault.id)
  const link = (path: string, text: string) => (
    <a
      href={`${network.explorer}/${path}`}
      target="_blank"
      rel="noreferrer"
      className="underline-offset-4 hover:underline"
    >
      {text}
    </a>
  )
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
              {
                label: 'Asset',
                value: monad ? (
                  <span className="inline-flex items-center gap-1">
                    TestUSD (6 decimals, no value)
                    {monad.token ? (
                      <span className="font-mono text-xs">
                        · {link(`address/${monad.token}`, shortHash(monad.token, 8, 4))}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  `${vault.asset} (6 decimals)`
                ),
              },
              { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
              {
                label: monad ? 'Ledger contract' : 'Vault address',
                value: address ? (
                  <span className="inline-flex items-center gap-1 font-mono text-xs">
                    {monad
                      ? link(`address/${address}`, shortHash(address, 10, 6))
                      : shortHash(address, 10, 6)}
                    <CopyButton
                      value={address}
                      label={monad ? 'Copy ledger contract address' : 'Copy vault address'}
                    />
                  </span>
                ) : unknown ? (
                  'Loading…'
                ) : monad ? (
                  'Not configured on this deployment'
                ) : (
                  'Assigned when settlement on Monad is switched on'
                ),
              },
              ...(onLedger
                ? [
                    {
                      label: 'Ledger id',
                      value: (
                        <span className="inline-flex items-center gap-1 font-mono text-xs">
                          {shortHash(onLedger.ledgerId, 10, 6)}
                          <CopyButton value={onLedger.ledgerId} label="Copy ledger id" />
                        </span>
                      ),
                    },
                  ]
                : []),
              {
                label: 'Custody',
                value: monad
                  ? 'A balance inside the ledger contract; only its rules move capital out. Tokens sent to the contract directly are not credited: deposits go through Add funds'
                  : vault.kind === 'portfolio'
                    ? 'Smart contract vault; capital leaves only to fund agreements or when you withdraw it'
                    : 'Smart contract vault; only funding contracts can move capital out',
              },
              {
                label: 'Ledger',
                value: monad
                  ? `Settled on ${network.name}: every movement is a transaction you can open from its receipt`
                  : unknown
                    ? 'Loading…'
                    : mode === 'demo'
                      ? 'Simulated in this demo; the Monad deployment follows'
                      : 'Test environment: limits are enforced by Viatik; settlement on Monad testnet comes next',
              },
              ...(check
                ? [
                    {
                      label: 'Balance',
                      value:
                        check.status === 'verified'
                          ? `Matches Monad${check.block !== null ? ` at block ${check.block.toLocaleString('en-US')}` : ''}`
                          : 'Pending verification: Monad has not confirmed it yet',
                    },
                  ]
                : []),
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
            {monad
              ? 'Amounts everywhere else in Viatik are shown in USD. On testnet, TestUSD stands in for USDC one to one.'
              : 'Amounts everywhere else in Viatik are shown in USD. USDC settles them one to one.'}
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** A wei amount from the API is zero. */
const noWei = (wei: string) => !/[1-9]/.test(wei)

/** The Yield preview in product words: the network is named only in its asset details. */
function yieldStatus(data: NetworkYield | undefined): StatusDescriptor {
  if (!data) return { label: 'Checking the test stake…', tone: 'neutral' }
  if (!data.available) return { label: 'Can’t be read right now', tone: 'neutral' }
  if (noWei(data.stakeWei)) return { label: 'No test stake right now', tone: 'neutral' }
  if (!data.validator.active) return { label: 'Not earning right now', tone: 'warning' }
  return { label: `Earning since ${formatShortDate(data.activeFrom.at)}`, tone: 'success' }
}

/**
 * Vault asset details of the Yield Vault, where network terms are allowed: Viatik's own test
 * stake, read live from Monad Testnet (the same read in the demo). Never capital: no rate and no
 * USD value.
 */
function YieldAssetSheet({
  name,
  data,
  open,
  onOpenChange,
}: {
  name: string
  data: NetworkYield | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mobile = useIsMobile()
  const network = networkInfo('testnet')
  const read = data?.available ? data : null
  const link = (path: string, text: string) => (
    <a
      href={`${network.explorer}/${path}`}
      target="_blank"
      rel="noreferrer"
      className="underline-offset-4 hover:underline"
    >
      {text}
    </a>
  )
  const basics = [
    { label: 'Asset', value: 'MON (testnet, no value)' },
    { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
  ]
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        className="max-h-[92svh] gap-0 overflow-y-auto p-0 data-[side=bottom]:rounded-t-2xl data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="font-display text-xl font-medium">Vault asset details</SheetTitle>
          <SheetDescription>{name} · test stake preview</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 p-5">
          <p className="text-sm text-pretty text-muted-foreground">
            Viatik staked a small amount of its own test MON with a validator on {network.name}. What it has
            earned is read live from the network.
          </p>
          {read ? (
            <KeyValueList
              items={[
                ...basics,
                {
                  label: 'Staked',
                  value: noWei(read.stakeWei) ? 'No stake found' : formatMon(read.stakeWei),
                  hint: !noWei(read.pendingStakeWei)
                    ? `+ ${formatMon(read.pendingStakeWei)} from epoch ${read.pendingEpoch ?? '—'}`
                    : noWei(read.stakeWei)
                      ? 'The test network may have been reset'
                      : undefined,
                },
                {
                  label: 'Validator',
                  value: `#${read.validatorId} · ${read.validator.active ? 'active' : 'inactive'} · ${read.validator.commissionPct}% commission`,
                },
                { label: 'Rewards so far', value: formatMon(read.rewardsWei), hint: 'Unclaimed' },
                {
                  label: 'Earning since',
                  value: `Epoch ${read.activeFrom.epoch} · ${formatDate(read.activeFrom.at)}`,
                },
                { label: 'Current epoch', value: String(read.epoch) },
                {
                  label: 'Staked from',
                  hint: 'Viatik’s operator account',
                  value: (
                    <span className="inline-flex items-center gap-1 font-mono text-xs">
                      {link(`address/${read.delegator}`, shortHash(read.delegator, 6, 4))}
                      <CopyButton value={read.delegator} label="Copy operator account address" />
                    </span>
                  ),
                },
                {
                  label: 'Stake transaction',
                  value: (
                    <span className="font-mono text-xs">
                      {link(`tx/${read.delegateTx}`, shortHash(read.delegateTx, 10, 6))}
                    </span>
                  ),
                },
                {
                  label: 'Read at',
                  hint: read.stale ? 'The last read: the network can’t be read right now' : undefined,
                  value: (
                    <span>
                      {link(`block/${read.block}`, `Block ${read.block.toLocaleString('en-US')}`)} ·{' '}
                      {formatDateTime(read.blockAt)}
                    </span>
                  ),
                },
              ]}
            />
          ) : (
            <>
              <KeyValueList items={basics} />
              <p className="text-sm text-pretty text-muted-foreground">
                {data
                  ? 'The test stake can’t be read right now. Try again in a few minutes.'
                  : 'Reading the test stake…'}
              </p>
            </>
          )}
          <p className="text-xs text-pretty text-subtle">
            Testnet MON has no value. This stake belongs to Viatik, not your portfolio, and is never added to
            your capital. Rewards depend on the network and can stop. No returns are promised.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}

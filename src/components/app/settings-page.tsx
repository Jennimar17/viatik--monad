'use client'

import { Fingerprint, KeyRound, Laptop, Plus } from 'lucide-react'
import Link from '@/components/viatik/link'
import * as React from 'react'
import { toast } from 'sonner'

import { AccountAddressCard, useAccountBalanceLine } from '@/components/app/account-address-card'
import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useOwnAccount } from '@/components/app/member-own-account'
import { AddDestinationSheet, destinationKindLabel } from '@/components/app/money-setup'
import { PageTabs, type PageTab } from '@/components/app/page-tabs'
import { LedgerPanel } from '@/components/app/ledger-panel'
import { PasskeysPanel } from '@/components/app/passkeys-panel'
import { providerStatus } from '@/components/app/provider-parts'
import { SponsorshipCheck } from '@/components/app/sponsorship-check'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { useTabParam } from '@/components/app/use-tab-param'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/viatik/feedback'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { CopyButton } from '@/components/viatik/operation'
import { OrgAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useLedger, useViatikState } from '@/data/react'
import { pseudoAddress } from '@/domain/ids'
import { agencyTypeLabel, categoryLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { roleLabel } from '@/domain/permissions'
import { agencyAgreementSummary, agencyTeamSize, governingAgreement, userName } from '@/domain/queries'
import { agreementStatus } from '@/domain/status'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { pluralize, shortHash } from '@/lib/format'
import { formatLocalDate, localTimeZone } from '@/lib/local-time'
import { useSession } from '@/lib/session'
import { timeZoneOptions } from '@/lib/time-zones'

/** Per-device choices that have no server side yet: notification switches, passkey, developer mode. */
type Preferences = {
  approvals: boolean
  payments: boolean
  releases: boolean
  weekly: boolean
  passkey: boolean
  developer: boolean
}

const DEFAULT_PREFERENCES: Preferences = {
  approvals: true,
  payments: true,
  releases: true,
  weekly: false,
  passkey: false,
  developer: false,
}

function readPreferences(key: string): Preferences {
  try {
    const raw = window.localStorage.getItem(key)
    return raw
      ? { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<Preferences>) }
      : DEFAULT_PREFERENCES
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function usePreferences(userId: string) {
  const key = `viatik:preferences:${userId}`
  // Settings render on the client only (after the demo state loads), so reading storage here is safe.
  const [preferences, setPreferences] = React.useState(() => readPreferences(key))
  const update = React.useCallback(
    (patch: Partial<Preferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...patch }
        try {
          window.localStorage.setItem(key, JSON.stringify(next))
        } catch {
          // Storage unavailable: the choice lasts for this visit only.
        }
        return next
      })
    },
    [key],
  )
  return [preferences, update] as const
}

/** Profile, workspace, rules and device settings; the tabs depend on the role. `?tab=` opens one. */
export function SettingsPage() {
  // The open tab follows `?tab=` (useSearchParams), which needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <Settings />
    </React.Suspense>
  )
}

function Settings() {
  const { state, user, userId } = useViatikState()
  const { mode, account } = useSession()
  const { role, agencyId, portfolioId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const profile = useCommand('updateProfile', { success: 'Profile saved.' })
  const [preferences, updatePreferences] = usePreferences(userId)
  const ledger = useLedger()
  const [name, setName] = React.useState(user?.name ?? '')
  const [jobTitle, setJobTitle] = React.useState(user?.title ?? '')
  const [timeZone, setTimeZone] = React.useState(user?.timeZone ?? 'UTC')
  const [destinationOpen, setDestinationOpen] = React.useState(false)
  // Times in Viatik follow this device's clock; the profile's zone is what the team sees. Accounts
  // created by signing in or by an invitation start in UTC: offer this device's zone instead.
  const deviceZone = localTimeZone()
  const deviceZoneLabel = deviceZone.replace(/_/g, ' ')
  const suggestDeviceZone = user?.timeZone === 'UTC' && timeZone === 'UTC' && deviceZone !== 'UTC'

  const agency = agencyId ? state.agencies.find((a) => a.id === agencyId) : undefined
  const portfolio = state.portfolios.find((p) => p.id === portfolioId)
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  // A real account shows its embedded account (null for a moment after the
  // first sign-in, while Privy creates it); the demo people show a stand-in.
  const realAccount = mode === 'account'
  const realAddress = realAccount ? (account?.address ?? null) : null
  const address = realAccount ? realAddress : pseudoAddress(userId)
  const dirty =
    name.trim() !== (user?.name ?? '') ||
    jobTitle.trim() !== (user?.title ?? '') ||
    timeZone !== user?.timeZone

  const discard = () => {
    setName(user?.name ?? '')
    setJobTitle(user?.title ?? '')
    setTimeZone(user?.timeZone ?? 'UTC')
  }

  const tabs: PageTab[] = [
    {
      value: 'profile',
      label: 'Profile',
      content: (
        <Panel title="Your profile" description="Amounts are shown in US dollars.">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <PersonAvatar name={name.trim() || user?.name || 'You'} size="lg" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{user?.email}</span>
                <span className="text-xs text-subtle">
                  {roleLabel[role]}
                  {user ? ` · since ${formatLocalDate(user.createdAt)}` : ''}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Full name" htmlFor="profile-name">
                <PillInput id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
              </FormField>
              <FormField label="Title" htmlFor="profile-title" optional>
                <PillInput
                  id="profile-title"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                />
              </FormField>
              <FormField
                label="Time zone"
                htmlFor="profile-tz"
                hint={
                  <>
                    {/* An Agency's team pages show its people's zones; nothing shows an Investor's. */}
                    {role === 'investor' ? '' : 'Shown to your team. '}Times in Viatik follow this device’s
                    clock ({deviceZoneLabel}).
                    {suggestDeviceZone ? (
                      <>
                        {' '}
                        <Button
                          variant="link"
                          size="sm"
                          className="h-auto p-0 text-xs"
                          onClick={() => setTimeZone(deviceZone)}
                        >
                          Use {deviceZoneLabel}
                        </Button>
                      </>
                    ) : null}
                  </>
                }
              >
                <SimpleSelect
                  id="profile-tz"
                  value={timeZone}
                  onValueChange={setTimeZone}
                  options={timeZoneOptions(timeZone)}
                />
              </FormField>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="pill-sm"
                disabled={!dirty || name.trim().length < 2 || profile.isPending}
                onClick={() => void profile.run({ name: name.trim(), title: jobTitle.trim(), timeZone })}
              >
                {profile.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              {dirty ? (
                <Button variant="ghost" size="pill-sm" onClick={discard} disabled={profile.isPending}>
                  Discard
                </Button>
              ) : null}
            </div>
          </div>
        </Panel>
      ),
    },
  ]

  // An Admin's own Viatik account, where "Funds arrived" links them. Members have it in Payments,
  // Investors in Add funds.
  if (role === 'agency_admin') {
    tabs.push({ value: 'account', label: 'Viatik account', content: <OwnAccountPanel /> })
  }

  if (agency) {
    // A Member's scoped state has no agreements and only their own membership: these read what
    // their Agency carries instead.
    const agreement = agencyAgreementSummary(state, agency.id)
    const teamSize = agencyTeamSize(state, agency.id)
    tabs.push({
      value: 'agency',
      label: 'Agency',
      content: (
        <Panel
          title="Agency profile"
          description={
            role === 'agency_admin'
              ? 'Set up with the funding agreement. Changes to these details go through your Investor.'
              : 'The Agency you work with.'
          }
        >
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <OrgAvatar name={agency.name} size="lg" />
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{agency.name}</span>
                <span className="text-xs text-pretty text-subtle">{agency.description}</span>
              </div>
            </div>
            <KeyValueList
              items={[
                { label: 'Type', value: agencyTypeLabel[agency.type] },
                { label: 'Website', value: agency.website ?? 'Not set' },
                { label: 'Time zone', value: agency.timeZone.replace(/_/g, ' ') },
                { label: 'Display currency', value: 'USD' },
                { label: 'Funded by', value: portfolio?.name ?? 'Not set' },
                {
                  label: 'Funding agreement',
                  value: agreement ? (
                    <span className="inline-flex items-center gap-2">
                      {agreement.title}
                      <StatusBadge status={agreementStatus[agreement.status]} />
                    </span>
                  ) : (
                    'No active agreement'
                  ),
                },
                { label: 'Team', value: pluralize(teamSize, 'person', 'people') },
              ]}
            />
            <p className="text-xs text-pretty text-subtle">
              Viatik is global by default: no country-specific payment rails or tax terms. Local settlement
              methods are future integrations.
            </p>
          </div>
        </Panel>
      ),
    })
  } else if (portfolio) {
    const agencies = state.agencies.filter((a) => a.portfolioId === portfolio.id)
    tabs.push({
      value: 'portfolio',
      label: 'Portfolio',
      content: (
        <Panel title="Portfolio">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <OrgAvatar name={portfolio.name} size="lg" />
              <div className="flex min-w-0 flex-col">
                <span className="font-medium">{portfolio.name}</span>
                <span className="text-xs text-subtle">{portfolio.organization}</span>
              </div>
            </div>
            <KeyValueList
              items={[
                { label: 'Display currency', value: portfolio.baseCurrency },
                { label: 'Time zone', value: portfolio.timeZone.replace(/_/g, ' ') },
                { label: 'Agencies', value: pluralize(agencies.length, 'agency', 'agencies') },
                { label: 'Created', value: formatLocalDate(portfolio.createdAt) },
              ]}
            />
          </div>
        </Panel>
      ),
    })
  }

  if (role === 'agency_admin' && agency) {
    const agreement = governingAgreement(state, agency.id)
    const budgets = state.budgets.filter((b) => b.agencyId === agency.id && b.status !== 'closed')
    const destinations = [...state.destinations.filter((d) => d.agencyId === agency.id)].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    const admins = state.memberships
      .filter(
        (m) =>
          m.role === 'agency_admin' &&
          m.status === 'active' &&
          m.scope.kind === 'agency' &&
          m.scope.agencyId === agency.id,
      )
      .map((m) => userName(state, m.userId))
    tabs.push(
      {
        value: 'approvals',
        label: 'Approval rules',
        content: (
          <div className="flex flex-col gap-6">
            <Panel
              title="Approval rules"
              description="Set per budget. The Investor’s exception threshold applies on top."
            >
              <KeyValueList
                items={[
                  {
                    label: 'Self-approval',
                    value: <StatusBadge status={{ label: 'Never allowed', tone: 'info' }} />,
                    hint: 'Nobody approves their own request',
                  },
                  { label: 'Who approves', value: admins.join(', ') },
                  {
                    label: 'Investor exception threshold',
                    value: agreement
                      ? formatUsd(agreement.spendingPolicy.exceptionThreshold, { withCode: true })
                      : 'No active agreement',
                    hint: 'Above this amount, the Investor decides',
                  },
                ]}
              />
            </Panel>
            <Panel
              title="Automatic approval per budget"
              description="Requests up to the limit approve automatically. Edit the rules from each budget."
            >
              {budgets.length === 0 ? (
                <EmptyState
                  compact
                  title="No budgets yet"
                  description="Approval limits are set when you create a budget."
                />
              ) : (
                <KeyValueList
                  items={budgets.map((b) => ({
                    label: (
                      <Link href={href(`budgets/${b.id}`)} className="text-foreground hover:underline">
                        {b.name}
                      </Link>
                    ),
                    value:
                      b.approvalThreshold > 0
                        ? `Up to ${formatUsd(b.approvalThreshold, { withCode: true })}`
                        : 'Always needs an Admin',
                    hint: `${formatUsd(b.perOperationLimit, { withCode: true })} max per payment`,
                  }))}
                />
              )}
            </Panel>
          </div>
        ),
      },
      {
        value: 'destinations',
        label: 'Providers',
        count: destinations.length,
        content: (
          <Panel
            title="Providers"
            description="Vendors, services and contractors the Agency can pay. Budgets can restrict payments to a subset."
            action={
              <div className="flex flex-wrap justify-end gap-2">
                <ButtonLink href={href('providers')} variant="outline" size="pill-sm">
                  Open Providers
                </ButtonLink>
                {can('send_payment') ? (
                  <Button size="pill-sm" onClick={() => setDestinationOpen(true)}>
                    <Plus data-icon="inline-start" /> Add provider
                  </Button>
                ) : null}
              </div>
            }
          >
            {destinations.length === 0 ? (
              <EmptyState
                compact
                title="No providers yet"
                description="Add the vendors and services the Agency pays."
              />
            ) : (
              <ul className="flex flex-col">
                {destinations.map((d) => {
                  const listedIn = budgets.filter((b) => b.allowedDestinationIds.includes(d.id)).length
                  return (
                    <li
                      key={d.id}
                      className="flex items-center gap-3 border-t border-border py-3 first:border-t-0"
                    >
                      <OrgAvatar name={d.name} size="sm" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <Link
                          href={href(`providers/${d.id}`)}
                          className="truncate text-sm font-medium hover:underline"
                        >
                          {d.name}
                        </Link>
                        <span className="truncate text-xs text-subtle">
                          {destinationKindLabel[d.kind]} · {categoryLabel[d.category]}
                          {d.settlementLabel ? ` · ${d.settlementLabel}` : null}
                        </span>
                      </span>
                      <span className="hidden text-xs text-subtle sm:block">
                        {listedIn ? `Listed in ${pluralize(listedIn, 'budget')}` : 'Open to all budgets'}
                      </span>
                      <StatusBadge status={providerStatus[d.status]} />
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        ),
      },
    )
  }

  const notificationRows: { key: keyof Preferences; label: string }[] = [
    {
      key: 'approvals',
      label: role === 'member' ? 'Decisions on my requests' : 'Requests that need my decision',
    },
    { key: 'payments', label: role === 'member' ? 'Payments I receive' : 'Completed payments' },
    // No funding notification ever goes to a Member.
    ...(role === 'member' ? [] : [{ key: 'releases' as const, label: 'Funding releases and milestones' }]),
    { key: 'weekly', label: 'Weekly summary' },
  ]

  tabs.push(
    {
      value: 'notifications',
      label: 'Notifications',
      content: (
        <Panel
          title="Notifications"
          description="What Viatik tells you about. In-app notifications are always on."
        >
          <p className="text-xs text-pretty text-subtle">
            Email notifications are not available yet. When they are, you can choose them here.
          </p>
          <ul className="flex flex-col">
            {notificationRows.map(({ key, label }) => (
              <li
                key={key}
                className="flex items-center justify-between gap-4 border-t border-border py-3.5 first:border-t-0"
              >
                <label htmlFor={`notify-${key}`} className="text-sm">
                  {label}
                </label>
                {/* Nothing sends email yet, so these stay off rather than pretend to save a choice. */}
                <Switch id={`notify-${key}`} checked={false} disabled />
              </li>
            ))}
          </ul>
        </Panel>
      ),
    },
    {
      value: 'security',
      label: 'Security',
      content: (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {mode === 'account' ? (
            <PasskeysPanel />
          ) : (
            <Panel title="Sign-in methods">
              <ul className="flex flex-col gap-3">
                <li className="flex items-center gap-3 text-sm">
                  <KeyRound className="size-4 shrink-0 text-subtle" aria-hidden="true" /> Email one-time code
                  <StatusBadge status={{ label: 'On', tone: 'success' }} className="ml-auto" />
                </li>
                <li className="flex items-center gap-3 text-sm">
                  <Fingerprint className="size-4 shrink-0 text-subtle" aria-hidden="true" /> Passkey on this
                  device
                  <StatusBadge
                    status={
                      preferences.passkey
                        ? { label: 'On', tone: 'success' }
                        : { label: 'Not set up', tone: 'neutral' }
                    }
                    className="ml-auto"
                  />
                </li>
              </ul>
              {preferences.passkey ? (
                <Button
                  variant="ghost"
                  size="pill-sm"
                  className="mt-4 w-fit text-danger hover:text-danger"
                  onClick={() => {
                    updatePreferences({ passkey: false })
                    toast.success('Passkey removed from this device.')
                  }}
                >
                  Remove passkey
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="pill-sm"
                  className="mt-4 w-fit"
                  onClick={() => {
                    updatePreferences({ passkey: true })
                    toast.success('Passkey added. You can sign in with this device.')
                  }}
                >
                  <Plus data-icon="inline-start" /> Add a passkey
                </Button>
              )}
            </Panel>
          )}
          <Panel title="Active sessions">
            <ul className="flex flex-col gap-3 text-sm">
              <li className="flex items-center gap-3">
                <Laptop className="size-4 shrink-0 text-subtle" aria-hidden="true" /> This browser
                <Tag className="ml-auto">Current</Tag>
              </li>
            </ul>
            <p className="mt-3 text-xs text-subtle">
              Only this browser is listed. To end a session on another device, use Sign out on that device.
            </p>
          </Panel>
        </div>
      ),
    },
    {
      value: 'developer',
      label: 'Developer',
      content: (
        <Panel
          title="Developer mode"
          description="Network details for integrators. Elsewhere, blockchain terms appear only in Add funds, Vault asset details and Verified details."
        >
          <div className="flex flex-col gap-5">
            <label className="flex items-center justify-between gap-4 text-sm">
              Show network details
              <Switch
                checked={preferences.developer}
                onCheckedChange={(checked) => updatePreferences({ developer: Boolean(checked) })}
              />
            </label>
            {preferences.developer ? (
              <KeyValueList
                items={[
                  { label: 'Network', value: `${network.name} · chain ${network.chainId}` },
                  {
                    label: 'Settlement asset',
                    value: network.asset.standsInFor
                      ? `${network.asset.detail}, standing in for ${network.asset.standsInFor} on testnet`
                      : network.asset.detail,
                  },
                  {
                    label: realAccount ? 'Your account' : 'Your account (demo)',
                    value: address ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {shortHash(address, 10, 6)}
                        <CopyButton value={address} label="Copy account address" />
                      </span>
                    ) : (
                      'Being created…'
                    ),
                  },
                  { label: 'Gas', value: 'Sponsored. You never need MON.' },
                  {
                    label: 'Ledger',
                    value:
                      ledger.view?.settlement === 'monad'
                        ? `Settled on ${network.name}.`
                        : !realAccount
                          ? 'Simulated in this demo; the Monad deployment follows.'
                          : !ledger.view
                            ? 'Loading…'
                            : 'Test environment: limits are enforced by Viatik; settlement on Monad testnet comes next.',
                  },
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
            ) : null}
            {preferences.developer && realAddress ? (
              <SponsorshipCheck address={realAddress} chainId={network.chainId} explorer={network.explorer} />
            ) : null}
            {preferences.developer && realAccount ? <LedgerPanel /> : null}
          </div>
        </Panel>
      ),
    },
  )

  // `?tab=` links open a tab, e.g. an Admin's "Funds arrived" opens Viatik account.
  const tab = useTabParam(
    tabs.map((t) => t.value),
    'profile',
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Settings"
        description="Your profile, your workspace, and how Viatik keeps you informed."
      />
      <PageTabs tabs={tabs} {...tab} />
      {role === 'agency_admin' && agency ? (
        <AddDestinationSheet open={destinationOpen} onOpenChange={setDestinationOpen} agencyId={agency.id} />
      ) : null}
    </div>
  )
}

/**
 * The Admin's own Viatik account, apart from the Agency's accounts: the full
 * address, the TestUSD it holds on Monad and its QR code behind "Show QR code".
 * Rendered only while its tab is open, so its live read runs only then.
 */
function OwnAccountPanel() {
  const own = useOwnAccount()
  const balance = useAccountBalanceLine(own)
  return (
    <AccountAddressCard
      own={own}
      description="Your own account, apart from the Agency’s. Money sent to you from outside Viatik arrives here."
      qr="collapsed"
      balance={balance}
      note="It stays with you: it does not add to any Agency account or budget."
    />
  )
}

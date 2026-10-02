'use client'

import { Fingerprint, KeyRound, Laptop, Plus } from 'lucide-react'
import Link from '@/components/viatik/link'
import * as React from 'react'
import { toast } from 'sonner'

import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { AddDestinationSheet, destinationKindLabel } from '@/components/app/money-setup'
import { PageTabs, type PageTab } from '@/components/app/page-tabs'
import { PasskeysPanel } from '@/components/app/passkeys-panel'
import { SponsorshipCheck } from '@/components/app/sponsorship-check'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { EmptyState } from '@/components/viatik/feedback'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { CopyButton } from '@/components/viatik/operation'
import { OrgAvatar, PersonAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { pseudoAddress } from '@/domain/ids'
import { agencyTypeLabel, categoryLabel } from '@/domain/labels'
import { formatUsd } from '@/domain/money'
import { roleLabel } from '@/domain/permissions'
import { activeAgreement, userName } from '@/domain/queries'
import { agreementStatus } from '@/domain/status'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { formatDate, pluralize, shortHash } from '@/lib/format'
import { useSession } from '@/lib/session'
import { timeZoneOptions } from '@/lib/time-zones'

const LOCALES = [
  { value: 'en-US', label: 'English (United States) · 1,234.56' },
  { value: 'en-GB', label: 'English (United Kingdom) · 1,234.56' },
  { value: 'de-DE', label: 'German formatting · 1.234,56' },
  { value: 'fr-FR', label: 'French formatting · 1 234,56' },
  { value: 'es-ES', label: 'Spanish formatting · 1.234,56' },
]

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

/** Profile, workspace, rules and device settings; the tabs depend on the role. */
export function SettingsPage({
  title = 'Settings',
  leading,
  children,
}: {
  title?: string
  /** Panels a role puts before the tabs, e.g. the Member's payment destination. */
  leading?: React.ReactNode
  /** Sheets and dialogs the caller controls. */
  children?: React.ReactNode
}) {
  const { state, user, userId } = useViatikState()
  const { mode, account } = useSession()
  const { role, agencyId, portfolioId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const profile = useCommand('updateProfile', { success: 'Profile saved.' })
  const [preferences, updatePreferences] = usePreferences(userId)
  const [name, setName] = React.useState(user?.name ?? '')
  const [jobTitle, setJobTitle] = React.useState(user?.title ?? '')
  const [timeZone, setTimeZone] = React.useState(user?.timeZone ?? 'UTC')
  const [locale, setLocale] = React.useState(user?.locale ?? 'en-US')
  const [destinationOpen, setDestinationOpen] = React.useState(false)

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
    timeZone !== user?.timeZone ||
    locale !== user?.locale

  const discard = () => {
    setName(user?.name ?? '')
    setJobTitle(user?.title ?? '')
    setTimeZone(user?.timeZone ?? 'UTC')
    setLocale(user?.locale ?? 'en-US')
  }

  const tabs: PageTab[] = [
    {
      value: 'profile',
      label: 'Profile',
      content: (
        <Panel
          title="Your profile"
          description="Dates and amounts follow your locale. Amounts are always shown in USD."
        >
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <PersonAvatar name={name.trim() || user?.name || 'You'} size="lg" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{user?.email}</span>
                <span className="text-xs text-subtle">
                  {roleLabel[role]}
                  {user ? ` · since ${formatDate(user.createdAt)}` : ''}
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
              <FormField label="Time zone" htmlFor="profile-tz">
                <SimpleSelect
                  id="profile-tz"
                  value={timeZone}
                  onValueChange={setTimeZone}
                  options={timeZoneOptions(timeZone)}
                />
              </FormField>
              <FormField label="Number and date format" htmlFor="profile-locale">
                <SimpleSelect
                  id="profile-locale"
                  value={locale}
                  onValueChange={setLocale}
                  options={LOCALES}
                />
              </FormField>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="pill-sm"
                disabled={!dirty || name.trim().length < 2 || profile.isPending}
                onClick={() =>
                  void profile.run({ name: name.trim(), title: jobTitle.trim(), timeZone, locale })
                }
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

  if (agency) {
    const agreement = activeAgreement(state, agency.id)
    const team = state.memberships.filter(
      (m) => m.scope.kind === 'agency' && m.scope.agencyId === agency.id && m.status === 'active',
    )
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
                { label: 'Team', value: pluralize(team.length, 'person', 'people') },
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
                { label: 'Created', value: formatDate(portfolio.createdAt) },
              ]}
            />
          </div>
        </Panel>
      ),
    })
  }

  if (role === 'agency_admin' && agency) {
    const agreement = activeAgreement(state, agency.id)
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
        label: 'Payment destinations',
        count: destinations.length,
        content: (
          <Panel
            title="Payment destinations"
            description="Vendors, services and contractors the Agency can pay. Budgets can restrict payments to a subset."
            action={
              can('send_payment') ? (
                <Button size="pill-sm" onClick={() => setDestinationOpen(true)}>
                  <Plus data-icon="inline-start" /> Add destination
                </Button>
              ) : null
            }
          >
            {destinations.length === 0 ? (
              <EmptyState
                compact
                title="No payment destinations yet"
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
                        <span className="truncate text-sm font-medium">{d.name}</span>
                        <span className="truncate text-xs text-subtle">
                          {destinationKindLabel[d.kind]} · {categoryLabel[d.category]} · {d.settlementLabel}
                        </span>
                      </span>
                      <span className="hidden text-xs text-subtle sm:block">
                        {listedIn ? `Listed in ${pluralize(listedIn, 'budget')}` : 'Open to all budgets'}
                      </span>
                      <StatusBadge
                        status={
                          d.status === 'approved'
                            ? { label: 'Approved', tone: 'success' }
                            : { label: 'Pending review', tone: 'warning' }
                        }
                      />
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
    { key: 'releases', label: 'Funding releases and milestones' },
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
          <ul className="flex flex-col">
            {notificationRows.map(({ key, label }) => (
              <li
                key={key}
                className="flex items-center justify-between gap-4 border-t border-border py-3.5 first:border-t-0"
              >
                <label htmlFor={`notify-${key}`} className="text-sm">
                  {label}
                </label>
                <Switch
                  id={`notify-${key}`}
                  checked={preferences[key]}
                  onCheckedChange={(checked) => {
                    updatePreferences({ [key]: Boolean(checked) })
                    toast.success('Preference saved.')
                  }}
                />
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
            <p className="mt-3 text-xs text-subtle">Sessions on other devices appear here.</p>
            <Button variant="ghost" size="pill-sm" className="mt-4 w-fit" disabled>
              Sign out other sessions
            </Button>
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
          description="Network details for integrators. Blockchain terms appear only here and in Verified details."
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
                  { label: 'Settlement asset', value: 'USDC (6 decimals)' },
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
                  { label: 'Ledger', value: 'Simulated in this demo; the Monad deployment follows.' },
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
          </div>
        </Panel>
      ),
    },
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={title}
        description="Your profile, your workspace, and how Viatik keeps you informed."
      />
      {leading}
      <PageTabs tabs={tabs} />
      {role === 'agency_admin' && agency ? (
        <AddDestinationSheet open={destinationOpen} onOpenChange={setDestinationOpen} agencyId={agency.id} />
      ) : null}
      {children}
    </div>
  )
}

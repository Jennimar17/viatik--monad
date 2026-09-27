import {
  Activity,
  ArrowDownLeft,
  Bot,
  Building2,
  ChartColumn,
  HandCoins,
  House,
  Landmark,
  LayoutDashboard,
  Layers,
  type LucideIcon,
  PieChart,
  ReceiptText,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  Vault,
  WalletCards,
} from 'lucide-react'
import type { Route } from 'next'

import type { Capability } from '@/domain/permissions'
import type { Membership, Role } from '@/domain/types'

export type NavItem = {
  key: string
  label: string
  /** Path relative to the role's scoped base, e.g. "overview". */
  path: string
  icon: LucideIcon
  /** Rendered only when the subject can at least view this capability. */
  capability?: Capability
  badge?: 'approvals' | 'bills' | 'requests'
}

export type RoleNavigation = { primary: NavItem[]; secondary: NavItem[]; mobileTabs?: NavItem[] }

/** Navigation exactly as the product spec defines it, per role. */
export const NAVIGATION: Record<Role, RoleNavigation> = {
  investor: {
    primary: [
      { key: 'overview', label: 'Overview', path: 'overview', icon: LayoutDashboard },
      { key: 'agencies', label: 'Agencies', path: 'agencies', icon: Building2 },
      { key: 'funding', label: 'Funding', path: 'funding', icon: HandCoins },
      { key: 'vaults', label: 'Vaults', path: 'vaults', icon: Vault },
      { key: 'approvals', label: 'Approvals', path: 'approvals', icon: ShieldCheck, badge: 'approvals' },
      { key: 'activity', label: 'Activity', path: 'activity', icon: Activity },
    ],
    secondary: [
      { key: 'reports', label: 'Reports', path: 'reports', icon: ChartColumn, capability: 'view_reports' },
      { key: 'team', label: 'Team', path: 'team', icon: Users, capability: 'manage_team' },
      { key: 'settings', label: 'Settings', path: 'settings', icon: Settings },
    ],
  },
  agency_admin: {
    primary: [
      { key: 'overview', label: 'Overview', path: 'overview', icon: LayoutDashboard },
      { key: 'funding', label: 'Funding', path: 'funding', icon: HandCoins },
      { key: 'accounts', label: 'Accounts', path: 'accounts', icon: Landmark, capability: 'view_treasury' },
      { key: 'budgets', label: 'Budgets', path: 'budgets', icon: PieChart },
      { key: 'payments', label: 'Payments', path: 'payments', icon: Send, capability: 'send_payment' },
      {
        key: 'bills',
        label: 'Bills',
        path: 'bills',
        icon: ReceiptText,
        capability: 'manage_bills',
        badge: 'bills',
      },
      { key: 'team', label: 'Team', path: 'team', icon: Users, capability: 'manage_team' },
    ],
    secondary: [
      {
        key: 'automations',
        label: 'Automations',
        path: 'automations',
        icon: Bot,
        capability: 'configure_ai_agent',
      },
      { key: 'approvals', label: 'Approvals', path: 'approvals', icon: ShieldCheck, badge: 'approvals' },
      { key: 'activity', label: 'Activity', path: 'activity', icon: Activity },
      { key: 'settings', label: 'Settings', path: 'settings', icon: Settings },
    ],
  },
  member: {
    primary: [
      { key: 'home', label: 'Home', path: 'home', icon: House },
      { key: 'budget', label: 'My budget', path: 'budget', icon: PieChart },
      { key: 'requests', label: 'Requests', path: 'requests', icon: Layers, badge: 'requests' },
      { key: 'expenses', label: 'Expenses', path: 'expenses', icon: WalletCards },
      { key: 'payments', label: 'Payments', path: 'payments', icon: ArrowDownLeft },
    ],
    secondary: [
      { key: 'activity', label: 'Activity', path: 'activity', icon: Activity },
      { key: 'profile', label: 'Profile', path: 'profile', icon: UserRound },
    ],
    mobileTabs: [
      { key: 'home', label: 'Home', path: 'home', icon: House },
      { key: 'request', label: 'Request', path: 'requests/new', icon: Send },
      { key: 'expenses', label: 'Expenses', path: 'expenses', icon: WalletCards },
      { key: 'payments', label: 'Payments', path: 'payments', icon: ArrowDownLeft },
    ],
  },
}

export function basePath(role: Role, scopeId: string): string {
  if (role === 'investor') return `/investor/${scopeId}`
  if (role === 'agency_admin') return `/agency/${scopeId}`
  return `/member/${scopeId}`
}

/** The first screen of a role: Portfolio overview, Agency overview or the Member home. */
export function roleHome(membership: Membership): Route {
  if (membership.scope.kind === 'portfolio')
    return `/investor/${membership.scope.portfolioId}/overview` as Route
  if (membership.role === 'agency_admin') return `/agency/${membership.scope.agencyId}/overview` as Route
  return `/member/${membership.scope.agencyId}/home` as Route
}

/** A receipt's page. Receipts live outside the role workspaces so they print cleanly. */
export function receiptHref(receiptId: string): Route {
  return `/receipts/${receiptId}` as Route
}

/** An invitation's landing page, the link shared with the invited person. */
export function inviteHref(code: string): Route {
  return `/invite/${code}` as Route
}

/** Section label for a path inside a role, used by the breadcrumb. */
export function sectionFor(role: Role, relativePath: string): NavItem | undefined {
  const navigation = NAVIGATION[role]
  const first = relativePath.split('/')[0] ?? ''
  return [...navigation.primary, ...navigation.secondary].find((item) => item.path === first)
}

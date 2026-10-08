import { DEMO } from '@/domain/fixtures/ids'
import type { Role } from '@/domain/types'

/**
 * Every product screen the spec defines (A6.4–A6.7), with its build status.
 * Drives the internal screens index at /design/screens and doubles as the
 * checklist for the remaining front-end phases. Update it when a screen ships.
 */
export type ScreenStatus = 'ready' | 'planned'

export type Screen = {
  /** Path relative to the role's workspace; `[param]` marks a record page. */
  path: string
  title: string
  summary: string
  status: ScreenStatus
  /** Phase that builds it, while planned. */
  phase?: string
  /** A concrete demo path to open, when the path has a parameter. */
  open?: string
}

export const SCREENS = {
  investor: [
    {
      path: 'overview',
      title: 'Overview',
      summary: 'KPIs, capital states, charts, pending tranches, agencies.',
      status: 'ready',
    },
    {
      path: 'agencies',
      title: 'Agencies',
      summary: 'Every funded team, with filters.',
      status: 'ready',
    },
    {
      path: 'agencies/new',
      title: 'New Agency',
      summary: 'Name, type, description, time zone, admin invite.',
      status: 'ready',
    },
    {
      path: 'agencies/[agencyId]',
      title: 'Agency detail',
      summary: 'Overview · Spending · Team · Activity; freeze agreement.',
      status: 'ready',
      open: `agencies/${DEMO.agencies.arc}`,
    },
    { path: 'funding', title: 'Funding', summary: 'Agreements by status.', status: 'ready' },
    {
      path: 'funding/new',
      title: 'New agreement',
      summary: 'Five-step wizard: commitment, tranches, milestones, policy.',
      status: 'ready',
    },
    {
      path: 'funding/[agreementId]',
      title: 'Agreement detail',
      summary: 'Progress, tranches, capital trail, policy, documents.',
      status: 'ready',
      open: `funding/${DEMO.agreements.arc}`,
    },
    {
      path: 'funding/[agreementId]/milestones/[milestoneId]',
      title: 'Milestone review',
      summary: 'Evidence, criteria, release / request changes / reject.',
      status: 'ready',
      open: `funding/${DEMO.agreements.arc}/milestones/${DEMO.milestones.arc2}`,
    },
    {
      path: 'vaults',
      title: 'Vaults',
      summary: 'Portfolio, funding, reserve and yield vaults with movements.',
      status: 'ready',
    },
    {
      path: 'vaults/add-funds',
      title: 'Add funds',
      summary: 'USDC deposit with waiting → received → credited.',
      status: 'ready',
    },
    {
      path: 'approvals',
      title: 'Approvals',
      summary: 'Tranche requests · Exceptions · Policy changes.',
      status: 'ready',
    },
    {
      path: 'activity',
      title: 'Activity',
      summary: 'Grouped feed with filters and CSV export.',
      status: 'ready',
    },
    {
      path: 'reports',
      title: 'Reports',
      summary: 'Deployment and spend charts, per-agency comparison.',
      status: 'ready',
    },
    { path: 'team', title: 'Team', summary: 'Investors and invitations.', status: 'ready' },
    {
      path: 'settings',
      title: 'Settings',
      summary: 'Profile, portfolio, notifications, security, developer.',
      status: 'ready',
    },
  ],
  agency_admin: [
    {
      path: 'overview',
      title: 'Overview',
      summary: 'KPIs, next tranche, requests, bills due, budget health.',
      status: 'ready',
    },
    {
      path: 'funding',
      title: 'Funding',
      summary: 'Agreement summary, tranches and release history.',
      status: 'ready',
    },
    {
      path: 'funding/tranches/[trancheId]/request',
      title: 'Request tranche',
      summary: 'Destination account and note.',
      status: 'ready',
      open: `funding/tranches/${DEMO.tranches.arc3}/request`,
    },
    {
      path: 'funding/milestones/[milestoneId]/submit',
      title: 'Submit milestone',
      summary: 'Evidence uploader and note.',
      status: 'ready',
      open: `funding/milestones/${DEMO.milestones.arc3}/submit`,
    },
    {
      path: 'accounts',
      title: 'Accounts',
      summary: 'Account cards with balances and sparklines.',
      status: 'ready',
    },
    {
      path: 'accounts/[accountId]',
      title: 'Account detail',
      summary: 'Balance, budgets, chart, movements.',
      status: 'ready',
      open: `accounts/${DEMO.accounts.arcOperations}`,
    },
    {
      path: 'accounts/new',
      title: 'New account',
      summary: 'Template, name, purpose, initial funding.',
      status: 'ready',
    },
    {
      path: 'accounts/transfer',
      title: 'Transfer funds',
      summary: 'Between accounts of the Agency.',
      status: 'ready',
    },
    {
      path: 'budgets',
      title: 'Budgets',
      summary: 'Cards with availability, usage and holders.',
      status: 'ready',
    },
    {
      path: 'budgets/new',
      title: 'New budget',
      summary: 'Source → Amount → Rules → People → Review.',
      status: 'ready',
    },
    {
      path: 'budgets/[budgetId]',
      title: 'Budget detail',
      summary: 'KPIs, rules, allowances, holds, payments.',
      status: 'ready',
      open: `budgets/${DEMO.budgets.arcTools}`,
    },
    {
      path: 'payments',
      title: 'Payments',
      summary: 'All · Team · Vendors · Reimbursements · Automation.',
      status: 'ready',
    },
    {
      path: 'payments/new',
      title: 'New payment',
      summary: 'Type, recipient, policy preview, operation.',
      status: 'ready',
    },
    { path: 'payments/team', title: 'Pay team', summary: 'Batch payouts.', status: 'ready' },
    { path: 'bills', title: 'Bills', summary: 'To pay · Scheduled · Paid · Reconciled.', status: 'ready' },
    { path: 'bills/new', title: 'Add bill', summary: 'Upload and fields.', status: 'ready' },
    {
      path: 'bills/[billId]',
      title: 'Bill detail',
      summary: 'Document, pay or schedule, reconcile.',
      status: 'ready',
      open: 'bills/bill_0024',
    },
    {
      path: 'bills/reconcile',
      title: 'Reconciliation',
      summary: 'Match paid bills to payments.',
      status: 'ready',
    },
    {
      path: 'providers',
      title: 'Providers',
      summary: 'Vendors, services and contractors with search, status and totals.',
      status: 'ready',
    },
    {
      path: 'providers/[providerId]',
      title: 'Provider detail',
      summary: 'Payments, total paid, budgets, bills; edit, pause, archive.',
      status: 'ready',
      open: `providers/${DEMO.destinations.vertex}`,
    },
    { path: 'team', title: 'Team', summary: 'Members and invitations.', status: 'ready' },
    {
      path: 'team/[memberId]',
      title: 'Member detail',
      summary: 'Edit allowance, revoke access.',
      status: 'ready',
      open: `team/${DEMO.users.alex}`,
    },
    {
      path: 'automations',
      title: 'Automations',
      summary: 'AI Agent cards.',
      status: 'ready',
    },
    {
      path: 'automations/new',
      title: 'New AI Agent',
      summary: 'Purpose, budget, caps, destinations, expiry.',
      status: 'ready',
    },
    {
      path: 'automations/[agentId]',
      title: 'AI Agent detail',
      summary: 'Policy, daily chart, decision log.',
      status: 'ready',
      open: `automations/${DEMO.agent}`,
    },
    {
      path: 'approvals',
      title: 'Approvals',
      summary: 'Queue with approval sheet.',
      status: 'ready',
    },
    {
      path: 'activity',
      title: 'Activity',
      summary: 'Grouped feed with filters and CSV export.',
      status: 'ready',
    },
    {
      path: 'settings',
      title: 'Settings',
      summary: 'Profile, approval rules, destinations, notifications, security, developer.',
      status: 'ready',
    },
  ],
  member: [
    {
      path: 'overview',
      title: 'Overview',
      summary: 'Available to spend, Viatik account, requests, receipts.',
      status: 'ready',
    },
    { path: 'budget', title: 'My budget', summary: 'Assigned budgets.', status: 'ready' },
    {
      path: 'budget/[budgetId]',
      title: 'Budget rules',
      summary: 'Rules, destinations, history.',
      status: 'ready',
      open: `budget/${DEMO.budgets.arcTools}`,
    },
    { path: 'requests', title: 'Requests', summary: 'By status.', status: 'ready' },
    { path: 'requests/new', title: 'New request', summary: 'Live policy evaluation.', status: 'ready' },
    {
      path: 'requests/[requestId]',
      title: 'Request detail',
      summary: 'Progress, verdict, receipt.',
      status: 'ready',
    },
    {
      path: 'expenses',
      title: 'Expenses',
      summary: 'Receipt status and filters.',
      status: 'ready',
    },
    {
      path: 'expenses/new',
      title: 'New expense',
      summary: 'Merchant, amount, receipt.',
      status: 'ready',
    },
    {
      path: 'payments',
      title: 'Payments',
      summary:
        'Viatik account: balance, send to my account, return unused funds, payments received, movements, saved addresses.',
      status: 'ready',
    },
    { path: 'activity', title: 'Activity', summary: 'Personal activity.', status: 'ready' },
    {
      path: 'settings',
      title: 'Settings',
      summary: 'Profile, agency, notifications, security, developer.',
      status: 'ready',
    },
  ],
} as const satisfies Record<Role, readonly Screen[]>

/** Screens outside the role workspaces. */
export const SHARED_SCREENS = [
  {
    path: '/sign-in',
    title: 'Sign in',
    summary: 'Email, Google or passkey; demo personas and deep links.',
    status: 'ready',
  },
  {
    path: '/welcome',
    title: 'Welcome',
    summary: 'New account: create a portfolio or join with an invitation.',
    status: 'ready',
  },
  {
    path: '/invite/[code]',
    title: 'Accept invitation',
    summary: 'Public invitation preview.',
    status: 'ready',
    open: '/invite/arc-sam-rivera',
  },
  { path: '/receipts/[receiptId]', title: 'Receipt', summary: 'Printable paper receipt.', status: 'ready' },
  { path: '/not-found', title: '404', summary: 'Branded not found.', status: 'ready' },
  { path: '/error', title: 'Error', summary: 'Branded error with retry.', status: 'ready' },
  {
    path: '/~offline',
    title: 'Offline',
    summary: 'Service worker fallback.',
    status: 'planned',
    phase: '4.9 (PWA)',
  },
] as const satisfies readonly Screen[]

// Path patterns derived from the inventory: `[param]` becomes any slug, so
// `href('budgets/nope')` fails the typecheck while `href(`budgets/${id}`)` passes.
type ParamsToPattern<S extends string> = S extends `${infer Head}[${string}]${infer Tail}`
  ? `${Head}${string}${ParamsToPattern<Tail>}`
  : S

/** Every screen path of a role (or of any role), relative to its workspace. */
export type ScreenPath<R extends Role = Role> = ParamsToPattern<(typeof SCREENS)[R][number]['path']>

import { usd } from '@/domain/money'
import type { BudgetAssignee, TimelineItem, TrailStep, TrancheSegment } from '@/components/viatik/finance'
import type { PolicyDecision } from '@/components/viatik/policy'
import type { StatusDescriptor } from '@/components/viatik/status'

/**
 * Props for the real product components shown on the landing. It tells the
 * same story as the demo: Northstar Capital funds Arc Studio, tranche 2 of 4
 * was just released, and Arc's team spends it within policy. Amounts are
 * integer cents, exactly as the product components expect.
 */

export const story = {
  investor: 'Northstar Capital',
  agency: 'Arc Studio',
  agreement: 'Product Delivery',
  member: 'Alex Morgan',
  admin: 'Maya Chen',
  vendor: 'Vertex Cloud',
  agent: 'Research Assistant',
} as const

export const capital = {
  committed: usd(100_000),
  released: usd(50_000),
  tranche: usd(25_000),
  payment: usd(120),
}

export const tranches: TrancheSegment[] = [
  { id: 't1', label: 'Discovery', amount: usd(25_000), state: 'released' },
  { id: 't2', label: 'Prototype', amount: usd(25_000), state: 'released' },
  { id: 't3', label: 'Beta', amount: usd(25_000), state: 'planned' },
  { id: 't4', label: 'Launch', amount: usd(25_000), state: 'planned' },
]

export const agreementTerms = [
  { label: 'Investor', value: story.investor },
  { label: 'Agency', value: story.agency },
  { label: 'Purpose', value: story.agreement },
  { label: 'Release model', value: 'Milestone based' },
  { label: 'Evidence', value: 'Required for every milestone' },
]

export const milestones: TimelineItem[] = [
  {
    id: 'm1',
    title: 'Discovery complete',
    date: 'Approved Jun 2',
    amount: usd(25_000),
    status: { label: 'Released', tone: 'success' },
    state: 'done',
  },
  {
    id: 'm2',
    title: 'Prototype delivered',
    date: 'Approved Sep 18',
    amount: usd(25_000),
    status: { label: 'Released', tone: 'success' },
    state: 'done',
  },
  {
    id: 'm3',
    title: 'Beta release',
    date: 'Due Nov 14',
    amount: usd(25_000),
    status: { label: 'In progress', tone: 'info' },
    state: 'current',
  },
  {
    id: 'm4',
    title: 'Production launch',
    date: 'Due Jan 30',
    amount: usd(25_000),
    status: { label: 'Planned', tone: 'neutral' },
    state: 'upcoming',
  },
]

export const budget = {
  name: 'Product Delivery',
  source: 'Operations',
  allocated: usd(5_000),
  spent: usd(1_620),
  reserved: usd(380),
  period: 'Monthly · resets Oct 1',
  status: { label: 'Active', tone: 'success' } satisfies StatusDescriptor,
  assignees: [
    { name: story.member, kind: 'user' },
    { name: story.admin, kind: 'user' },
    { name: story.agent, kind: 'ai_agent' },
  ] satisfies BudgetAssignee[],
}

export const budgetRules = [
  'Up to 500.00 USD per payment.',
  'Development tools, cloud and contractors only.',
  'Payments above 1,000.00 USD need Investor review.',
  'New destinations need Agency Admin approval.',
]

export const approvedPayment: PolicyDecision = {
  outcome: 'approved',
  checks: [
    {
      rule: 'limit',
      passed: true,
      blocking: true,
      message: '120.00 USD is within the 500.00 USD limit.',
    },
    {
      rule: 'category',
      passed: true,
      blocking: true,
      message: 'Development tools is an approved category.',
    },
    { rule: 'destination', passed: true, blocking: true, message: 'Vertex Cloud is an approved vendor.' },
  ],
}

export const reviewPayment: PolicyDecision = {
  outcome: 'needs_approval',
  reason: { message: 'Northwind Labs has not been paid from this budget before.' },
  checks: [],
}

export const trail: TrailStep[] = [
  { id: 's1', label: 'Commitment', title: `${story.investor} commits`, amount: usd(100_000) },
  { id: 's2', label: 'Release', title: 'Tranche 2 · Prototype', amount: usd(25_000) },
  { id: 's3', label: 'Budget', title: `${story.agreement} budget`, amount: usd(5_000) },
  { id: 's4', label: 'Payment', title: story.vendor, amount: usd(120) },
  { id: 's5', label: 'Receipt', title: 'RCT-0042', detail: 'Verified on Monad' },
]

export const receipt = {
  number: 'RCT-0042',
  description: `${story.vendor} · September compute`,
  amount: usd(120),
  rows: [
    { label: 'From', value: `${story.agreement} budget` },
    { label: 'Paid to', value: story.vendor },
    { label: 'Policy', value: 'Approved automatically' },
    { label: 'Evidence', value: 'vertex-invoice-0917.pdf' },
  ],
}

export const allowance = {
  used: 120,
  limit: 500,
  available: usd(380),
  budget: `${story.agreement} budget`,
}

export const agentRules = [
  'Up to 5.00 USD per operation.',
  'Up to 50.00 USD per day.',
  'Approved data and compute providers only.',
  'Expires Dec 31. Can be paused at any time.',
]

export const verifiedRelease = {
  operation: 'Tranche release',
  status: { label: 'Finalized', tone: 'success' } satisfies StatusDescriptor,
  rows: [
    { label: 'Network', value: 'Monad' },
    { label: 'Amount', value: '25,000.00 USDC' },
    { label: 'From', value: `${story.investor} vault` },
    { label: 'To', value: `${story.agency} · Operations` },
    { label: 'Transaction', value: '0x7a41…c09e', mono: true },
    { label: 'Receipt hash', value: '0x9c2e…41ab', mono: true },
  ],
}

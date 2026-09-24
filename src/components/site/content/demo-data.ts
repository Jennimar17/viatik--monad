/**
 * Static, clearly fictional interface data used by the landing-page product
 * previews. Nothing here is connected to a backend or a network.
 */

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning'

export type Status = { label: string; tone: StatusTone }

export const CURRENCY = 'USD'

export const capitalHistoryDemo = [
  { month: 'Apr', released: 0, portfolio: 25000 },
  { month: 'May', released: 8000, portfolio: 48000 },
  { month: 'Jun', released: 25000, portfolio: 78000 },
  { month: 'Jul', released: 25000, portfolio: 104000 },
  { month: 'Aug', released: 38000, portfolio: 134000 },
  { month: 'Sep', released: 50000, portfolio: 165000 },
]

export const spendingHistoryDemo = [
  { week: 'W1', team: 1650, tools: 420 },
  { week: 'W2', team: 2300, tools: 680 },
  { week: 'W3', team: 1850, tools: 520 },
  { week: 'W4', team: 2900, tools: 850 },
]

export const heroDemo = {
  investor: 'Northstar Capital',
  agency: 'Arc Studio',
  agreement: 'Product Delivery',
  committed: '100,000.00',
  released: '50,000.00',
  tranche: { label: 'Tranche 2 of 4', amount: '25,000.00' },
  milestone: 'Prototype delivered',
  budget: 'Product Delivery budget',
  account: 'Operations',
  member: 'Alex Morgan',
  vendor: 'Vertex Cloud',
  payment: '120.00',
  paymentCategory: 'Development tools',
  network: 'Monad',
  status: 'Verified',
} as const

export type PortfolioRow = {
  agency: string
  committed: string
  released: string
  nextMilestone: string
  status: Status
}

export const portfolioDemo = {
  rows: [
    {
      agency: 'Arc Studio',
      committed: '100,000.00',
      released: '25,000.00',
      nextMilestone: 'Prototype delivered',
      status: { label: 'Ready for review', tone: 'accent' },
    },
    {
      agency: 'Harbor Labs',
      committed: '250,000.00',
      released: '125,000.00',
      nextMilestone: 'Beta launch',
      status: { label: 'On schedule', tone: 'success' },
    },
    {
      agency: 'Fieldwork Collective',
      committed: '60,000.00',
      released: '15,000.00',
      nextMilestone: 'Field study complete',
      status: { label: 'Scheduled', tone: 'neutral' },
    },
  ] satisfies PortfolioRow[],
  pendingAction: {
    title: 'Prototype delivered — ready for review',
    detail: 'Arc Studio · Tranche 2 of 4 · 25,000.00',
  },
}

export const agencyOverviewDemo = {
  agency: 'Arc Studio',
  account: 'Operations',
  availableToOperate: '42,680.00',
  allocatedToBudgets: '18,400.00',
  reservedForPayments: '3,250.00',
  billsDue: 4,
  pendingRequests: 3,
  actions: ['Request funding', 'Create budget', 'Pay team', 'Pay bill'],
} as const

export const memberDemo = {
  member: 'Alex Morgan',
  budget: 'Product Delivery budget',
  policyText:
    'You can spend up to 500.00 USD this month. Development tools and cloud services are allowed. Payments above 250.00 USD require approval.',
  monthlyLimit: '500.00',
  available: '380.00',
  usedThisMonth: '120.00',
  usedPercent: 24,
  pendingRequests: 1,
  missingReceipts: 0,
} as const

export type Tranche = { label: string; amount: string; status: Status }

export const fundingAgreementDemo = {
  agency: 'Arc Studio',
  investor: 'Northstar Capital',
  purpose: 'Product delivery',
  commitment: '100,000.00',
  released: '25,000.00',
  releaseModel: 'Milestone based',
  progressPercent: 50,
  tranches: [
    { label: 'Tranche 1', amount: '25,000.00', status: { label: 'Released', tone: 'success' } },
    { label: 'Tranche 2', amount: '25,000.00', status: { label: 'Ready for review', tone: 'accent' } },
    { label: 'Tranche 3', amount: '25,000.00', status: { label: 'Planned', tone: 'neutral' } },
    { label: 'Tranche 4', amount: '25,000.00', status: { label: 'Planned', tone: 'neutral' } },
  ] satisfies Tranche[],
  milestones: ['Discovery complete', 'Prototype delivered', 'Beta release', 'Production launch'],
}

export type BudgetNode = {
  name: string
  kind: 'Account' | 'Budget' | 'Member' | 'Vendor' | 'AI Agent'
}

export const budgetPolicyDemo = {
  chain: [
    { name: 'Operations account', kind: 'Account' },
    { name: 'Product Delivery budget', kind: 'Budget' },
  ] satisfies [BudgetNode, BudgetNode],
  destinations: [
    { name: 'Alex Morgan', kind: 'Member' },
    { name: 'Vertex Cloud', kind: 'Vendor' },
    { name: 'Research Assistant', kind: 'AI Agent' },
  ] satisfies BudgetNode[],
  rules: [
    { label: 'Monthly limit', value: '5,000.00 USD' },
    { label: 'Per-payment limit', value: '500.00 USD' },
    { label: 'Approved categories', value: 'Development, cloud, contractors' },
    { label: 'Investor review', value: 'Payments above 1,000.00 USD' },
    { label: 'New destinations', value: 'Require approval' },
  ],
  requests: [
    {
      destination: 'Vertex Cloud',
      amount: '120.00',
      category: 'Development tools',
      status: { label: 'Approved by policy', tone: 'success' } as Status,
      reason: null,
    },
    {
      destination: 'New destination',
      amount: '900.00',
      category: 'Uncategorized',
      status: { label: 'Action required', tone: 'warning' } as Status,
      reason: 'Destination is not approved.',
    },
  ],
}

export const reconciliationDemo = {
  bill: {
    vendor: 'Vertex Cloud',
    reference: 'INV-2048',
    amount: '1,240.00',
    due: 'Due Sep 30',
  },
  payment: {
    account: 'Operations account',
    budget: 'Product Delivery budget',
    status: { label: 'Completed', tone: 'success' } as Status,
  },
  evidence: ['Invoice attached', 'Receipt generated', 'Verified record available'],
  finalState: { label: 'Reconciled', tone: 'success' } as Status,
}

export const automationDemo = {
  name: 'Research Assistant',
  kind: 'AI Agent',
  managedBy: 'Agency Admin · Arc Studio',
  policy: [
    { label: 'Daily limit', value: '50.00 USD' },
    { label: 'Per-operation limit', value: '5.00 USD' },
    { label: 'Providers', value: 'Approved services only' },
    { label: 'Working balance', value: '18.40 USD' },
  ],
  status: { label: 'Active', tone: 'success' } as Status,
  recentAction: {
    title: 'Data request',
    amount: '0.04',
    policyResult: 'Allowed',
    receipt: 'Created',
  },
}

export const verifiedDetailsDemo = {
  status: { label: 'Confirmed', tone: 'success' } as Status,
  network: 'Monad',
  operation: 'Tranche release',
  amount: '25,000.00',
  asset: 'USDC',
  timestamp: '18 Sep 2026 · 14:02 UTC',
  transaction: '0x7a41…demo',
  receiptHash: '0x9c2e…demo',
}

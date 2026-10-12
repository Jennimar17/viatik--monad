import type {
  AccountTemplate,
  AgencyType,
  BudgetPeriod,
  BudgetTemplate,
  PaymentType,
  ReceiptKind,
  ReleaseModel,
  Reminder,
  RequestType,
  SpendingCategory,
  VaultKind,
} from './types'

export const categoryLabel: Record<SpendingCategory, string> = {
  team: 'Team',
  contractors: 'Contractors',
  software: 'Software and tools',
  cloud: 'Cloud infrastructure',
  ai_services: 'AI services',
  research: 'Research',
  marketing: 'Marketing',
  travel: 'Travel',
  legal: 'Legal and compliance',
  equipment: 'Equipment',
}

export const agencyTypeLabel: Record<AgencyType, string> = {
  startup: 'Startup',
  agency: 'Agency',
  creative_studio: 'Creative studio',
  software_team: 'Software team',
  project_company: 'Project company',
  contractor_collective: 'Contractor collective',
  grant_recipient: 'Grant recipient',
  venture_studio_project: 'Venture studio project',
}

export const accountTemplate: Record<AccountTemplate, { label: string; description: string }> = {
  operations: { label: 'Operations', description: 'Receives released funding and covers day-to-day costs.' },
  people: { label: 'People', description: 'Team and contractor payments.' },
  vendors: { label: 'Vendors', description: 'Tools, services, and supplier bills.' },
  taxes: { label: 'Taxes', description: 'Set aside amounts owed to tax authorities.' },
  reserve: { label: 'Reserve', description: 'Capital held back from normal spending.' },
  project: { label: 'Project', description: 'Ring-fenced capital for a specific project.' },
}

export const budgetTemplate: Record<
  BudgetTemplate,
  { label: string; description: string; categories: SpendingCategory[] }
> = {
  team_spend: {
    label: 'Team spend',
    description: 'Everyday spending by team members.',
    categories: ['software', 'travel', 'equipment', 'research'],
  },
  tools: {
    label: 'Tools and software',
    description: 'Subscriptions and software licenses.',
    categories: ['software', 'cloud'],
  },
  vendors: {
    label: 'Vendors',
    description: 'Approved suppliers and service providers.',
    categories: ['contractors', 'legal', 'marketing'],
  },
  travel: { label: 'Travel', description: 'Trips, accommodation, and transport.', categories: ['travel'] },
  project: {
    label: 'Project',
    description: 'Everything a specific deliverable needs.',
    categories: ['contractors', 'software', 'cloud', 'research'],
  },
  ai_automation: {
    label: 'AI automation',
    description: 'Capped spending for AI Agents and data services.',
    categories: ['ai_services', 'research'],
  },
}

export const budgetPeriodLabel: Record<BudgetPeriod, string> = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
}

/** What an allowance is counted per, e.g. "$500 per month". */
export const budgetPeriodUnit: Record<BudgetPeriod, string> = {
  monthly: 'month',
  quarterly: 'quarter',
  one_time: 'budget',
}

export const paymentTypeLabel: Record<PaymentType, string> = {
  team: 'Team payment',
  contractor: 'Contractor payment',
  reimbursement: 'Reimbursement',
  vendor: 'Vendor payment',
  tool: 'Tool payment',
  refund: 'Refund',
  capital_return: 'Capital return',
  automation: 'Automation payment',
  advance: 'Money for purchases',
}

export const requestTypeLabel: Record<RequestType, string> = {
  funds: 'Money for purchases',
  vendor_payment: 'Vendor payment',
  reimbursement: 'Reimbursement',
  work: 'Payment for work',
  automation: 'Automation payment',
}

export const releaseModelLabel: Record<ReleaseModel, { label: string; description: string }> = {
  milestone: {
    label: 'Milestone-based',
    description: 'The Agency submits evidence for each milestone. You review it, then release the tranche.',
  },
  scheduled: {
    label: 'Scheduled',
    description:
      'Each tranche has a planned date. You release it when it is due; Viatik does not release by itself.',
  },
  manual: {
    label: 'Manual',
    description: 'You release each tranche, in order, whenever you decide. No evidence needed.',
  },
  recurring: {
    label: 'Recurring',
    description:
      'The same amount, planned every period. You release each one; Viatik does not release by itself.',
  },
}

/**
 * What an Agency does next once it accepts an agreement, by release model. The Investor always
 * releases; without a milestone, a tranche needs no request (one only picks the account it lands in).
 */
export const agencyNextTranche: Record<ReleaseModel, string> = {
  milestone: 'Submit evidence for the first milestone to request its tranche.',
  manual:
    'The Investor releases each tranche whenever they decide; the first one is ready for them now. You can also request it to choose the account it lands in.',
  scheduled:
    'The Investor releases each tranche when its planned date comes; the first one can already be released. You can also request it to choose the account it lands in.',
  recurring:
    'The Investor releases one tranche each period; the first one can already be released. You can also request it to choose the account it lands in.',
}

export const vaultKindLabel: Record<VaultKind, { label: string; description: string }> = {
  portfolio: {
    label: 'Portfolio Vault',
    description: 'Available investor capital, not yet committed to an Agency.',
  },
  funding: { label: 'Funding Vault', description: 'Capital committed to an Agency and not yet released.' },
  agency_reserve: { label: 'Agency Reserve', description: 'Agency capital held back from normal spending.' },
  yield: {
    label: 'Yield Vault',
    description: 'A preview of how rewards on eligible idle assets would be reported.',
  },
}

export const receiptKindLabel: Record<ReceiptKind, string> = {
  payment: 'Payment receipt',
  tranche_release: 'Funding release receipt',
  deposit: 'Deposit receipt',
  funding: 'Funding receipt',
  transfer: 'Transfer receipt',
  allocation: 'Allocation receipt',
  withdrawal: 'Withdrawal receipt',
  outside_payment: 'Outside payment receipt',
  capital_return: 'Capital return receipt',
}

export const reminderCadenceLabel: Record<Reminder['cadence'], string> = {
  monthly: 'Monthly',
}

/**
 * How often a scheduled payment runs: "Once", "Every 7 days", "Every 2 minutes". The ledger
 * repeats by a fixed number of seconds, so a "month" is honestly "Every 30 days".
 */
export function scheduleCadenceLabel(schedule: { intervalSeconds: number; runs: number }): string {
  if (schedule.intervalSeconds === 0 || schedule.runs <= 1) return 'Once'
  const every = (count: number, unit: string) => `Every ${count === 1 ? unit : `${count} ${unit}s`}`
  const seconds = schedule.intervalSeconds
  if (seconds % 86_400 === 0) return seconds === 604_800 ? 'Every week' : every(seconds / 86_400, 'day')
  if (seconds % 3_600 === 0) return every(seconds / 3_600, 'hour')
  if (seconds % 60 === 0) return every(seconds / 60, 'minute')
  return every(seconds, 'second')
}

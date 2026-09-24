import type { DemoRole } from '@/components/site/content/site'

export const announcement = {
  text: 'Built for Metropolis on Monad',
  link: { label: 'See what powers Viatik', href: '#monad' },
}

export const hero = {
  eyebrow: 'Programmable funding for modern teams',
  headline: ['Fund the work.', 'Control how capital moves.'],
  body: 'Deploy capital to agencies, startups, and project teams with milestones, budgets, and spending rules that enforce themselves.',
  primaryCta: { label: 'Open the demo' },
  secondaryCta: { label: 'See how it works', href: '#how-it-works' },
  supportingLine: 'Built on Monad. Designed like modern financial software.',
}

export const trustStatement = {
  headline: ['A transfer shows where capital started.', 'Viatik shows where it went.'],
  body: 'Funding decisions, milestone reviews, team payments, vendor bills, and receipts usually live in separate tools. Viatik connects them in one traceable capital flow.',
}

export type FlowStage = {
  id: string
  title: string
  description: string
  detail: { label: string; value: string }
}

export const capitalFlow = {
  heading: 'From commitment to receipt',
  body: 'Follow capital through every decision without turning operations into a manual approval process.',
  stages: [
    {
      id: 'commit',
      title: 'Commit',
      description: 'Investor defines the amount and purpose.',
      detail: { label: 'Funding agreement', value: '100,000.00 USD · Product Delivery' },
    },
    {
      id: 'release',
      title: 'Release',
      description: 'Capital becomes available by schedule or milestone.',
      detail: { label: 'Tranche 2 of 4', value: '25,000.00 USD · Prototype delivered' },
    },
    {
      id: 'allocate',
      title: 'Allocate',
      description: 'Agency Admin creates accounts and controlled budgets.',
      detail: { label: 'Operations account', value: 'Product Delivery budget' },
    },
    {
      id: 'spend',
      title: 'Spend',
      description: 'Members, vendors, and AI Agents operate within policy.',
      detail: { label: 'Payment', value: 'Vertex Cloud · 120.00 USD' },
    },
    {
      id: 'verify',
      title: 'Verify',
      description: 'Payment, evidence, and receipt remain connected.',
      detail: { label: 'Receipt', value: 'Verified on Monad' },
    },
  ] satisfies FlowStage[],
}

export type RoleStory = {
  id: DemoRole
  tab: string
  eyebrow: string
  heading: string
  body: string
  features: string[]
  cta: string
}

export const roleStory = {
  heading: 'One flow. Three perspectives.',
  body: 'Investors define the boundaries. Agencies operate the capital. Members know exactly what they can use.',
  roles: [
    {
      id: 'investor',
      tab: 'Investor',
      eyebrow: 'Investor',
      heading: 'Deploy capital without losing the operating trail',
      body: 'Create funding agreements, release milestone-based tranches, and review exceptions across every Agency from one portfolio.',
      features: [
        'Portfolio visibility',
        'Funding agreements',
        'Milestone reviews',
        'Controlled releases',
        'Capital trail',
      ],
      cta: 'Explore the Investor view',
    },
    {
      id: 'agency-admin',
      tab: 'Agency Admin',
      eyebrow: 'Agency Admin',
      heading: 'Turn released capital into an operating system',
      body: 'Create accounts and budgets, pay people and vendors, reconcile bills, and manage requests without breaking Investor-defined controls.',
      features: [
        'Accounts and budgets',
        'Team payments',
        'Vendor bills',
        'Spending approvals',
        'Reconciliation',
      ],
      cta: 'Explore the Agency view',
    },
    {
      id: 'member',
      tab: 'Member',
      eyebrow: 'Member',
      heading: 'Know what you can spend before you spend it',
      body: 'Request funds, use approved budgets, pay authorized services, upload receipts, and receive payments without handling wallets or gas.',
      features: [
        'Personal spending access',
        'Clear budget rules',
        'Funding requests',
        'Expense evidence',
        'Payment history',
      ],
      cta: 'Explore the Member view',
    },
  ] satisfies RoleStory[],
}

export const fundingAgreements = {
  eyebrow: 'Programmable agreements',
  heading: 'Funding conditions become part of the capital flow',
  body: 'Define the commitment, schedule, milestones, evidence requirements, spending boundaries, and approval thresholds for each Agency.',
  points: [
    'Scheduled or milestone-based tranches.',
    'Clear committed, funded, and released balances.',
    'Evidence attached to every milestone review.',
    'Emergency pause and capital return conditions.',
    'Rules that remain visible to both sides.',
  ],
}

export const agencyOperations = {
  eyebrow: 'Agency operations',
  heading: 'Flexible enough to operate. Controlled enough to trust.',
  body: 'Released funding becomes operational accounts and budgets for people, tools, vendors, projects, and controlled automation.',
}

export const reconciliation = {
  eyebrow: 'Connected evidence',
  heading: 'A payment is not complete until the record is complete',
  body: 'Link bills, payments, receipts, and supporting evidence in a single reconciliation trail.',
  points: [
    'Suggested payment matches.',
    'Required receipt reminders.',
    'Canonical payment record.',
    'Human-readable activity trail.',
    'Optional Monad verification.',
  ],
}

export const automation = {
  eyebrow: 'Controlled automation',
  heading: 'Give AI Agents a budget, not unlimited access',
  body: 'Set provider rules, per-operation limits, daily caps, expiration dates, and an emergency pause. Every automated payment leaves a decision record.',
  cta: { label: 'See programmable controls', href: '#security' },
}

export const monad = {
  eyebrow: 'Built on Monad',
  heading: 'Blockchain where it matters. Financial software everywhere else.',
  body: 'Viatik uses Monad for settlement, programmable controls, and verifiable receipts while keeping wallets, gas, contract calls, and network operations behind the product experience.',
  userLayer: {
    title: 'What users see',
    items: ['Sign in', 'Funding agreement', 'Available balance', 'Budget', 'Payment', 'Receipt'],
  },
  systemLayer: {
    title: 'What Viatik coordinates',
    items: [
      'Embedded accounts',
      'Sponsored operations',
      'Policy enforcement',
      'Onchain settlement',
      'Evidence hashes',
      'Verifiable events',
    ],
  },
  note: 'Demo data shown.',
}

export const security = {
  eyebrow: 'Designed around control',
  heading: 'Rules that do not depend on someone remembering them',
  body: 'Critical funding and spending policies can be enforced at the account layer. Private documents and personal information remain in Viatik’s protected application layer.',
  controls: [
    { title: 'Scoped access', body: 'Every action is limited by role, Agency, account, and budget.' },
    { title: 'Separation of duties', body: 'Nobody approves their own exceptional request.' },
    { title: 'Spending limits', body: 'Per-payment and period limits remain attached to the budget.' },
    {
      title: 'Approved destinations',
      body: 'Payments can be restricted to known people, vendors, and services.',
    },
    { title: 'Emergency controls', body: 'Funding agreements, budgets, and automations can be paused.' },
    {
      title: 'Verifiable receipts',
      body: 'Important actions can be independently verified without exposing private business documents.',
    },
  ],
}

export const principles = {
  title: 'Capital control without operational control',
  statement: ['Investors define the boundaries.', 'Agencies decide how to operate within them.'],
  body: 'Viatik is designed to preserve accountability without forcing investors to approve every ordinary expense. Policy handles routine decisions. People review the exceptions.',
  items: [
    { title: 'Purpose before payment', body: 'Every allocation starts with a defined use.' },
    {
      title: 'Rules before approval',
      body: 'Routine spending follows policy instead of manual intervention.',
    },
    { title: 'Evidence after settlement', body: 'The payment and its supporting record remain connected.' },
  ],
}

export const faq = {
  heading: 'Questions, answered plainly',
  items: [
    {
      question: 'What is Viatik?',
      answer:
        'Viatik is a programmable funding platform for investors and the agencies, startups, studios, and project teams they support. It connects funding agreements, capital releases, budgets, payments, and evidence in one operating flow.',
    },
    {
      question: 'Is Viatik a bank?',
      answer:
        'No. Viatik is software for coordinating funding and spending. Financial, custody, payment, and compliance capabilities depend on the infrastructure and providers used in each deployment.',
    },
    {
      question: 'Do users need a crypto wallet?',
      answer:
        'The intended experience uses embedded accounts, so normal users can sign in with familiar methods and use Viatik without installing a wallet extension. Advanced verification details remain available when needed.',
    },
    {
      question: 'What is a Funding Agreement?',
      answer:
        'A Funding Agreement defines how much capital is committed to an Agency, how it may be released, which milestones or schedules apply, and which operating controls must be followed.',
    },
    {
      question: 'Can an Agency spend funds freely?',
      answer:
        'An Agency can operate within the accounts, budgets, limits, categories, and approval thresholds established by its Funding Agreement and administrators.',
    },
    {
      question: 'What is the difference between a payout and a spending allowance?',
      answer:
        'A payout transfers funds to a recipient. A spending allowance gives a Member permission to use Agency funds under a defined budget without transferring the entire allocation in advance.',
    },
    {
      question: 'Can Viatik manage team payments?',
      answer:
        'Agency Admins can organize team and contractor payments and connect them to budgets and receipts. Viatik does not calculate payroll taxes or determine employment classification.',
    },
    {
      question: 'Where does Monad appear?',
      answer:
        'Monad provides the settlement and programmable verification layer. In normal workflows, users see familiar financial actions. Network details appear only when they open Verified details or use advanced funding options.',
    },
    {
      question: 'Does Viatik guarantee investment returns?',
      answer:
        'No. Viatik does not guarantee returns. Vault and yield capabilities are optional future features and depend on external protocols, asset eligibility, and risk conditions.',
    },
  ],
}

export const finalCta = {
  heading: 'Put capital to work without losing the trail',
  body: 'Create an Agency, define its funding agreement, and follow the first tranche from commitment to completed payment.',
  primary: 'Open the demo',
  secondary: 'Join the waitlist',
}

export const waitlist = {
  title: 'Join the waitlist',
  description: 'Tell us a little about your organization and we will share early-access availability.',
  fields: {
    email: 'Work email',
    organization: 'Organization',
    role: 'I am an',
  },
  roleOptions: [
    { value: 'investor', label: 'Investor' },
    { value: 'agency', label: 'Agency' },
    { value: 'other', label: 'Other' },
  ],
  submit: 'Request early access',
  success: {
    title: 'Preview complete',
    message: 'This is an interactive product preview. No request has been sent or saved.',
  },
}

export const footer = {
  copyright: '© 2026 Viatik. All rights reserved.',
  builtOn: 'Built on Monad',
}

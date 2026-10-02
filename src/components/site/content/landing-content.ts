import type { DemoRole } from '@/components/site/content/site'
import type { GlassFigureId } from '@/components/site/illustrations/glass-figures'
import type { StageId } from '@/components/site/illustrations/scenes'

/*
 * Landing copy. Message hierarchy every section expands:
 *   Promise   Fund the work without losing control of how capital moves.
 *   Mechanism Agreements, budgets and spending rules travel with the capital
 *             and are enforced at the account layer, on Monad.
 *   Proof     A live demo of all three roles; USDC settlement on Monad.
 *             No customer names, counts or testimonials until they are real.
 *   Action    Open the demo (or a role inside it).
 */

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
  proofStrip: {
    lead: 'For the people backing what comes next.',
    items: ['Settles in USDC on Monad', 'No wallets or gas for users', 'Every payment keeps its receipt'],
  },
}

export const showcase = {
  eyebrow: 'Why Viatik',
  headline: ['Clear terms for the people who fund.', 'Room to work for the people who build.'],
  body: 'Investors set the terms once. Operators see everything the capital powers. Teams spend within rules they can read.',
  cards: {
    investors: {
      title: 'Back what comes next.',
      description: 'Commit with purpose. Release when the work is proven.',
      chipLabel: 'Funding agreement',
      chipValue: '$100,000.00',
      chipNote: 'Four milestones, one clear plan.',
      link: 'Built for investors',
    },
    operators: {
      title: 'More room to build.',
      description: 'One view of everything your capital powers.',
      metricLabel: 'September spending',
      metricValue: '$11,170.00',
      link: 'Made for operators',
    },
    teams: {
      title: 'Good work, less friction.',
      description: 'Clear budgets give your team more autonomy.',
      chipTitle: 'You’re good to go.',
      chipNote: 'Tools & services · Within budget',
      link: 'Designed for teams',
    },
  },
}

export type FlowStage = {
  id: StageId
  title: string
  description: string
  detail: { label: string; value: string }
}

export const howItWorks = {
  eyebrow: 'How it works',
  headline: ['A transfer shows where capital started.', 'Viatik shows where it went.'],
  body: 'Funding decisions, milestone reviews, payments, and receipts usually live in separate tools. Viatik keeps them in one flow, from commitment to receipt.',
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

export type RoleId = 'investor' | 'agency-admin' | 'member' | 'ai-agent'

export type RoleLayer = {
  id: RoleId
  number: string
  label: string
  heading: string
  body: string
  bestFitFor: string
  features: string[]
  cta: { label: string; role: DemoRole }
}

export const roles = {
  eyebrow: 'Product',
  heading: 'One flow. Four layers of control.',
  body: 'Capital moves down the stack: Investors set the boundaries, Agencies run the capital, Members spend within it, and AI Agents work on a budget.',
  items: [
    {
      id: 'investor',
      number: '01',
      label: 'Investor',
      heading: 'Deploy capital without losing the trail',
      body: 'Release milestone-based tranches and review exceptions across every Agency from one portfolio.',
      bestFitFor: 'Funds, angels, grant programs, and studios backing several teams at once.',
      features: [
        'Funding agreements with milestones',
        'Releases tied to reviewed evidence',
        'One capital trail per Agency',
      ],
      cta: { label: 'Explore the Investor view', role: 'investor' },
    },
    {
      id: 'agency-admin',
      number: '02',
      label: 'Agency Admin',
      heading: 'Turn released capital into operations',
      body: 'Create accounts, budgets, and payments without breaking the rules the Investor set.',
      bestFitFor: 'Studios, agencies, and startups operating funded work for someone else.',
      features: [
        'Accounts and budgets per project',
        'Team payments and vendor bills',
        'Reconciliation with evidence attached',
      ],
      cta: { label: 'Explore the Agency view', role: 'agency-admin' },
    },
    {
      id: 'member',
      number: '03',
      label: 'Member',
      heading: 'Know what you can spend before you spend it',
      body: 'Request funds, pay approved services, and upload receipts without handling wallets or gas.',
      bestFitFor: 'Contributors, contractors, and team leads spending on behalf of an Agency.',
      features: [
        'A clear allowance with its rules',
        'Funding requests in plain language',
        'A receipt on every payment',
      ],
      cta: { label: 'Explore the Member view', role: 'member' },
    },
    {
      id: 'ai-agent',
      number: '04',
      label: 'AI Agents',
      heading: 'Give automation a budget, not unlimited access',
      body: 'Every automated payment follows provider rules and leaves a decision record.',
      bestFitFor: 'Teams paying for APIs, data, and compute through agents.',
      features: ['Per-operation and daily limits', 'Approved providers only', 'Emergency pause and expiry'],
      cta: { label: 'See it in the Agency view', role: 'agency-admin' },
    },
  ] satisfies RoleLayer[],
}

export type UseCase = {
  id: GlassFigureId
  title: string
  caption: string
  body: string
  role: DemoRole
}

export const useCases = {
  eyebrow: 'Use cases',
  heading: 'Built for whoever funds the work',
  body: 'The same flow fits any arrangement where one side provides capital and the other operates it.',
  items: [
    {
      id: 'studios',
      title: 'Venture studios & accelerators',
      caption: 'Milestone tranches',
      body: 'Back several teams at once and release each tranche when its milestone is proven.',
      role: 'investor',
    },
    {
      id: 'grants',
      title: 'Grant programs',
      caption: 'Evidence-gated releases',
      body: 'Pay grantees as deliverables land, with the evidence attached to every release.',
      role: 'investor',
    },
    {
      id: 'ecosystems',
      title: 'Ecosystem funds',
      caption: 'Settled on Monad',
      body: 'Fund builders with programmable controls and receipts anyone can verify.',
      role: 'investor',
    },
    {
      id: 'agencies',
      title: 'Agencies & studios',
      caption: 'Budgets and vendor bills',
      body: 'Turn a client commitment into budgets for people, tools, and vendors.',
      role: 'agency-admin',
    },
    {
      id: 'teams',
      title: 'Distributed teams',
      caption: 'Allowances, not shared wallets',
      body: 'Give every contributor a clear allowance instead of a shared card or wallet.',
      role: 'member',
    },
  ] satisfies UseCase[],
}

export type ControlTab = {
  id: 'agreements' | 'budgets' | 'reconciliation'
  tab: string
  /** Where the panel would live in the app, shown in the frame's breadcrumb. */
  crumb: string
  heading: string
  body: string
  points: string[]
}

export const controls = {
  eyebrow: 'Programmable controls',
  statement: ['Investors define the boundaries.', 'Agencies operate within them.'],
  body: 'Policy handles routine spending, people review the exceptions, and every rule stays visible to both sides.',
  tabs: [
    {
      id: 'agreements',
      tab: 'Funding agreements',
      crumb: 'Funding',
      heading: 'Funding conditions travel with the capital',
      body: 'Set the commitment, schedule, milestones, evidence requirements, and approval thresholds for each Agency.',
      points: [
        'Scheduled or milestone-based tranches',
        'Evidence attached to every milestone review',
        'Emergency pause and capital return conditions',
      ],
    },
    {
      id: 'budgets',
      tab: 'Budgets & policies',
      crumb: 'Budgets',
      heading: 'Budgets with the rules attached',
      body: 'Released funding becomes accounts and budgets for people, tools, vendors, and controlled automation.',
      points: [
        'Monthly and per-payment limits',
        'Approved categories and destinations',
        'Exceptions routed to the right reviewer',
      ],
    },
    {
      id: 'reconciliation',
      tab: 'Reconciliation',
      crumb: 'Bills & receipts',
      heading: 'A payment is complete when the record is',
      body: 'Bills, payments, receipts, and supporting evidence stay linked in a single reconciliation trail.',
      points: ['Suggested payment matches', 'Required receipt reminders', 'Optional verification on Monad'],
    },
  ] satisfies ControlTab[],
  security: {
    heading: 'Rules that do not depend on someone remembering them',
    body: 'Critical funding and spending policies can be enforced at the account layer. Private documents and personal information stay in Viatik’s protected application layer.',
    controls: [
      { title: 'Scoped access', body: 'Every action is limited by role, Agency, account, and budget.' },
      { title: 'Separation of duties', body: 'Nobody approves their own exceptional request.' },
      { title: 'Spending limits', body: 'Per-payment and period limits stay attached to the budget.' },
      {
        title: 'Approved destinations',
        body: 'Payments can be restricted to known people, vendors, and services.',
      },
      { title: 'Emergency controls', body: 'Agreements, budgets, and automations can be paused.' },
      {
        title: 'Verifiable receipts',
        body: 'Important actions can be verified without exposing private business documents.',
      },
    ],
  },
}

export const monad = {
  eyebrow: 'Built on Monad',
  heading: 'Blockchain where it matters. Financial software everywhere else.',
  body: 'Viatik uses Monad for settlement, programmable controls, and verifiable receipts while keeping wallets, gas, contract calls, and network operations behind the product experience.',
  pace: {
    title: 'From payment to final',
    body: 'A tranche release is settled and final in under a second.',
    from: 'Payment sent',
    to: 'Final',
    duration: '0.8 s',
    stats: [
      { value: '0.8 s', label: 'Final, for every payment' },
      { value: '10,000', label: 'Transactions per second' },
      { value: 'EVM', label: 'Works with Ethereum tools' },
    ],
    note: 'Network figures as published by Monad.',
  },
  verified: {
    label: 'Verified details',
    note: 'Anyone can check this record onchain. Private documents never leave Viatik.',
  },
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
      question: 'Can an Agency spend funds freely?',
      answer:
        'An Agency can operate within the accounts, budgets, limits, categories, and approval thresholds established by its Funding Agreement and administrators.',
    },
    {
      question: 'How do AI Agents spend money?',
      answer:
        'An Agency Admin gives each AI Agent its own budget with approved providers, per-operation limits, a daily cap, and an expiry date. Payments outside those rules are not allowed, and the Agent can be paused at any time.',
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

export const closing = {
  eyebrow: 'Get started',
  heading: 'Put capital to work without losing the trail',
  body: 'Open the demo and follow one tranche from commitment to completed payment, from each side of the agreement.',
  primary: 'Open the demo',
}

export const footer = {
  copyright: '© 2026 Viatik. All rights reserved.',
  builtOn: 'Built on Monad',
}

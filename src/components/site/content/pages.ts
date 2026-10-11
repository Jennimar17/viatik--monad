import type { PageBlock } from '@/components/site/chrome/marketing-page'

/*
 * Copy for the informational pages linked from the footer. Draft: only says
 * what the product does today and what the landing already claims.
 */

export const about = {
  eyebrow: 'About Viatik',
  title: 'Funding that keeps its trail.',
  intro:
    'Viatik is programmable funding software for investors and the agencies, startups and project teams they back. It keeps agreements, releases, budgets, payments and receipts in one flow.',
  blocks: [
    {
      id: 'what',
      heading: 'What Viatik does',
      body: 'A transfer shows where capital started. Viatik shows where it went.',
      points: [
        'Investors set the terms once: amount, milestones and evidence.',
        'Agencies turn released capital into accounts and budgets.',
        'Members spend within clear allowances and attach a receipt to every payment.',
      ],
    },
    {
      id: 'who',
      tone: 'light',
      heading: 'Who it is for',
      cards: [
        {
          tag: 'Investor',
          title: 'Fund with control',
          body: 'Release milestone-based tranches and review exceptions across every Agency from one portfolio.',
        },
        {
          tag: 'Agency Admin',
          title: 'Run the capital',
          body: 'Create accounts, budgets and payments without breaking the rules the Investor set.',
        },
        {
          tag: 'Member',
          title: 'Spend with confidence',
          body: 'Know what you can spend before you spend it, with no wallets or gas to manage.',
        },
      ],
    },
    {
      id: 'monad',
      heading: 'Why Monad',
      body: 'Monad settles payments in under a second and keeps receipts anyone can verify. Wallets, gas and contract calls stay behind the product, so people see familiar financial actions.',
    },
    {
      id: 'status',
      tone: 'light',
      heading: 'Where we are',
      body: 'Viatik is an early product built for the Monad Metropolis hackathon and runs on Monad Testnet. The demo uses fictional people, organizations and amounts.',
    },
  ] satisfies PageBlock[],
}

export const roadmap = {
  eyebrow: 'Roadmap',
  title: 'What works today, and what comes next.',
  intro:
    'Viatik runs on Monad Testnet today. This page separates what you can use now from what moves to mainnet with real assets.',
  blocks: [
    {
      id: 'live',
      heading: 'Live today',
      tone: 'light',
      body: 'Open the demo and follow one tranche from commitment to completed payment.',
      cards: [
        {
          tag: 'Investor',
          title: 'Funding agreements',
          body: 'Commit capital to an Agency with milestones, evidence requirements and tranches.',
        },
        {
          tag: 'Investor',
          title: 'Fund and withdraw',
          body: 'Bring funds from your own wallet and withdraw from the Portfolio Vault to your wallet or another address.',
        },
        {
          tag: 'Investor',
          title: 'Network rewards preview',
          body: 'A read-only view of a real MON delegation on Monad, with no yield promise.',
        },
        {
          tag: 'Agency Admin',
          title: 'Budgets and policies',
          body: 'Released funding becomes accounts and budgets with limits, categories and approvals.',
        },
        {
          tag: 'Agency Admin',
          title: 'Providers',
          body: 'Search, edit, pause and archive the vendors you pay, with their payment history.',
        },
        {
          tag: 'Agency Admin',
          title: 'Scheduled and recurring payments',
          body: 'Schedule one-off or repeating payments. Admins and Investors can pause or cancel them.',
        },
        {
          tag: 'Member',
          title: 'Your Viatik account',
          body: 'See your balance and movements, and send them to a saved wallet address whenever you want.',
        },
        {
          tag: 'Everyone',
          title: 'Verified receipts',
          body: 'Important actions settle on Monad Testnet and every payment keeps a receipt anyone can check.',
        },
        {
          tag: 'Everyone',
          title: 'Sign in without a wallet',
          body: 'Email, Google or passkey. Your account is created for you.',
        },
      ],
    },
    {
      id: 'mainnet',
      heading: 'Coming to mainnet',
      body: 'Viatik settles with test dollars on Monad Testnet today. After the hackathon these move to real assets and live infrastructure.',
      cards: [
        {
          tag: 'Mainnet',
          title: 'USDC settlement',
          body: 'Funding agreements, releases and payments settle in USDC instead of test dollars.',
        },
        {
          tag: 'Mainnet',
          title: 'Fiat on- and off-ramps',
          body: 'Add and withdraw money with a bank account, not only a wallet.',
        },
        {
          tag: 'Mainnet',
          title: 'Yield on idle capital',
          body: 'Idle capital can earn through established lending markets, with clear risk disclosures.',
        },
      ],
    },
  ] satisfies PageBlock[],
}

export const docs = {
  eyebrow: 'Documentation',
  title: 'How Viatik works, in plain language.',
  intro: 'The ideas behind the product, the roles, and how to check a payment on Monad.',
  blocks: [
    {
      id: 'concepts',
      tone: 'light',
      heading: 'Core concepts',
      cards: [
        {
          title: 'Funding agreement',
          body: 'The terms between an Investor and an Agency: amount, purpose, milestones and evidence.',
        },
        {
          title: 'Tranche',
          body: 'A portion of the commitment released when its schedule or milestone is met.',
        },
        {
          title: 'Vault',
          body: 'Where capital is held. The Portfolio Vault belongs to the Investor; each agreement has its own funding vault.',
        },
        {
          title: 'Account and budget',
          body: 'How an Agency Admin turns released capital into spendable amounts with rules attached.',
        },
        {
          title: 'Policy',
          body: 'Limits, approved categories and destinations. Routine spending passes; exceptions go to a reviewer.',
        },
        {
          title: 'Receipt',
          body: 'The record that links a payment to its bill and evidence, verifiable on Monad.',
        },
      ],
    },
    {
      id: 'roles',
      heading: 'Roles',
      points: [
        'Investor: sets the boundaries, releases tranches and reviews exceptions across the portfolio.',
        'Agency Admin: operates the Agency, turning released capital into accounts, budgets and payments.',
        'Member: spends within assigned limits, requests funds and uploads receipts.',
      ],
    },
    {
      id: 'settlement',
      heading: 'How payments settle',
      body: 'Viatik records funding, releases and payments on Monad, where a transaction is final in under a second. Wallets, gas and contract calls stay behind the product, so you only see familiar financial actions. Private documents stay in Viatik; only their fingerprints are recorded.',
    },
    {
      id: 'verify',
      tone: 'light',
      heading: 'How to verify a receipt',
      points: [
        'Open a payment and choose Verified details.',
        'Copy the transaction link and open it in the Monad block explorer.',
        'Check that the amount, destination and time match the receipt in Viatik.',
      ],
    },
    {
      id: 'glossary',
      heading: 'Glossary',
      cards: [
        { title: 'Agency', body: 'The studio, startup or team that operates funded work.' },
        { title: 'Evidence', body: 'Files and notes that prove a milestone was met.' },
        { title: 'Testnet', body: 'A practice network. Funds used on it have no real value.' },
      ],
    },
  ] satisfies PageBlock[],
}

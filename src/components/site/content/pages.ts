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
      heading: 'Where we are',
      body: 'Viatik is an early product built for the Monad Metropolis hackathon and runs on Monad Testnet. The demo uses fictional people, organizations and amounts.',
    },
  ] satisfies PageBlock[],
}

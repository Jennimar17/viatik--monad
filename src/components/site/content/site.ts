import type { Route } from 'next'

export type DemoRole = 'investor' | 'agency-admin' | 'member'

export const siteConfig = {
  name: 'Viatik',
  // Production origin; it feeds canonical, Open Graph and JSON-LD metadata.
  url: 'https://viatik.xyz',
  title: 'Viatik — Programmable funding for modern teams',
  description:
    'Fund agencies, startups, and project teams through programmable agreements, milestone-based releases, controlled budgets, and verifiable payments.',
  ogTitle: 'Fund the work. Control how capital moves.',
  ogDescription:
    'Viatik connects funding agreements, capital releases, budgets, payments, and evidence in one verifiable flow.',
  statement: 'Programmable funding infrastructure for modern teams.',
  routes: {
    demo: '/sign-in/demo',
    signIn: '/sign-in',
    /** Opens the product signed in as the matching person of the demo story. */
    demoRole: (role: DemoRole) => `/sign-in/demo?as=${role}` as const,
  },
} as const

export type NavItem = { label: string; href: `#${string}` | Route; external?: boolean }

/**
 * A page that is planned but not built yet. It is listed so the information
 * architecture is visible, and rendered like a link that cannot be followed.
 * When the page ships, replace `planned` with `href`; typed routes check it.
 */
export type PlannedItem = { label: string; planned: string }

export type FooterItem = NavItem | PlannedItem

export function isPlanned(item: FooterItem): item is PlannedItem {
  return 'planned' in item
}

export const primaryNav: NavItem[] = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Product', href: '#product' },
  { label: 'Use cases', href: '#use-cases' },
  { label: 'Controls', href: '#controls' },
  { label: 'Monad', href: '#monad' },
]

export const footerNav: { heading: string; items: FooterItem[] }[] = [
  {
    heading: 'Product',
    items: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Roles', href: '#product' },
      { label: 'Controls', href: '#controls' },
      { label: 'Security', href: '#security' },
      { label: 'Funding agreements', planned: '/product/funding-agreements' },
      { label: 'Budgets & policies', planned: '/product/budgets' },
      { label: 'AI Agents', planned: '/product/ai-agents' },
      { label: 'Open the demo', href: '/sign-in/demo' },
    ],
  },
  {
    heading: 'Use cases',
    items: [
      { label: 'Venture studios', planned: '/use-cases/venture-studios' },
      { label: 'Grant programs', planned: '/use-cases/grant-programs' },
      { label: 'Ecosystem funds', planned: '/use-cases/ecosystem-funds' },
      { label: 'Agencies & studios', planned: '/use-cases/agencies' },
      { label: 'Distributed teams', planned: '/use-cases/distributed-teams' },
    ],
  },
  {
    heading: 'Learn',
    items: [
      { label: 'About Monad', planned: '/monad' },
      { label: 'Why Monad', href: '#monad' },
      { label: 'Settlement', planned: '/learn/settlement' },
      { label: 'Verified receipts', planned: '/learn/verification' },
      { label: 'Documentation', planned: '/docs' },
      { label: 'Glossary', planned: '/glossary' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    heading: 'Company',
    items: [
      { label: 'About Viatik', planned: '/about' },
      { label: 'Roadmap', planned: '/roadmap' },
      { label: 'Brand kit', planned: '/brand' },
      { label: 'Contact', planned: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    items: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
    ],
  },
]

export type SocialNetwork = 'x' | 'discord' | 'github' | 'telegram'

/** Social profiles, not live yet: shown in the footer without links. */
export const socials: { network: SocialNetwork; label: string }[] = [
  { network: 'x', label: 'X' },
  { network: 'discord', label: 'Discord' },
  { network: 'github', label: 'GitHub' },
  { network: 'telegram', label: 'Telegram' },
]

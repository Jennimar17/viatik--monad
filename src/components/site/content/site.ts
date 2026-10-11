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
  contact: {
    email: 'contact@viatik.xyz',
    x: 'https://x.com/viatikapp',
  },
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
      { label: 'Controls & security', href: '#controls' },
      { label: 'Open the demo', href: '/sign-in/demo' },
    ],
  },
  {
    heading: 'Learn',
    items: [
      { label: 'Why Monad', href: '#monad' },
      { label: 'Documentation', href: '/docs' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    heading: 'Company',
    items: [
      { label: 'About', href: '/about' },
      { label: 'Roadmap', href: '/roadmap' },
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

export type SocialNetwork = 'x' | 'email'

/** Where to find and reach Viatik, linked from the footer. */
export const socials: { network: SocialNetwork; label: string; href: string }[] = [
  { network: 'x', label: 'Viatik on X', href: siteConfig.contact.x },
  {
    network: 'email',
    label: `Email ${siteConfig.contact.email}`,
    href: `mailto:${siteConfig.contact.email}`,
  },
]

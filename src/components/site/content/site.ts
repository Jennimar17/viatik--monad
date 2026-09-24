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
  // Configuration placeholder for the fictional "View in explorer" control in
  // the Verified details preview. Leave null to render it as a disabled demo
  // control instead of linking to a fabricated transaction.
  explorerUrl: null as string | null,
  routes: {
    demo: '#product',
    signIn: '/sign-in',
    demoRole: (role: DemoRole) =>
      role === 'investor' ? '#for-investors' : role === 'agency-admin' ? '#for-agencies' : '#product',
  },
} as const

export type NavItem = { label: string; href: `#${string}` | Route; external?: boolean }

export const primaryNav: NavItem[] = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'For investors', href: '#for-investors' },
  { label: 'For agencies', href: '#for-agencies' },
  { label: 'Security', href: '#security' },
]

export const footerNav: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Product',
    items: [
      { label: 'How it works', href: '#how-it-works' },
      { label: 'For investors', href: '#for-investors' },
      { label: 'For agencies', href: '#for-agencies' },
      { label: 'Security', href: '#security' },
    ],
  },
  {
    heading: 'Company',
    items: [
      { label: 'About', href: '#principles' },
      { label: 'Contact', href: '#waitlist' },
      { label: 'Updates', href: '#waitlist' },
    ],
  },
  {
    heading: 'Resources',
    items: [
      { label: 'Documentation', href: '#faq' },
      { label: 'Monad', href: '#monad' },
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

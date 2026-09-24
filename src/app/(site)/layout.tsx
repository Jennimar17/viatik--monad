import type { Metadata } from 'next'

import { siteConfig } from '@/components/site/content/site'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: {
    url: '/',
    title: siteConfig.ogTitle,
    description: siteConfig.ogDescription,
  },
  twitter: {
    title: siteConfig.ogTitle,
    description: siteConfig.ogDescription,
  },
}

const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: siteConfig.name,
    url: siteConfig.url,
    logo: `${siteConfig.url}/brand/viatik-mark-dark.svg`,
    description: siteConfig.statement,
  },
]

/** Marketing site (viatik.xyz): skip link and structured data, as in the original landing. */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-full focus:bg-primary focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-primary-foreground focus:outline-none"
      >
        Skip to content
      </a>
      {children}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
    </>
  )
}

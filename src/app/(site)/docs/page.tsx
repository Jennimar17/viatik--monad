import type { Metadata } from 'next'

import { MarketingPage } from '@/components/site/chrome/marketing-page'
import { docs } from '@/components/site/content/pages'

export const metadata: Metadata = {
  title: 'Documentation',
  description: docs.intro,
  alternates: { canonical: '/docs' },
}

export default function DocsPage() {
  return <MarketingPage {...docs} toc />
}

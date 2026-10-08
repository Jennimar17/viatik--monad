import type { Metadata } from 'next'

import { MarketingPage } from '@/components/site/chrome/marketing-page'
import { about } from '@/components/site/content/pages'

export const metadata: Metadata = {
  title: 'About',
  description: about.intro,
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return <MarketingPage {...about} />
}

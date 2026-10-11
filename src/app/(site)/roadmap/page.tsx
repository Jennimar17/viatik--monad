import type { Metadata } from 'next'

import { MarketingPage } from '@/components/site/chrome/marketing-page'
import { roadmap } from '@/components/site/content/pages'

export const metadata: Metadata = {
  title: 'Roadmap',
  description: roadmap.intro,
  alternates: { canonical: '/roadmap' },
}

export default function RoadmapPage() {
  return <MarketingPage {...roadmap} />
}

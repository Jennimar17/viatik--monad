import type { MetadataRoute } from 'next'

import { siteConfig } from '@/components/site/content/site'

/** Public pages only: workspaces, invitations and the API stay out (see robots.ts). */
const pages: { path: string; changeFrequency: 'weekly' | 'monthly' | 'yearly'; priority: number }[] = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/sign-in/demo', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/docs', changeFrequency: 'monthly', priority: 0.7 },
  { path: '/roadmap', changeFrequency: 'monthly', priority: 0.6 },
  { path: '/sign-in', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return pages.map(({ path, changeFrequency, priority }) => ({
    url: path === '/' ? siteConfig.url : `${siteConfig.url}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }))
}

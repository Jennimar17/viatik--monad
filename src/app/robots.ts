import type { MetadataRoute } from 'next'

import { siteConfig } from '@/components/site/content/site'

/** Crawlers see the public site; signed-in workspaces, invitations, internal pages and the API stay out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/investor/', '/agency/', '/member/', '/invite/', '/welcome', '/design'],
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  }
}

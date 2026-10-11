import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'

import { siteConfig } from '@/components/site/content/site'
import './globals.css'

// Variable fonts, latin subset, served from the repo (src/fonts, OFL licensed)
// so builds never depend on Google Fonts being reachable.
const inter = localFont({
  src: '../fonts/inter-latin.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})

const archivo = localFont({
  src: '../fonts/archivo-latin.woff2',
  weight: '100 900',
  variable: '--font-archivo',
  display: 'swap',
  // Width axis, used by the `wide-set` utility on display text.
  declarations: [{ prop: 'font-stretch', value: '62.5% 125%' }],
})

// Product-only monospace (hashes, addresses, tags). Not preloaded: the browser
// fetches it only when a product screen renders with it, never on the landing.
const jetbrains = localFont({
  src: '../fonts/jetbrains-mono-latin.woff2',
  weight: '100 800',
  variable: '--font-jetbrains',
  display: 'swap',
  preload: false,
})

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: siteConfig.title, template: `%s · ${siteConfig.name}` },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  openGraph: {
    type: 'website',
    siteName: siteConfig.name,
    locale: 'en',
  },
  twitter: {
    card: 'summary',
  },
  icons: {
    icon: [{ url: '/brand/viatik-mark-dark.svg', type: 'image/svg+xml' }],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
  themeColor: '#22092c',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${archivo.variable} ${jetbrains.variable} bg-background`}
    >
      <body className="min-h-svh antialiased">
        {children}
        {/* Vercel Analytics exists only on Vercel; elsewhere its script would 404. */}
        {process.env.NODE_ENV === 'production' && process.env.VERCEL === '1' && <Analytics />}
      </body>
    </html>
  )
}

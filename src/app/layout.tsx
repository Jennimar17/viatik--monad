import type { Metadata, Viewport } from 'next'
import { Archivo, Inter } from 'next/font/google'

import { publicEnv } from '@/lib/env'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-archivo',
  display: 'swap',
  axes: ['wdth'],
})

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_SITE_URL),
  title: 'Viatik',
  applicationName: 'Viatik',
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
    <html lang="en" className={`${inter.variable} ${archivo.variable}`}>
      <body className="min-h-svh antialiased">{children}</body>
    </html>
  )
}

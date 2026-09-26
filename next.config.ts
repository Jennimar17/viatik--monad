import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

const nextConfig: NextConfig = {
  // Fails the typecheck on links to routes that do not exist.
  typedRoutes: true,
  // The landing ships pre-sized photos; kept for visual parity with the original site.
  images: { unoptimized: true },
  experimental: {
    // The repo lives on a slow external drive: persisting the dev cache costs
    // more (60–100 MB writes per compile, minute-long compactions) than it saves.
    turbopackFileSystemCacheForDev: false,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig

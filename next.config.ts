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
    // `pnpm build` runs webpack (package.json): Hostinger's build sandbox blocks the
    // 127.0.0.1 connection Turbopack's PostCSS workers need. This flag only affects
    // `next build --turbopack`, where only Vercel keeps .next/cache between builds.
    turbopackFileSystemCacheForBuild: process.env.VERCEL === '1',
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // The Member's Home and Profile became Overview and Settings, as in the other roles.
  async redirects() {
    return [
      // One hostname in production, so passkeys and sessions always belong to viatik.xyz.
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.viatik.xyz' }],
        destination: 'https://viatik.xyz/:path*',
        permanent: true,
      },
      { source: '/member/:agencyId/home', destination: '/member/:agencyId/overview', permanent: false },
      { source: '/member/:agencyId/profile', destination: '/member/:agencyId/settings', permanent: false },
    ]
  },
}

export default nextConfig

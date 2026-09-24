import type { Metadata } from 'next'

import { AppProviders } from '@/components/app/providers'

export const metadata: Metadata = {
  // `absolute` keeps the root template from turning the default into "Viatik · Viatik".
  title: { absolute: 'Viatik', template: '%s · Viatik' },
  robots: { index: false, follow: false },
}

/** The product (app.viatik.xyz): sign-in, invitations and the role workspaces. */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="app-theme app-canvas min-h-svh">
      <AppProviders>{children}</AppProviders>
    </div>
  )
}

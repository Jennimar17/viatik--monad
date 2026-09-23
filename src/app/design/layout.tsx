import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { publicEnv } from '@/lib/env'

export const metadata: Metadata = {
  title: 'Design system · Viatik',
  robots: { index: false, follow: false },
}

/** Internal showcase of the product design system. Available in development and demo builds only. */
export default function DesignLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  if (process.env.NODE_ENV === 'production' && !publicEnv.NEXT_PUBLIC_DEMO_MODE) notFound()

  return (
    <div className="app-theme app-canvas min-h-svh">
      <TooltipProvider>{children}</TooltipProvider>
      <Toaster position="bottom-right" />
    </div>
  )
}

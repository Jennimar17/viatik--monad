'use client'

import { ButtonLink } from '@/components/app/button-link'
import { ErrorState } from '@/components/viatik/feedback'
import { ViatikLogo } from '@/components/viatik/viatik-logo'

/** Branded error boundary for every route: nothing moved, try again or go back to the workspace. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="app-theme app-canvas min-h-svh">
      <main className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center gap-6 px-4">
        <ViatikLogo />
        <ErrorState
          titleAs="h1"
          title="Something went wrong on this screen"
          description="Nothing was moved or changed. Try again, and if it keeps happening, reload the page."
          onRetry={reset}
          className="w-full"
        />
        <ButtonLink href="/sign-in" variant="ghost" size="pill-sm">
          Go to my workspace
        </ButtonLink>
      </main>
    </div>
  )
}

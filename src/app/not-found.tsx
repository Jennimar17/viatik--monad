import { ButtonLink } from '@/components/app/button-link'
import { Tag } from '@/components/viatik/status'
import { ViatikLogo } from '@/components/viatik/viatik-logo'

/** Branded 404 for any path outside a workspace; screens inside a workspace use `ScreenUnavailable`. */
export default function NotFound() {
  return (
    <div className="app-theme app-canvas min-h-svh">
      <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-5 px-4 text-center">
        <ViatikLogo />
        <Tag>404</Tag>
        <h1 className="font-display text-3xl font-medium tracking-tight text-balance">
          We could not find that page
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          It may have moved, or it belongs to a workspace you do not have access to.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <ButtonLink href="/sign-in" size="pill">
            Go to my workspace
          </ButtonLink>
          <ButtonLink href="/" variant="outline" size="pill">
            Back to viatik.xyz
          </ButtonLink>
        </div>
      </main>
    </div>
  )
}

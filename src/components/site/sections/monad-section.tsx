import { cn } from '@/lib/utils'

import { VerifiedDetailsPreview } from '@/components/site/previews/verified-details-preview'
import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { monad } from '@/components/site/content/landing-content'

export function MonadSection() {
  return (
    <Section id="monad" aria-labelledby="monad-heading">
      <Container className="flex flex-col gap-14 lg:gap-16">
        <SectionIntro
          eyebrow={monad.eyebrow}
          heading={<span id="monad-heading">{monad.heading}</span>}
          body={monad.body}
          className="max-w-3xl"
        />

        <div className="grid gap-10 lg:grid-cols-12 lg:items-start lg:gap-12">
          <div className="lg:col-span-7">
            <LayerGrid />
          </div>
          <div className="lg:col-span-5">
            <VerifiedDetailsPreview />
          </div>
        </div>
      </Container>
    </Section>
  )
}

/**
 * Two aligned layers read as paired rows: what the user sees on the left,
 * what Viatik coordinates for that step on the right.
 */
function LayerGrid() {
  const pairs = monad.userLayer.items.map(
    (item, index) => [item, monad.systemLayer.items[index] ?? ''] as const,
  )

  return (
    <div className="flex flex-col gap-3">
      <div
        aria-label="What users see, paired with what Viatik coordinates"
        role="group"
        className="grain grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border"
      >
        <LayerCell layer="user" header>
          {monad.userLayer.title}
        </LayerCell>
        <LayerCell layer="system" header>
          {monad.systemLayer.title}
        </LayerCell>
        {pairs.map(([user, system]) => (
          <LayerPair key={user} user={user} system={system} />
        ))}
      </div>
      <p className="text-xs text-subtle">
        Users work in the left column. Viatik coordinates the right column without exposing it.
      </p>
    </div>
  )
}

function LayerPair({ user, system }: { user: string; system: string }) {
  return (
    <>
      <LayerCell layer="user">{user}</LayerCell>
      <LayerCell layer="system">{system}</LayerCell>
    </>
  )
}

function LayerCell({
  layer,
  header = false,
  children,
}: {
  layer: 'user' | 'system'
  header?: boolean
  children: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-2.5 px-4 py-3 text-sm sm:px-5',
        layer === 'user' ? 'bg-card text-foreground' : 'bg-background text-muted-foreground',
        header && 'text-xs font-medium tracking-[0.06em] text-subtle uppercase',
      )}
    >
      {!header ? (
        <span
          aria-hidden="true"
          className={cn('size-1.5 shrink-0', layer === 'user' ? 'bg-violet' : 'border border-subtle')}
        />
      ) : null}
      <span className="text-pretty">{children}</span>
    </div>
  )
}

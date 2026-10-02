import { cn } from '@/lib/utils'

import { Container, Section, SectionIntro } from '@/components/site/chrome/section'
import { MonadLayersScene } from '@/components/site/illustrations/scenes'
import { MonadPace } from '@/components/site/sections/monad-pace'
import { KeyValueList } from '@/components/viatik/layout'
import { StatusBadge } from '@/components/viatik/status'
import { monad } from '@/components/site/content/landing-content'
import { verifiedRelease } from '@/components/site/content/product-demo'

export function MonadSection() {
  return (
    <Section id="monad" aria-labelledby="monad-heading" className="theme-light">
      <Container className="flex flex-col gap-14 lg:gap-16">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
          <SectionIntro
            eyebrow={monad.eyebrow}
            heading={<span id="monad-heading">{monad.heading}</span>}
            body={monad.body}
            className="lg:col-span-7 lg:max-w-none"
          />
          <MonadLayersScene className="mx-auto h-64 w-full max-w-sm sm:h-72 lg:col-span-4 lg:col-start-9 lg:h-80 lg:max-w-none" />
        </div>

        <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
          <MonadPace className="lg:col-span-7" />
          <VerifiedRecord className="lg:col-span-5" />
        </div>
      </Container>
    </Section>
  )
}

/** The one place network details appear: the record behind a tranche release. */
function VerifiedRecord({ className }: { className?: string }) {
  return (
    <div className={cn('theme-dark product-frame flex flex-col gap-5 p-5 sm:p-7', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-subtle">{monad.verified.label}</p>
          <p className="text-base font-medium text-foreground">{verifiedRelease.operation}</p>
        </div>
        <StatusBadge status={verifiedRelease.status} />
      </div>
      <KeyValueList
        items={verifiedRelease.rows.map((row) => ({
          label: row.label,
          value: row.mono ? <code className="font-mono text-xs">{row.value}</code> : row.value,
        }))}
      />
      <p className="mt-auto border-t border-border pt-4 text-xs text-pretty text-subtle">
        {monad.verified.note}
      </p>
    </div>
  )
}

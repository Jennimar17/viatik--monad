import { ArrowRightIcon } from 'lucide-react'

import { Container } from '@/components/site/chrome/section'
import { announcement } from '@/components/site/content/landing-content'

export function AnnouncementBar() {
  return (
    <div className="border-b border-border bg-card">
      <Container className="flex min-h-11 flex-wrap items-center justify-center gap-x-4 text-sm">
        <p className="py-2 text-muted-foreground">{announcement.text}</p>
        <a
          href={announcement.link.href}
          className="inline-flex min-h-11 items-center gap-1.5 text-foreground transition-colors hover:text-violet focus-visible:rounded-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {announcement.link.label}
          <ArrowRightIcon aria-hidden="true" className="size-4" />
        </a>
      </Container>
    </div>
  )
}

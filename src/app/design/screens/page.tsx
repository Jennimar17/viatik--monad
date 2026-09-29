'use client'

import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import type { Route } from 'next'
import Link from '@/components/viatik/link'
import { useRouter } from 'next/navigation'

import { basePath } from '@/components/app/nav'
import { SCREENS, SHARED_SCREENS, type Screen } from '@/components/app/screens'
import { Button } from '@/components/ui/button'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PersonAvatar, roleIcons } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { DEMO, DEMO_PERSONAS } from '@/domain/fixtures/ids'
import { roleLabel } from '@/domain/permissions'
import type { Role } from '@/domain/types'
import { setDemoSession } from '@/lib/session'

const personaOf: Record<Role, (typeof DEMO_PERSONAS)[number]> = {
  investor: DEMO_PERSONAS[0]!,
  agency_admin: DEMO_PERSONAS[1]!,
  member: DEMO_PERSONAS[2]!,
}

const scopeOf: Record<Role, string> = {
  investor: DEMO.portfolio,
  agency_admin: DEMO.agencies.arc,
  member: DEMO.agencies.arc,
}

const statusOf = (screen: Screen) =>
  screen.status === 'ready'
    ? { label: 'Ready', tone: 'success' as const }
    : { label: `Planned · ${screen.phase ?? ''}`.trim(), tone: 'neutral' as const }

/** Internal index of every spec screen, to review the UI role by role. */
export default function ScreensPage() {
  const router = useRouter()
  const openAs = (userId: string, path: string) => {
    setDemoSession(userId)
    router.push(path as Route)
  }
  const total = Object.values(SCREENS).flat().length + SHARED_SCREENS.length
  const ready = [...Object.values(SCREENS).flat(), ...SHARED_SCREENS].filter(
    (s) => s.status === 'ready',
  ).length

  return (
    <main id="main" className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow={
          <Link href="/design" className="flex items-center gap-1 hover:text-foreground">
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Design system
          </Link>
        }
        title="Screens"
        description={`${ready} of ${total} screens from the product spec are built. Open any of them as its demo persona.`}
      />

      {(Object.keys(SCREENS) as Role[]).map((role) => {
        const persona = personaOf[role]
        const base = basePath(role, scopeOf[role])
        const Icon = roleIcons[role]
        return (
          <Panel
            key={role}
            title={
              <span className="flex items-center gap-2">
                <Icon className="size-4 text-subtle" aria-hidden="true" /> {roleLabel[role]}
              </span>
            }
            description={`Viewed as ${persona.name} · ${persona.organization}`}
          >
            <ScreenList
              screens={SCREENS[role]}
              hrefFor={(screen) => `${base}/${screen.open ?? screen.path}`}
              onOpen={(path) => openAs(persona.userId, path)}
              persona={persona.name}
            />
          </Panel>
        )
      })}

      <Panel title="Shared" description="Outside the role workspaces.">
        <ScreenList
          screens={SHARED_SCREENS}
          hrefFor={(screen) => screen.open ?? screen.path}
          onOpen={(path) => openAs(personaOf.agency_admin.userId, path)}
          persona={personaOf.agency_admin.name}
        />
      </Panel>
    </main>
  )
}

function ScreenList({
  screens,
  hrefFor,
  onOpen,
  persona,
}: {
  screens: Screen[]
  hrefFor: (screen: Screen) => string
  onOpen: (path: string) => void
  persona: string
}) {
  return (
    <ul className="flex flex-col">
      {screens.map((screen) => {
        const openable = !screen.path.includes('[') || Boolean(screen.open)
        return (
          <li
            key={screen.path}
            className="flex flex-col gap-2 border-t border-border py-3 first:border-t-0 sm:flex-row sm:items-center sm:gap-4"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{screen.title}</span>
                <code className="font-mono text-2xs text-subtle">{screen.path}</code>
              </span>
              <span className="text-xs text-muted-foreground">{screen.summary}</span>
            </span>
            <span className="flex items-center gap-2">
              <StatusBadge status={statusOf(screen)} />
              {openable ? (
                <Button variant="outline" size="sm" onClick={() => onOpen(hrefFor(screen))}>
                  <PersonAvatar name={persona} size="xs" /> Open
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              ) : (
                <span className="text-xs text-subtle">Open from its list</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

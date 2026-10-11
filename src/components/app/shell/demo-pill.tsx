'use client'

import { Check, FlaskConical, LogOut, RotateCcw } from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PersonAvatar, roleIcons } from '@/components/viatik/people'
import { useResetDemo, useViatikState } from '@/data/react'
import { DEMO_PERSONAS } from '@/domain/fixtures'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

import { useRole } from '../role-context'
import { resetWelcomeCards } from '../welcome-card'
import { useShellUi } from './app-shell'

/**
 * Hackathon demo mode: a floating glass pill to view the product as any of
 * the three people in the demo story, to reset the data, or to leave the demo.
 */
export function DemoPill() {
  const { userId, user } = useViatikState()
  const { role } = useRole()
  const { enterDemo, signOut } = useSession()
  const router = useRouter()
  const resetDemo = useResetDemo()
  const { bottomBar } = useShellUi()
  const RoleIcon = roleIcons[role]

  return (
    <div
      className={cn(
        'no-print fixed right-4 z-40 sm:right-6',
        role === 'member' ? 'bottom-24 md:bottom-6' : 'bottom-4 sm:bottom-6',
        // On phones a screen's action bar takes the bottom edge; the pill comes back when it unmounts.
        // From md up the bar floats on the right, sticky at the bottom edge or, scrolled to the end,
        // above the page's bottom padding: the demo pill sits above both.
        bottomBar && 'max-md:hidden md:bottom-36',
      )}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="glass-overlay flex h-11 items-center gap-2.5 rounded-full py-1.5 pr-4 pl-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Demo mode. Viewing as ${user?.name}, ${roleLabel[role]}. Switch person`}
            />
          }
        >
          <PersonAvatar name={user?.name ?? 'Demo'} size="sm" />
          <span className="hidden flex-col leading-tight sm:flex">
            <span className="text-2xs tracking-[0.1em] text-subtle uppercase">Viewing as</span>
            <span className="flex items-center gap-1.5 text-sm">
              {user?.name} · {roleLabel[role]}
              <RoleIcon className="size-3.5 text-subtle" aria-hidden="true" />
            </span>
          </span>
          <FlaskConical className="size-4 text-subtle sm:hidden" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-80 p-1.5">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs text-subtle">
              Demo mode · view the product as
            </DropdownMenuLabel>
            {DEMO_PERSONAS.map((persona) => {
              const Icon = roleIcons[persona.role]
              const active = persona.userId === userId
              return (
                <DropdownMenuItem
                  key={persona.key}
                  onClick={() => {
                    enterDemo(persona.userId)
                    router.push(persona.href as Route)
                  }}
                  className="items-start gap-3 rounded-lg p-2.5"
                >
                  <PersonAvatar name={persona.name} size="sm" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {persona.name}
                      <span className="flex items-center gap-1 text-xs font-normal text-subtle">
                        <Icon className="size-3" aria-hidden="true" /> {roleLabel[persona.role]}
                      </span>
                    </span>
                    <span className="text-xs text-pretty text-muted-foreground">
                      {persona.organization} · {roleDescription[persona.role]}
                    </span>
                  </span>
                  {active ? <Check className="mt-1 size-4 text-sage" aria-label="Current" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 rounded-lg"
            onClick={async () => {
              // Go home first: records created since are gone after the reset.
              // An invited demo person is gone too, so they choose a persona again.
              const persona = DEMO_PERSONAS.find((p) => p.userId === userId)
              router.push((persona?.href ?? '/sign-in/demo') as Route)
              resetWelcomeCards(DEMO_PERSONAS.map((p) => p.userId))
              await resetDemo()
              toast.success('Demo data was reset.')
            }}
          >
            <RotateCcw className="size-4" /> Reset demo
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2 rounded-lg"
            onClick={async () => {
              // Only the demo person leaves; a real account on this device stays signed in.
              // Awaited, so this destination replaces the shell's own redirect to sign-in.
              await signOut()
              router.replace('/sign-in/demo')
            }}
          >
            <LogOut className="size-4" /> Exit demo
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

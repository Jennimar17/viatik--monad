'use client'

import { Menu, Plus } from 'lucide-react'
import Link from '@/components/viatik/link'
import { usePathname } from 'next/navigation'

import { useSidebar } from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

import { NAVIGATION } from '../nav'
import { useHref, useRole } from '../role-context'
import { useBadgeCounts } from './app-sidebar'

/** Member navigation on phones: Overview · Request · Expenses · Payments · More. */
export function MobileTabBar() {
  const { base } = useRole()
  const href = useHref()
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const tabs = NAVIGATION.member.mobileTabs ?? []
  const counts = useBadgeCounts()

  return (
    <nav
      aria-label="Primary"
      className="glass-chrome fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
        {tabs.map((tab) => {
          const target = `${base}/${tab.path}`
          const active = pathname === target || (tab.key !== 'request' && pathname.startsWith(`${target}/`))
          const Icon = tab.icon
          const count = tab.badge ? counts[tab.badge] : 0
          if (tab.key === 'request') {
            return (
              <li key={tab.key} className="flex justify-center">
                <Link
                  href={href(tab.path)}
                  className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label="New request"
                >
                  <Plus className="size-5" />
                </Link>
              </li>
            )
          }
          return (
            <li key={tab.key}>
              <Link
                href={href(tab.path)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'text-foreground' : 'text-subtle',
                )}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {count > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 flex min-w-4 items-center justify-center rounded-full bg-mist px-1 text-2xs leading-4 font-medium text-primary-foreground tabular-nums">
                      {count}
                    </span>
                  ) : null}
                </span>
                {tab.label}
                {count > 0 ? <span className="sr-only">({count} overdue)</span> : null}
              </Link>
            </li>
          )
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className="flex w-full flex-col items-center gap-1 rounded-lg py-1.5 text-[11px] text-subtle outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Menu className="size-5" />
            More
          </button>
        </li>
      </ul>
    </nav>
  )
}

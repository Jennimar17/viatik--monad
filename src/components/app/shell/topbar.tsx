'use client'

import { Bell, LogOut, Search, Settings } from 'lucide-react'
import Link from '@/components/viatik/link'
import { usePathname, useRouter } from 'next/navigation'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { PersonAvatar } from '@/components/viatik/people'
import { ViatikMark } from '@/components/viatik/viatik-logo'
import { useViatikState } from '@/data/react'
import { useSession } from '@/lib/session'

import { sectionFor } from '../nav'
import { useHref, useRole } from '../role-context'
import { useShellUi } from './app-shell'
import { useBadgeCounts } from './app-sidebar'

export function Topbar() {
  const { user, state } = useViatikState()
  const { role, base, agencyId, portfolioId } = useRole()
  const { openCommand, openNotifications } = useShellUi()
  const { signOut } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const href = useHref()
  const counts = useBadgeCounts()

  const scopeName = agencyId
    ? state.agencies.find((a) => a.id === agencyId)?.name
    : state.portfolios.find((p) => p.id === portfolioId)?.name
  const relative = pathname.startsWith(base) ? pathname.slice(base.length + 1) : ''
  const section = sectionFor(role, relative)
  const deeper = section && relative !== section.path

  return (
    <header className="glass-chrome sticky top-0 z-30 flex h-16 items-center gap-2 border-b px-3 sm:px-5">
      <SidebarTrigger className={role === 'member' ? 'hidden md:inline-flex' : undefined} />
      <Link href={href('overview')} className="flex items-center gap-2 md:hidden" aria-label="Viatik home">
        <ViatikMark className="size-7" />
      </Link>

      <Breadcrumb className="hidden min-w-0 md:block">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbLink render={<Link href={href('overview')} />} className="truncate">
              {scopeName}
            </BreadcrumbLink>
          </BreadcrumbItem>
          {section ? (
            <>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {deeper ? (
                  <BreadcrumbLink render={<Link href={href(section.path)} />}>{section.label}</BreadcrumbLink>
                ) : (
                  <BreadcrumbPage>{section.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </>
          ) : null}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={openCommand}
          className="flex h-9 items-center gap-2 rounded-full border border-hairline bg-mist/5 pr-2 pl-3 text-sm text-subtle transition-colors outline-none hover:bg-mist/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:w-56 lg:w-72"
        >
          <Search className="size-4" aria-hidden="true" />
          <span className="flex-1 text-left max-sm:sr-only">Search or jump to…</span>
          <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
        </button>
        <button
          type="button"
          onClick={openNotifications}
          className="relative inline-flex size-9 items-center justify-center rounded-full border border-hairline bg-mist/5 text-muted-foreground transition-colors outline-none hover:bg-mist/10 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            counts.notifications > 0 ? `Notifications, ${counts.notifications} unread` : 'Notifications'
          }
        >
          <Bell className="size-4" />
          {counts.notifications > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-mist px-1 text-2xs leading-4 font-medium text-primary-foreground">
              {counts.notifications}
            </span>
          ) : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Account menu"
              />
            }
          >
            <PersonAvatar name={user?.name ?? 'You'} size="md" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60 p-1.5">
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
                <span className="text-sm font-medium text-foreground">{user?.name}</span>
                <span className="text-xs text-subtle">{user?.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 rounded-lg" onClick={() => router.push(href('settings'))}>
              <Settings className="size-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 rounded-lg"
              onClick={async () => {
                await signOut()
                router.replace('/sign-in')
              }}
            >
              <LogOut className="size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

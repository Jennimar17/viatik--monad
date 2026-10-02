'use client'

import * as React from 'react'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useViatik } from '@/data/react'
import { publicEnv } from '@/lib/env'
import { cn } from '@/lib/utils'

import { useRole } from '../role-context'
import { AppSidebar } from './app-sidebar'
import { CommandMenu } from './command-menu'
import { DemoPill } from './demo-pill'
import { HeadFallback } from './head-fallback'
import { MobileTabBar } from './mobile-tab-bar'
import { NotificationsSheet } from './notifications-sheet'
import { Topbar } from './topbar'

type ShellUi = {
  openCommand: () => void
  openNotifications: () => void
  /** True while a screen shows a sticky action bar at the bottom. */
  bottomBar: boolean
  setBottomBar: (active: boolean) => void
}

const ShellUiContext = React.createContext<ShellUi | null>(null)

export function useShellUi() {
  const context = React.useContext(ShellUiContext)
  if (!context) throw new Error('useShellUi must be used inside AppShell')
  return context
}

/** Screens with a bottom action bar declare it, so floating chrome moves out of the way. */
export function useBottomBar(active = true) {
  const { setBottomBar } = useShellUi()
  React.useEffect(() => {
    if (!active) return
    setBottomBar(true)
    return () => setBottomBar(false)
  }, [active, setBottomBar])
}

const TABLET = '(min-width: 768px) and (max-width: 1023px)'

/**
 * Role shell: glass sidebar (icon rail on tablet, sheet on phones), glass top
 * bar, opaque content surfaces on the grain canvas. Members also get a bottom
 * tab bar on phones.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { role } = useRole()
  const { mode } = useViatik()
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [notificationsOpen, setNotificationsOpen] = React.useState(false)
  // Tablets get the icon rail by default; desktops get the full sidebar. The
  // shell only mounts in the browser (after the data loads), so reading the
  // media query up front avoids a collapse animation on tablets.
  const [sidebarOpen, setSidebarOpen] = React.useState(() => !window.matchMedia(TABLET).matches)

  React.useEffect(() => {
    const query = window.matchMedia(TABLET)
    const apply = () => setSidebarOpen(!query.matches)
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Autofill extensions dispatch synthetic keydown events without a `key`.
      if (event.key?.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const [bottomBar, setBottomBar] = React.useState(false)
  const ui = React.useMemo<ShellUi>(
    () => ({
      openCommand: () => setCommandOpen(true),
      openNotifications: () => setNotificationsOpen(true),
      bottomBar,
      setBottomBar,
    }),
    [bottomBar],
  )

  return (
    <ShellUiContext.Provider value={ui}>
      <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <AppSidebar />
        {/* SidebarInset renders the page's <main>. */}
        <SidebarInset id="main" className="min-w-0 bg-transparent">
          <Topbar />
          <div
            className={cn(
              'mx-auto w-full px-4 pt-6 sm:px-6 lg:px-8',
              role === 'member' ? 'max-w-[1120px] pb-32 md:pb-16' : 'max-w-[1360px] pb-24 md:pb-16',
            )}
          >
            {children}
          </div>
        </SidebarInset>
        {role === 'member' ? <MobileTabBar /> : null}
        <HeadFallback />
        {/* Switching people is a demo affordance; real accounts never see it. */}
        {publicEnv.NEXT_PUBLIC_DEMO_MODE && mode === 'demo' ? <DemoPill /> : null}
        <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
        <NotificationsSheet open={notificationsOpen} onOpenChange={setNotificationsOpen} />
      </SidebarProvider>
    </ShellUiContext.Provider>
  )
}

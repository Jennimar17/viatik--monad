'use client'

import Link from '@/components/viatik/link'
import { usePathname } from 'next/navigation'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar'
import { roleIcons } from '@/components/viatik/people'
import { ViatikMark } from '@/components/viatik/viatik-logo'
import { useViatikState } from '@/data/react'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { adminApprovals, investorApprovals, openBills, unreadCount } from '@/domain/queries'

import { NAVIGATION, type NavItem } from '../nav'
import { useHref, usePermissions, useRole } from '../role-context'

export function AppSidebar() {
  const { role, base } = useRole()
  const navigation = NAVIGATION[role]
  const { canView } = usePermissions()
  const pathname = usePathname()
  const href = useHref()
  const { setOpenMobile, isMobile } = useSidebar()
  const counts = useBadgeCounts()

  const visible = (items: NavItem[]) => items.filter((item) => !item.capability || canView(item.capability))
  const isActive = (item: NavItem) => {
    const target = `${base}/${item.path}`
    return pathname === target || pathname.startsWith(`${target}/`)
  }

  const renderItems = (items: NavItem[]) =>
    visible(items).map((item) => {
      const Icon = item.icon
      const count = item.badge ? counts[item.badge] : 0
      return (
        <SidebarMenuItem key={item.key}>
          <SidebarMenuButton
            isActive={isActive(item)}
            tooltip={item.label}
            render={<Link href={href(item.path)} onClick={() => isMobile && setOpenMobile(false)} />}
            className="h-9 rounded-lg data-active:bg-mist/10 data-active:font-medium data-active:text-foreground"
          >
            <Icon />
            <span>{item.label}</span>
          </SidebarMenuButton>
          {count > 0 ? (
            <SidebarMenuBadge className="rounded-full bg-mist/15 text-foreground">{count}</SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
      )
    })

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-3 pt-4 pb-2">
        <Link
          href={href(role === 'member' ? 'home' : 'overview')}
          className="flex h-9 items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          aria-label="Viatik home"
        >
          <ViatikMark className="size-7" />
          <span className="font-display text-lg font-medium tracking-tight group-data-[collapsible=icon]:hidden">
            Viatik
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs tracking-[0.12em] text-subtle uppercase">
            {role === 'member' ? 'My money' : role === 'investor' ? 'Portfolio' : 'Agency'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">{renderItems(navigation.primary)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs tracking-[0.12em] text-subtle uppercase">
            {role === 'member' ? 'More' : 'Manage'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">{renderItems(navigation.secondary)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="px-3 pb-4">
        <RoleNote />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function RoleNote() {
  const { role } = useRole()
  const RoleIcon = roleIcons[role]
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-hairline p-3 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
      <RoleIcon className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
      <p className="text-pretty">
        <span className="font-medium text-foreground">{roleLabel[role]}.</span> {roleDescription[role]}
      </p>
    </div>
  )
}

/** Counters on the navigation: pending approvals, open bills, my pending requests. */
export function useBadgeCounts() {
  const { state, userId, now } = useViatikState()
  const { role, agencyId, portfolioId } = useRole()
  return {
    approvals:
      role === 'investor'
        ? investorApprovals(state, portfolioId).total
        : role === 'agency_admin' && agencyId
          ? adminApprovals(state, agencyId).mine.length
          : 0,
    bills: role === 'agency_admin' && agencyId ? openBills(state, agencyId, now).length : 0,
    // Funding agreements the Agency has not accepted yet.
    agreements:
      role === 'agency_admin' && agencyId
        ? state.agreements.filter((a) => a.agencyId === agencyId && a.status === 'pending_acceptance').length
        : 0,
    requests:
      role === 'member'
        ? state.requests.filter(
            (r) =>
              r.agencyId === agencyId &&
              r.requester.kind === 'user' &&
              r.requester.userId === userId &&
              r.status === 'needs_approval',
          ).length
        : 0,
    notifications: unreadCount(state, userId),
  }
}

'use client'

import { ChevronsUpDown, LogOut, Plus } from 'lucide-react'
import { AppLink as Link } from '@/components/viatik/app-link'
import { usePathname, useRouter } from 'next/navigation'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { OrgAvatar, roleIcons } from '@/components/viatik/people'
import { Tag } from '@/components/viatik/status'
import { ViatikMark } from '@/components/viatik/viatik-logo'
import { useViatikState } from '@/data/react'
import { roleDescription, roleLabel } from '@/domain/permissions'
import { adminApprovals, investorApprovals, openBills, unreadCount } from '@/domain/queries'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

import { NAVIGATION, roleHome, type NavItem } from '../nav'
import { resolveScope, useHref, usePermissions, useRole } from '../role-context'

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
      <SidebarHeader className="gap-3 px-3 pt-4">
        <Link
          href={href(role === 'member' ? 'home' : 'overview')}
          className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          aria-label="Viatik home"
        >
          <ViatikMark className="size-7" />
          <span className="font-display text-lg font-medium tracking-tight group-data-[collapsible=icon]:hidden">
            Viatik
          </span>
        </Link>
        <WorkspaceSwitcher />
      </SidebarHeader>
      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">{renderItems(navigation.primary)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel className="text-2xs tracking-[0.12em] text-subtle uppercase">
            {role === 'member' ? 'More' : 'Workspace'}
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

/** Organization, role tag and every workspace the person belongs to, grouped by role. */
function WorkspaceSwitcher() {
  const { state, memberships } = useViatikState()
  const current = useRole()
  const router = useRouter()
  const { signOut } = useSession()
  const href = useHref()
  const RoleIcon = roleIcons[current.role]

  const workspaceName = (agencyId?: string, portfolioId?: string) =>
    agencyId
      ? (state.agencies.find((a) => a.id === agencyId)?.name ?? 'Agency')
      : (state.portfolios.find((p) => p.id === portfolioId)?.name ?? 'Portfolio')
  const currentName = workspaceName(
    current.agencyId,
    current.role === 'investor' ? current.portfolioId : undefined,
  )

  const scopes = memberships
    .map((m) => resolveScope(m, (agencyId) => state.agencies.find((a) => a.id === agencyId)?.portfolioId))
    .filter((s): s is NonNullable<typeof s> => s !== null)
  const order = ['investor', 'agency_admin', 'member'] as const
  const grouped = order
    .map((role) => ({ role, scopes: scopes.filter((s) => s.role === role) }))
    .filter((g) => g.scopes.length > 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Workspace: ${currentName}, ${roleLabel[current.role]}. Switch workspace`}
            className="flex w-full items-center gap-2.5 rounded-xl border border-hairline bg-mist/5 p-2 text-left transition-colors outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 hover:bg-mist/10 focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <OrgAvatar name={currentName} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-medium">{currentName}</span>
          <Tag className="w-fit">
            <RoleIcon className="size-2.5" aria-hidden="true" />
            {roleLabel[current.role]}
          </Tag>
        </span>
        <ChevronsUpDown
          className="size-4 shrink-0 text-subtle group-data-[collapsible=icon]:hidden"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 p-1.5" align="start">
        {grouped.map((group) => {
          const Icon = roleIcons[group.role]
          return (
            <DropdownMenuGroup key={group.role}>
              <DropdownMenuLabel className="flex items-center gap-1.5 text-xs text-subtle">
                <Icon className="size-3" aria-hidden="true" /> {roleLabel[group.role]}
              </DropdownMenuLabel>
              {group.scopes.map((scope) => {
                const name = workspaceName(
                  scope.agencyId,
                  scope.role === 'investor' ? scope.portfolioId : undefined,
                )
                const active = scope.base === current.base
                return (
                  <DropdownMenuItem
                    key={scope.membership.id}
                    onClick={() => router.push(roleHome(scope.membership))}
                    className={cn('gap-3 rounded-lg p-2', active && 'bg-muted')}
                  >
                    <OrgAvatar name={name} size="sm" />
                    <span className="truncate text-sm">{name}</span>
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          )
        })}
        <DropdownMenuSeparator />
        {current.role === 'investor' ? (
          <DropdownMenuItem onClick={() => router.push(href('agencies/new'))} className="gap-2 rounded-lg">
            <Plus className="size-4" /> Create Agency
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={() => {
            signOut()
            router.replace('/sign-in')
          }}
          className="gap-2 rounded-lg"
        >
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    requests:
      role === 'member'
        ? state.requests.filter(
            (r) =>
              r.requester.kind === 'user' && r.requester.userId === userId && r.status === 'needs_approval',
          ).length
        : 0,
    notifications: unreadCount(state, userId),
  }
}

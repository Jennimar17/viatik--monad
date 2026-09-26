'use client'

import { BellOff } from 'lucide-react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { EmptyState } from '@/components/viatik/feedback'
import { SectionLabel } from '@/components/viatik/layout'
import { useCommand, useViatikState } from '@/data/react'
import type { Notification } from '@/domain/types'
import { dayGroup, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Notifications, grouped into today and earlier, with unread markers. */
export function NotificationsSheet({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { state, userId, now } = useViatikState()
  const router = useRouter()
  const markRead = useCommand('markNotificationsRead', { silent: true })
  const notifications = state.notifications.filter((n) => n.userId === userId)
  const unread = notifications.filter((n) => !n.readAt)
  const today = notifications.filter((n) => dayGroup(n.createdAt, now) === 'Today')
  const earlier = notifications.filter((n) => dayGroup(n.createdAt, now) !== 'Today')

  const section = (title: string, items: Notification[]) =>
    items.length > 0 ? (
      <div className="flex flex-col gap-1">
        <SectionLabel className="px-2 pb-1">{title}</SectionLabel>
        {items.map((notification) => (
          <button
            key={notification.id}
            type="button"
            onClick={() => {
              if (!notification.readAt) void markRead.run({ ids: [notification.id] })
              onOpenChange(false)
              router.push(notification.href as Route)
            }}
            className={cn(
              'flex gap-3 rounded-xl p-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50',
              !notification.readAt && 'bg-mist/5',
            )}
          >
            <span
              className={cn(
                'mt-1.5 size-2 shrink-0 rounded-full',
                notification.readAt ? 'bg-transparent' : 'bg-mist',
              )}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">
                {notification.title}
                {notification.readAt ? null : <span className="sr-only"> (unread)</span>}
              </span>
              <span className="text-sm text-pretty text-muted-foreground">{notification.body}</span>
              <span className="text-xs text-subtle">{formatRelative(notification.createdAt, now)}</span>
            </span>
          </button>
        ))}
      </div>
    ) : null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="font-display text-xl font-medium">Notifications</SheetTitle>
          <SheetDescription>
            {unread.length > 0 ? `${unread.length} unread` : 'You are all caught up.'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-3">
          {notifications.length === 0 ? (
            <EmptyState
              icon={<BellOff />}
              title="Nothing needs your attention"
              description="Requests that require your decision will appear here."
              compact
            />
          ) : (
            <>
              {section('Today', today)}
              {section('Earlier', earlier)}
            </>
          )}
        </div>
        {unread.length > 0 ? (
          <div className="border-t border-border p-3">
            <Button variant="ghost" size="pill-sm" className="w-full" onClick={() => void markRead.run({})}>
              Mark all as read
            </Button>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

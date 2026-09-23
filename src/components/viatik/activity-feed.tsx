import { CircleCheck, type LucideIcon } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'

import type { Cents } from '@/domain/money'
import { dayGroup, formatRelative } from '@/lib/format'
import { cn } from '@/lib/utils'

import { Amount } from './amount'
import { AgentAvatar, PersonAvatar } from './people'

export type ActivityItem = {
  id: string
  /** Who did it: a person, or an AI Agent acting within its policy. */
  actor: { kind: 'user' | 'ai_agent'; name: string }
  summary: string
  at: string
  /** Extra scope, e.g. the agency name on portfolio-wide feeds. */
  context?: string
  amount?: Cents
  icon?: LucideIcon
  tone?: 'default' | 'success' | 'danger'
  href?: Route
}

/** Human-readable activity records, optionally grouped by day. */
export function ActivityFeed({
  items,
  now,
  grouped = false,
  className,
}: {
  items: ActivityItem[]
  /** Reference time for relative dates, so server and client agree. */
  now: string
  grouped?: boolean
  className?: string
}) {
  const groups = new Map<string, ActivityItem[]>()
  for (const item of items) {
    const key = grouped ? dayGroup(item.at, now) : 'all'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }

  return (
    <div className={cn('flex flex-col gap-6', className)}>
      {[...groups.entries()].map(([group, list]) => (
        <div key={group} className="flex flex-col gap-1">
          {grouped ? (
            <p className="pb-2 text-xs font-medium tracking-[0.08em] text-subtle uppercase">{group}</p>
          ) : null}
          <ul className="flex flex-col">
            {list.map((item) => {
              const Icon = item.icon ?? CircleCheck
              const content = (
                <>
                  <span className="relative mt-0.5 shrink-0">
                    {item.actor.kind === 'ai_agent' ? (
                      <AgentAvatar size="sm" />
                    ) : (
                      <PersonAvatar name={item.actor.name} size="sm" />
                    )}
                    <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-border bg-card">
                      <Icon
                        className={cn(
                          'size-2.5',
                          item.tone === 'danger'
                            ? 'text-danger'
                            : item.tone === 'success'
                              ? 'text-sage'
                              : 'text-subtle',
                        )}
                        aria-hidden="true"
                      />
                    </span>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm text-pretty text-foreground">{item.summary}</span>
                    <span className="text-xs text-subtle">
                      {item.actor.name}
                      {item.actor.kind === 'ai_agent' ? ' · AI Agent' : ''}
                      {item.context ? ` · ${item.context}` : ''} · {formatRelative(item.at, now)}
                    </span>
                  </span>
                  {item.amount !== undefined ? (
                    <Amount value={item.amount} size="sm" className="shrink-0 text-muted-foreground" />
                  ) : null}
                </>
              )
              return (
                <li key={item.id} className="border-t border-border first:border-t-0">
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="flex w-full gap-3 py-3 outline-none hover:bg-muted/20 focus-visible:bg-muted/30"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div className="flex gap-3 py-3">{content}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

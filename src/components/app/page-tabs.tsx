'use client'

import type * as React from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export type PageTab = { value: string; label: string; count?: number; content: React.ReactNode }

/** Pill tabs, as in the landing's role switcher. Scrolls horizontally on phones. */
export function PageTabs({
  tabs,
  defaultValue,
  value,
  onValueChange,
  className,
}: {
  tabs: PageTab[]
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  className?: string
}) {
  return (
    <Tabs
      defaultValue={defaultValue ?? tabs[0]?.value}
      value={value}
      onValueChange={(next) => onValueChange?.(String(next))}
      className={cn('flex flex-col gap-5', className)}
    >
      <div className="-mx-4 scrollbar-none overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <TabsList className="h-auto w-max gap-1 rounded-full border border-border bg-mist/[0.03] p-1">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-8 flex-none rounded-full px-3.5 text-sm text-muted-foreground data-active:bg-primary data-active:text-primary-foreground data-active:shadow-none"
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 ? (
                <span className="ml-1 rounded-full bg-current/15 px-1.5 text-xs num">{tab.count}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="outline-none">
          {tab.content}
        </TabsContent>
      ))}
    </Tabs>
  )
}

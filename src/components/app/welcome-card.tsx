'use client'

import { X } from 'lucide-react'
import * as React from 'react'

import { roleIcons } from '@/components/viatik/people'
import { useViatikState } from '@/data/react'
import { roleLabel } from '@/domain/permissions'

import { useRole } from './role-context'

const copy = {
  investor: {
    title: 'As an Investor you set boundaries and review exceptions.',
    points: [
      'Create funding agreements with tranches, milestones and a spending policy.',
      'Release each tranche when its milestone is delivered.',
      'Agencies operate inside your rules; anything above them comes back to you.',
    ],
  },
  agency_admin: {
    title: 'As an Agency Admin you turn released capital into budgets and payments.',
    points: [
      'Request tranches and submit milestone evidence.',
      'Organize money in accounts and give people budgets with clear limits.',
      'Approve requests, pay bills and keep every payment reconciled.',
    ],
  },
  member: {
    title: 'As a Member you spend within the limits assigned to you.',
    points: [
      'Requests inside your limits are approved automatically.',
      'Anything above your limits goes to your Agency Admin.',
      'Upload receipts so every expense is reconciled.',
    ],
  },
} as const

// Dismissals live in localStorage; the in-memory set covers blocked storage.
const listeners = new Set<() => void>()
const dismissedInMemory = new Set<string>()

function isDismissed(key: string) {
  if (dismissedInMemory.has(key)) return true
  try {
    return window.localStorage.getItem(key) === 'dismissed'
  } catch {
    return false
  }
}

function dismiss(key: string) {
  dismissedInMemory.add(key)
  try {
    window.localStorage.setItem(key, 'dismissed')
  } catch {
    // Storage unavailable: dismissed for this visit only.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** First-visit explanation of the current role. Dismissed per person and role on this device. */
export function WelcomeCard() {
  const { userId } = useViatikState()
  const { role } = useRole()
  const key = `viatik:welcome:${userId}:${role}`
  // Hidden during server rendering so it never flashes for people who dismissed it.
  const dismissed = React.useSyncExternalStore(
    subscribe,
    () => isDismissed(key),
    () => true,
  )

  if (dismissed) return null
  const Icon = roleIcons[role]
  const text = copy[role]

  return (
    <section
      aria-label={`Welcome, ${roleLabel[role]}`}
      className="relative flex flex-col gap-4 rounded-2xl border border-mist/15 bg-mist/5 p-5 sm:flex-row sm:gap-5 sm:p-6"
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-subtle">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-col gap-3 pr-8">
        <h2 className="font-display text-lg font-medium text-balance">{text.title}</h2>
        <ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3 sm:gap-4">
          {text.points.map((point) => (
            <li key={point} className="text-pretty">
              {point}
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        onClick={() => dismiss(key)}
        className="absolute top-3 right-3 inline-flex size-8 items-center justify-center rounded-full text-subtle transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </section>
  )
}

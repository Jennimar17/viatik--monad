import { Bot, Building2, Landmark, UserRound } from 'lucide-react'

import { cn } from '@/lib/utils'

const palette = [
  'bg-[color-mix(in_srgb,var(--color-sage)_28%,transparent)] text-foreground',
  'bg-[color-mix(in_srgb,var(--color-stone)_30%,transparent)] text-foreground',
  'bg-[color-mix(in_srgb,var(--color-info)_24%,transparent)] text-foreground',
  'bg-[color-mix(in_srgb,var(--color-warning)_22%,transparent)] text-foreground',
  'bg-[color-mix(in_srgb,var(--color-mist)_18%,transparent)] text-foreground',
]

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/)
  return (
    (parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '')
  ).toUpperCase()
}

/** Stable color per name, so a person keeps the same avatar everywhere. */
function colorFor(seed: string) {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return palette[Math.abs(hash) % palette.length]
}

const sizes = {
  xs: 'size-6 text-[10px]',
  sm: 'size-8 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-11 text-base',
}

/** Initials avatar for people; icon avatar for AI Agents; rounded square for organizations. */
export function PersonAvatar({
  name,
  size = 'sm',
  className,
}: {
  name: string
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-border font-medium',
        sizes[size],
        colorFor(name),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

export function AgentAvatar({ size = 'sm', className }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-foreground',
        sizes[size],
        className,
      )}
    >
      <Bot className="size-[55%]" />
    </span>
  )
}

export function OrgAvatar({
  name,
  size = 'sm',
  className,
}: {
  name: string
  size?: keyof typeof sizes
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg border border-border font-display font-medium',
        sizes[size],
        colorFor(`org:${name}`),
        className,
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

/** One icon per role, without colored circles, as on the landing. */
export const roleIcons = {
  investor: Landmark,
  agency_admin: Building2,
  member: UserRound,
  ai_agent: Bot,
} as const

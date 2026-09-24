'use client'

import { Compass } from 'lucide-react'

import { EmptyState } from '@/components/viatik/feedback'

import { ButtonLink } from './button-link'
import { useHref, useRole } from './role-context'

/** In-shell "not found" for paths inside a workspace that do not exist. */
export function ScreenUnavailable() {
  const { role } = useRole()
  const href = useHref()
  return (
    <EmptyState
      titleAs="h1"
      icon={<Compass />}
      title="This screen is not available"
      description="The link may be out of date, or the screen is not part of your role."
      action={
        <ButtonLink href={href(role === 'member' ? 'home' : 'overview')} size="pill">
          Back to {role === 'member' ? 'Home' : 'Overview'}
        </ButtonLink>
      }
      className="mt-10"
    />
  )
}

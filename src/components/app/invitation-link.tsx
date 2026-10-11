'use client'

import { Check, Copy, Mail } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { inviteHref } from '@/components/app/nav'
import { Button, buttonVariants } from '@/components/ui/button'
import { roleLabel } from '@/domain/permissions'
import type { Invitation } from '@/domain/types'
import { publicEnv } from '@/lib/env'
import { useSession } from '@/lib/session'
import { cn } from '@/lib/utils'

type InvitationDetails = Pick<Invitation, 'code' | 'name' | 'email' | 'role'>

/** The full link the invited person opens; product screens render on the client. */
function invitationUrl(code: string) {
  const origin = typeof window === 'undefined' ? publicEnv.NEXT_PUBLIC_SITE_URL : window.location.origin
  return new URL(inviteHref(code), origin).toString()
}

/** A ready-to-send email in the inviter's own mail app; Viatik sends no email itself. */
function mailtoHref(invitation: InvitationDetails, url: string, workspace: string, inviter?: string) {
  const firstName = invitation.name.trim().split(' ')[0] || 'there'
  const subject = `Join ${workspace} on Viatik`
  const body = [
    `Hi ${firstName},`,
    '',
    `${inviter ?? 'Your team'} invited you to join ${workspace} on Viatik as ${roleLabel[invitation.role]}.`,
    '',
    `Open this link and sign in with ${invitation.email}:`,
    url,
    '',
    'Your account is created the first time you sign in. No wallet or browser extension needed.',
  ].join('\n')
  return `mailto:${invitation.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

/** Copy through a hidden field, for browsers that deny the Clipboard API (unfocused or restricted pages). */
function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;top:0;left:0;opacity:0'
  document.body.appendChild(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}

function CopyLinkButton({ url, label = 'Copy link' }: { url: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async () => {
    let ok = false
    try {
      await navigator.clipboard.writeText(url)
      ok = true
    } catch {
      ok = legacyCopy(url)
    }
    if (!ok) {
      toast.error('This browser blocked copying. Use Email to send the invitation instead.')
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Button size="pill-sm" variant="outline" onClick={() => void copy()} aria-live="polite">
      {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

/**
 * How an invitation reaches the invited person: a link to copy and a
 * prefilled email. The link only works for the invited email address.
 * In the demo it only works in this browser, so it says so and offers no email.
 * `actions` is the compact form for lists of pending invitations.
 */
export function InvitationLink({
  invitation,
  workspace,
  inviter,
  variant = 'full',
  className,
}: {
  invitation: InvitationDetails
  workspace: string
  inviter?: string
  variant?: 'full' | 'actions'
  className?: string
}) {
  // Demo data lives in this browser only: opened anywhere else, the link is not valid.
  const demo = useSession().mode === 'demo'
  const url = invitationUrl(invitation.code)
  const mailto = mailtoHref(invitation, url, workspace, inviter)

  if (variant === 'actions') {
    return (
      <span className={cn('flex flex-wrap items-center gap-2', className)}>
        <CopyLinkButton url={url} label={demo ? 'Copy demo link' : 'Copy link'} />
        {demo ? null : (
          <a
            href={mailto}
            className={buttonVariants({ variant: 'ghost', size: 'pill-sm' })}
            aria-label={`Email the invitation to ${invitation.email}`}
          >
            <Mail data-icon="inline-start" /> Email
          </a>
        )}
      </span>
    )
  }

  return (
    <div className={cn('flex w-full flex-col gap-3', className)}>
      {demo ? (
        <p className="text-sm text-pretty text-muted-foreground">
          This is a demo link: it only works in this browser. Open it in a new tab to accept as{' '}
          {invitation.name}. Invitations from a real account work on any device.
        </p>
      ) : (
        <p className="text-sm text-pretty text-muted-foreground">
          Send this link to {invitation.name}. It only works for{' '}
          <span className="text-foreground">{invitation.email}</span>: they sign in with that email and accept
          in one step.
        </p>
      )}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 py-1.5 pr-1.5 pl-3">
        <input
          readOnly
          value={url}
          aria-label={`Invitation link for ${invitation.name}`}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-xs text-foreground outline-none"
        />
        <CopyLinkButton url={url} label="Copy" />
      </div>
      {demo ? null : (
        <a href={mailto} className={cn(buttonVariants({ variant: 'outline', size: 'pill-sm' }), 'w-fit')}>
          <Mail data-icon="inline-start" /> Send by email
        </a>
      )}
    </div>
  )
}

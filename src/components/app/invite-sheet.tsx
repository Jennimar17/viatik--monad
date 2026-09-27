'use client'

import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput } from '@/components/app/form-controls'
import { inviteHref } from '@/components/app/nav'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { useCommand } from '@/data/react'
import { roleDescription, roleLabel } from '@/domain/permissions'
import type { Role } from '@/domain/types'
import { cn } from '@/lib/utils'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const rolePolicy: Record<Role, string> = {
  member: 'Members only see the budgets assigned to them.',
  agency_admin: 'Agency Admins operate the Agency but never release their own tranches.',
  investor: 'Investors see the whole portfolio and decide on exceptions.',
}

/** Invite a person into an Agency (Admin or Member) or a portfolio (Investor). */
export function InviteSheet({
  open,
  onOpenChange,
  scope,
  roles,
  workspaceName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: { agencyId: string } | { portfolioId: string }
  roles: Role[]
  workspaceName: string
}) {
  const invite = useCommand('invite')
  const defaultRole = roles[0] ?? 'member'
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [role, setRole] = React.useState<Role>(defaultRole)
  const [code, setCode] = React.useState<string | null>(null)

  const trimmed = name.trim()
  const valid = trimmed.length > 1 && EMAIL.test(email.trim())

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        setName('')
        setEmail('')
        setRole(defaultRole)
        setCode(null)
        invite.reset()
      }}
      title={`Invite to ${workspaceName}`}
      summary={{
        what: `${trimmed || 'They'} will receive an invitation to join ${workspaceName} as ${roleLabel[role]}. Their account is set up when they first sign in.`,
        reversible: 'You can cancel the invitation or remove access later; removal is immediate.',
        policy: rolePolicy[role],
      }}
      confirmLabel="Send invitation"
      disabled={!valid}
      phase={invite.phase}
      error={invite.error}
      onConfirm={async () => {
        const invitation = await invite.run({ name: trimmed, email: email.trim(), role, scope })
        if (invitation) setCode(invitation.code)
      }}
      success={{
        title: 'Invitation sent',
        body: `${trimmed} was invited as ${roleLabel[role]}. The invitation stays pending until they join.`,
        actions: code ? (
          <ButtonLink href={inviteHref(code)} variant="outline" size="pill-sm">
            Open invitation link
          </ButtonLink>
        ) : undefined,
      }}
    >
      <div className="flex flex-col gap-4">
        <FormField label="Full name" htmlFor="invite-name">
          <PillInput
            id="invite-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </FormField>
        <FormField label="Work email" htmlFor="invite-email">
          <PillInput
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </FormField>
        {roles.length > 1 ? (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Role</span>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Role">
              {roles.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={role === option}
                  onClick={() => setRole(option)}
                  className={cn(
                    'h-11 rounded-full border text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    role === option
                      ? 'border-mist bg-mist/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {roleLabel[option]}
                </button>
              ))}
            </div>
            <p className="text-xs text-pretty text-subtle">{roleDescription[role]}</p>
          </div>
        ) : null}
      </div>
    </ApprovalSheet>
  )
}

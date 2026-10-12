'use client'

import {
  useLinkWithPasskey,
  usePrivy,
  useUnlinkPasskey,
  type LinkedAccountWithMetadata,
} from '@privy-io/react-auth'
import { Fingerprint, Globe, Mail, Plus } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Panel } from '@/components/viatik/layout'
import { StatusBadge } from '@/components/viatik/status'
import { formatLocalDate } from '@/lib/local-time'

type PasskeyAccount = Extract<LinkedAccountWithMetadata, { type: 'passkey' }>

/** Privy error codes people can act on; anything else gets the generic message. */
const ERRORS: Record<string, string> = {
  passkey_not_allowed: 'The passkey prompt was closed or timed out. Try again.',
  cannot_link_more_of_type: 'You have reached the passkey limit for this account.',
  missing_or_invalid_mfa: 'This passkey is used for two-step verification. Turn that off first.',
}

function messageFor(error: unknown, fallback: string) {
  const code = (error as { privyErrorCode?: string } | null)?.privyErrorCode
  return (code && ERRORS[code]) || fallback
}

const LINKING_STATUS: Record<string, string> = {
  'generating-challenge': 'Preparing…',
  'awaiting-passkey': 'Confirm on your device…',
  'submitting-response': 'Saving your passkey…',
}

function deviceLabel(passkey: PasskeyAccount) {
  if (passkey.authenticatorName) return passkey.authenticatorName
  const { createdWithBrowser: browser, createdWithOs: os } = passkey
  return browser && os ? `${browser} on ${os}` : (browser ?? os ?? 'Passkey')
}

const at = (date: Date | null) => (date ? formatLocalDate(new Date(date).toISOString()) : '—')

/**
 * Real sign-in methods of a Privy account. A passkey is added to an account
 * that already signs in with email or Google (invitations are bound to an
 * email, so Viatik never creates accounts from a passkey alone). The last
 * remaining sign-in method cannot be removed.
 */
export function PasskeysPanel() {
  const { ready, user } = usePrivy()
  const { linkWithPasskey, state } = useLinkWithPasskey()
  const { unlink } = useUnlinkPasskey()
  const [error, setError] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState<string | null>(null)

  const accounts = user?.linkedAccounts ?? []
  const passkeys = accounts.filter((account): account is PasskeyAccount => account.type === 'passkey')
  const email = accounts.find((account) => account.type === 'email')
  const google = accounts.find((account) => account.type === 'google_oauth')
  // Embedded accounts are not sign-in methods.
  const signInMethods = accounts.filter((a) => a.type !== 'wallet' && a.type !== 'smart_wallet').length
  const linking = state.status in LINKING_STATUS
  // The passkey's name is the account identifier the device's passkey picker shows.
  const accountEmail =
    email?.type === 'email' ? email.address : google?.type === 'google_oauth' ? google.email : undefined

  const add = async () => {
    setError(null)
    try {
      await linkWithPasskey(accountEmail ? { name: accountEmail } : undefined)
      toast.success('Passkey added. Next time, choose “Use a passkey” to sign in.')
    } catch (e) {
      setError(messageFor(e, 'We could not add the passkey. Try again.'))
    }
  }

  const remove = async (credentialId: string) => {
    setError(null)
    setRemoving(credentialId)
    try {
      await unlink({ credentialId })
      toast.success('Passkey removed.')
    } catch (e) {
      setError(messageFor(e, 'We could not remove the passkey. Try again.'))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Panel title="Sign-in methods">
      <ul className="flex flex-col gap-3">
        {email && email.type === 'email' ? (
          <li className="flex items-center gap-3 text-sm">
            <Mail className="size-4 shrink-0 text-subtle" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              Email code
              <span className="truncate text-xs text-subtle">{email.address}</span>
            </span>
            <StatusBadge status={{ label: 'On', tone: 'success' }} className="ml-auto" />
          </li>
        ) : null}
        {google && google.type === 'google_oauth' ? (
          <li className="flex items-center gap-3 text-sm">
            <Globe className="size-4 shrink-0 text-subtle" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              Google
              <span className="truncate text-xs text-subtle">{google.email}</span>
            </span>
            <StatusBadge status={{ label: 'On', tone: 'success' }} className="ml-auto" />
          </li>
        ) : null}
        {passkeys.map((passkey) => (
          <li key={passkey.credentialId} className="flex items-center gap-3 text-sm">
            <Fingerprint className="size-4 shrink-0 text-subtle" aria-hidden="true" />
            <span className="flex min-w-0 flex-col">
              {deviceLabel(passkey)}
              <span className="text-xs text-subtle">
                Added {at(passkey.firstVerifiedAt)} · last used {at(passkey.latestVerifiedAt)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="pill-sm"
              className="ml-auto text-danger hover:text-danger"
              disabled={signInMethods <= 1 || removing === passkey.credentialId}
              onClick={() => void remove(passkey.credentialId)}
              aria-label={`Remove passkey ${deviceLabel(passkey)}`}
            >
              {removing === passkey.credentialId ? 'Removing…' : 'Remove'}
            </Button>
          </li>
        ))}
      </ul>

      {passkeys.length === 0 ? (
        <p className="mt-3 text-sm text-pretty text-muted-foreground">
          Add a passkey to sign in with your fingerprint, face or device PIN instead of an email code.
        </p>
      ) : signInMethods <= 1 ? (
        <p className="mt-3 text-xs text-subtle">
          Add another sign-in method before removing your only passkey.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-3">
        <Button variant="outline" size="pill-sm" disabled={!ready || linking} onClick={() => void add()}>
          <Plus data-icon="inline-start" /> Add a passkey
        </Button>
        <span className="text-xs text-subtle" aria-live="polite">
          {linking ? LINKING_STATUS[state.status] : ''}
        </span>
      </div>
    </Panel>
  )
}

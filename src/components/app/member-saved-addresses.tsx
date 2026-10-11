'use client'

import { Bookmark, CircleUserRound, Plus } from 'lucide-react'
import * as React from 'react'

import { FormField, PillInput } from '@/components/app/form-controls'
import { Button } from '@/components/ui/button'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { CopyButton } from '@/components/viatik/operation'
import { StatusBadge } from '@/components/viatik/status'
import { useCommand, useViatikState } from '@/data/react'
import { parseAddress, shortAddress } from '@/domain/address'
import type { PayoutAddress } from '@/domain/types'

import { sameAddress, type OwnAccount } from './member-own-account'

/** The engine refuses more; the screen says so before anyone tries. */
export const MAX_SAVED_ADDRESSES = 10

const LABEL_MAX = 40

/** The person's saved addresses, oldest first. */
export function useSavedAddresses(): PayoutAddress[] {
  const { state, userId } = useViatikState()
  return React.useMemo(
    () =>
      state.payoutAddresses
        .filter((a) => a.userId === userId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    [state.payoutAddresses, userId],
  )
}

/**
 * Where the person can send their Viatik balance: their own Viatik account
 * (always, the default) and the addresses they saved, which they add and
 * remove here.
 */
export function MemberSavedAddresses({ own }: { own: OwnAccount }) {
  const saved = useSavedAddresses()
  const remove = useCommand('removePayoutAddress', { success: 'Address removed.' })
  const [removing, setRemoving] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const full = saved.length >= MAX_SAVED_ADDRESSES

  const onRemove = async (addressId: string) => {
    setRemoving(addressId)
    await remove.run({ addressId })
    setRemoving(null)
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        <li className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
            <CircleUserRound className="size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">
              My Viatik account
              {own.settlement === 'simulated' ? (
                <span className="font-normal text-subtle"> (demo)</span>
              ) : null}
            </span>
            <span className="truncate font-mono text-xs text-subtle">
              {own.address ? shortAddress(own.address) : 'Being created…'}
            </span>
          </span>
          <StatusBadge status={{ label: 'Default', tone: 'neutral' }} />
          {own.address ? <CopyButton value={own.address} label="Copy my Viatik account address" /> : null}
        </li>
        {saved.map((address) => (
          <li key={address.id} className="flex items-center gap-3 border-t border-border py-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-subtle">
              <Bookmark className="size-4" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">{address.label}</span>
              <span className="truncate font-mono text-xs text-subtle">{shortAddress(address.address)}</span>
            </span>
            <CopyButton value={address.address} label={`Copy the address of ${address.label}`} />
            <Button
              variant="ghost"
              size="pill-sm"
              className="text-danger hover:text-danger"
              disabled={removing !== null}
              onClick={() => void onRemove(address.id)}
              aria-label={`${removing === address.id ? 'Removing' : 'Remove'} ${address.label}`}
            >
              {removing === address.id ? 'Removing…' : 'Remove'}
            </Button>
          </li>
        ))}
      </ul>

      {/* The demo's placeholder address is explained under the balance. */}
      {own.settlement !== 'simulated' && !own.address ? (
        <p className="text-xs text-pretty text-subtle">
          Your Viatik account is being created. It shows here in a moment.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button variant="outline" size="pill-sm" disabled={full} onClick={() => setAddOpen(true)}>
          <Plus data-icon="inline-start" /> Save an address
        </Button>
        <span className="text-xs text-pretty text-subtle">
          {full
            ? `You saved ${MAX_SAVED_ADDRESSES} addresses, the most you can. Remove one to add another.`
            : 'The Admins of your Agencies can see the addresses you save.'}
        </span>
      </div>

      <AddAddressSheet open={addOpen} onOpenChange={setAddOpen} own={own} saved={saved} />
    </div>
  )
}

function AddAddressSheet({
  open,
  onOpenChange,
  own,
  saved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  own: OwnAccount
  saved: PayoutAddress[]
}) {
  const add = useCommand('addPayoutAddress')
  const [label, setLabel] = React.useState('')
  const [value, setValue] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  // What was saved, kept for the success message while the form clears.
  const [savedRecord, setSavedRecord] = React.useState<PayoutAddress | null>(null)

  const trimmedLabel = label.trim()
  const typed = value.trim()
  const parsed = parseAddress(typed)
  const duplicate = Boolean(parsed && saved.some((a) => sameAddress(a.address, parsed)))
  const isOwn = Boolean(parsed && sameAddress(parsed, own.address))
  // A partly typed address is not wrong yet: say so once the field is left or the length is reached.
  const addressError =
    typed === ''
      ? undefined
      : !parsed
        ? touched || typed.length >= 42
          ? 'Enter a valid account address: 0x followed by 40 characters.'
          : undefined
        : duplicate
          ? 'You already saved this address.'
          : isOwn
            ? 'This is your own Viatik account. It is always available, so there is no need to save it.'
            : undefined

  return (
    <ApprovalSheet
      open={open}
      onOpenChange={onOpenChange}
      onClosed={() => {
        add.reset()
        setLabel('')
        setValue('')
        setTouched(false)
        setSavedRecord(null)
      }}
      title="Save an address"
      description="Another account you own, to send your Viatik balance to."
      summary={{
        what: `${trimmedLabel || 'This address'} becomes a place you can send your Viatik balance to.`,
        reversible: 'You can remove it at any time. Money already sent stays where it went.',
        policy: 'Only you can send your balance. The Admins of your Agencies can see the addresses you save.',
      }}
      confirmLabel="Save address"
      disabled={!parsed || !trimmedLabel || duplicate || isOwn}
      phase={add.phase}
      error={add.error}
      onConfirm={async () => {
        if (!parsed) return
        const record = await add.run({ label: trimmedLabel, address: parsed })
        if (record) setSavedRecord(record)
      }}
      success={{
        title: 'Address saved',
        body: (
          <>
            {savedRecord?.label ?? trimmedLabel} can now be chosen when you send your balance.
            <span className="mt-1 block font-mono text-xs break-all text-muted-foreground">
              {savedRecord?.address ?? parsed}
            </span>
          </>
        ),
      }}
    >
      <div className="flex flex-col gap-4">
        <FormField
          label="Label"
          htmlFor="payout-address-label"
          hint="A name you recognize, e.g. “Savings account”."
        >
          <PillInput
            id="payout-address-label"
            value={label}
            maxLength={LABEL_MAX}
            autoComplete="off"
            disabled={add.isPending}
            onChange={(e) => setLabel(e.target.value)}
          />
        </FormField>
        <FormField
          label="Address"
          htmlFor="payout-address-value"
          error={addressError}
          hint="Copy it from the account you own. Money sent to a wrong address cannot be recovered."
        >
          <PillInput
            id="payout-address-value"
            value={value}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            disabled={add.isPending}
            className="font-mono text-sm"
            aria-invalid={addressError ? true : undefined}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </FormField>
        {parsed && !addressError ? (
          <p className="rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs break-all text-foreground">
            {parsed}
          </p>
        ) : null}
        {own.settlement === 'simulated' ? (
          <p className="text-xs text-pretty text-subtle">
            Demo: saving works as in the product, but nothing is ever sent to this address.
          </p>
        ) : null}
      </div>
    </ApprovalSheet>
  )
}

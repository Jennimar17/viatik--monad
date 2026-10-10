'use client'

import { Info, TriangleAlert } from 'lucide-react'
import * as React from 'react'
import type { Address } from 'viem'

import { FormField, PillInput } from '@/components/app/form-controls'
import { sameAddress } from '@/components/app/member-own-account'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { CopyButton } from '@/components/viatik/operation'
import { useLedger } from '@/data/react'
import { parseAddress } from '@/domain/address'

/**
 * Entering an address that money leaves Viatik for (Pay outside Viatik): the
 * same checks as the investor withdraw sheet, a full-address confirmation that
 * an edit always clears, and the refusal of Viatik's own contracts that the
 * server applies too (src/server/commands.ts, refuseViatikAddress).
 *
 *   const entry = useAddressEntry({ known: [{ address: ownAddress, note: 'This is your own Viatik account.' }] })
 *   <AddressField id="payee-address" value={entry.typed} onChange={entry.setTyped}
 *     onBlur={entry.touch} error={entry.error} hint="0x followed by 40 characters." />
 *   {entry.address ? (
 *     <AddressConfirm id="payee-address-confirm" address={entry.address}
 *       confirmed={entry.confirmed} onConfirmedChange={entry.setConfirmed} notice={entry.notice} />
 *   ) : null}
 *   // Ready to send: entry.address && entry.confirmed
 */

/** 0x and 40 hexadecimal characters: the shape of an address, before its checksum is checked. */
export const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/

const ZERO_SHAPE = /^0x0{40}$/i

/** The server's words when the address is Viatik's ledger or its test token. */
export const VIATIK_ADDRESS_ERROR =
  "This address belongs to Viatik's ledger or its test token. Use another address."

/**
 * Viatik's own contracts (the ledger and the TestUSD token), lowercased, when
 * this workspace settles on Monad and they are configured. Empty in the demo and
 * on the test ledger: there the server is the only check.
 */
export function useViatikAddresses(): string[] {
  const { view } = useLedger()
  const contract = view?.settlement === 'monad' ? view.contract : null
  const token = view?.settlement === 'monad' ? view.token : null
  return React.useMemo(
    () => [contract, token].flatMap((address) => (address ? [address.toLowerCase()] : [])),
    [contract, token],
  )
}

/**
 * Why `typed` is not a usable destination, or undefined while it is fine or
 * still being typed (a short entry is judged once the field was left).
 */
export function addressError(
  typed: string,
  touched: boolean,
  blocked: readonly string[],
): string | undefined {
  const value = typed.trim()
  if (value === '') return undefined
  const parsed = parseAddress(value)
  if (parsed && blocked.includes(parsed.toLowerCase())) return VIATIK_ADDRESS_ERROR
  if (parsed) return undefined
  if (ZERO_SHAPE.test(value))
    return 'This is the zero address: nothing sent to it can ever be recovered. Enter the address of an account.'
  if (!touched && value.length < 42) return undefined
  return ADDRESS_SHAPE.test(value)
    ? 'This address does not check out: a character may be wrong. Copy it again from the account.'
    : 'Enter a valid account address: 0x followed by 40 characters.'
}

/** An address the screen already knows, with a non-blocking note shown when it is entered. */
export type KnownAddress = { address: string | null | undefined; note: string }

export type AddressEntry = {
  /** What the person typed, as typed. */
  typed: string
  /** Replaces the typed text (also when a saved payee fills it); clears the confirmation. */
  setTyped: (value: string) => void
  /** Marks the field as left, so a short or broken entry shows its error. */
  touch: () => void
  /** The checksummed address when it is valid and not one of Viatik's contracts, else null. */
  address: Address | null
  error?: string
  /** A note about a known address (e.g. "This is your own Viatik account."). Never blocks. */
  notice?: string
  /** The person confirmed exactly this address; any edit clears it. */
  confirmed: boolean
  setConfirmed: (confirmed: boolean) => void
  /** Back to empty, for a sheet's onClosed or a form reset. */
  reset: () => void
}

/**
 * State and checks for one address field. `initial` prefills it (still to
 * confirm); `known` adds non-blocking notes for addresses the screen recognizes.
 */
export function useAddressEntry(options: { initial?: string; known?: KnownAddress[] } = {}): AddressEntry {
  const blocked = useViatikAddresses()
  const [typed, setTypedState] = React.useState(options.initial ?? '')
  const [touched, setTouched] = React.useState(false)
  // The address the person confirmed: a confirmation never carries over to another address.
  const [confirmedFor, setConfirmedFor] = React.useState<string | null>(null)

  const error = addressError(typed, touched, blocked)
  const parsed = parseAddress(typed)
  const address = parsed && !error ? parsed : null
  const notice = address
    ? options.known?.find((known) => sameAddress(known.address, address))?.note
    : undefined

  const setTyped = React.useCallback((value: string) => {
    setTypedState(value)
    setConfirmedFor(null)
  }, [])
  const touch = React.useCallback(() => setTouched(true), [])
  const setConfirmed = React.useCallback(
    (confirmed: boolean) => setConfirmedFor(confirmed && address ? address : null),
    [address],
  )
  const reset = React.useCallback(() => {
    setTypedState('')
    setTouched(false)
    setConfirmedFor(null)
  }, [])

  return {
    typed,
    setTyped,
    touch,
    address,
    error,
    notice,
    confirmed: Boolean(address && sameAddress(confirmedFor, address)),
    setConfirmed,
    reset,
  }
}

/** The address input: a mono pill field with its label, hint and error. */
export function AddressField({
  id,
  label = 'Address',
  value,
  onChange,
  onBlur,
  error,
  hint = '0x followed by 40 characters.',
  disabled,
  placeholder = '0x…',
  className,
}: {
  id: string
  label?: string
  value: string
  onChange: (value: string) => void
  /** Usually `entry.touch`, so a short entry shows its error once the field is left. */
  onBlur?: () => void
  error?: string
  hint?: React.ReactNode
  disabled?: boolean
  placeholder?: string
  className?: string
}) {
  return (
    <FormField label={label} htmlFor={id} error={error} hint={hint} className={className}>
      <PillInput
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        inputMode="text"
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        className="font-mono text-sm"
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
    </FormField>
  )
}

/**
 * The full address in a warning box with "I confirm this address is correct".
 * Render it once the address is valid; nothing should be sent before it is ticked.
 */
export function AddressConfirm({
  id,
  address,
  confirmed,
  onConfirmedChange,
  disabled,
  warning = 'The money goes to this address. Check every character: money sent to a wrong address cannot be recovered.',
  notice,
}: {
  /** Id of the checkbox (its label points at it). */
  id: string
  address: string
  confirmed: boolean
  onConfirmedChange: (confirmed: boolean) => void
  disabled?: boolean
  /** The sentence above the address. */
  warning?: React.ReactNode
  /** A non-blocking note under the address, e.g. `entry.notice`. */
  notice?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4">
      <p className="flex gap-2 text-sm text-pretty text-foreground">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <span>{warning}</span>
      </p>
      <p className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <span className="min-w-0 flex-1 font-mono text-sm break-all text-foreground">{address}</span>
        <CopyButton value={address} label="Copy the full address" />
      </p>
      {notice ? (
        <p className="flex gap-2 text-sm text-pretty text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0 text-subtle" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      ) : null}
      <div className="flex items-start gap-3">
        <Checkbox
          id={id}
          checked={confirmed}
          disabled={disabled}
          onCheckedChange={(value) => onConfirmedChange(Boolean(value))}
          className="mt-0.5"
        />
        <Label htmlFor={id} className="text-sm leading-snug font-medium text-pretty text-foreground">
          I confirm this address is correct
        </Label>
      </div>
    </div>
  )
}

import { getAddress, isAddress, zeroAddress, type Address } from 'viem'

/**
 * A usable account address in its checksummed form, or null: all-lowercase and
 * checksummed input pass, a mixed-case one with a wrong checksum (a typo) does not,
 * and neither does the zero address.
 */
export function parseAddress(value: string): Address | null {
  const trimmed = value.trim()
  if (!isAddress(trimmed)) return null
  const address = getAddress(trimmed)
  return address === zeroAddress ? null : address
}

/** `0x1234…abcd`: enough to recognize an address, never the whole of it. */
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

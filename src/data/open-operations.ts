import type { OpenOperation } from './data-source'

/**
 * Operations sent for signing and not confirmed yet, kept in localStorage so
 * a reload or a closed tab can confirm them later on this device (the server
 * also sweeps them on each state read). Keyed by idempotency key, so a hash
 * is only ever confirmed under the operation it was signed for. When storage
 * is unavailable (private mode, blocked site data) the tab still remembers
 * them in memory: an operation it signed is never signed again.
 */

const STORAGE_KEY = 'viatik:open-operations'
/** The server keeps an operation's key for a day; older entries cannot be confirmed anymore. */
const KEEP_MS = 24 * 60 * 60 * 1000

/**
 * Commands that never wait for a signature (they move nothing). An entry for one was left by an
 * empty answer read as unsettled: there is nothing to confirm, so it is dropped.
 */
const NEVER_SIGNED: ReadonlySet<string> = new Set(['markNotificationsRead'])

let memory: OpenOperation[] = []

function read(): OpenOperation[] {
  let all = memory
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw !== null) all = JSON.parse(raw) as OpenOperation[]
  } catch {
    // Unavailable: what this tab wrote is still in memory.
  }
  return all.filter(
    (operation) => Date.now() - Date.parse(operation.at) < KEEP_MS && !NEVER_SIGNED.has(operation.name),
  )
}

function write(all: OpenOperation[]) {
  memory = all
  try {
    if (all.length > 0) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked or full: kept in memory for this tab, and the server's sweep still confirms it.
  }
}

export function rememberOpen(operation: OpenOperation) {
  write([...read().filter((o) => o.key !== operation.key), operation])
}

export function forgetOpen(key: string) {
  write(read().filter((o) => o.key !== key))
}

export function openOperationsOf(userId: string): OpenOperation[] {
  return read().filter((o) => o.userId === userId)
}

export function openOperation(key: string): OpenOperation | undefined {
  return read().find((o) => o.key === key)
}

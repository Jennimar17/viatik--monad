// Adds every Viatik account already in the database to the Alchemy webhook's watched addresses
// (new accounts are added at sign-in; this catches up the ones created before). It reads the
// database only (a read-only transaction), and talks to Alchemy only with --apply.
//
//   node scripts/alchemy-sync-addresses.mjs           prints the plan, sends nothing
//   node scripts/alchemy-sync-addresses.mjs --apply   adds them (adding one twice is harmless)
//
// DATABASE_URL, ALCHEMY_WEBHOOK_ID and ALCHEMY_NOTIFY_AUTH_TOKEN come from the environment or
// .env.local. Secrets are never printed. Addresses are only added, never removed, so addresses
// added by hand in the dashboard stay.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALCHEMY_ADDRESSES_URL = 'https://dashboard.alchemy.com/api/update-webhook-addresses'
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
/** Addresses per request. */
const BATCH = 500

/** KEY=value lines of .env.local (no expansion); the process environment wins. */
function readEnv() {
  const file = path.join(root, '.env.local')
  const values = {}
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!match) continue
      let value = match[2].trim()
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
      else value = value.replace(/\s+#.*$/, '')
      values[match[1]] = value
    }
  }
  return (key) => process.env[key] || values[key] || undefined
}

const apply = process.argv.includes('--apply')
const env = readEnv()
const databaseUrl = env('DATABASE_URL')
if (!databaseUrl) {
  console.error('DATABASE_URL is not set (environment or .env.local).')
  process.exit(1)
}

// Read only: the transaction pooler needs prepare: false.
const sql = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 10, onnotice: () => {} })
let rows
try {
  rows = await sql.begin(
    'read only',
    (tx) => tx`select id, wallet_address from users where wallet_address is not null`,
  )
} catch (error) {
  console.error(`The database could not be read: ${error?.code ?? error?.name ?? 'error'}`)
  process.exit(1)
} finally {
  await sql.end({ timeout: 5 })
}

// An address two people claim belongs to neither (as in the app): it is not watched.
const claims = new Map()
for (const row of rows) {
  if (!ADDRESS.test(row.wallet_address)) continue
  const key = row.wallet_address.toLowerCase()
  claims.set(key, [...(claims.get(key) ?? []), row.wallet_address])
}
const addresses = [...claims.values()].filter((held) => held.length === 1).map(([address]) => address)
const shared = [...claims.values()].filter((held) => held.length > 1).length

const webhookId = env('ALCHEMY_WEBHOOK_ID')
const token = env('ALCHEMY_NOTIFY_AUTH_TOKEN')
console.log(
  `${addresses.length} Viatik account${addresses.length === 1 ? '' : 's'} to watch on webhook ${webhookId ?? '(ALCHEMY_WEBHOOK_ID not set)'}:`,
)
for (const address of addresses) console.log(`  ${address}`)
if (shared > 0) console.log(`${shared} address(es) claimed by two people are left out.`)

if (!apply) {
  console.log('\nPlan only: nothing was sent. Run again with --apply to add them.')
  process.exit(0)
}
if (!webhookId || !token) {
  console.error('\nSet ALCHEMY_WEBHOOK_ID and ALCHEMY_NOTIFY_AUTH_TOKEN in .env.local first.')
  process.exit(1)
}
if (addresses.length === 0) {
  console.log('\nNothing to add.')
  process.exit(0)
}

let failed = false
for (let start = 0; start < addresses.length; start += BATCH) {
  const batch = addresses.slice(start, start + BATCH)
  try {
    const response = await fetch(ALCHEMY_ADDRESSES_URL, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-alchemy-token': token },
      body: JSON.stringify({ webhook_id: webhookId, addresses_to_add: batch, addresses_to_remove: [] }),
      signal: AbortSignal.timeout(15_000),
    })
    console.log(`Added ${start + 1}–${start + batch.length}: ${response.status} ${response.statusText}`)
    if (!response.ok) failed = true
  } catch (error) {
    console.error(`Added ${start + 1}–${start + batch.length}: failed (${error?.name ?? 'error'})`)
    failed = true
  }
}
process.exit(failed ? 1 : 0)

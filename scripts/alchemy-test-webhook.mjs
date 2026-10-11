// Sends a signed Alchemy delivery (one TestUSD transfer into a Viatik account) to the webhook route
// of a running Viatik, to see "Funds arrived" without Alchemy or a real transfer. Nothing touches
// Monad or Alchemy: it only POSTs to the URL below.
//
//   node scripts/alchemy-test-webhook.mjs <account> [amount] [options]
//
//   <account>          the person's Viatik account address (users.wallet_address)
//   [amount]           USD, up to 6 decimals (default 25)
//   --from 0x…         the sender (default: a random address; never 0x0 or the ledger, which are skipped)
//   --tx 0x…           the transaction hash (default: random). Send the same --tx and --log-index
//                      again to check that a delivery received twice is told once.
//   --log-index N      the log's index in the transaction (default 0)
//   --graphql          a Custom (GraphQL) webhook delivery instead of Address Activity
//   --url URL          default http://localhost:3000/api/v1/webhooks/alchemy
//   --key KEY          the signing key (default: ALCHEMY_WEBHOOK_SIGNING_KEY from the environment or .env.local)
//   --print            prints the delivery and sends nothing
//
// TEST_USD_ADDRESS and ALCHEMY_WEBHOOK_ID come from the environment or .env.local. The key is
// never printed.
import { createHmac, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/

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

function fail(message) {
  console.error(message)
  process.exit(1)
}

function parseArgs(argv) {
  const options = { positional: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--graphql' || arg === '--print' || arg === '--help' || arg === '-h')
      options[arg.replace(/^-+/, '')] = true
    else if (arg.startsWith('--')) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) fail(`${arg} needs a value.`)
      options[arg.slice(2)] = value
      i += 1
    } else options.positional.push(arg)
  }
  return options
}

/** "12.5" → 12500000n (6 decimals), without floating point. */
function unitsOf(amount) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(amount)
  if (!match) fail(`The amount "${amount}" is not a USD amount with up to 6 decimals.`)
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? '').padEnd(6, '0'))
}

const hex32 = (value) => `0x${value.toString(16).padStart(64, '0')}`
const topicOf = (address) => `0x${'0'.repeat(24)}${address.slice(2).toLowerCase()}`
const randomHex = (bytes) => `0x${randomBytes(bytes).toString('hex')}`

const args = parseArgs(process.argv.slice(2))
if (args.help || args.h) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\nimport ')[0])
  process.exit(0)
}
const env = readEnv()
const to = args.to ?? args.positional[0]
if (!to || !ADDRESS.test(to))
  fail('Give the Viatik account address: node scripts/alchemy-test-webhook.mjs 0x… [amount]')
const units = unitsOf(args.amount ?? args.positional[1] ?? '25')
if (units <= 0n) fail('The amount must be greater than zero.')
const from = args.from ?? randomHex(20)
if (!ADDRESS.test(from)) fail('--from must be an address.')
const tx = (args.tx ?? randomHex(32)).toLowerCase()
if (!HASH.test(tx)) fail('--tx must be a 32-byte hex hash.')
const logIndex = Number(args['log-index'] ?? 0)
if (!Number.isSafeInteger(logIndex) || logIndex < 0) fail('--log-index must be a whole number.')
const token = env('TEST_USD_ADDRESS')
if (!token || !ADDRESS.test(token)) fail('TEST_USD_ADDRESS is not set (environment or .env.local).')
const webhookId = env('ALCHEMY_WEBHOOK_ID') ?? 'wh_local_test'
const url = args.url ?? 'http://localhost:3000/api/v1/webhooks/alchemy'

const block = 69_400_000 + Math.floor(Math.random() * 100_000)
const data = hex32(units)
const topics = [TRANSFER_TOPIC, topicOf(from), topicOf(to)]
const now = new Date().toISOString()
const eventId = `whevt_${randomBytes(8).toString('hex')}`

const payload = args.graphql
  ? {
      webhookId,
      id: eventId,
      createdAt: now,
      type: 'GRAPHQL',
      event: {
        sequenceNumber: String(Date.now()),
        network: 'MONAD_TESTNET',
        data: {
          block: {
            hash: randomHex(32),
            number: block,
            timestamp: Math.floor(Date.now() / 1000),
            logs: [
              {
                data,
                topics,
                index: logIndex,
                account: { address: token.toLowerCase() },
                transaction: {
                  hash: tx,
                  nonce: 0,
                  index: 0,
                  from: { address: from.toLowerCase() },
                  to: { address: token.toLowerCase() },
                  status: 1,
                },
              },
            ],
          },
        },
      },
    }
  : {
      webhookId,
      id: eventId,
      createdAt: now,
      type: 'ADDRESS_ACTIVITY',
      event: {
        network: 'MONAD_TESTNET',
        activity: [
          {
            fromAddress: from.toLowerCase(),
            toAddress: to.toLowerCase(),
            blockNum: `0x${block.toString(16)}`,
            hash: tx,
            value: Number(units) / 1e6,
            asset: 'TUSD',
            category: 'token',
            rawContract: { rawValue: data, address: token.toLowerCase(), decimals: 6 },
            log: {
              address: token.toLowerCase(),
              topics,
              data,
              blockNumber: `0x${block.toString(16)}`,
              transactionHash: tx,
              transactionIndex: '0x0',
              blockHash: randomHex(32),
              logIndex: `0x${logIndex.toString(16)}`,
              removed: false,
            },
          },
        ],
      },
    }

const body = JSON.stringify(payload)
if (args.print) {
  console.log(JSON.stringify(payload, null, 2))
  process.exit(0)
}
const key = args.key ?? env('ALCHEMY_WEBHOOK_SIGNING_KEY')
if (!key) fail('No signing key: set ALCHEMY_WEBHOOK_SIGNING_KEY in .env.local or pass --key.')
const signature = createHmac('sha256', key).update(body, 'utf8').digest('hex')

console.log(
  `Sending ${args.graphql ? 'a Custom (GraphQL)' : 'an Address Activity'} delivery: ${Number(units) / 1e6} TestUSD to ${to}`,
)
console.log(`  tx ${tx}  log ${logIndex}  (send again with --tx ${tx} --log-index ${logIndex})`)
let response
try {
  response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-alchemy-signature': signature },
    body,
    signal: AbortSignal.timeout(30_000),
  })
} catch (error) {
  fail(`Could not reach ${url}: ${error?.message ?? error}. Is the app running (pnpm dev)?`)
}
const text = await response.text()
console.log(`${response.status} ${response.statusText}`)
console.log(text)
if (response.status === 404)
  console.log('404: ALCHEMY_WEBHOOK_SIGNING_KEY is not set on the server (restart it after adding it).')
process.exit(response.ok ? 0 : 1)

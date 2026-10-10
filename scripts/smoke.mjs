// Engine and settlement smoke test. Real commands go through the API schemas, the engine, the
// settlement planner, the mock ledger and the genesis, and the ledger's books are checked after
// every step (see scripts/smoke/harness.ts). It only reads the repo.
//
//   node scripts/smoke.mjs [engine] [settlement] [genesis] [alchemy] [kimi] [--failures]
//
// With no suite named, all of them run. alchemy checks the webhook's pure pieces (signature,
// filtering, the "Funds arrived" notification) and kimi the receipt reader's (config, limits,
// answer parsing, matching), both with no keys and no network.
// --failures prints only the failed checks.
// Exit code: 0 everything passed, 1 a check failed, 2 the smoke itself broke (a suite did not
// load, or a scenario threw something other than a failed step).
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SUITES = ['engine', 'settlement', 'genesis', 'alchemy', 'kimi']

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const onlyFailures = args.includes('--failures')
const named = args.filter((arg) => !arg.startsWith('--'))
const unknown = named.filter((name) => !SUITES.includes(name))
if (unknown.length > 0) {
  console.error(`Unknown suite: ${unknown.join(', ')}. Choose from ${SUITES.join(', ')}.`)
  process.exit(2)
}
const selected = named.length > 0 ? SUITES.filter((name) => named.includes(name)) : SUITES

/** jiti loads the TypeScript suites. It is not a direct dependency: pnpm keeps it in its hoisted store. */
function loadJiti() {
  const load = createRequire(import.meta.url)
  let resolved
  try {
    resolved = load.resolve('jiti', { paths: [root] })
  } catch {
    resolved = load.resolve('jiti', { paths: [path.join(root, 'node_modules', '.pnpm', 'node_modules')] })
  }
  return load(resolved).createJiti(import.meta.url, {
    alias: { '@': path.join(root, 'src') },
    interopDefault: true,
    // Transpiled files go to the temp folder, never into the repo.
    fsCache: path.join(os.tmpdir(), 'viatik-smoke-jiti'),
  })
}

/** Counts per suite, and the checker every suite gets. */
function createChecker() {
  const counts = new Map()
  let suite = ''
  const tally = (key) => {
    const entry = counts.get(suite) ?? { pass: 0, fail: 0, error: 0 }
    entry[key] += 1
    counts.set(suite, entry)
  }
  const t = {
    check(name, ok, detail = '') {
      tally(ok ? 'pass' : 'fail')
      if (ok && onlyFailures) return true
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? `\n       ${detail}` : ''}`)
      return ok
    },
    async scenario(title, run) {
      if (!onlyFailures) console.log(`\n  ${title}`)
      try {
        await run()
      } catch (error) {
        // A failed step already printed why; anything else is a bug in the smoke or a crash.
        if (error?.name === 'StepFailed') {
          tally('fail')
          console.log(`FAIL ${title}: stopped (${error.message})`)
        } else {
          tally('error')
          console.log(`ERROR ${title}: ${error?.stack ?? error}`)
        }
      }
    },
    note(text) {
      if (!onlyFailures) console.log(`     · ${text}`)
    },
  }
  return {
    t,
    begin(name) {
      suite = name
      counts.set(name, { pass: 0, fail: 0, error: 0 })
      console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`)
    },
    error(name, error) {
      suite = name
      tally('error')
      console.log(`ERROR ${name}: ${error?.stack ?? error}`)
    },
    counts,
  }
}

const started = Date.now()
let jiti
try {
  jiti = loadJiti()
} catch (error) {
  console.error(`The smoke could not load jiti: ${error?.message ?? error}`)
  process.exit(2)
}

const checker = createChecker()
for (const name of selected) {
  checker.begin(name)
  try {
    const loaded = await jiti.import(`./smoke/${name}.ts`)
    const run = typeof loaded === 'function' ? loaded : loaded?.default
    if (typeof run !== 'function') throw new Error(`scripts/smoke/${name}.ts has no default export`)
    await run(checker.t)
  } catch (error) {
    checker.error(name, error)
  }
}

let failed = 0
let errors = 0
console.log('\nSummary')
for (const [name, { pass, fail, error }] of checker.counts) {
  failed += fail
  errors += error
  console.log(
    `  ${name.padEnd(11)} ${String(pass).padStart(4)} passed  ${String(fail).padStart(3)} failed${error > 0 ? `  ${error} errors` : ''}`,
  )
}
const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(
  errors > 0
    ? `SMOKE BROKE (${seconds} s)`
    : failed > 0
      ? `${failed} FAILED (${seconds} s)`
      : `ALL PASSED (${seconds} s)`,
)
process.exit(errors > 0 ? 2 : failed > 0 ? 1 : 0)

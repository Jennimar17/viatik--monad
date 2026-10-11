// Records Kimi's readings of the demo's sample files (public/demo/kimi/), which the demo replays
// instead of calling Kimi (src/data/kimi-samples.ts). Each sample is read live, once per run, by the
// server's own reader (src/server/receipt-reader.ts) with KIMI_API_KEY from .env.local, against the
// demo story seeded at that moment. It prints the model name, never the key.
//
//   node scripts/kimi-record.mjs [--only <id>] [--write]
//
// Without --write it is a dry run: it prints what Kimi answered and writes nothing. With --write,
// and only when every reading is what its sample needs, it writes src/data/kimi-recordings.ts and
// formats it (with --only, the other samples keep their recordings). The logic is in
// scripts/kimi-record.ts. Not part of the smoke, which stays offline.
// Exit code: 0 every reading passed, 1 one did not (nothing was written), 2 the script broke.
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const write = args.includes('--write')
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? args[onlyAt + 1] : undefined
if (onlyAt >= 0 && (!only || only.startsWith('--'))) {
  console.error('--only needs a sample id, e.g. --only kestrel-receipt.')
  process.exit(2)
}
const unknown = args.filter(
  (arg, index) => arg !== '--write' && (onlyAt < 0 || index < onlyAt || index > onlyAt + 1),
)
if (unknown.length > 0) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Use [--only <id>] [--write].`)
  process.exit(2)
}

/** jiti loads the TypeScript logic. It is not a direct dependency: pnpm keeps it in its hoisted store. */
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

try {
  // KIMI_API_KEY (and KIMI_MODEL, KIMI_BASE_URL) stay in this process; nothing prints them.
  process.loadEnvFile(path.join(root, '.env.local'))
} catch {
  console.error('.env.local could not be read. Add KIMI_API_KEY there first.')
  process.exit(2)
}

let code
try {
  const loaded = await loadJiti().import('./kimi-record.ts')
  const run = typeof loaded === 'function' ? loaded : loaded?.default
  if (typeof run !== 'function') throw new Error('scripts/kimi-record.ts has no default export')
  code = await run({ root, write, only })
} catch (error) {
  console.error(`The recording broke: ${error?.stack ?? error}`)
  code = 2
}
process.exit(code)

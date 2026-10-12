import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { EvidenceReadPurpose } from '@/data/api-contract'
import { KIMI_RECORDINGS } from '@/data/kimi-recordings'
import type { DemoSampleId, KimiRecording } from '@/data/kimi-samples'
import { createDemoState } from '@/domain/fixtures'
import { DEMO } from '@/domain/fixtures/ids'
import type { Id } from '@/domain/types'
import { scopeStateForUser } from '@/domain/visibility'
import {
  buildProposal,
  kimiConfig,
  READ_DEADLINE_MS,
  readerCandidates,
  readWithKimi,
  type KimiConfig,
} from '@/server/receipt-reader'

/**
 * The logic of scripts/kimi-record.mjs. Each sample is read the way
 * `POST /v1/evidence/read` reads a file (src/server/evidence.ts), by the demo
 * person who reads it there, and the reading is checked against what the
 * demo story needs from it before anything is written.
 */

type Sample = {
  id: DemoSampleId
  path: KimiRecording['file']['path']
  /** The name the file gets when the demo adds it to a form. */
  name: string
  mimeType: string
  purpose: EvidenceReadPurpose
  userId: Id
  /** What Kimi must read for the demo story to work. */
  expect: {
    amount: string
    /** The date printed on the sample (YYYY-MM-DD). */
    date: string
    monthly: boolean
    /** The open item it pays, by its label; null when it pays none. */
    match: ((label: string) => boolean) | null
    /** Invoices of a monthly charge: the day of the monthly payment proposed. */
    dayOfMonth?: number
  }
}

const SAMPLES: Sample[] = [
  {
    id: 'kestrel-receipt',
    path: '/demo/kimi/kestrel-receipt.png',
    name: 'Kestrel Camera & Supply receipt (sample).png',
    mimeType: 'image/png',
    purpose: 'receipt',
    userId: DEMO.users.alex,
    expect: {
      amount: '71.86',
      date: '2026-10-10',
      monthly: false,
      match: (label) => label === 'Field kit for the pilot visit',
    },
  },
  {
    id: 'figma-invoice',
    path: '/demo/kimi/figma-invoice.pdf',
    name: 'Figma invoice (sample).pdf',
    mimeType: 'application/pdf',
    purpose: 'invoice',
    userId: DEMO.users.maya,
    expect: {
      amount: '45.00',
      date: '2026-10-01',
      monthly: true,
      match: (label) => label.startsWith('Figma'),
      dayOfMonth: 1,
    },
  },
  {
    id: 'loomwise-invoice',
    path: '/demo/kimi/loomwise-invoice.pdf',
    name: 'Loomwise invoice (sample).pdf',
    mimeType: 'application/pdf',
    purpose: 'invoice',
    userId: DEMO.users.maya,
    expect: { amount: '36.00', date: '2026-10-10', monthly: true, match: null, dayOfMonth: 10 },
  },
]

/** The lowest confidence a recorded reading may have: the card then says "A clear reading". */
const CLEAR_CONFIDENCE = 0.8

/** Reads one sample with Kimi, against the demo story as a visitor seeding it now would get it. */
async function readSample(root: string, config: KimiConfig, sample: Sample): Promise<KimiRecording> {
  const { purpose, userId } = sample
  const agencyId = DEMO.agencies.arc
  const now = new Date().toISOString()
  const view = scopeStateForUser(createDemoState(now), userId)
  const bytes = readFileSync(path.join(root, 'public', sample.path))
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const sent = readerCandidates(view, { userId, agencyId, purpose, now })
  const { answer, model } = await readWithKimi({
    config,
    bytes: new Uint8Array(bytes).buffer,
    mimeType: sample.mimeType,
    purpose,
    candidates: sent,
    now,
    deadline: Date.now() + READ_DEADLINE_MS,
  })
  const proposal = buildProposal(answer, {
    purpose,
    sent,
    current: sent,
    reminders:
      purpose === 'invoice'
        ? view.reminders.filter((r) => r.agencyId === agencyId && r.status !== 'archived')
        : [],
    now,
  })
  return {
    id: sample.id,
    purpose,
    file: {
      path: sample.path,
      name: sample.name,
      mimeType: sample.mimeType,
      sizeBytes: bytes.byteLength,
      sha256,
    },
    recordedAt: now,
    model,
    // Without ids: they change with the day the demo is seeded, so the demo finds the match by label.
    sent: sent.map(({ key, kind, label, amount, date, earliest }) => ({
      key,
      kind,
      label,
      amount,
      date,
      earliest,
    })),
    answer,
    proposal,
  }
}

/** Why the reading does not serve the demo story; empty when it does. */
function problemsOf(sample: Sample, { answer, proposal }: KimiRecording): string[] {
  const { expect } = sample
  const problems: string[] = []
  if (!answer.readable) problems.push('Kimi found nothing it can read')
  if (answer.amount !== expect.amount) problems.push(`amount ${answer.amount} instead of ${expect.amount}`)
  if (answer.currency !== 'USD') problems.push(`currency ${answer.currency} instead of USD`)
  if (answer.date !== expect.date) problems.push(`date ${answer.date} instead of ${expect.date}`)
  if (answer.isRecurringMonthly !== expect.monthly) {
    problems.push(expect.monthly ? 'not read as monthly' : 'read as monthly')
  }
  const label = proposal.match?.label ?? null
  if (expect.match === null ? label !== null : label === null || !expect.match(label)) {
    problems.push(`matched ${label === null ? 'nothing' : `“${label}”`}`)
  }
  if (expect.dayOfMonth !== undefined && proposal.reminder?.dayOfMonth !== expect.dayOfMonth) {
    problems.push(`no monthly payment on day ${expect.dayOfMonth} proposed`)
  }
  for (const note of proposal.notes) problems.push(`note: ${note}`)
  if (proposal.confidence < CLEAR_CONFIDENCE) {
    problems.push(`confidence ${proposal.confidence}, below ${CLEAR_CONFIDENCE}`)
  }
  return problems
}

/** Writes src/data/kimi-recordings.ts with these recordings (the others' kept) and formats it. */
function writeRecordings(root: string, recorded: KimiRecording[]) {
  const order = (id: DemoSampleId) => SAMPLES.findIndex((sample) => sample.id === id)
  const all = [
    ...KIMI_RECORDINGS.filter((kept) => !recorded.some((r) => r.id === kept.id)),
    ...recorded,
  ].sort((a, b) => order(a.id) - order(b.id))
  const days = [...new Set(all.map((r) => r.recordedAt.slice(0, 10)))].sort().join(', ')
  const file = path.join(root, 'src', 'data', 'kimi-recordings.ts')
  writeFileSync(
    file,
    [
      `// Generated by scripts/kimi-record.mjs on ${days}. Kimi read these sample files once; the demo replays them. Do not edit by hand.`,
      "import type { KimiRecording } from './kimi-samples'",
      '',
      `export const KIMI_RECORDINGS: KimiRecording[] = ${JSON.stringify(all, null, 2)}`,
      '',
    ].join('\n'),
  )
  execFileSync(
    process.execPath,
    [path.join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs'), '--write', file],
    {
      cwd: root,
      stdio: 'inherit',
    },
  )
}

export default async function record(options: {
  root: string
  write: boolean
  only?: string
}): Promise<number> {
  const { root, write, only } = options
  const samples = only ? SAMPLES.filter((sample) => sample.id === only) : SAMPLES
  if (samples.length === 0) {
    console.error(`Unknown sample: ${only}. Choose from ${SAMPLES.map((sample) => sample.id).join(', ')}.`)
    return 2
  }
  const config = kimiConfig()
  if (!config) {
    console.error('KIMI_API_KEY is not set in .env.local, so Kimi cannot be called.')
    return 2
  }
  // The model only: the key never leaves this process.
  console.log(`Kimi model: ${config.model}.${write ? '' : ' Dry run: nothing is written.'}`)

  const recorded: KimiRecording[] = []
  let failed = 0
  for (const sample of samples) {
    console.log(`\n${sample.id} (${sample.purpose}, public${sample.path})`)
    let recording: KimiRecording
    try {
      recording = await readSample(root, config, sample)
    } catch (error) {
      failed += 1
      const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown }
      console.log(
        `  FAIL Kimi did not answer: ${String(message)}${typeof code === 'string' ? ` (${code})` : ''}`,
      )
      continue
    }
    console.log(`  read by  ${recording.model}`)
    console.log(`  answer   ${JSON.stringify(recording.answer)}`)
    console.log(`  proposal ${JSON.stringify(recording.proposal)}`)
    const problems = problemsOf(sample, recording)
    if (problems.length > 0) {
      failed += 1
      for (const problem of problems) console.log(`  FAIL ${problem}`)
    } else {
      console.log('  PASS')
      recorded.push(recording)
    }
  }

  if (failed > 0) {
    console.log(
      `\n${failed} of ${samples.length} readings are not what the samples need. Nothing was written.`,
    )
    return 1
  }
  if (!write) {
    console.log('\nEvery reading passed. Nothing was written: run again with --write to record.')
    return 0
  }
  writeRecordings(root, recorded)
  console.log(`\nRecorded ${recorded.length} reading(s) in src/data/kimi-recordings.ts.`)
  return 0
}

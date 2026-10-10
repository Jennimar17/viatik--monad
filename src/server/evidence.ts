import { createHash } from 'node:crypto'

import { and, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

import {
  EVIDENCE_MAX_BYTES,
  EVIDENCE_MIME_TYPES,
  type EvidenceLink,
  type EvidenceReadAnswer,
  type EvidenceReaderStatus,
  type EvidenceUploadTicket,
  type VerifiedUpload,
} from '@/data/api-contract'
import { newId } from '@/domain/ids'
import { findEvidence } from '@/domain/queries'
import { scopeStateForUser } from '@/domain/visibility'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { getDb } from './db/client'
import { uploads, users } from './db/schema'
import { ApiError } from './errors'
import {
  buildProposal,
  kimiConfig,
  READ_DEADLINE_MS,
  readerCandidates,
  readWithKimi,
  startRead,
} from './receipt-reader'
import { readWorld } from './repository'
import { deleteObject, readObject, signedReadUrl, signedUploadUrl } from './storage'
import { requireUser } from './user'

const noStore = { 'cache-control': 'no-store' }
const DAY_MS = 24 * 60 * 60 * 1000
/** Signed upload URLs expire after two hours; a pending upload older than that is abandoned. */
const ABANDONED_MS = 2 * 60 * 60 * 1000
/** What one person may upload in a day: generous for real use, a brake on filling the storage. */
const DAILY_FILES = 150
const DAILY_BYTES = 300 * 1024 * 1024

const uploadRequest = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^[^\u0000]*$/),
  mimeType: z.enum(EVIDENCE_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(EVIDENCE_MAX_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
})

/** `POST /v1/evidence/read`: a file the caller uploaded, and what it is read for. */
const readRequest = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  agencyId: z.string().min(1).max(100),
  purpose: z.enum(['receipt', 'invoice']),
})

type UploadRow = typeof uploads.$inferSelect

const verified = (row: UploadRow): VerifiedUpload => ({
  kind: 'file',
  name: row.name,
  mimeType: row.mimeType,
  sizeBytes: row.sizeBytes,
  sha256: row.sha256,
})

/** Whether the bytes really are the announced type (Storage trusts the uploader's header). */
function looksLike(bytes: Uint8Array, mimeType: string): boolean {
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length))
  switch (mimeType) {
    case 'application/pdf':
      return text(0, 1024).includes('%PDF-')
    case 'image/png':
      return bytes[0] === 0x89 && text(1, 3) === 'PNG'
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/webp':
      return text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP'
    case 'image/heic':
      return (
        text(4, 4) === 'ftyp' &&
        ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1'].includes(text(8, 4))
      )
    default:
      return false
  }
}

/** Removes an upload that will never be used, object first. */
async function discard(row: Pick<UploadRow, 'id' | 'path'>) {
  await deleteObject(row.path)
  await getDb().delete(uploads).where(eq(uploads.id, row.id))
}

/**
 * Evidence files. The bytes never pass through the API (Vercel caps request
 * bodies well below the 10 MB a file may have):
 * 1. `POST /v1/evidence` records the announced file and returns a signed
 *    Storage URL for one new private object.
 * 2. The browser PUTs the file there.
 * 3. `POST /v1/evidence/:uploadId/verify` reads the object back and accepts
 *    it only if its type, SHA-256 and size match what was announced.
 * Commands then reference the file by that SHA-256 (see verifiedFiles), and
 * `GET /v1/evidence/:evidenceId/link` opens it for people who can see it.
 * `POST /v1/evidence/read` has Kimi read one of the caller's verified files
 * and answers a proposal to check, without saving anything (receipt-reader.ts);
 * it runs under its own route file for a longer maxDuration
 * (src/app/api/v1/evidence/read/route.ts).
 */
export const evidence = new Hono<AppEnv>()
  .post(
    '/',
    requireAccount,
    requireUser,
    bodyLimit({
      maxSize: 4 * 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'This request is too large.')
      },
    }),
    async (c) => {
      const user = c.get('user')
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiError(400, 'invalid_json', 'The request body must be JSON.')
      })
      const parsed = uploadRequest.safeParse(body)
      if (!parsed.success) {
        throw new ApiError(
          422,
          'invalid_file',
          'Only PDF, PNG, JPG, WEBP or HEIC files up to 10 MB can be added.',
        )
      }

      const db = getDb()
      // This person's abandoned uploads go first, so they never count or take space.
      const abandoned = await db
        .select({ id: uploads.id, path: uploads.path })
        .from(uploads)
        .where(
          and(
            eq(uploads.userId, user.id),
            eq(uploads.status, 'pending'),
            lt(uploads.createdAt, new Date(Date.now() - ABANDONED_MS)),
          ),
        )
        .limit(50)
      for (const row of abandoned) await discard(row)

      // One private object per upload, never shared or overwritten by another person.
      const id = newId('up')
      const path = `${user.id}/${id}`
      await db.transaction(async (tx) => {
        // Serializes this person's uploads, so parallel requests cannot pass the daily limit together.
        await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for('update')
        const [today] = await tx
          .select({
            files: sql<number>`count(*)::int`,
            bytes: sql<number>`coalesce(sum(${uploads.sizeBytes}), 0)::bigint`,
          })
          .from(uploads)
          .where(and(eq(uploads.userId, user.id), gt(uploads.createdAt, new Date(Date.now() - DAY_MS))))
        if (
          (today?.files ?? 0) >= DAILY_FILES ||
          Number(today?.bytes ?? 0) + parsed.data.sizeBytes > DAILY_BYTES
        ) {
          throw new ApiError(429, 'upload_limit', 'You have added a lot of files today. Try again tomorrow.')
        }
        await tx.insert(uploads).values({ id, userId: user.id, path, status: 'pending', ...parsed.data })
      })

      let uploadUrl: string
      try {
        uploadUrl = await signedUploadUrl(path)
      } catch (error) {
        await db.delete(uploads).where(eq(uploads.id, id))
        throw error
      }
      return c.json<EvidenceUploadTicket>({ uploadId: id, uploadUrl }, 201, noStore)
    },
  )
  .post('/:uploadId/verify', requireAccount, requireUser, async (c) => {
    const user = c.get('user')
    const db = getDb()
    const [row] = await db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, c.req.param('uploadId')), eq(uploads.userId, user.id)))
      .limit(1)
    if (!row) throw new ApiError(404, 'not_found', 'This upload does not exist. Add the file again.')
    if (row.status === 'verified') return c.json(verified(row), 200, noStore)

    const stored = await readObject(row.path)
    if (!stored) {
      throw new ApiError(409, 'upload_incomplete', 'The file did not finish uploading. Add it again.')
    }
    const bytes = new Uint8Array(stored.bytes)
    const servedAs = stored.contentType.split(';')[0]?.trim().toLowerCase()
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (
      sha256 !== row.sha256 ||
      bytes.byteLength !== row.sizeBytes ||
      servedAs !== row.mimeType ||
      !looksLike(bytes, row.mimeType)
    ) {
      // Never keep bytes that are not what was announced.
      await discard(row)
      throw new ApiError(422, 'upload_mismatch', 'This file could not be verified. Add it again.')
    }
    const [done] = await db
      .update(uploads)
      .set({ status: 'verified', verifiedAt: new Date() })
      .where(eq(uploads.id, row.id))
      .returning()
    return c.json(verified(done ?? row), 200, noStore)
  })
  .get('/:evidenceId/link', requireAccount, requireUser, async (c) => {
    const user = c.get('user')
    // Only evidence the caller can already see in their own state can be opened.
    const world = await readWorld()
    const item = findEvidence(scopeStateForUser(world.state, user.id), c.req.param('evidenceId'))
    if (!item || item.kind !== 'file') throw new ApiError(404, 'not_found', 'This file is not available.')
    // The copy uploaded by whoever attached it (the same bytes, by fingerprint).
    const [stored] = await getDb()
      .select({ path: uploads.path })
      .from(uploads)
      .where(
        and(
          eq(uploads.userId, item.addedBy),
          eq(uploads.sha256, item.sha256),
          eq(uploads.status, 'verified'),
        ),
      )
      .orderBy(desc(uploads.verifiedAt))
      .limit(1)
    if (!stored) {
      throw new ApiError(
        404,
        'not_stored',
        'This file has no stored copy. Example files in the demo story cannot be opened.',
      )
    }
    return c.json<EvidenceLink>({ url: await signedReadUrl(stored.path) }, 200, noStore)
  })
  // Whether this deployment reads files with Kimi: the screens show "Read with Kimi" only then.
  .get('/read/status', requireAccount, requireUser, (c) =>
    c.json<EvidenceReaderStatus>({ enabled: kimiConfig() !== null }, 200, noStore),
  )
  .post(
    '/read',
    requireAccount,
    requireUser,
    bodyLimit({
      maxSize: 2 * 1024,
      onError: () => {
        throw new ApiError(413, 'too_large', 'This request is too large.')
      },
    }),
    async (c) => {
      const deadline = Date.now() + READ_DEADLINE_MS
      const config = kimiConfig()
      if (!config) throw new ApiError(404, 'feature_disabled', 'Reading files with Kimi is not available.')
      const user = c.get('user')
      const body: unknown = await c.req.json().catch(() => {
        throw new ApiError(400, 'invalid_json', 'The request body must be JSON.')
      })
      const parsed = readRequest.safeParse(body)
      if (!parsed.success) throw new ApiError(422, 'invalid_request', 'Choose a file to read.')
      const { sha256, agencyId, purpose } = parsed.data

      // What the file may pay comes from what the caller can see, and only they may use the proposal.
      const now = new Date().toISOString()
      const sent = readerCandidates(scopeStateForUser((await readWorld()).state, user.id), {
        userId: user.id,
        agencyId,
        purpose,
        now,
      })

      // Only the caller's own file, as the server verified it.
      const [row] = await getDb()
        .select({ path: uploads.path, mimeType: uploads.mimeType, sha256: uploads.sha256 })
        .from(uploads)
        .where(and(eq(uploads.userId, user.id), eq(uploads.sha256, sha256), eq(uploads.status, 'verified')))
        .orderBy(desc(uploads.verifiedAt))
        .limit(1)
      if (!row) throw new ApiError(404, 'not_found', 'Upload the file first, then read it.')

      const end = startRead(user.id)
      try {
        const stored = await readObject(row.path)
        if (!stored) throw new ApiError(404, 'not_stored', 'This file is no longer stored. Add it again.')
        if (createHash('sha256').update(new Uint8Array(stored.bytes)).digest('hex') !== row.sha256) {
          throw new ApiError(422, 'upload_mismatch', 'This file could not be verified. Add it again.')
        }
        const { answer, model } = await readWithKimi({
          config,
          bytes: stored.bytes,
          mimeType: row.mimeType,
          purpose,
          candidates: sent,
          now,
          deadline,
        })

        // Kimi takes a while: a match must still be open now (someone may have acted meanwhile).
        const later = new Date().toISOString()
        const state = scopeStateForUser((await readWorld()).state, user.id)
        let current: typeof sent = []
        try {
          current = readerCandidates(state, { userId: user.id, agencyId, purpose, now: later })
        } catch {
          // The caller lost access meanwhile: nothing can be matched.
        }
        const proposal = buildProposal(answer, {
          purpose,
          sent,
          current,
          // Paused ones too: the person is told to resume it rather than create a second one.
          reminders:
            purpose === 'invoice'
              ? state.reminders.filter((r) => r.agencyId === agencyId && r.status !== 'archived')
              : [],
          now: later,
        })
        return c.json<EvidenceReadAnswer>({ proposal, model }, 200, noStore)
      } finally {
        end()
      }
    },
  )

/**
 * Every file a command attaches must be one the caller uploaded and the
 * server verified, so the fingerprint recorded (and later settled onchain)
 * is the real content's. The file's type and size are taken from the
 * verified upload, never from the request. Links and notes need no upload.
 * Mutates `input` (already a fresh parsed copy).
 */
export async function verifiedFiles(userId: string, input: unknown): Promise<void> {
  const files: Record<string, unknown>[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.kind === 'file') {
      files.push(record)
      return
    }
    Object.values(record).forEach(visit)
  }
  visit(input)
  if (files.length === 0) return

  const hashes = [...new Set(files.map((file) => file.sha256))]
  if (hashes.some((hash) => typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash))) {
    throw new ApiError(422, 'file_not_uploaded', 'Upload the file before submitting.')
  }
  const rows = await getDb()
    .select({ sha256: uploads.sha256, mimeType: uploads.mimeType, sizeBytes: uploads.sizeBytes })
    .from(uploads)
    .where(
      and(
        eq(uploads.userId, userId),
        eq(uploads.status, 'verified'),
        inArray(uploads.sha256, hashes as string[]),
      ),
    )
  const known = new Map(rows.map((row) => [row.sha256, row]))
  for (const file of files) {
    const row = known.get(file.sha256 as string)
    if (!row) {
      throw new ApiError(
        422,
        'file_not_uploaded',
        'One of the files was not uploaded. Remove it and add it again.',
      )
    }
    file.mimeType = row.mimeType
    file.sizeBytes = row.sizeBytes
    delete file.url
  }
}

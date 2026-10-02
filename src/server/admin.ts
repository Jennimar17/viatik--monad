import { timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'

import { readServerEnv } from '@/lib/env'

import type { AppEnv } from './context'
import { operations } from './db/schema'
import { ApiError } from './errors'
import { resetWorld, withWorld } from './repository'

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * `POST /v1/admin/seed`: restores the demo story for everyone (before
 * recording the video, or after a judge's session). Needs ADMIN_SEED_TOKEN in
 * the `x-admin-token` header; without that variable the route does not exist.
 * Real accounts keep their sign-in, but workspaces created since are gone.
 */
export const admin = new Hono<AppEnv>().post('/seed', async (c) => {
  const expected = readServerEnv().ADMIN_SEED_TOKEN
  if (!expected) throw new ApiError(404, 'not_found', 'This endpoint does not exist.')
  if (!sameSecret(c.req.header('x-admin-token') ?? '', expected)) {
    throw new ApiError(401, 'unauthenticated', 'A valid admin token is required.')
  }
  await withWorld(async (_world, tx) => {
    await resetWorld(tx)
    // Replays would answer with results from the old story.
    await tx.delete(operations)
    return { state: null, result: null }
  })
  return c.json({ status: 'seeded' })
})

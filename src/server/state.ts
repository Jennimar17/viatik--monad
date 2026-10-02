import { Hono } from 'hono'

import { invitationPreview } from '@/domain/identity'
import { scopeStateForUser } from '@/domain/visibility'

import { requireAccount } from './auth'
import type { AppEnv } from './context'
import { ApiError } from './errors'
import { readWorld, readWorldVersion, withWorld } from './repository'
import { requireUser, withCaller } from './user'

const noStore = { 'cache-control': 'no-store' }

/**
 * `GET /v1/state`: everything the caller may see (`scopeStateForUser`). The
 * ETag is the caller plus the state version, so a client polling for changes
 * gets a 304 without the state being read or sent again.
 */
export const state = new Hono<AppEnv>().get('/', requireAccount, requireUser, async (c) => {
  const user = c.get('user')
  const version = await readWorldVersion()
  if (version !== null && c.req.header('if-none-match') === `"${user.id}:${version}"`) {
    return c.body(null, 304, { ...noStore, etag: `"${user.id}:${version}"` })
  }

  let world = await readWorld()
  // First visit of a new person, or new verified details: record them once.
  if (withCaller(world.state, user, new Date().toISOString())) {
    world = await withWorld(async (current) => {
      const next = withCaller(current.state, user, new Date().toISOString())
      return {
        state: next,
        result: next ? { state: next, version: current.version + 1 } : current,
      }
    })
  }
  return c.json(scopeStateForUser(world.state, user.id), 200, {
    ...noStore,
    etag: `"${user.id}:${world.version}"`,
  })
})

/** `GET /v1/invitations/:code`: what an invitation link shows before anyone signs in. */
export const invitations = new Hono<AppEnv>().get('/:code', async (c) => {
  const code = c.req.param('code')
  if (!/^[\w-]{3,80}$/.test(code)) throw new ApiError(404, 'not_found', 'This invitation link is not valid.')
  const preview = invitationPreview((await readWorld()).state, code)
  if (!preview) throw new ApiError(404, 'not_found', 'This invitation link is not valid.')
  return c.json(preview, 200, noStore)
})

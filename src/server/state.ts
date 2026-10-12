import { Hono } from 'hono'
import { endTime, startTime, wrapTime } from 'hono/timing'

import { invitationPreview } from '@/domain/identity'
import { scopeStateForUser } from '@/domain/visibility'

import { requireAccount } from './auth'
import { sweepOpenOperations } from './commands'
import type { AppEnv } from './context'
import { ApiError } from './errors'
import { readWorld, readWorldVersion, withWorld } from './repository'
import { requireUser, withCaller } from './user'

const noStore = { 'cache-control': 'no-store' }

/**
 * `GET /v1/state`: everything the caller may see (`scopeStateForUser`). The
 * ETag is the caller plus the state version, so a client polling for changes
 * gets a 304 without the state being read or sent again. Each read also
 * sweeps the caller's operations still pending on Monad.
 */
export const state = new Hono<AppEnv>().get('/', requireAccount, requireUser, async (c) => {
  const user = c.get('user')
  // Operations of this person still pending on Monad get a short look first (it may change the version).
  await wrapTime(c, 'sweep', sweepOpenOperations(user, c.get('requestId')))
  // Only a poll sends the ETag of its copy: a first load has nothing to compare, so the version is not read.
  const ifNoneMatch = c.req.header('if-none-match')
  if (ifNoneMatch) {
    const version = await wrapTime(c, 'version', readWorldVersion())
    if (version !== null && ifNoneMatch === `"${user.id}:${version}"`) {
      return c.body(null, 304, { ...noStore, etag: `"${user.id}:${version}"` })
    }
  }

  startTime(c, 'state')
  let world = await readWorld()
  // First visit of a new person, or new verified details: record them once.
  if (withCaller(world.state, user, new Date().toISOString())) {
    world = await withWorld(async (current) => {
      const next = withCaller(current.state, user, new Date().toISOString())
      return {
        state: next,
        result: next ? { ...current, state: next, version: current.version + 1 } : current,
      }
    })
  }
  endTime(c, 'state')
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

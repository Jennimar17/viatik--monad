import { eq, sql } from 'drizzle-orm'

import { createDemoState } from '@/domain/fixtures'
import type { ViatikState } from '@/domain/types'

import { getDb } from './db/client'
import { worldState } from './db/schema'

const WORLD = 'main'

type Db = ReturnType<typeof getDb>
/** The transaction handle Drizzle passes to `db.transaction`. */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export type World = { state: ViatikState; version: number }

/** The first read on an empty database starts from the demo story (Northstar, Arc Studio, Lumen Labs). */
async function seedIfMissing(db: Db | DbTx) {
  await db
    .insert(worldState)
    .values({ id: WORLD, state: createDemoState(new Date().toISOString()), version: 1 })
    .onConflictDoNothing()
}

/** Current version only: enough to tell a client its copy is still fresh. */
export async function readWorldVersion(): Promise<number | null> {
  const [row] = await getDb()
    .select({ version: worldState.version })
    .from(worldState)
    .where(eq(worldState.id, WORLD))
  return row?.version ?? null
}

export async function readWorld(): Promise<World> {
  const db = getDb()
  let [row] = await db.select().from(worldState).where(eq(worldState.id, WORLD))
  if (!row) {
    await seedIfMissing(db)
    ;[row] = await db.select().from(worldState).where(eq(worldState.id, WORLD))
  }
  if (!row) throw new Error('The product state could not be created.')
  return { state: row.state, version: row.version }
}

/**
 * Serialized read-modify-write of the whole state. The row lock makes
 * concurrent commands wait for each other (the transaction pooler supports
 * row locks, not session-level ones). `work` returns the next state, or null
 * to leave it untouched; throwing rolls everything back.
 */
export async function withWorld<R>(
  work: (world: World, tx: DbTx) => Promise<{ state: ViatikState | null; result: R }>,
): Promise<R> {
  return getDb().transaction(async (tx) => {
    let [row] = await tx.select().from(worldState).where(eq(worldState.id, WORLD)).for('update')
    if (!row) {
      await seedIfMissing(tx)
      ;[row] = await tx.select().from(worldState).where(eq(worldState.id, WORLD)).for('update')
    }
    if (!row) throw new Error('The product state could not be created.')
    const { state, result } = await work({ state: row.state, version: row.version }, tx)
    if (state) {
      await tx
        .update(worldState)
        .set({ state, version: row.version + 1, updatedAt: new Date() })
        .where(eq(worldState.id, WORLD))
    }
    return result
  })
}

/** Replaces the state with a fresh demo story (admin seed). */
export async function resetWorld(tx: DbTx): Promise<void> {
  await seedIfMissing(tx)
  await tx
    .update(worldState)
    .set({
      state: createDemoState(new Date().toISOString()),
      version: sql`${worldState.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(worldState.id, WORLD))
}

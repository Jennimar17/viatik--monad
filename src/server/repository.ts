import { eq, sql } from 'drizzle-orm'

import { createDemoState } from '@/domain/fixtures'
import { upgradeState } from '@/domain/migrate'
import type { KeeperStatus, ViatikState } from '@/domain/types'
import type { Balances } from '@/ledger/types'

import { getDb } from './db/client'
import { worldState, type WorldLedger } from './db/schema'

const WORLD = 'main'

type Db = ReturnType<typeof getDb>
/** The transaction handle Drizzle passes to `db.transaction`. */
export type DbTx = Parameters<Parameters<Db['transaction']>[0]>[0]

export type World = { state: ViatikState; version: number; ledger: WorldLedger | null }

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
  return { state: upgradeState(row.state), version: row.version, ledger: row.ledger }
}

/** Where the world settles (null on the demo ledger), without reading the state itself. */
export async function readWorldLedger(): Promise<WorldLedger | null> {
  const [row] = await getDb()
    .select({ ledger: worldState.ledger })
    .from(worldState)
    .where(eq(worldState.id, WORLD))
  return row?.ledger ?? null
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
    const { state, result } = await work(
      { state: upgradeState(row.state), version: row.version, ledger: row.ledger },
      tx,
    )
    if (state) {
      await tx
        .update(worldState)
        .set({ state, version: row.version + 1, updatedAt: new Date() })
        .where(eq(worldState.id, WORLD))
    }
    return result
  })
}

/**
 * Keeps the balances last read from Monad with the world, with the state
 * version they were read for, if the world is still in the same namespace and
 * no newer read is there: neither a later block nor a later state (a read
 * that started before a confirm must not replace the confirm's own read). The
 * state and its version do not change.
 */
export async function saveLedgerBalances(
  balances: Balances,
  namespace: string,
  version: number,
): Promise<void> {
  const read = JSON.stringify({ ...balances, version })
  await getDb()
    .update(worldState)
    .set({ ledger: sql`jsonb_set(${worldState.ledger}, '{balances}', ${read}::jsonb)` })
    .where(
      sql`${worldState.id} = ${WORLD} and ${worldState.ledger}->>'namespace' = ${namespace} and coalesce((${worldState.ledger}->'balances'->>'block')::bigint, -1) <= ${balances.block ?? 0} and coalesce((${worldState.ledger}->'balances'->>'version')::int, -1) <= ${version}`,
    )
}

/**
 * Inside `withWorld` (the row is locked): keeps the keeper's last pass in the
 * stored state without a new version, so a pass that changed nothing does not
 * make every open screen read the whole state again (they poll by version):
 * the next read of the state, or the next change, carries it. Writes nothing
 * and returns false when the state's last versioned save is older than
 * `staleAfterMs`: the caller then saves it the normal way, so open screens
 * still hear from the timer now and then.
 */
export async function saveKeeperQuietly(
  tx: DbTx,
  keeper: KeeperStatus,
  staleAfterMs: number,
): Promise<boolean> {
  const rows = await tx
    .update(worldState)
    .set({ state: sql`jsonb_set(${worldState.state}, '{keeper}', ${JSON.stringify(keeper)}::jsonb)` })
    .where(
      sql`${worldState.id} = ${WORLD} and ${worldState.updatedAt} > now() - make_interval(secs => ${Math.floor(staleAfterMs / 1000)})`,
    )
    .returning({ id: worldState.id })
  return rows.length > 0
}

/**
 * Replaces the state with a fresh story (admin seed) and where it settles:
 * bound to Monad after a genesis of exactly that state, or the demo ledger.
 */
export async function resetWorld(
  tx: DbTx,
  next: { state: ViatikState; ledger: WorldLedger | null },
): Promise<void> {
  await seedIfMissing(tx)
  await tx
    .update(worldState)
    .set({
      state: next.state,
      version: sql`${worldState.version} + 1`,
      ledger: next.ledger,
      updatedAt: new Date(),
    })
    .where(eq(worldState.id, WORLD))
}

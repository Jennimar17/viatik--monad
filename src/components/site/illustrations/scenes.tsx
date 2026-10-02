import { IsoScene, type IsoBoxSpec } from '@/components/site/illustrations/iso'

/**
 * Landing illustrations, composed from isometric boxes. Each scene is a
 * metaphor for a step or a use case rather than a picture of the interface.
 * Boxes are listed back to front.
 */

type SceneProps = { className?: string }

// How it works: one small object per stage of the capital flow.

const commit: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 46, d: 34, h: 8, tone: 'pearl' },
  { x: 4, y: 3, z: 8, w: 46, d: 34, h: 6, tone: 'lilac' },
  { x: 22, y: 14, z: 14, w: 12, d: 12, h: 12, tone: 'rose', float: 'fast' },
]

const release: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 16, d: 34, h: 12, tone: 'pearl' },
  { x: 16, y: 0, w: 16, d: 34, h: 24, tone: 'lilac' },
  { x: 32, y: 0, w: 16, d: 34, h: 36, tone: 'iri' },
  { x: 36, y: -18, z: 48, w: 9, d: 9, h: 9, tone: 'mint', float: 'slow' },
]

const allocate: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 14, d: 36, h: 26, tone: 'lilac' },
  { x: 19, y: 0, w: 14, d: 36, h: 18, tone: 'iri' },
  { x: 38, y: 0, w: 14, d: 36, h: 32, tone: 'mint' },
]

const spend: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 30, d: 30, h: 30, tone: 'iri' },
  { x: 42, y: 4, z: 22, w: 11, d: 11, h: 11, tone: 'rose', float: 'fast' },
  { x: 60, y: 8, z: 34, w: 7, d: 7, h: 7, tone: 'pearl', float: 'slow' },
]

const verify: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 42, d: 42, h: 7, tone: 'plum' },
  { x: 7, y: 7, z: 7, w: 28, d: 5, h: 5, tone: 'mint' },
  { x: 7, y: 12, z: 7, w: 5, d: 18, h: 5, tone: 'mint' },
  { x: 30, y: 12, z: 7, w: 5, d: 18, h: 5, tone: 'mint' },
  { x: 7, y: 30, z: 7, w: 28, d: 5, h: 5, tone: 'mint' },
  { x: 16, y: 16, z: 18, w: 10, d: 10, h: 10, tone: 'pearl', float: 'slow' },
]

export const stageScenes = { commit, release, allocate, spend, verify } as const

export type StageId = keyof typeof stageScenes

export function StageScene({ stage, className }: SceneProps & { stage: StageId }) {
  return <IsoScene boxes={stageScenes[stage]} className={className} pad={6} />
}

// Use cases: one building per kind of funder or team.

/** A stepped tower with shards in orbit: studios backing many teams. */
const studioTower: IsoBoxSpec[] = [
  { x: -78, y: 26, z: 150, w: 30, d: 30, h: 30, tone: 'rose', float: 'slow' },
  { x: 0, y: 0, w: 124, d: 124, h: 10, tone: 'plum' },
  { x: 12, y: 12, z: 10, w: 100, d: 100, h: 72, tone: 'lilac' },
  { x: 24, y: 24, z: 82, w: 76, d: 76, h: 78, tone: 'iri' },
  { x: 36, y: 36, z: 160, w: 52, d: 52, h: 58, tone: 'lilac' },
  { x: 46, y: 46, z: 218, w: 32, d: 32, h: 30, tone: 'pearl' },
  { x: 59, y: 59, z: 248, w: 6, d: 6, h: 64, tone: 'pearl' },
  { x: 156, y: -44, z: 214, w: 24, d: 24, h: 24, tone: 'mint', float: 'fast' },
  { x: 196, y: 52, z: 40, w: 16, d: 16, h: 40, tone: 'pearl', float: 'slow' },
]

/** Filed slabs with a seal: grants paid against evidence. */
const grantArchive: IsoBoxSpec[] = [
  { x: -30, y: 8, w: 14, d: 56, h: 64, tone: 'lilac' },
  { x: 0, y: 0, w: 92, d: 64, h: 9, tone: 'pearl' },
  { x: 6, y: 4, z: 9, w: 92, d: 64, h: 9, tone: 'lilac' },
  { x: 12, y: 8, z: 18, w: 92, d: 64, h: 9, tone: 'pearl' },
  { x: 62, y: 34, z: 27, w: 20, d: 20, h: 20, tone: 'rose' },
  { x: -10, y: -40, z: 84, w: 16, d: 16, h: 16, tone: 'mint', float: 'fast' },
]

/** Two towers and a deck: capital crossing into an ecosystem. */
const ecosystemBridge: IsoBoxSpec[] = [
  { x: -22, y: -46, z: -10, w: 60, d: 200, h: 10, tone: 'plum' },
  { x: 0, y: -26, z: 52, w: 16, d: 26, h: 8, tone: 'iri' },
  { x: 0, y: 0, w: 16, d: 16, h: 118, tone: 'rose' },
  { x: 0, y: 16, z: 52, w: 16, d: 82, h: 8, tone: 'iri' },
  { x: 0, y: 16, z: 106, w: 16, d: 82, h: 7, tone: 'lilac' },
  { x: 0, y: 98, w: 16, d: 16, h: 118, tone: 'rose' },
  { x: 0, y: 114, z: 52, w: 16, d: 30, h: 8, tone: 'iri' },
  { x: 62, y: -30, z: 96, w: 20, d: 20, h: 20, tone: 'mint', float: 'slow' },
  { x: -64, y: 120, z: 40, w: 14, d: 14, h: 14, tone: 'pearl', float: 'fast' },
]

/** A block of buildings at different heights: budgets inside one agency. */
const agencyBlocks: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 104, d: 72, h: 8, tone: 'plum' },
  { x: 8, y: 8, z: 8, w: 24, d: 24, h: 64, tone: 'lilac' },
  { x: 40, y: 8, z: 8, w: 24, d: 24, h: 96, tone: 'iri' },
  { x: 8, y: 40, z: 8, w: 24, d: 24, h: 32, tone: 'mint' },
  { x: 72, y: 8, z: 8, w: 24, d: 24, h: 44, tone: 'rose' },
  { x: 40, y: 40, z: 8, w: 24, d: 24, h: 52, tone: 'pearl' },
  { x: 72, y: 40, z: 8, w: 24, d: 24, h: 78, tone: 'lilac' },
  { x: 46, y: -24, z: 128, w: 14, d: 14, h: 14, tone: 'mint', float: 'fast' },
]

/** Modules with one lifted out: a team member spending on their own. */
const teamModules: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 104, d: 104, h: 8, tone: 'plum' },
  { x: 8, y: 8, z: 8, w: 26, d: 26, h: 26, tone: 'iri' },
  { x: 42, y: 8, z: 8, w: 26, d: 26, h: 26, tone: 'pearl' },
  { x: 8, y: 42, z: 8, w: 26, d: 26, h: 26, tone: 'lilac' },
  { x: 76, y: 8, z: 8, w: 20, d: 20, h: 20, tone: 'mint' },
  { x: 8, y: 76, z: 8, w: 20, d: 20, h: 20, tone: 'pearl' },
  { x: 58, y: 58, z: 56, w: 30, d: 30, h: 30, tone: 'rose', float: 'slow' },
  { x: 116, y: -10, z: 76, w: 12, d: 12, h: 12, tone: 'mint', float: 'fast' },
]

export const useCaseScenes = {
  studios: studioTower,
  grants: grantArchive,
  ecosystems: ecosystemBridge,
  agencies: agencyBlocks,
  teams: teamModules,
} as const

export type UseCaseSceneId = keyof typeof useCaseScenes

export function UseCaseScene({ scene, className }: SceneProps & { scene: UseCaseSceneId }) {
  return <IsoScene boxes={useCaseScenes[scene]} className={className} pad={12} />
}

// Monad: what people use, floating over what Viatik coordinates.

const layers: IsoBoxSpec[] = [
  { x: 0, y: 0, w: 132, d: 132, h: 10, tone: 'plum' },
  ...[0, 1, 2].flatMap((row) =>
    [0, 1, 2].map((col): IsoBoxSpec => ({
      x: 14 + col * 40,
      y: 14 + row * 40,
      z: 10,
      w: 24,
      d: 24,
      h: 12 + ((row + col) % 3) * 8,
      tone: (row + col) % 2 ? 'lilac' : 'plum',
    })),
  ),
  { x: 6, y: 6, z: 10, w: 4, d: 4, h: 84, tone: 'lilac' },
  { x: 122, y: 6, z: 10, w: 4, d: 4, h: 84, tone: 'lilac' },
  { x: 6, y: 122, z: 10, w: 4, d: 4, h: 84, tone: 'lilac' },
  { x: 0, y: 0, z: 94, w: 132, d: 132, h: 6, tone: 'glass' },
  { x: 16, y: 16, z: 100, w: 52, d: 30, h: 6, tone: 'pearl' },
  { x: 78, y: 16, z: 100, w: 38, d: 30, h: 14, tone: 'rose' },
  { x: 16, y: 58, z: 100, w: 30, d: 58, h: 10, tone: 'mint' },
  { x: 58, y: 58, z: 100, w: 58, d: 58, h: 4, tone: 'pearl' },
  { x: 122, y: 122, z: 10, w: 4, d: 4, h: 84, tone: 'lilac' },
  { x: 150, y: 30, z: 150, w: 16, d: 16, h: 16, tone: 'iri', float: 'slow' },
]

export function MonadLayersScene({ className }: SceneProps) {
  return <IsoScene boxes={layers} className={className} pad={10} />
}

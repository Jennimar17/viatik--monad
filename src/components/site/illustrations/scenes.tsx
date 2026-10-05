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

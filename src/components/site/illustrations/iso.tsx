import { cn } from '@/lib/utils'

/**
 * Isometric SVG primitives for the landing illustrations.
 *
 * Scenes are plain data: a list of boxes in a right-handed grid (x runs
 * down-right, y down-left, z up), drawn in array order, so a scene lists
 * boxes from back to front. The viewBox is fitted to the boxes.
 *
 * Every face is filled with a gradient from <IsoDefs />, which the page must
 * render once. Sharing one set of definitions keeps ids unique and the markup
 * light no matter how many scenes a page shows.
 */

const COS = Math.cos(Math.PI / 6)
const SIN = 0.5

type Point = [x: number, y: number, z: number]

export type IsoTone = 'iri' | 'lilac' | 'rose' | 'mint' | 'pearl' | 'plum' | 'glass'

export type IsoBoxSpec = {
  x: number
  y: number
  z?: number
  w: number
  d: number
  h: number
  tone?: IsoTone
  /** Drifts gently; `slow` and `fast` keep neighbouring pieces out of step. */
  float?: 'slow' | 'fast'
}

function project([x, y, z]: Point): [number, number] {
  return [(x - y) * COS, (x + y) * SIN - z]
}

function points(corners: Point[]) {
  return corners
    .map((corner) =>
      project(corner)
        .map((n) => n.toFixed(1))
        .join(','),
    )
    .join(' ')
}

function corners({ x, y, z = 0, w, d, h }: IsoBoxSpec) {
  return {
    top: [
      [x, y, z + h],
      [x + w, y, z + h],
      [x + w, y + d, z + h],
      [x, y + d, z + h],
    ] satisfies Point[],
    right: [
      [x + w, y, z],
      [x + w, y + d, z],
      [x + w, y + d, z + h],
      [x + w, y, z + h],
    ] satisfies Point[],
    left: [
      [x, y + d, z],
      [x + w, y + d, z],
      [x + w, y + d, z + h],
      [x, y + d, z + h],
    ] satisfies Point[],
  }
}

function IsoBox({ spec }: { spec: IsoBoxSpec }) {
  const tone = spec.tone ?? 'iri'
  const face = corners(spec)
  const { x, y, z = 0, w, d, h } = spec
  const [ex1, ey1] = project([x + w, y + d, z])
  const [ex2, ey2] = project([x + w, y + d, z + h])

  return (
    <g strokeLinejoin="round">
      <polygon points={points(face.left)} fill={`url(#iso-${tone}-left)`} />
      <polygon points={points(face.right)} fill={`url(#iso-${tone}-right)`} />
      <polygon
        points={points(face.top)}
        fill={`url(#iso-${tone}-top)`}
        style={{ stroke: 'var(--iri-edge)' }}
        strokeWidth={0.75}
      />
      <line x1={ex1} y1={ey1} x2={ex2} y2={ey2} style={{ stroke: 'var(--iri-edge)' }} strokeWidth={0.75} />
    </g>
  )
}

/** Fits a padded viewBox around every corner of every box. */
function viewBoxFor(boxes: IsoBoxSpec[], pad: number) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const box of boxes) {
    const face = corners(box)
    for (const corner of [...face.top, ...face.left, ...face.right]) {
      const [px, py] = project(corner)
      minX = Math.min(minX, px)
      minY = Math.min(minY, py)
      maxX = Math.max(maxX, px)
      maxY = Math.max(maxY, py)
    }
  }
  // Room for the float animation above the highest piece.
  const lift = boxes.some((box) => box.float) ? 8 : 0
  return [minX - pad, minY - pad - lift, maxX - minX + pad * 2, maxY - minY + pad * 2 + lift]
    .map((n) => n.toFixed(1))
    .join(' ')
}

export function IsoScene({
  boxes,
  className,
  pad = 8,
  preserveAspectRatio,
}: {
  boxes: IsoBoxSpec[]
  className?: string
  pad?: number
  preserveAspectRatio?: string
}) {
  return (
    <svg
      viewBox={viewBoxFor(boxes, pad)}
      preserveAspectRatio={preserveAspectRatio}
      aria-hidden="true"
      focusable="false"
      className={cn('overflow-visible', className)}
    >
      {boxes.map((box, index) =>
        box.float ? (
          <g key={index} className={box.float === 'slow' ? 'quiet-orbit' : 'gentle-float'}>
            <IsoBox spec={box} />
          </g>
        ) : (
          <IsoBox key={index} spec={box} />
        ),
      )}
    </svg>
  )
}

type Stop = [colour: string, opacity?: number]

/** Per tone: top face (diagonal), left face and right face (vertical). */
const TONES: Record<IsoTone, Record<'top' | 'left' | 'right', Stop[]>> = {
  iri: {
    top: [['--iri-pearl'], ['--iri-periwinkle']],
    left: [['--iri-rose'], ['--iri-lilac']],
    right: [['--iri-mint'], ['--iri-lilac']],
  },
  lilac: {
    top: [['--iri-pearl'], ['--iri-lilac']],
    left: [['--iri-lilac'], ['--iri-haze']],
    right: [['--iri-haze'], ['--iri-deep']],
  },
  rose: {
    top: [['--iri-pearl'], ['--iri-rose']],
    left: [['--iri-rose'], ['--iri-lilac']],
    right: [['--iri-lilac'], ['--iri-dusk']],
  },
  mint: {
    top: [['--iri-pearl'], ['--iri-mint']],
    left: [['--iri-mint'], ['--iri-periwinkle']],
    right: [['--iri-mint'], ['--iri-dusk']],
  },
  pearl: {
    top: [['--iri-paper'], ['--iri-pearl']],
    left: [['--iri-pearl'], ['--iri-periwinkle']],
    right: [['--iri-periwinkle'], ['--iri-lilac']],
  },
  plum: {
    top: [['--iri-haze'], ['--iri-dusk']],
    left: [['--iri-dusk'], ['--iri-deep']],
    right: [['--iri-deep'], ['--iri-night']],
  },
  glass: {
    top: [
      ['--iri-pearl', 0.42],
      ['--iri-periwinkle', 0.22],
    ],
    left: [
      ['--iri-lilac', 0.34],
      ['--iri-rose', 0.18],
    ],
    right: [
      ['--iri-mint', 0.3],
      ['--iri-lilac', 0.16],
    ],
  },
}

/** Gradient definitions shared by every <IsoScene> on the page. Render once. */
export function IsoDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="absolute size-0 overflow-hidden"
    >
      <defs>
        {Object.entries(TONES).flatMap(([tone, faces]) =>
          Object.entries(faces).map(([face, stops]) => (
            <linearGradient
              key={`${tone}-${face}`}
              id={`iso-${tone}-${face}`}
              x1="0"
              y1="0"
              x2={face === 'top' ? '1' : '0'}
              y2="1"
            >
              {stops.map(([colour, opacity = 1], index) => (
                <stop
                  key={colour}
                  offset={index / (stops.length - 1)}
                  style={{ stopColor: `var(${colour})`, stopOpacity: opacity }}
                />
              ))}
            </linearGradient>
          )),
        )}
      </defs>
    </svg>
  )
}

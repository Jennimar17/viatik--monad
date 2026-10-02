import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

import { IsoBox, project, type IsoBoxSpec } from '@/components/site/illustrations/iso'

const SIZE = 150
const THICKNESS = 12
const GAP = 50
const LIFT = 16

/**
 * Four slabs stacked like the roles they stand for, top to bottom: Investor,
 * Agency Admin, Member, AI Agents. The selected slab lifts and catches the
 * iridescent light; small cubes of capital drip down the front edge, from the
 * top layer to the bottom one. Purely decorative: the accessible control is
 * the tab list beside it, and clicks here are a pointer shortcut.
 */
export function CapitalStackScene({
  labels,
  active,
  onSelect,
  className,
}: {
  labels: string[]
  active: number
  onSelect?: (index: number) => void
  className?: string
}) {
  const levels = labels.length
  const topZ = (levels - 1) * GAP
  // The front corner, where capital drips from layer to layer.
  const [dropX, dropTopY] = project([SIZE, SIZE, topZ + THICKNESS + 18])

  return (
    <svg
      viewBox="-150 -230 450 400"
      aria-hidden="true"
      focusable="false"
      className={cn('overflow-visible', className)}
    >
      <line
        x1={dropX}
        y1={dropTopY}
        x2={dropX}
        y2={SIZE}
        style={{ stroke: 'var(--iri-edge)' }}
        strokeDasharray="2 5"
        strokeWidth={1}
      />

      {/* Bottom layer first, so upper layers paint over it. */}
      {labels
        .map((label, index) => ({ label, index }))
        .reverse()
        .map(({ label, index }) => {
          const z = (levels - 1 - index) * GAP
          const slab: IsoBoxSpec = { x: 0, y: 0, z, w: SIZE, d: SIZE, h: THICKNESS }
          const isActive = index === active
          const [labelX, labelY] = project([SIZE, 0, z + THICKNESS / 2])
          return (
            <g
              key={label}
              className={cn('stack-layer', onSelect && 'cursor-pointer')}
              style={{ transform: isActive ? `translateY(-${LIFT}px)` : 'none' } as CSSProperties}
              onClick={onSelect ? () => onSelect(index) : undefined}
            >
              <IsoBox spec={{ ...slab, tone: 'glass' }} />
              <g className="scene-fade" style={{ opacity: isActive ? 1 : 0 }}>
                <IsoBox spec={{ ...slab, tone: 'iri' }} />
              </g>
              <line
                x1={labelX + 6}
                y1={labelY}
                x2={labelX + 26}
                y2={labelY}
                style={{ stroke: isActive ? 'var(--brand-mist)' : 'var(--iri-edge)' }}
                strokeWidth={1}
              />
              <text
                x={labelX + 32}
                y={labelY}
                dominantBaseline="middle"
                fontSize={10}
                letterSpacing="0.12em"
                className="scene-fade"
                style={{
                  fill: isActive ? 'var(--brand-mist)' : 'var(--brand-stone)',
                  fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
                  fontWeight: isActive ? 530 : 400,
                }}
              >
                {label.toUpperCase()}
              </text>
            </g>
          )
        })}

      {[0, 1, 2].map((drop) => (
        <g
          key={drop}
          className="capital-drop"
          style={
            {
              '--drop': `${SIZE - dropTopY - 6}px`,
              animationDelay: `${drop * 1.06}s`,
            } as CSSProperties
          }
        >
          <IsoBox
            spec={{ x: SIZE - 7, y: SIZE - 7, z: topZ + THICKNESS + 18, w: 7, d: 7, h: 7, tone: 'mint' }}
          />
        </g>
      ))}
    </svg>
  )
}

import type { CSSProperties, ReactNode } from 'react'
import { CheckIcon, PaperclipIcon, ReceiptIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type GlassFigureId = 'studios' | 'grants' | 'ecosystems' | 'agencies' | 'teams'

/**
 * Use-case figures: frosted glass pieces over soft orbs of iridescent light.
 * Each figure is a square canvas laid out in percentages, so it scales from
 * the large sticky panel down to a mobile thumbnail; the grain comes from
 * the surface it sits on (`.grain`). Built from spans so a figure can sit
 * inside a link. Purely decorative.
 */
export function GlassFigure({
  id,
  className,
  style,
}: {
  id: GlassFigureId
  className?: string
  style?: CSSProperties
}) {
  const Figure = figures[id]
  return (
    <span aria-hidden="true" className={cn('relative block aspect-square', className)} style={style}>
      <Figure />
    </span>
  )
}

/** A blurred pool of colour that the glass above it refracts. */
function Orb({ colour, x, y, size }: { colour: string; x: number; y: number; size: number }) {
  return (
    <span
      className="glow-orb"
      style={{
        background: `var(${colour})`,
        left: `${x}%`,
        top: `${y}%`,
        width: `${size}%`,
        height: `${size}%`,
      }}
    />
  )
}

/** A frosted glass piece, positioned in percent of the canvas. */
function Glass({
  x,
  y,
  w,
  h,
  rotate = 0,
  round = '12%',
  float,
  className,
  children,
}: {
  x: number
  y: number
  w: number
  h: number
  rotate?: number
  round?: string
  float?: 'slow' | 'fast'
  className?: string
  children?: ReactNode
}) {
  const shape = (
    <span
      className={cn('glass-shape absolute', className)}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: `${w}%`,
        height: `${h}%`,
        borderRadius: round,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
      }}
    >
      {children}
    </span>
  )
  if (!float) return shape
  return (
    <span className={cn('absolute inset-0', float === 'slow' ? 'quiet-orbit' : 'gentle-float')}>{shape}</span>
  )
}

/** A line of placeholder text inside a glass piece. */
function Bar({ width, className }: { width: string; className?: string }) {
  return <span className={cn('block h-[5%] min-h-1 rounded-full bg-mist/35', className)} style={{ width }} />
}

const iriFill = {
  backgroundImage: 'linear-gradient(90deg, var(--iri-periwinkle), var(--iri-lilac), var(--iri-mint))',
}

/** Venture studios: a fan of team cards, the front one releasing tranche 2 of 4. */
function Studios() {
  return (
    <>
      <Orb colour="--iri-lilac" x={4} y={12} size={56} />
      <Orb colour="--iri-mint" x={56} y={52} size={40} />
      <Orb colour="--iri-rose" x={60} y={2} size={26} />
      <Glass x={14} y={20} w={50} h={58} rotate={-13} />
      <Glass x={23} y={17} w={50} h={58} rotate={-4} />
      <Glass x={32} y={20} w={50} h={58} rotate={6} className="flex flex-col justify-between p-[6%]">
        <span className="flex flex-col gap-[7%]">
          <span className="block aspect-square w-[18%] rounded-full bg-mist/30" />
          <Bar width="70%" />
          <Bar width="45%" className="bg-mist/20" />
        </span>
        <span className="flex flex-col gap-[6%]">
          <Bar width="55%" className="h-[9%] bg-mist/50" />
          <span className="flex h-[5%] min-h-1 gap-[4%]">
            <span className="flex-1 rounded-full" style={iriFill} />
            <span className="flex-1 rounded-full" style={iriFill} />
            <span className="flex-1 rounded-full bg-mist/20" />
            <span className="flex-1 rounded-full bg-mist/20" />
          </span>
        </span>
      </Glass>
      <Glass
        x={68}
        y={64}
        w={18}
        h={18}
        round="50%"
        float="fast"
        className="flex items-center justify-center"
      >
        <CheckIcon className="size-[45%] text-mist" />
      </Glass>
    </>
  )
}

/** Grant programs: a report with its evidence clipped on and a verified seal. */
function Grants() {
  return (
    <>
      <Orb colour="--iri-rose" x={2} y={48} size={52} />
      <Orb colour="--iri-periwinkle" x={52} y={6} size={46} />
      <Orb colour="--iri-mint" x={66} y={64} size={24} />
      <Glass x={58} y={20} w={26} h={30} rotate={9} className="flex items-start justify-end p-[3%]">
        <PaperclipIcon className="size-[34%] text-mist/80" />
      </Glass>
      <Glass x={20} y={12} w={50} h={72} rotate={-4} className="flex flex-col gap-[5%] p-[7%]">
        <Bar width="60%" className="h-[6%] bg-mist/55" />
        <Bar width="90%" />
        <Bar width="82%" />
        <Bar width="88%" />
        <Bar width="64%" />
        <span className="mt-auto flex items-center gap-[6%]">
          <span className="block aspect-[4/3] w-[30%] rounded-[12%] bg-mist/15" />
          <span className="flex flex-1 flex-col gap-[14%]">
            <Bar width="80%" className="h-[12%] bg-mist/30" />
            <Bar width="55%" className="h-[12%] bg-mist/20" />
          </span>
        </span>
      </Glass>
      <Glass
        x={56}
        y={58}
        w={22}
        h={22}
        round="50%"
        float="slow"
        className="flex items-center justify-center"
      >
        <ShieldCheckIcon className="size-[46%] text-mist" />
      </Glass>
    </>
  )
}

const ORBIT_NODES = [
  { radius: 40, angle: -35, size: 11 },
  { radius: 40, angle: 115, size: 9 },
  { radius: 40, angle: 210, size: 12 },
  { radius: 27, angle: 40, size: 8 },
  { radius: 27, angle: 250, size: 9 },
]

/** Ecosystem funds: builders orbiting a shared core of capital. */
function Ecosystems() {
  return (
    <>
      <Orb colour="--iri-mint" x={6} y={30} size={50} />
      <Orb colour="--iri-lilac" x={52} y={4} size={44} />
      <Orb colour="--iri-periwinkle" x={44} y={58} size={40} />
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        {[40, 27].map((r) => (
          <circle
            key={r}
            cx={50}
            cy={50}
            r={r}
            fill="none"
            style={{ stroke: 'color-mix(in srgb, var(--brand-mist) 32%, transparent)' }}
            strokeWidth={0.4}
          />
        ))}
      </svg>
      <span className="absolute inset-0 animate-[spin_80s_linear_infinite]">
        {ORBIT_NODES.map((node) => {
          const rad = (node.angle * Math.PI) / 180
          const x = 50 + node.radius * Math.cos(rad) - node.size / 2
          const y = 50 + node.radius * Math.sin(rad) - node.size / 2
          return (
            <Glass key={`${node.radius}-${node.angle}`} x={x} y={y} w={node.size} h={node.size} round="50%" />
          )
        })}
      </span>
      <Glass x={35} y={35} w={30} h={30} round="50%" className="flex items-center justify-center">
        <span className="block aspect-square w-[38%] rotate-45 rounded-[18%]" style={iriFill} />
      </Glass>
    </>
  )
}

const DONUT_CIRCUMFERENCE = 2 * Math.PI * 30

/** Budget shares as dash lengths and offsets around the donut. */
const DONUT = [
  { share: 0.46, colour: '--iri-lilac' },
  { share: 0.3, colour: '--iri-mint' },
  { share: 0.16, colour: '--iri-periwinkle' },
].map((segment, index, all) => ({
  ...segment,
  length: segment.share * DONUT_CIRCUMFERENCE,
  offset: all.slice(0, index).reduce((sum, previous) => sum + previous.share * DONUT_CIRCUMFERENCE, 0),
}))

/** Agencies & studios: one commitment split into budgets, with bills beside it. */
function Agencies() {
  return (
    <>
      <Orb colour="--iri-periwinkle" x={2} y={14} size={54} />
      <Orb colour="--iri-rose" x={56} y={36} size={36} />
      <Orb colour="--iri-mint" x={28} y={66} size={30} />
      <Glass x={8} y={18} w={56} h={56} round="50%">
        <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
          <circle
            cx={50}
            cy={50}
            r={30}
            fill="none"
            style={{ stroke: 'color-mix(in srgb, var(--brand-mist) 14%, transparent)' }}
            strokeWidth={9}
          />
          {DONUT.map((segment) => (
            <circle
              key={segment.colour}
              cx={50}
              cy={50}
              r={30}
              fill="none"
              style={{ stroke: `var(${segment.colour})` }}
              strokeWidth={9}
              strokeDasharray={`${segment.length - 1.5} ${DONUT_CIRCUMFERENCE}`}
              strokeDashoffset={-segment.offset}
              strokeLinecap="round"
            />
          ))}
        </svg>
      </Glass>
      <Glass x={58} y={22} w={34} h={15} round="22% / 48%" className="flex items-center gap-[8%] px-[6%]">
        <ReceiptIcon className="size-[44%] shrink-0 text-mist/80" />
        <span className="flex flex-1 flex-col gap-[16%]">
          <Bar width="85%" className="h-1.5" />
          <Bar width="55%" className="h-1.5 bg-mist/20" />
        </span>
      </Glass>
      <Glass x={62} y={42} w={32} h={15} round="22% / 48%" className="flex items-center gap-[8%] px-[6%]">
        <CheckIcon className="size-[40%] shrink-0 text-mist" />
        <span className="flex flex-1 flex-col gap-[16%]">
          <Bar width="80%" className="h-1.5" />
          <Bar width="50%" className="h-1.5 bg-mist/20" />
        </span>
      </Glass>
      <Glass x={62} y={66} w={14} h={14} round="50%" float="fast" />
    </>
  )
}

const TEAM = [
  { x: 10, y: 12 },
  { x: 74, y: 10 },
  { x: 8, y: 72 },
  { x: 76, y: 72 },
]

/** Distributed teams: contributors around one shared allowance. */
function Teams() {
  return (
    <>
      <Orb colour="--iri-lilac" x={30} y={20} size={50} />
      <Orb colour="--iri-mint" x={2} y={56} size={36} />
      <Orb colour="--iri-rose" x={62} y={0} size={30} />
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        {TEAM.map((person) => (
          <line
            key={`${person.x}-${person.y}`}
            x1={person.x + 8}
            y1={person.y + 8}
            x2={50}
            y2={51}
            style={{ stroke: 'color-mix(in srgb, var(--brand-mist) 30%, transparent)' }}
            strokeWidth={0.4}
            strokeDasharray="1.2 1.6"
          />
        ))}
      </svg>
      {TEAM.map((person, index) => (
        <Glass
          key={`${person.x}-${person.y}`}
          x={person.x}
          y={person.y}
          w={16}
          h={16}
          round="50%"
          float={index === 1 ? 'slow' : undefined}
          className="flex items-center justify-center"
        >
          <UserRoundIcon className="size-[46%] text-mist/85" />
        </Glass>
      ))}
      <Glass x={28} y={34} w={44} h={34} className="flex items-center gap-[8%] p-[7%]">
        <svg viewBox="0 0 40 40" className="aspect-square w-[42%] shrink-0 -rotate-90">
          <circle
            cx={20}
            cy={20}
            r={15}
            fill="none"
            style={{ stroke: 'color-mix(in srgb, var(--brand-mist) 18%, transparent)' }}
            strokeWidth={5}
          />
          <circle
            cx={20}
            cy={20}
            r={15}
            fill="none"
            style={{ stroke: 'var(--iri-mint)' }}
            strokeWidth={5}
            strokeLinecap="round"
            strokeDasharray={`${0.76 * 2 * Math.PI * 15} ${2 * Math.PI * 15}`}
          />
        </svg>
        <span className="flex flex-1 flex-col gap-[14%]">
          <Bar width="90%" className="h-1.5 bg-mist/50" />
          <Bar width="70%" className="h-1.5" />
          <Bar width="50%" className="h-1.5 bg-mist/20" />
        </span>
      </Glass>
    </>
  )
}

const figures: Record<GlassFigureId, () => ReactNode> = {
  studios: Studios,
  grants: Grants,
  ecosystems: Ecosystems,
  agencies: Agencies,
  teams: Teams,
}

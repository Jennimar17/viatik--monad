'use client'

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { formatUsd, type Cents } from '@/domain/money'
import { cn } from '@/lib/utils'

export type SeriesConfig = { key: string; label: string; color: string }[]

function toConfig(series: SeriesConfig): ChartConfig {
  return Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]))
}

// Chart values are integer cents; compact ticks are display-only.
const moneyTick = (value: number) => formatUsd(value as Cents, { compact: true })
const moneyTooltip = (value: unknown) => formatUsd(Number(value) as Cents, { withCode: true })

/** Tiny trend line for KPI tiles. */
export function Sparkline({
  data,
  color = 'var(--color-chart-2)',
  className,
}: {
  data: number[]
  color?: string
  className?: string
}) {
  const rows = data.map((value, index) => ({ index, value }))
  const gradientId = `spark-${Math.abs(data.reduce((acc, v) => acc * 31 + v, 7) | 0)}`
  return (
    <ChartContainer
      config={{ value: { label: 'Value', color } }}
      className={cn('aspect-auto h-10 w-full', className)}
    >
      <AreaChart data={rows} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          dataKey="value"
          type="monotone"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

/** Cumulative or monthly money over time. */
export function MoneyAreaChart({
  data,
  series,
  xKey = 'month',
  className,
  stacked = false,
}: {
  data: Record<string, number | string>[]
  series: SeriesConfig
  xKey?: string
  className?: string
  stacked?: boolean
}) {
  return (
    <ChartContainer config={toConfig(series)} className={cn('aspect-auto h-64 w-full', className)}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--color-${s.key})`} stopOpacity={0.3} />
              <stop offset="100%" stopColor={`var(--color-${s.key})`} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={moneyTick} fontSize={12} />
        <ChartTooltip
          cursor={{ stroke: 'var(--color-border)' }}
          content={
            <ChartTooltipContent
              formatter={(v, name) => <TooltipRow name={String(name)} value={v} series={series} />}
            />
          }
        />
        {series.map((s) => (
          <Area
            key={s.key}
            dataKey={s.key}
            type="monotone"
            stroke={`var(--color-${s.key})`}
            strokeWidth={1.75}
            fill={`url(#fill-${s.key})`}
            stackId={stacked ? 'a' : undefined}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  )
}

/** Stacked bars, e.g. spend by budget per month, or deployment per agency (horizontal). */
export function MoneyBarChart({
  data,
  series,
  xKey = 'month',
  className,
  layout = 'vertical-bars',
}: {
  data: Record<string, number | string>[]
  series: SeriesConfig
  xKey?: string
  className?: string
  layout?: 'vertical-bars' | 'horizontal-bars'
}) {
  const horizontal = layout === 'horizontal-bars'
  return (
    <ChartContainer config={toConfig(series)} className={cn('aspect-auto h-64 w-full', className)}>
      <BarChart
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: 8, bottom: 0, left: horizontal ? 8 : 0 }}
        barCategoryGap={horizontal ? 10 : '28%'}
      >
        <CartesianGrid
          vertical={horizontal}
          horizontal={!horizontal}
          strokeDasharray="3 3"
          stroke="var(--color-border)"
        />
        {horizontal ? (
          <>
            <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={moneyTick} fontSize={12} />
            <YAxis
              type="category"
              dataKey={xKey}
              tickLine={false}
              axisLine={false}
              width={104}
              fontSize={12}
            />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
            <YAxis tickLine={false} axisLine={false} width={52} tickFormatter={moneyTick} fontSize={12} />
          </>
        )}
        <ChartTooltip
          cursor={{ fill: 'var(--color-muted)', opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(v, name) => <TooltipRow name={String(name)} value={v} series={series} />}
            />
          }
        />
        {series.map((s, index) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={`var(--color-${s.key})`}
            radius={index === series.length - 1 ? (horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]) : 0}
            maxBarSize={horizontal ? 18 : 36}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

function TooltipRow({ name, value, series }: { name: string; value: unknown; series: SeriesConfig }) {
  const entry = series.find((s) => s.key === name)
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="size-2 rounded-[2px]" style={{ background: entry?.color }} />
        {entry?.label ?? name}
      </span>
      <span className="font-medium text-foreground num">{moneyTooltip(value)}</span>
    </div>
  )
}

/** Donut for composition, e.g. spend by category. */
export function MoneyDonut({
  data,
  className,
  centerLabel,
  centerValue,
}: {
  data: { key: string; label: string; value: number; color: string }[]
  className?: string
  centerLabel?: string
  centerValue?: string
}) {
  const config = Object.fromEntries(data.map((d) => [d.key, { label: d.label, color: d.color }]))
  const series = data.map((d) => ({ key: d.key, label: d.label, color: d.color }))
  return (
    <div className={cn('relative', className)}>
      <ChartContainer config={config} className="aspect-square h-44 w-full">
        <PieChart>
          <ChartTooltip
            content={
              <ChartTooltipContent
                hideLabel
                nameKey="key"
                formatter={(v, name) => <TooltipRow name={String(name)} value={v} series={series} />}
              />
            }
          />
          <Pie
            data={data}
            dataKey="value"
            nameKey="key"
            innerRadius="68%"
            outerRadius="100%"
            strokeWidth={2}
            stroke="var(--color-card)"
            paddingAngle={1}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={d.color} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-display text-xl font-medium num">{centerValue}</span>
          {centerLabel ? <span className="text-xs text-subtle">{centerLabel}</span> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Radial meter for allowances and caps (e.g. 120 of 500 this month). */
export function UsageRing({
  value,
  max,
  size = 132,
  label,
  className,
  children,
}: {
  value: number
  max: number
  size?: number
  label: string
  className?: string
  children?: React.ReactNode
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const tone = pct >= 90 ? 'var(--color-danger)' : pct >= 70 ? 'var(--color-warning)' : 'var(--color-sage)'
  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`${label}: ${Math.round(pct)}% used`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (pct / 100) * circumference}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  )
}

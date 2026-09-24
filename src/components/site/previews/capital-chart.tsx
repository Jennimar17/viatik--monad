'use client'

import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import { cn } from '@/lib/utils'

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { capitalHistoryDemo, spendingHistoryDemo } from '@/components/site/content/demo-data'

const capitalConfig = {
  released: { label: 'Released capital', color: 'var(--chart-1)' },
  portfolio: { label: 'Portfolio releases', color: 'var(--chart-1)' },
} satisfies ChartConfig

const spendingConfig = {
  team: { label: 'Team', color: 'var(--chart-1)' },
  tools: { label: 'Tools & services', color: 'var(--chart-2)' },
} satisfies ChartConfig

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

export function CapitalChart({
  compact = false,
  portfolio = false,
  className,
}: {
  compact?: boolean
  portfolio?: boolean
  className?: string
}) {
  const dataKey = portfolio ? 'portfolio' : 'released'

  return (
    <figure
      className={cn('min-w-0', className)}
      aria-label="Illustrative released capital, April to September"
    >
      <ChartContainer config={capitalConfig} className={cn('w-full text-sm', compact ? 'h-28' : 'h-44')}>
        <AreaChart
          accessibilityLayer
          data={capitalHistoryDemo}
          margin={{ top: 8, right: 6, left: 6, bottom: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--v-border)" strokeDasharray="3 5" />
          <XAxis
            dataKey="month"
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            tick={{ fontSize: 14, fill: 'var(--v-text-muted)' }}
          />
          <ChartTooltip
            cursor={{ stroke: 'var(--v-text-subtle)', strokeDasharray: '3 3' }}
            content={<ChartTooltipContent formatter={(value) => currency.format(Number(value))} />}
          />
          <Area
            dataKey={dataKey}
            type="monotone"
            stroke={`var(--color-${dataKey})`}
            fill={`var(--color-${dataKey})`}
            fillOpacity={0.08}
            strokeWidth={2}
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 3, stroke: 'var(--v-surface)' }}
          />
        </AreaChart>
      </ChartContainer>
      <figcaption className="sr-only">
        Fictional product data.{' '}
        {capitalHistoryDemo.map((point) => `${point.month}: ${currency.format(point[dataKey])}`).join('; ')}.
      </figcaption>
    </figure>
  )
}

export function SpendingChart() {
  return (
    <figure className="min-w-0" aria-label="Illustrative weekly team and tools spending">
      <ChartContainer config={spendingConfig} className="h-44 w-full text-sm">
        <BarChart
          accessibilityLayer
          data={spendingHistoryDemo}
          barSize={22}
          margin={{ top: 12, left: 0, right: 0 }}
        >
          <CartesianGrid vertical={false} stroke="var(--v-border)" strokeDasharray="3 5" />
          <XAxis
            dataKey="week"
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            tick={{ fontSize: 14, fill: 'var(--v-text-muted)' }}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                formatter={(value, name) =>
                  `${spendingConfig[name as keyof typeof spendingConfig]?.label ?? name}: ${currency.format(Number(value))}`
                }
              />
            }
          />
          <Bar
            dataKey="team"
            stackId="spend"
            fill="var(--color-team)"
            radius={[0, 0, 3, 3]}
            isAnimationActive={false}
          />
          <Bar
            dataKey="tools"
            stackId="spend"
            fill="var(--color-tools)"
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ChartContainer>
      <figcaption className="sr-only">
        Fictional product data.{' '}
        {spendingHistoryDemo
          .map(
            (point) =>
              `${point.week}: team ${currency.format(point.team)}, tools ${currency.format(point.tools)}`,
          )
          .join('; ')}
        .
      </figcaption>
    </figure>
  )
}

'use client'

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { spendingByWeek } from '@/components/site/content/product-demo'

const spendingConfig = {
  team: { label: 'Team', color: 'var(--chart-1)' },
  tools: { label: 'Tools & services', color: 'var(--chart-2)' },
} satisfies ChartConfig

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

/** Weekly spending stacked by team and tools, for the operators card. */
export function SpendingChart() {
  return (
    <figure className="min-w-0" aria-label="Weekly team and tools spending">
      <ChartContainer config={spendingConfig} className="h-44 w-full text-sm">
        <BarChart
          accessibilityLayer
          data={spendingByWeek}
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
        {spendingByWeek
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

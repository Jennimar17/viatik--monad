'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

type Pair = { label: string; text: string; surface: string; light?: boolean }

const pairs: Pair[] = [
  { label: 'Body text on canvas', text: 'text-foreground', surface: 'bg-canvas' },
  { label: 'Muted text on canvas', text: 'text-muted-foreground', surface: 'bg-canvas' },
  { label: 'Subtle text on canvas', text: 'text-subtle', surface: 'bg-canvas' },
  { label: 'Success on canvas', text: 'text-success', surface: 'bg-canvas' },
  { label: 'Warning on canvas', text: 'text-warning', surface: 'bg-canvas' },
  { label: 'Danger on canvas', text: 'text-danger', surface: 'bg-canvas' },
  { label: 'Info on canvas', text: 'text-info', surface: 'bg-canvas' },
  { label: 'Subtle text on card', text: 'text-subtle', surface: 'bg-card' },
  { label: 'Warning on card', text: 'text-warning', surface: 'bg-card' },
  { label: 'Danger on card', text: 'text-danger', surface: 'bg-card' },
  { label: 'Primary button label', text: 'text-primary-foreground', surface: 'bg-primary' },
  { label: 'Body text on paper', text: 'text-foreground', surface: 'bg-canvas', light: true },
  { label: 'Muted text on paper', text: 'text-muted-foreground', surface: 'bg-canvas', light: true },
  { label: 'Success on paper', text: 'text-success', surface: 'bg-canvas', light: true },
  { label: 'Warning on paper', text: 'text-warning', surface: 'bg-canvas', light: true },
  { label: 'Danger on paper', text: 'text-danger', surface: 'bg-canvas', light: true },
  { label: 'Info on paper', text: 'text-info', surface: 'bg-canvas', light: true },
]

/** Parses the computed color formats browsers return: rgb(), rgba() and color(srgb …). */
function parseColor(value: string): [number, number, number, number] | null {
  const numbers = value.match(/-?[\d.]+/g)?.map(Number)
  if (!numbers || numbers.length < 3) return null
  if (value.startsWith('color(srgb')) {
    const [r = 0, g = 0, b = 0, a = 1] = numbers
    return [r * 255, g * 255, b * 255, a]
  }
  const [r = 0, g = 0, b = 0, a = 1] = numbers
  return [r, g, b, a]
}

function luminance([r, g, b]: [number, number, number, number]) {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(foreground: string, background: string) {
  const fg = parseColor(foreground)
  const bg = parseColor(background)
  if (!fg || !bg) return null
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

/** WCAG contrast of every text/surface pair, measured from the live computed styles. */
export function ContrastTable() {
  const refs = React.useRef<(HTMLDivElement | null)[]>([])
  const [ratios, setRatios] = React.useState<(number | null)[]>([])

  React.useEffect(() => {
    setRatios(
      refs.current.map((cell) => {
        const text = cell?.querySelector('span')
        if (!cell || !text) return null
        return contrast(getComputedStyle(text).color, getComputedStyle(cell).backgroundColor)
      }),
    )
  }, [])

  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs text-subtle">
          <tr>
            <th className="px-4 py-2.5 font-medium">Pair</th>
            <th className="px-4 py-2.5 font-medium">Sample</th>
            <th className="px-4 py-2.5 text-right font-medium">Ratio</th>
            <th className="px-4 py-2.5 text-right font-medium">AA</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((pair, index) => {
            const ratio = ratios[index]
            const passes = ratio !== undefined && ratio !== null && ratio >= 4.5
            return (
              <tr key={pair.label} className="border-t border-border">
                <td className="px-4 py-2.5 text-muted-foreground">{pair.label}</td>
                <td className={cn('p-1.5', pair.light && 'theme-light')}>
                  <div
                    ref={(node) => {
                      refs.current[index] = node
                    }}
                    className={cn('rounded-md px-3 py-1.5', pair.surface)}
                  >
                    <span className={pair.text}>Viatik 25,000.00 USD</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right num">{ratio ? `${ratio.toFixed(2)}:1` : '…'}</td>
                <td
                  className={cn(
                    'px-4 py-2.5 text-right font-medium',
                    passes ? 'text-success' : 'text-danger',
                  )}
                >
                  {ratio ? (passes ? 'Pass' : 'Fail') : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

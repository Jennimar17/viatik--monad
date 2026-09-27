'use client'

import * as React from 'react'

import { encodeQr } from '@/lib/qr'
import { cn } from '@/lib/utils'

const QUIET_ZONE = 4

/** A scannable QR code on paper, e.g. a deposit address. */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const path = React.useMemo(() => {
    const modules = encodeQr(value)
    let d = ''
    modules.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`
      })
    })
    return { d, size: modules.length + QUIET_ZONE * 2 }
  }, [value])
  return (
    <svg
      viewBox={`0 0 ${path.size} ${path.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      className={cn('size-40 shrink-0 rounded-lg', className)}
    >
      <rect width={path.size} height={path.size} fill="var(--brand-paper)" />
      <path d={path.d} fill="var(--brand-plum)" />
    </svg>
  )
}

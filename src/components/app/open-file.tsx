'use client'

import * as React from 'react'

import { useEvidenceFiles } from '@/data/react'
import type { Evidence } from '@/domain/types'
import { cn } from '@/lib/utils'

/**
 * A stored evidence file (a receipt, bill or milestone document) that opens
 * in a new tab. Files without a stored copy, like the examples in the demo
 * story, show as plain text.
 */
export function OpenFileButton({
  evidence,
  className,
  children,
}: {
  evidence: Evidence
  className?: string
  /** Visible text instead of the file name (the name stays in the accessible label). */
  children?: React.ReactNode
}) {
  const { canOpen, open } = useEvidenceFiles()
  const [opening, setOpening] = React.useState(false)
  if (!canOpen(evidence)) {
    return children ? null : <span className={cn('truncate', className)}>{evidence.name}</span>
  }
  return (
    <button
      type="button"
      aria-label={children ? `${String(children)}: ${evidence.name}` : `Open ${evidence.name}`}
      aria-busy={opening || undefined}
      disabled={opening}
      onClick={async () => {
        setOpening(true)
        await open(evidence.id)
        setOpening(false)
      }}
      className={cn(
        'truncate text-left underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60',
        className,
      )}
    >
      {children ?? evidence.name}
    </button>
  )
}

/** A list of attachments by name; stored files open on click. */
export function AttachmentNames({ items }: { items: Evidence[] }) {
  if (items.length === 0) return <>None</>
  return (
    <span className="inline-flex flex-wrap gap-x-1">
      {items.map((item, index) => (
        <span key={item.id} className="min-w-0">
          {item.kind === 'file' ? <OpenFileButton evidence={item} /> : item.name}
          {index < items.length - 1 ? ',' : ''}
        </span>
      ))}
    </span>
  )
}

'use client'

import { Check, FileText, Link2, Paperclip, Upload, X } from 'lucide-react'
import * as React from 'react'

import { formatUsd, parseUsdInput, toInputString, type Cents } from '@/domain/money'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Pill input that edits integer cents. Never produces a float. */
export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = '0.00',
  invalid,
  disabled,
  available,
  className,
  autoFocus,
  'aria-describedby': describedBy,
}: {
  value: Cents | null
  onChange: (value: Cents | null) => void
  id?: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  /** Shown under the input, e.g. what the budget still allows. */
  available?: Cents
  className?: string
  autoFocus?: boolean
  'aria-describedby'?: string
}) {
  const [text, setText] = React.useState(value !== null ? toInputString(value) : '')
  // When the parent changes the value (e.g. "Use maximum"), show it, unless
  // the typed text already means the same amount.
  const [synced, setSynced] = React.useState(value)
  if (value !== synced) {
    setSynced(value)
    if (parseUsdInput(text) !== value) setText(value !== null ? toInputString(value) : '')
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        className={cn(
          'flex h-12 items-center gap-2 rounded-full border border-input bg-input/30 px-5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40',
          invalid && 'border-destructive ring-3 ring-destructive/20',
          disabled && 'opacity-50',
        )}
      >
        <span className="text-lg text-subtle" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          placeholder={placeholder}
          value={text}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d.,]/g, '')
            setText(next)
            const parsed = next === '' ? null : parseUsdInput(next)
            setSynced(parsed)
            onChange(parsed)
          }}
          onBlur={() => {
            const parsed = parseUsdInput(text)
            if (parsed !== null) setText(toInputString(parsed))
          }}
          className="min-w-0 flex-1 bg-transparent font-display text-xl tracking-tight num outline-none placeholder:text-subtle/60"
        />
        <span className="text-sm text-subtle">USD</span>
      </div>
      {available !== undefined ? (
        <p className="px-5 text-xs text-subtle">
          <span className="text-foreground num">{formatUsd(available, { withCode: true })}</span> available
        </p>
      ) : null}
    </div>
  )
}

export type DraftFile = {
  kind: 'file' | 'link' | 'note'
  name: string
  url?: string
  mimeType?: string
  sizeBytes?: number
}

/**
 * Evidence and receipt upload: drag and drop, browse, or add a link. Files
 * stay private in the product; only their fingerprints are recorded onchain.
 */
export function EvidenceUploader({
  files,
  onChange,
  allowLinks = true,
  accept = 'application/pdf,image/*',
  label = 'Drop files here or browse',
  hint = 'PDF or images, up to 10 MB each. Files stay private — only a fingerprint is recorded.',
  className,
}: {
  files: DraftFile[]
  onChange: (files: DraftFile[]) => void
  allowLinks?: boolean
  accept?: string
  label?: string
  hint?: string
  className?: string
}) {
  const hintId = React.useId()
  const [dragging, setDragging] = React.useState(false)
  const [link, setLink] = React.useState('')

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const next = Array.from(list).map((file) => ({
      kind: 'file' as const,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }))
    onChange([...files, ...next])
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* The label is the drop zone: clicking it opens the picker and the
          (visually hidden) file input keeps native keyboard and screen-reader support. */}
      <label
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          addFiles(event.dataTransfer.files)
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-8 text-center transition-colors hover:border-foreground/40 hover:bg-muted/30 focus-within:ring-2 focus-within:ring-ring',
          dragging && 'border-foreground/60 bg-muted/40',
        )}
      >
        <Upload className="size-5 text-subtle" aria-hidden="true" />
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span id={hintId} className="block max-w-sm text-xs text-pretty text-subtle">
          {hint}
        </span>
        <input
          type="file"
          multiple
          accept={accept}
          aria-describedby={hintId}
          className="sr-only"
          onChange={(event) => addFiles(event.target.files)}
        />
      </label>

      {allowLinks ? (
        <div className="flex gap-2">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-full border border-input bg-input/30 px-4 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40">
            <Link2 className="size-4 text-subtle" aria-hidden="true" />
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://… (demo, build, or document link)"
              aria-label="Evidence link"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle/70"
            />
          </div>
          <button
            type="button"
            disabled={!/^https?:\/\/\S+\.\S+/.test(link)}
            onClick={() => {
              onChange([...files, { kind: 'link', name: link.replace(/^https?:\/\//, ''), url: link }])
              setLink('')
            }}
            className="h-10 rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            Add link
          </button>
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-4 py-2.5">
              {file.kind === 'link' ? (
                <Link2 className="size-4 shrink-0 text-subtle" />
              ) : file.kind === 'note' ? (
                <Paperclip className="size-4 shrink-0 text-subtle" />
              ) : (
                <FileText className="size-4 shrink-0 text-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
              {file.sizeBytes ? (
                <span className="text-xs text-subtle">{formatBytes(file.sizeBytes)}</span>
              ) : null}
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                className="inline-flex size-7 items-center justify-center rounded-full text-subtle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Wizard progress: numbered steps with labels; collapses to "Step 2 of 5" on phones. */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: string[]
  current: number
  className?: string
}) {
  return (
    <nav aria-label="Progress" className={cn('w-full', className)}>
      <p className="text-sm text-muted-foreground sm:hidden">
        Step {current + 1} of {steps.length} · <span className="text-foreground">{steps[current]}</span>
      </p>
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((step, index) => {
          const done = index < current
          const active = index === current
          return (
            <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs',
                  done && 'border-mist bg-mist text-primary-foreground',
                  active && 'border-mist text-foreground',
                  !done && !active && 'border-border text-subtle',
                )}
                aria-current={active ? 'step' : undefined}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className={cn('truncate text-sm', active ? 'text-foreground' : 'text-subtle')}>
                {step}
              </span>
              {index < steps.length - 1 ? (
                <span
                  className={cn('h-px min-w-4 flex-1', done ? 'bg-mist/50' : 'bg-border')}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/** Large selectable card for templates and release models (use inside a `role="radiogroup"`). */
export function ChoiceCard({
  selected,
  onSelect,
  title,
  description,
  icon,
  className,
  disabled,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  description?: string
  icon?: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'relative flex min-h-24 flex-col items-start gap-1.5 rounded-xl border p-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
        selected
          ? 'border-mist bg-mist/[0.07]'
          : 'border-border hover:border-foreground/30 hover:bg-muted/30',
        className,
      )}
    >
      {icon ? <span className="mb-1 text-subtle [&_svg]:size-5">{icon}</span> : null}
      <span className="text-sm font-medium text-foreground">{title}</span>
      {description ? <span className="text-xs text-pretty text-muted-foreground">{description}</span> : null}
      {selected ? (
        <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-mist text-primary-foreground">
          <Check className="size-3" />
        </span>
      ) : null}
    </button>
  )
}

/** Sticky action bar at the bottom of long forms (full width on phones). */
export function FormActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'glass-chrome sticky bottom-0 z-20 -mx-4 mt-2 flex flex-col-reverse gap-2 border-t px-4 py-3 sm:mx-0 sm:flex-row sm:items-center sm:justify-end sm:rounded-full sm:border sm:px-3 sm:py-2',
        className,
      )}
    >
      {children}
    </div>
  )
}

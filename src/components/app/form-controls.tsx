'use client'

import * as React from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type Option = { value: string; label: string; description?: string }

/**
 * Pill select that shows the chosen option's label. With nothing to choose it
 * is disabled and says so (`empty`), instead of opening an empty list.
 */
export function SimpleSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Choose…',
  empty = 'Nothing to choose yet',
  invalid,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: string | null
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  /** Shown instead of the placeholder when there are no options. */
  empty?: string
  invalid?: boolean
  className?: string
  disabled?: boolean
  /** Name for selects without a visible label, e.g. a toolbar filter. */
  'aria-label'?: string
}) {
  const none = options.length === 0
  const prompt = none ? empty : placeholder
  return (
    <Select
      value={value}
      onValueChange={(next) => next !== null && onValueChange(String(next))}
      items={options}
      disabled={disabled || none}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full min-w-0 bg-input/30 px-5 data-placeholder:text-subtle data-[size=default]:h-11',
          className,
        )}
      >
        <SelectValue placeholder={prompt} className="min-w-0 truncate">
          {(selected: string | null) => options.find((o) => o.value === selected)?.label ?? prompt}
        </SelectValue>
      </SelectTrigger>
      {none ? null : (
        <SelectContent className="max-h-80 rounded-xl p-1">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="rounded-lg py-2">
              <span className="flex flex-col">
                <span>{option.label}</span>
                {option.description ? (
                  <span className="text-xs text-subtle">{option.description}</span>
                ) : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      )}
    </Select>
  )
}

/**
 * A choice among things that can appear or disappear while the form is open
 * (an account created inline, another tab's change): until the person picks
 * one it follows `fallback`, and a pick that no longer exists is dropped.
 */
export function useChoice(
  available: readonly string[],
  fallback: string | null | undefined,
): [string | null, (value: string) => void] {
  const [picked, setPicked] = React.useState<string | null>(null)
  const value = picked !== null && available.includes(picked) ? picked : (fallback ?? null)
  return [value, setPicked]
}

/** Label, control and hint or error, stacked. */
export function FormField({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
  optional,
}: {
  label: string
  htmlFor?: string
  hint?: React.ReactNode
  error?: string
  children: React.ReactNode
  className?: string
  optional?: boolean
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-2', className)} data-invalid={error ? true : undefined}>
      <Label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional ? <span className="font-normal text-subtle"> (optional)</span> : null}
      </Label>
      {children}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-pretty text-subtle">{hint}</p>
      ) : null}
    </div>
  )
}

/** Form-height pill input (the base input is the compact toolbar size). */
export function PillInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  return <Input className={cn('h-11 bg-input/30 px-5', className)} {...props} />
}

/** Multi-select as toggle chips (categories, destinations). */
export function ChipSelect({
  options,
  value,
  onChange,
  className,
  ariaLabel,
}: {
  options: Option[]
  value: string[]
  onChange: (value: string[]) => void
  className?: string
  ariaLabel: string
}) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value.includes(option.value)
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() =>
              onChange(active ? value.filter((v) => v !== option.value) : [...value, option.value])
            }
            className={cn(
              'h-9 rounded-full border px-3.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active
                ? 'border-mist bg-mist/10 text-foreground'
                : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

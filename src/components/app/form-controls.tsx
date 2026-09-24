'use client'

import type * as React from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type Option = { value: string; label: string; description?: string }

/** Pill select that shows the chosen option's label. */
export function SimpleSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = 'Choose…',
  invalid,
  className,
  disabled,
}: {
  id?: string
  value: string | null
  onValueChange: (value: string) => void
  options: Option[]
  placeholder?: string
  invalid?: boolean
  className?: string
  disabled?: boolean
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => next !== null && onValueChange(String(next))}
      items={options}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-11 w-full min-w-0 bg-input/30 px-5 data-placeholder:text-subtle data-[size=default]:h-11',
          className,
        )}
      >
        <SelectValue placeholder={placeholder} className="min-w-0 truncate">
          {(selected: string | null) => options.find((o) => o.value === selected)?.label ?? placeholder}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-80 rounded-xl p-1">
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} className="rounded-lg py-2">
            <span className="flex flex-col">
              <span>{option.label}</span>
              {option.description ? <span className="text-xs text-subtle">{option.description}</span> : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
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

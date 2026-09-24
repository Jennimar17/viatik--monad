'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { joinWaitlist } from '@/app/(site)/actions'
import { waitlist } from '@/components/site/content/landing-content'

type Errors = Partial<Record<'email' | 'organization' | 'role', string>>

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function WaitlistDialog({ triggerLabel }: { triggerLabel: string }) {
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [role, setRole] = useState<string | null>(null)
  const successHeadingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (submitted) successHeadingRef.current?.focus()
  }, [submitted])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setSubmitted(false)
      setErrors({})
      setRole(null)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const organization = String(data.get('organization') ?? '').trim()

    const nextErrors: Errors = {}
    if (!EMAIL_PATTERN.test(email)) nextErrors.email = 'Enter a valid work email address.'
    if (!organization) nextErrors.organization = 'Enter the name of your organization.'
    if (!role) nextErrors.role = 'Choose the option that describes you.'
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    // Validated again on the server; it is stored once the backend lands. The
    // confirmation shows right away, as in the original landing.
    void joinWaitlist({ email, organization, role })
    setSubmitted(true)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="pill" />}>{triggerLabel}</DialogTrigger>

      <DialogContent className="gap-6 border border-border bg-card p-6 text-base ring-0 sm:max-w-md sm:p-8">
        {submitted ? (
          <div className="flex animate-in flex-col gap-6 duration-300 fade-in-0 zoom-in-95" role="status">
            <span
              aria-hidden="true"
              className="flex size-11 items-center justify-center rounded-full border border-success/40 bg-success/10 text-success"
            >
              <CheckIcon className="size-5" />
            </span>
            <DialogHeader>
              <DialogTitle
                ref={successHeadingRef}
                tabIndex={-1}
                className="font-display text-2xl leading-tight font-medium outline-none"
              >
                {waitlist.success.title}
              </DialogTitle>
              <DialogDescription className="text-base text-pretty">
                {waitlist.success.message}
              </DialogDescription>
            </DialogHeader>
            <div>
              <DialogClose render={<Button variant="secondary" size="pill" />}>Done</DialogClose>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader className="pr-10">
              <DialogTitle className="font-display text-2xl leading-tight font-medium">
                {waitlist.title}
              </DialogTitle>
              <DialogDescription className="text-base text-pretty">{waitlist.description}</DialogDescription>
            </DialogHeader>

            <p className="rounded-xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
              Product preview only. This form does not send or save early-access requests.
            </p>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
              <FieldGroup>
                <Field data-invalid={errors.email ? true : undefined}>
                  <FieldLabel htmlFor="waitlist-email">{waitlist.fields.email}</FieldLabel>
                  <Input
                    id="waitlist-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    required
                    aria-invalid={errors.email ? true : undefined}
                    aria-describedby={errors.email ? 'waitlist-email-error' : undefined}
                    className="h-11 rounded-full px-4 text-base"
                  />
                  <FieldError id="waitlist-email-error">{errors.email}</FieldError>
                </Field>

                <Field data-invalid={errors.organization ? true : undefined}>
                  <FieldLabel htmlFor="waitlist-organization">{waitlist.fields.organization}</FieldLabel>
                  <Input
                    id="waitlist-organization"
                    name="organization"
                    type="text"
                    autoComplete="organization"
                    required
                    aria-invalid={errors.organization ? true : undefined}
                    aria-describedby={errors.organization ? 'waitlist-organization-error' : undefined}
                    className="h-11 rounded-full px-4 text-base"
                  />
                  <FieldError id="waitlist-organization-error">{errors.organization}</FieldError>
                </Field>

                <FieldSet data-invalid={errors.role ? true : undefined} className="gap-2">
                  <FieldLegend variant="label">{waitlist.fields.role}</FieldLegend>
                  <RadioGroup
                    name="role"
                    value={role}
                    onValueChange={(value) => setRole(String(value))}
                    aria-describedby={errors.role ? 'waitlist-role-error' : undefined}
                    className="flex flex-wrap gap-2"
                  >
                    {waitlist.roleOptions.map((option) => (
                      <FieldLabel
                        key={option.value}
                        htmlFor={`waitlist-role-${option.value}`}
                        className="inline-flex h-11 cursor-pointer items-center gap-2.5 rounded-full border border-border px-4 text-sm font-medium text-foreground transition-colors hover:border-subtle has-data-checked:border-violet has-data-checked:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                      >
                        <RadioGroupItem id={`waitlist-role-${option.value}`} value={option.value} />
                        {option.label}
                      </FieldLabel>
                    ))}
                  </RadioGroup>
                  <FieldError id="waitlist-role-error">{errors.role}</FieldError>
                </FieldSet>
              </FieldGroup>

              <Button type="submit" size="pill" className="w-full sm:w-auto sm:self-start">
                {waitlist.submit}
              </Button>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

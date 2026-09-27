'use client'

import { CircleCheck } from 'lucide-react'
import { AppLink as Link } from '@/components/viatik/app-link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FormActions } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { useCommand } from '@/data/react'
import { agencyTypeLabel } from '@/domain/labels'
import type { AgencyType } from '@/domain/types'
import { timeZoneOptions } from '@/lib/time-zones'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TYPE_OPTIONS = (Object.keys(agencyTypeLabel) as AgencyType[]).map((type) => ({
  value: type,
  label: agencyTypeLabel[type],
}))

export default function NewAgencyPage() {
  const { portfolioId } = useRole()
  const href = useHref()
  const router = useRouter()
  const create = useCommand('createAgency', { silent: true })
  const [name, setName] = React.useState('')
  const [type, setType] = React.useState<AgencyType>('startup')
  const [description, setDescription] = React.useState('')
  const [website, setWebsite] = React.useState('')
  const [timeZone, setTimeZone] = React.useState('America/New_York')
  const [adminName, setAdminName] = React.useState('')
  const [adminEmail, setAdminEmail] = React.useState('')
  const [touched, setTouched] = React.useState(false)
  const [createdId, setCreatedId] = React.useState<string | null>(null)
  useBottomBar(!createdId)

  const errors = {
    name: name.trim().length < 2 ? 'Enter the Agency name.' : undefined,
    description: description.trim().length < 5 ? 'Describe what the Agency does.' : undefined,
    adminName: adminName.trim().length < 2 ? 'Enter the Agency Admin’s name.' : undefined,
    adminEmail: EMAIL.test(adminEmail.trim()) ? undefined : 'Enter a valid email address.',
  }
  const valid = !Object.values(errors).some(Boolean)
  const busy = create.phase !== 'idle' && create.phase !== 'failed' && create.phase !== 'completed'
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  const submit = async () => {
    setTouched(true)
    if (!valid) return
    const agency = await create.run({
      portfolioId,
      name: name.trim(),
      type,
      description: description.trim(),
      website: website.trim() || undefined,
      timeZone,
      admin: { name: adminName.trim(), email: adminEmail.trim() },
    })
    if (agency) setCreatedId(agency.id)
  }

  if (createdId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
        <div className="flex items-center gap-3">
          <CircleCheck className="size-7 shrink-0 text-success" aria-hidden="true" />
          <h1 className="font-display text-3xl font-medium tracking-tight">{name.trim()} created</h1>
        </div>
        <p className="text-pretty text-muted-foreground">
          {adminName.trim()} was invited to become the Agency Admin. Next, define how capital should be
          released with a funding agreement.
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={href(`funding/new?agency=${createdId}`)} size="pill">
            Create funding agreement
          </ButtonLink>
          <ButtonLink href={href(`agencies/${createdId}`)} variant="outline" size="pill">
            View Agency
          </ButtonLink>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('agencies')} className="hover:text-foreground">
            Agencies
          </Link>
        }
        title="Create Agency"
        description="Add a team, startup, studio or project you want to fund."
      />

      <Panel title="About the Agency">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Agency name" htmlFor="agency-name" error={shown('name')}>
            <PillInput
              id="agency-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(shown('name')) || undefined}
            />
          </FormField>
          <FormField label="Type" htmlFor="agency-type">
            <SimpleSelect
              id="agency-type"
              value={type}
              onValueChange={(value) => setType(value as AgencyType)}
              options={TYPE_OPTIONS}
            />
          </FormField>
          <FormField
            label="What does it do?"
            htmlFor="agency-description"
            error={shown('description')}
            className="sm:col-span-2"
          >
            <Textarea
              id="agency-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-20 rounded-xl"
              aria-invalid={Boolean(shown('description')) || undefined}
            />
          </FormField>
          <FormField label="Website" htmlFor="agency-website" optional>
            <PillInput
              id="agency-website"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://"
            />
          </FormField>
          <FormField label="Time zone" htmlFor="agency-tz">
            <SimpleSelect
              id="agency-tz"
              value={timeZone}
              onValueChange={setTimeZone}
              options={timeZoneOptions(timeZone)}
            />
          </FormField>
        </div>
      </Panel>

      <Panel
        title="Agency Admin"
        description="The person who will operate the Agency: accounts, budgets, payments and evidence."
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Full name" htmlFor="admin-name" error={shown('adminName')}>
            <PillInput
              id="admin-name"
              value={adminName}
              onChange={(e) => setAdminName(e.target.value)}
              autoComplete="off"
              aria-invalid={Boolean(shown('adminName')) || undefined}
            />
          </FormField>
          <FormField label="Work email" htmlFor="admin-email" error={shown('adminEmail')}>
            <PillInput
              id="admin-email"
              type="email"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              autoComplete="off"
              aria-invalid={Boolean(shown('adminEmail')) || undefined}
            />
          </FormField>
        </div>
      </Panel>

      {create.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={create.phase} error={create.error} />
        </Panel>
      ) : null}

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('agencies'))} disabled={busy}>
          Cancel
        </Button>
        <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create Agency'}
        </Button>
      </FormActions>
    </div>
  )
}

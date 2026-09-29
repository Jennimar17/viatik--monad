'use client'

import { CalendarClock, Flag, Hand, Plus, Repeat, Trash2 } from 'lucide-react'
import Link from '@/components/viatik/link'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { ChipSelect, FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Amount } from '@/components/viatik/amount'
import { ChoiceCard, FormActions, MoneyInput, Stepper } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { PolicySummary } from '@/components/viatik/policy'
import { useCommand, useViatikState } from '@/data/react'
import type { TrancheDraft } from '@/domain/engine/funding'
import { categoryLabel, releaseModelLabel } from '@/domain/labels'
import { formatUsd, splitEvenly, sum, usd, ZERO, type Cents } from '@/domain/money'
import { joinList } from '@/domain/policy'
import type { ReleaseModel, SpendingCategory, SpendingPolicy } from '@/domain/types'
import { formatDate, fromDateInput } from '@/lib/format'
import { cn } from '@/lib/utils'

const STEPS = ['Agency', 'Commitment', 'Tranches', 'Policy', 'Review']
const DAY = 86_400_000
const MILESTONE_NAMES = ['Kickoff and plan', 'Prototype', 'Beta', 'Launch', 'Growth']

const modelIcons: Record<ReleaseModel, React.ReactNode> = {
  milestone: <Flag />,
  scheduled: <CalendarClock />,
  manual: <Hand />,
  recurring: <Repeat />,
}

const CATEGORY_OPTIONS = (Object.keys(categoryLabel) as SpendingCategory[]).map((category) => ({
  value: category,
  label: categoryLabel[category],
}))

const CADENCE_OPTIONS: { value: SpendingPolicy['reportingCadence']; label: string }[] = [
  { value: 'per_milestone', label: 'Per milestone' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
]

type TrancheRow = {
  key: string
  name: string
  amount: Cents | null
  title: string
  description: string
  criteria: string
  due: string
}

export default function NewAgreementPage() {
  // useSearchParams needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <NewAgreement />
    </React.Suspense>
  )
}

function NewAgreement() {
  const { state, now } = useViatikState()
  const { portfolioId } = useRole()
  const href = useHref()
  const router = useRouter()
  const params = useSearchParams()
  const create = useCommand('createAgreement', { silent: true })
  const agencies = state.agencies.filter((a) => a.portfolioId === portfolioId)
  const hasAgreement = (agencyId: string) =>
    state.agreements.some((g) => g.agencyId === agencyId && g.status !== 'cancelled')
  const day = (offset: number) => new Date(new Date(now).getTime() + offset * DAY).toISOString().slice(0, 10)

  const [step, setStep] = React.useState(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [createdId, setCreatedId] = React.useState<string | null>(null)
  const [agencyId, setAgencyId] = React.useState<string | null>(
    params.get('agency') ?? agencies.find((a) => !hasAgreement(a.id))?.id ?? agencies[0]?.id ?? null,
  )
  const [title, setTitle] = React.useState('Growth program')
  const [purpose, setPurpose] = React.useState('')
  const [start, setStart] = React.useState(day(7))
  const [end, setEnd] = React.useState(day(365))
  const [committed, setCommitted] = React.useState<Cents | null>(usd(80_000))
  const [model, setModel] = React.useState<ReleaseModel>('milestone')
  const [rows, setRows] = React.useState<TrancheRow[]>([])
  // Row keys come from a counter, so adding and removing rows never reuses one.
  const [keySeed, setKeySeed] = React.useState(0)
  const [categories, setCategories] = React.useState<SpendingCategory[]>([
    'team',
    'contractors',
    'software',
    'cloud',
  ])
  const [exception, setException] = React.useState<Cents | null>(usd(10_000))
  const [cadence, setCadence] = React.useState<SpendingPolicy['reportingCadence']>('per_milestone')
  const [returns, setReturns] = React.useState(
    'Unreleased capital returns to the Portfolio Vault if the agreement is cancelled or expires.',
  )
  const [evidence, setEvidence] = React.useState(
    'Each milestone needs a written summary, a demo link or build, and supporting documents.',
  )
  useBottomBar(!createdId)

  const agency = agencies.find((a) => a.id === agencyId)
  const total = sum(rows, (r) => r.amount ?? ZERO)
  const startAt = fromDateInput(start)
  const endAt = fromDateInput(end)
  const busy = create.phase !== 'idle' && create.phase !== 'failed' && create.phase !== 'completed'

  const updateRow = (key: string, patch: Partial<TrancheRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)))

  const newRow = (key: number, index: number, amount: Cents | null): TrancheRow => ({
    key: `t${key}`,
    name: `Tranche ${index + 1}`,
    amount,
    title: MILESTONE_NAMES[index] ?? `Milestone ${index + 1}`,
    description: '',
    criteria: '',
    due: day(30 + index * 75),
  })

  const splitInto = (count: number) => {
    const amounts: (Cents | null)[] = committed
      ? splitEvenly(committed, count)
      : Array.from({ length: count }, () => null)
    setRows(amounts.map((amount, i) => newRow(keySeed + i, i, amount)))
    setKeySeed(keySeed + amounts.length)
  }

  const validate = (index: number) => {
    const next: Record<string, string> = {}
    if (index === 0) {
      if (!agencyId) next.agency = 'Choose an Agency.'
      if (title.trim().length < 3) next.title = 'Name the agreement.'
      if (purpose.trim().length < 5) next.purpose = 'Describe what the funding is for.'
      if (!startAt) next.start = 'Pick a start date.'
      if (!endAt || !startAt || endAt <= startAt) next.end = 'The end date must be after the start date.'
    }
    if (index === 1 && (!committed || committed <= 0)) next.committed = 'Enter the total commitment.'
    if (index === 2) {
      if (rows.length === 0) next.rows = 'Add at least one tranche.'
      else if (total !== committed) {
        next.rows = `Tranches add up to ${formatUsd(total, { withCode: true })} but the commitment is ${formatUsd(committed ?? ZERO, { withCode: true })}.`
      }
      for (const row of rows) {
        if (!row.amount) next[`amount-${row.key}`] = 'Enter an amount.'
        if (!fromDateInput(row.due)) next[`due-${row.key}`] = 'Pick a date.'
        if (model === 'milestone' && row.title.trim().length < 3)
          next[`title-${row.key}`] = 'Name the milestone.'
      }
    }
    if (index === 3) {
      if (categories.length === 0) next.categories = 'Choose at least one approved use.'
      if (!exception || exception <= 0) next.exception = 'Set an exception threshold.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const next = () => {
    if (!validate(step)) return
    if (step === 1 && rows.length === 0) splitInto(model === 'recurring' ? 6 : 4)
    setStep(step + 1)
  }

  const submit = async () => {
    if (!agencyId || !committed || !exception || !startAt || !endAt) return
    const tranches: TrancheDraft[] = rows.map((row) => ({
      name: row.name.trim(),
      amount: row.amount ?? ZERO,
      releaseCondition: model === 'milestone' ? 'milestone' : model === 'manual' ? 'manual' : 'scheduled',
      scheduledFor: model === 'scheduled' || model === 'recurring' ? fromDateInput(row.due) : undefined,
      milestone:
        model === 'milestone'
          ? {
              title: row.title.trim(),
              description: row.description.trim(),
              acceptanceCriteria: row.criteria
                .split('\n')
                .map((c) => c.trim())
                .filter(Boolean),
              dueDate: fromDateInput(row.due) ?? endAt,
            }
          : undefined,
    }))
    const agreement = await create.run({
      portfolioId,
      agencyId,
      title: title.trim(),
      purpose: purpose.trim(),
      committed,
      releaseModel: model,
      startDate: startAt,
      endDate: endAt,
      tranches,
      spendingPolicy: {
        allowedCategories: categories,
        exceptionThreshold: exception,
        reportingCadence: cadence,
        returnConditions: returns.trim(),
      },
      evidenceRequirements: evidence.trim(),
    })
    if (agreement) setCreatedId(agreement.id)
  }

  if (createdId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
        <PageHeader
          title="Agreement created"
          description={`${agency?.name ?? 'The Agency'} was asked to accept ${title.trim()}. Fund the agreement so tranches can be released once it is accepted.`}
        />
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={href(`funding/${createdId}`)} size="pill">
            Open agreement
          </ButtonLink>
          <ButtonLink href={href('vaults/add-funds')} variant="outline" size="pill">
            Add funds
          </ButtonLink>
          <ButtonLink href={href('funding')} variant="ghost" size="pill">
            All agreements
          </ButtonLink>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('funding')} className="hover:text-foreground">
            Funding
          </Link>
        }
        title="Create funding agreement"
        description="Define the commitment, how it is released, and the operating boundaries. This is an operational funding policy, not a legal equity or debt agreement."
      />
      <Stepper steps={STEPS} current={step} />

      {step === 0 ? (
        <Panel title="Agency and purpose">
          {agencies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create an Agency first.{' '}
              <ButtonLink href={href('agencies/new')} variant="link" size="sm" className="h-auto px-0">
                Create Agency
              </ButtonLink>
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Agency" htmlFor="agreement-agency" error={errors.agency}>
                <SimpleSelect
                  id="agreement-agency"
                  value={agencyId}
                  onValueChange={setAgencyId}
                  options={agencies.map((a) => ({
                    value: a.id,
                    label: a.name,
                    description: hasAgreement(a.id) ? 'Has an agreement' : 'No agreement yet',
                  }))}
                />
              </FormField>
              <FormField label="Agreement name" htmlFor="agreement-title" error={errors.title}>
                <PillInput id="agreement-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </FormField>
              <FormField
                label="Purpose"
                htmlFor="agreement-purpose"
                error={errors.purpose}
                className="sm:col-span-2"
              >
                <Textarea
                  id="agreement-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="min-h-20 rounded-xl"
                  placeholder="What will this capital make possible?"
                />
              </FormField>
              <FormField label="Start date" htmlFor="agreement-start" error={errors.start}>
                <PillInput
                  id="agreement-start"
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </FormField>
              <FormField label="End date" htmlFor="agreement-end" error={errors.end}>
                <PillInput
                  id="agreement-end"
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </FormField>
            </div>
          )}
        </Panel>
      ) : null}

      {step === 1 ? (
        <Panel title="Commitment and release model">
          <div className="flex flex-col gap-6">
            <FormField
              label="Total commitment"
              htmlFor="agreement-committed"
              error={errors.committed}
              hint="Promised under this agreement. You fund it separately, as needed."
            >
              <MoneyInput
                id="agreement-committed"
                value={committed}
                onChange={(value) => {
                  setCommitted(value)
                  setRows([])
                }}
                invalid={Boolean(errors.committed)}
              />
            </FormField>
            <div
              role="radiogroup"
              aria-label="Release model"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {(Object.keys(releaseModelLabel) as ReleaseModel[]).map((option) => (
                <ChoiceCard
                  key={option}
                  selected={model === option}
                  onSelect={() => {
                    setModel(option)
                    setRows([])
                  }}
                  title={releaseModelLabel[option].label}
                  description={releaseModelLabel[option].description}
                  icon={modelIcons[option]}
                />
              ))}
            </div>
          </div>
        </Panel>
      ) : null}

      {step === 2 ? (
        <Panel
          title="Tranches"
          description={
            model === 'milestone'
              ? 'Each tranche is released after its milestone is approved.'
              : 'Tranches are released on their dates or when you decide.'
          }
          action={
            <div className="flex gap-1" role="group" aria-label="Split the commitment into">
              {[2, 3, 4, 5, 6].map((n) => (
                <Button
                  key={n}
                  variant={rows.length === n ? 'secondary' : 'ghost'}
                  size="pill-sm"
                  aria-pressed={rows.length === n}
                  onClick={() => splitInto(n)}
                >
                  {n}
                </Button>
              ))}
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {rows.map((row, i) => (
              <div key={row.key} className="flex flex-col gap-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <PillInput
                    aria-label="Tranche name"
                    value={row.name}
                    onChange={(e) => updateRow(row.key, { name: e.target.value })}
                    className="h-9 max-w-48"
                  />
                  <Button
                    variant="ghost"
                    size="icon-pill"
                    aria-label={`Remove ${row.name}`}
                    onClick={() => setRows(rows.filter((x) => x.key !== row.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <FormField label="Amount" htmlFor={`amount-${row.key}`} error={errors[`amount-${row.key}`]}>
                    <MoneyInput
                      id={`amount-${row.key}`}
                      value={row.amount}
                      onChange={(value) => updateRow(row.key, { amount: value })}
                      invalid={Boolean(errors[`amount-${row.key}`])}
                    />
                  </FormField>
                  <FormField
                    label={model === 'milestone' ? 'Milestone due' : 'Release date'}
                    htmlFor={`due-${row.key}`}
                    error={errors[`due-${row.key}`]}
                  >
                    <PillInput
                      id={`due-${row.key}`}
                      type="date"
                      value={row.due}
                      onChange={(e) => updateRow(row.key, { due: e.target.value })}
                    />
                  </FormField>
                  {model === 'milestone' ? (
                    <>
                      <FormField
                        label="Milestone"
                        htmlFor={`title-${row.key}`}
                        error={errors[`title-${row.key}`]}
                      >
                        <PillInput
                          id={`title-${row.key}`}
                          value={row.title}
                          onChange={(e) => updateRow(row.key, { title: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Description" htmlFor={`description-${row.key}`} optional>
                        <PillInput
                          id={`description-${row.key}`}
                          value={row.description}
                          onChange={(e) => updateRow(row.key, { description: e.target.value })}
                        />
                      </FormField>
                      <FormField
                        label="Acceptance criteria"
                        htmlFor={`criteria-${row.key}`}
                        hint="One per line. You check these before releasing the tranche."
                        className="sm:col-span-2"
                      >
                        <Textarea
                          id={`criteria-${row.key}`}
                          value={row.criteria}
                          onChange={(e) => updateRow(row.key, { criteria: e.target.value })}
                          className="min-h-20 rounded-xl"
                        />
                      </FormField>
                    </>
                  ) : null}
                </div>
                {i === 0 && model !== 'milestone' ? (
                  <p className="text-xs text-subtle">
                    The first tranche becomes available as soon as the Agency accepts.
                  </p>
                ) : null}
              </div>
            ))}
            <Button
              variant="outline"
              size="pill-sm"
              className="w-fit"
              onClick={() => {
                setRows([...rows, newRow(keySeed, rows.length, null)])
                setKeySeed(keySeed + 1)
              }}
            >
              <Plus data-icon="inline-start" /> Add tranche
            </Button>
            <div
              className={cn(
                'flex justify-between rounded-lg px-4 py-3 text-sm',
                total === committed ? 'bg-success-soft' : 'bg-warning-soft',
              )}
            >
              <span>Tranches total</span>
              <span className="num">
                {formatUsd(total, { withCode: true })} of {formatUsd(committed ?? ZERO, { withCode: true })}
              </span>
            </div>
            {errors.rows ? (
              <p className="text-sm text-danger" role="alert">
                {errors.rows}
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {step === 3 ? (
        <Panel title="Operating boundaries" description="What the Agency can do without asking you.">
          <div className="flex flex-col gap-6">
            <FormField label="Approved uses of funds" error={errors.categories}>
              <ChipSelect
                ariaLabel="Approved uses"
                value={categories}
                onChange={(value) => setCategories(value as SpendingCategory[])}
                options={CATEGORY_OPTIONS}
              />
            </FormField>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField
                label="Exception threshold"
                htmlFor="agreement-exception"
                error={errors.exception}
                hint="Single operations above this come to you for approval."
              >
                <MoneyInput
                  id="agreement-exception"
                  value={exception}
                  onChange={setException}
                  invalid={Boolean(errors.exception)}
                />
              </FormField>
              <FormField label="Reporting" htmlFor="agreement-cadence">
                <SimpleSelect
                  id="agreement-cadence"
                  value={cadence}
                  onValueChange={(value) => setCadence(value as SpendingPolicy['reportingCadence'])}
                  options={CADENCE_OPTIONS}
                />
              </FormField>
            </div>
            <FormField label="Evidence requirements" htmlFor="agreement-evidence">
              <Textarea
                id="agreement-evidence"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                className="min-h-20 rounded-xl"
              />
            </FormField>
            <FormField label="Return conditions" htmlFor="agreement-returns">
              <Textarea
                id="agreement-returns"
                value={returns}
                onChange={(e) => setReturns(e.target.value)}
                className="min-h-20 rounded-xl"
              />
            </FormField>
          </div>
        </Panel>
      ) : null}

      {step === 4 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Summary">
            <KeyValueList
              items={[
                { label: 'Agency', value: agency?.name ?? 'Not chosen' },
                { label: 'Agreement', value: title.trim() },
                { label: 'Commitment', value: <Amount value={committed ?? ZERO} size="sm" /> },
                { label: 'Release model', value: releaseModelLabel[model].label },
                { label: 'Tranches', value: String(rows.length) },
                {
                  label: 'Term',
                  value: startAt && endAt ? `${formatDate(startAt)} – ${formatDate(endAt)}` : 'Not set',
                },
                { label: 'Reporting', value: CADENCE_OPTIONS.find((c) => c.value === cadence)?.label },
              ]}
            />
          </Panel>
          <Panel title="In plain English">
            <PolicySummary
              title="What you are agreeing to"
              lines={[
                `You commit ${formatUsd(committed ?? ZERO, { withCode: true })} to ${agency?.name ?? 'the Agency'}, released in ${rows.length} tranches.`,
                model === 'milestone'
                  ? 'Each tranche is released only after you approve its milestone.'
                  : 'Tranches are released on schedule or when you decide.',
                `Capital can be used for ${joinList(categories.map((c) => categoryLabel[c].toLowerCase()))}.`,
                `Single operations above ${formatUsd(exception ?? ZERO, { withCode: true })} come to you as exceptions.`,
                'Released capital can never exceed what you have funded.',
              ]}
            />
          </Panel>
          {create.phase !== 'idle' ? (
            <Panel className="lg:col-span-2">
              <PendingOperation phase={create.phase} error={create.error} />
            </Panel>
          ) : null}
        </div>
      ) : null}

      <FormActions>
        <Button
          variant="ghost"
          size="pill-sm"
          disabled={busy}
          onClick={() => (step === 0 ? router.push(href('funding')) : setStep(step - 1))}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button size="pill-sm" onClick={next} disabled={agencies.length === 0}>
            Next: {STEPS[step + 1]}
          </Button>
        ) : (
          <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Creating…' : 'Create agreement'}
          </Button>
        )}
      </FormActions>
    </div>
  )
}

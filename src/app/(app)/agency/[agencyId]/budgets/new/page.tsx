'use client'

import { Bot, Briefcase, Cloud, Folder, Plane, Plus, Trash2, Users } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import { ChipSelect, FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ChoiceCard, FormActions, MoneyInput, Stepper } from '@/components/viatik/forms'
import { KeyValueList, PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { AgentAvatar, PersonAvatar } from '@/components/viatik/people'
import { PolicySummary } from '@/components/viatik/policy'
import { useCommand, useViatikState } from '@/data/react'
import type { AllowanceDraft } from '@/domain/engine'
import { budgetPeriodLabel, budgetPeriodUnit, budgetTemplate, categoryLabel } from '@/domain/labels'
import { formatUsd, usd, ZERO, type Cents } from '@/domain/money'
import { describeBudgetPolicy } from '@/domain/policy'
import { destinationName, holderName, userName } from '@/domain/queries'
import { accountBalance } from '@/domain/selectors'
import type { BudgetPeriod, BudgetTemplate, SpendingCategory } from '@/domain/types'
import { publicEnv } from '@/lib/env'
import { fromDateInput } from '@/lib/format'

const STEPS = ['Source', 'Amount', 'Rules', 'People', 'Review']

const templateIcons: Record<BudgetTemplate, React.ReactNode> = {
  team_spend: <Users />,
  tools: <Cloud />,
  vendors: <Briefcase />,
  travel: <Plane />,
  project: <Folder />,
  ai_automation: <Bot />,
}

const periodHint: Record<BudgetPeriod, string> = {
  monthly: 'Limits reset on the 1st.',
  quarterly: 'Limits reset each quarter.',
  one_time: 'One pool until it runs out.',
}

type Draft = {
  sourceAccountId: string | null
  template: BudgetTemplate
  name: string
  purpose: string
  allocation: Cents | null
  period: BudgetPeriod
  perOperationLimit: Cents | null
  periodLimit: Cents | null
  approvalThreshold: Cents | null
  categories: SpendingCategory[]
  destinations: string[]
  /** yyyy-mm-dd from the date input, or empty. */
  expiresAt: string
  allowances: { key: string; holder: AllowanceDraft['holder']; periodLimit: Cents | null }[]
}

/** The demo walks through the Product Delivery budget, so the draft starts there. */
function initialDraft(sourceAccountId: string | null): Draft {
  const demo = publicEnv.NEXT_PUBLIC_DEMO_MODE
  return {
    sourceAccountId,
    template: 'project',
    name: demo ? 'Product Delivery' : '',
    purpose: demo ? 'Services, tools, and contractors for the beta build.' : '',
    allocation: demo ? usd(5_000) : null,
    period: 'monthly',
    perOperationLimit: usd(500),
    periodLimit: demo ? usd(5_000) : null,
    approvalThreshold: usd(250),
    categories: budgetTemplate.project.categories,
    destinations: [],
    expiresAt: '',
    allowances: [],
  }
}

export default function NewBudgetPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const create = useCommand('createBudget')
  const [step, setStep] = React.useState(0)
  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [createdId, setCreatedId] = React.useState<string | null>(null)

  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const destinations = state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  const people = state.memberships.filter(
    (m) => m.scope.kind === 'agency' && m.scope.agencyId === agencyId && m.status === 'active',
  )
  const agents = state.agents.filter((a) => a.agencyId === agencyId)

  const [draft, setDraft] = React.useState<Draft>(() =>
    initialDraft(accounts.find((a) => a.template === 'operations')?.id ?? null),
  )
  const update = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }))
  const source = accounts.find((a) => a.id === draft.sourceAccountId)
  const available = source ? accountBalance(state, source.id) : ZERO
  const unit = budgetPeriodUnit[draft.period]

  const validate = (index: number) => {
    const next: Record<string, string> = {}
    if (index === 0) {
      if (!draft.sourceAccountId) next.source = 'Choose the account that funds this budget.'
      if (!draft.name.trim()) next.name = 'Give the budget a name.'
    }
    if (index === 1) {
      if (!draft.allocation || draft.allocation <= 0) next.allocation = 'Enter the amount to allocate.'
      else if (draft.allocation > available)
        next.allocation = `${source?.name ?? 'The account'} has ${formatUsd(available, { withCode: true })} available.`
      if (draft.expiresAt && (fromDateInput(draft.expiresAt) ?? '') <= now)
        next.expiresAt = 'Choose a date in the future.'
    }
    if (index === 2) {
      if (!draft.perOperationLimit || draft.perOperationLimit <= 0)
        next.perOperationLimit = 'Set a per-operation limit.'
      if (!draft.periodLimit || draft.periodLimit <= 0) next.periodLimit = 'Set a period limit.'
      if (draft.perOperationLimit && draft.periodLimit && draft.perOperationLimit > draft.periodLimit)
        next.perOperationLimit = 'Cannot be higher than the period limit.'
      if (draft.approvalThreshold === null)
        next.approvalThreshold = 'Set when approval is needed (0 means always).'
      if (draft.categories.length === 0) next.categories = 'Choose at least one approved use.'
    }
    if (index === 3) {
      for (const a of draft.allowances) {
        if (!a.periodLimit || a.periodLimit <= 0) next[`allowance-${a.key}`] = 'Enter an allowance.'
        else if (draft.periodLimit && a.periodLimit > draft.periodLimit)
          next[`allowance-${a.key}`] = 'Cannot exceed the period limit.'
      }
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const policyLines = describeBudgetPolicy(
    {
      period: draft.period,
      perOperationLimit: draft.perOperationLimit ?? ZERO,
      periodLimit: draft.periodLimit ?? ZERO,
      approvalThreshold: draft.approvalThreshold ?? ZERO,
      allowedCategories: draft.categories,
      expiresAt: fromDateInput(draft.expiresAt),
    },
    {
      destinationNames: draft.destinations.map((id) => destinationName(state, id)),
      categoryLabels: categoryLabel,
    },
  )

  const submit = async () => {
    const { sourceAccountId, allocation, perOperationLimit, periodLimit, approvalThreshold } = draft
    if (!sourceAccountId || !allocation || !perOperationLimit || !periodLimit || approvalThreshold === null)
      return
    const result = await create.run({
      agencyId,
      sourceAccountId,
      name: draft.name.trim(),
      purpose: draft.purpose.trim(),
      template: draft.template,
      period: draft.period,
      allocation,
      perOperationLimit,
      periodLimit,
      approvalThreshold,
      allowedCategories: draft.categories,
      allowedDestinationIds: draft.destinations,
      expiresAt: fromDateInput(draft.expiresAt),
      allowances: draft.allowances.flatMap((a) =>
        a.periodLimit ? [{ holder: a.holder, periodLimit: a.periodLimit }] : [],
      ),
    })
    if (result) setCreatedId(result.id)
  }

  if (createdId) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-10">
        <PageHeader
          title="Budget created"
          description={`${draft.name} is active with ${formatUsd(draft.allocation ?? ZERO, { withCode: true })}.`}
        />
        <Panel>
          <PolicySummary lines={policyLines} />
        </Panel>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={href(`budgets/${createdId}`)} size="pill">
            View budget
          </ButtonLink>
          <ButtonLink href={href('budgets')} variant="outline" size="pill">
            All budgets
          </ButtonLink>
        </div>
      </div>
    )
  }

  const busy = create.phase !== 'idle' && create.phase !== 'failed'
  const unassigned = [
    ...people
      .filter(
        (m) => !draft.allowances.some((a) => a.holder.kind === 'member' && a.holder.userId === m.userId),
      )
      .map((m) => ({
        value: `member:${m.userId}`,
        label: `${userName(state, m.userId)} · ${m.role === 'agency_admin' ? 'Agency Admin' : 'Member'}`,
      })),
    ...agents
      .filter(
        (ag) => !draft.allowances.some((a) => a.holder.kind === 'ai_agent' && a.holder.agentId === ag.id),
      )
      .map((ag) => ({ value: `agent:${ag.id}`, label: `${ag.name} · AI Agent` })),
  ]
  const addHolder = (value: string) => {
    const [kind, id = ''] = value.split(':')
    const holder: AllowanceDraft['holder'] =
      kind === 'member' ? { kind: 'member', userId: id } : { kind: 'ai_agent', agentId: id }
    update({ allowances: [...draft.allowances, { key: value, holder, periodLimit: usd(500) }] })
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href={href('budgets')} className="hover:text-foreground">
              Budgets
            </Link>
            <span aria-hidden="true">/</span>
            <span>New budget</span>
          </>
        }
        title="Create budget"
        description="Assign capital from an account, set the rules, and choose who can spend it."
      />
      <Stepper steps={STEPS} current={step} />

      {step === 0 ? (
        <Panel title="Where does the money come from?">
          <div className="flex flex-col gap-6">
            <FormField
              label="Source account"
              htmlFor="source"
              error={errors.source}
              hint={source ? `${formatUsd(available, { withCode: true })} available` : undefined}
            >
              <SimpleSelect
                id="source"
                value={draft.sourceAccountId}
                onValueChange={(value) => update({ sourceAccountId: value })}
                invalid={Boolean(errors.source)}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: `${formatUsd(accountBalance(state, a.id), { withCode: true })} available`,
                }))}
              />
            </FormField>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Template</p>
              <div
                role="radiogroup"
                aria-label="Budget template"
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              >
                {(Object.keys(budgetTemplate) as BudgetTemplate[]).map((key) => (
                  <ChoiceCard
                    key={key}
                    selected={draft.template === key}
                    onSelect={() => update({ template: key, categories: budgetTemplate[key].categories })}
                    title={budgetTemplate[key].label}
                    description={budgetTemplate[key].description}
                    icon={templateIcons[key]}
                  />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <FormField label="Budget name" htmlFor="name" error={errors.name}>
                <PillInput
                  id="name"
                  value={draft.name}
                  aria-invalid={Boolean(errors.name) || undefined}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder={budgetTemplate[draft.template].label}
                />
              </FormField>
              <FormField label="Purpose" htmlFor="purpose" optional>
                <PillInput
                  id="purpose"
                  value={draft.purpose}
                  onChange={(e) => update({ purpose: e.target.value })}
                />
              </FormField>
            </div>
          </div>
        </Panel>
      ) : null}

      {step === 1 ? (
        <Panel title="How much, and for how long?">
          <div className="flex flex-col gap-6">
            <FormField
              label="Amount to allocate"
              htmlFor="allocation"
              error={errors.allocation}
              hint="Moves from the source account into the budget. Unused funds can be returned later."
            >
              <MoneyInput
                id="allocation"
                value={draft.allocation}
                onChange={(value) => update({ allocation: value })}
                available={available}
                invalid={Boolean(errors.allocation)}
              />
            </FormField>
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium">Period</p>
              <div role="radiogroup" aria-label="Period" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {(Object.keys(budgetPeriodLabel) as BudgetPeriod[]).map((period) => (
                  <ChoiceCard
                    key={period}
                    selected={draft.period === period}
                    onSelect={() => update({ period })}
                    title={budgetPeriodLabel[period]}
                    description={periodHint[period]}
                  />
                ))}
              </div>
            </div>
            <FormField
              label="Closes on"
              htmlFor="expires"
              optional
              error={errors.expiresAt}
              hint="Unused funds return to the source account when the budget closes."
            >
              <PillInput
                id="expires"
                type="date"
                value={draft.expiresAt}
                aria-invalid={Boolean(errors.expiresAt) || undefined}
                onChange={(e) => update({ expiresAt: e.target.value })}
                className="sm:w-60"
              />
            </FormField>
          </div>
        </Panel>
      ) : null}

      {step === 2 ? (
        <Panel title="Rules" description="Enforced on Monad, not just in the app.">
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              <FormField label="Per-operation limit" htmlFor="per-op" error={errors.perOperationLimit}>
                <MoneyInput
                  id="per-op"
                  value={draft.perOperationLimit}
                  onChange={(v) => update({ perOperationLimit: v })}
                  invalid={Boolean(errors.perOperationLimit)}
                />
              </FormField>
              <FormField
                label={`${budgetPeriodLabel[draft.period]} limit`}
                htmlFor="period-limit"
                error={errors.periodLimit}
              >
                <MoneyInput
                  id="period-limit"
                  value={draft.periodLimit}
                  onChange={(v) => update({ periodLimit: v })}
                  invalid={Boolean(errors.periodLimit)}
                />
              </FormField>
              <FormField
                label="Approve automatically up to"
                htmlFor="threshold"
                error={errors.approvalThreshold}
              >
                <MoneyInput
                  id="threshold"
                  value={draft.approvalThreshold}
                  onChange={(v) => update({ approvalThreshold: v })}
                  invalid={Boolean(errors.approvalThreshold)}
                />
              </FormField>
            </div>
            <FormField label="Approved uses" error={errors.categories}>
              <ChipSelect
                ariaLabel="Approved uses"
                value={draft.categories}
                onChange={(value) => update({ categories: value as SpendingCategory[] })}
                options={(Object.keys(categoryLabel) as SpendingCategory[]).map((c) => ({
                  value: c,
                  label: categoryLabel[c],
                }))}
              />
            </FormField>
            <FormField
              label="Allowed payment destinations"
              hint="Leave empty to allow any approved destination of the Agency."
            >
              <ChipSelect
                ariaLabel="Allowed payment destinations"
                value={draft.destinations}
                onChange={(value) => update({ destinations: value })}
                options={destinations.map((d) => ({ value: d.id, label: d.name }))}
              />
            </FormField>
          </div>
        </Panel>
      ) : null}

      {step === 3 ? (
        <Panel
          title="Who can spend it?"
          description="Give Members or AI Agents an allowance. The money stays in the budget until a payment is made."
        >
          <div className="flex flex-col gap-4">
            {draft.allowances.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No one has spending access yet. You can also add people later.
              </p>
            ) : null}
            <ul className="flex flex-col gap-3">
              {draft.allowances.map((a) => {
                const error = errors[`allowance-${a.key}`]
                const name = holderName(state, a.holder)
                return (
                  <li
                    key={a.key}
                    className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      {a.holder.kind === 'member' ? (
                        <PersonAvatar name={name} size="sm" />
                      ) : (
                        <AgentAvatar size="sm" />
                      )}
                      <span className="truncate text-sm font-medium">{name}</span>
                    </span>
                    <div className="flex items-start gap-2">
                      <div className="w-full sm:w-52">
                        <MoneyInput
                          value={a.periodLimit}
                          onChange={(value) =>
                            update({
                              allowances: draft.allowances.map((x) =>
                                x.key === a.key ? { ...x, periodLimit: value } : x,
                              ),
                            })
                          }
                          invalid={Boolean(error)}
                          aria-describedby={error ? `err-${a.key}` : undefined}
                        />
                        {error ? (
                          <p id={`err-${a.key}`} className="mt-1 px-2 text-xs text-danger">
                            {error}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-pill"
                        aria-label={`Remove ${name}`}
                        onClick={() =>
                          update({ allowances: draft.allowances.filter((x) => x.key !== a.key) })
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {unassigned.length > 0 ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <SimpleSelect
                  value={null}
                  placeholder="Add a person or AI Agent"
                  onValueChange={addHolder}
                  options={unassigned}
                  className="sm:w-80"
                />
                <span className="flex items-center gap-1.5 text-xs text-subtle">
                  <Plus className="size-3.5" aria-hidden="true" /> Allowance is per {unit}
                </span>
              </div>
            ) : null}
          </div>
        </Panel>
      ) : null}

      {step === 4 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Panel title="Summary">
            <KeyValueList
              items={[
                { label: 'Budget', value: draft.name },
                { label: 'Template', value: budgetTemplate[draft.template].label },
                { label: 'Source account', value: source?.name },
                { label: 'Allocation', value: <Amount value={draft.allocation ?? ZERO} size="sm" /> },
                { label: 'Period', value: budgetPeriodLabel[draft.period] },
                {
                  label: 'People with access',
                  value:
                    draft.allowances.length === 0
                      ? 'No one yet'
                      : draft.allowances
                          .map(
                            (a) =>
                              `${holderName(state, a.holder)} (${formatUsd(a.periodLimit ?? ZERO)}/${unit})`,
                          )
                          .join(', '),
                },
              ]}
            />
          </Panel>
          <Panel title="In plain English">
            <PolicySummary lines={policyLines} />
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
          onClick={() => (step === 0 ? router.push(href('budgets')) : setStep(step - 1))}
          disabled={busy}
        >
          {step === 0 ? 'Cancel' : 'Back'}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button size="pill-sm" onClick={() => validate(step) && setStep(step + 1)}>
            Next: {STEPS[step + 1]}
          </Button>
        ) : (
          <Button size="pill-sm" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create budget'}
          </Button>
        )}
      </FormActions>
    </div>
  )
}

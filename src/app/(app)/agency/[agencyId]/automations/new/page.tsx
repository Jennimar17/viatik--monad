'use client'

import { AppLink as Link } from '@/components/viatik/app-link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { ChipSelect, FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { FormActions, MoneyInput } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { PolicySummary } from '@/components/viatik/policy'
import { useCommand, useViatikState } from '@/data/react'
import { formatUsd, usd, ZERO, type Cents } from '@/domain/money'
import { joinList } from '@/domain/policy'
import { destinationName } from '@/domain/queries'
import { budgetUsage } from '@/domain/selectors'
import { fromDateInput } from '@/lib/format'

const DAY = 86_400_000

export default function NewAgentPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const create = useCommand('createAgent', { success: (agent) => `${agent.name} is active.` })
  useBottomBar()

  const budgets = state.budgets.filter((b) => b.agencyId === agencyId && b.status === 'active')
  const destinations = state.destinations.filter((d) => d.agencyId === agencyId && d.status === 'approved')
  const [name, setName] = React.useState('')
  const [purpose, setPurpose] = React.useState('')
  const [budgetId, setBudgetId] = React.useState<string | null>(
    budgets.find((b) => b.template === 'ai_automation')?.id ??
      budgets.find((b) => budgetUsage(state, b, now).available > 0)?.id ??
      budgets[0]?.id ??
      null,
  )
  const [dailyCap, setDailyCap] = React.useState<Cents | null>(usd(20))
  const [perOperation, setPerOperation] = React.useState<Cents | null>(usd(5))
  const [balance, setBalance] = React.useState<Cents | null>(usd(50))
  const [providers, setProviders] = React.useState<string[]>([])
  const [expires, setExpires] = React.useState(
    new Date(new Date(now).getTime() + 90 * DAY).toISOString().slice(0, 10),
  )
  const [touched, setTouched] = React.useState(false)

  const expiresAt = fromDateInput(expires)
  const budget = budgets.find((b) => b.id === budgetId)
  const errors = {
    name: name.trim().length > 1 ? undefined : 'Give the agent a name.',
    purpose: purpose.trim().length > 3 ? undefined : 'Say what it does.',
    budget: budgetId ? undefined : 'Choose the budget it spends from.',
    dailyCap: dailyCap && dailyCap > 0 ? undefined : 'Set a daily cap.',
    perOperation:
      perOperation && perOperation > 0
        ? dailyCap && perOperation > dailyCap
          ? 'Cannot exceed the daily cap.'
          : budget && perOperation > budget.perOperationLimit
            ? `Cannot exceed the budget’s ${formatUsd(budget.perOperationLimit, { withCode: true })} per-payment limit.`
            : undefined
        : 'Set a per-operation maximum.',
    providers: providers.length > 0 ? undefined : 'Choose at least one provider it may pay.',
    expires: expiresAt && expiresAt > now ? undefined : 'Pick a date in the future.',
  }
  const valid = !Object.values(errors).some(Boolean)
  const busy = create.phase !== 'idle' && create.phase !== 'failed' && create.phase !== 'completed'
  const shown = (key: keyof typeof errors) => (touched ? errors[key] : undefined)

  const submit = async () => {
    setTouched(true)
    if (!valid || !budgetId || !dailyCap || !perOperation || !expiresAt) return
    const agent = await create.run({
      agencyId,
      name: name.trim(),
      purpose: purpose.trim(),
      budgetId,
      dailyCap,
      perOperationMax: perOperation,
      allowedDestinationIds: providers,
      workingBalanceLimit: balance ?? ZERO,
      expiresAt,
    })
    if (agent) router.push(href(`automations/${agent.id}`))
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('automations')} className="hover:text-foreground">
            Automations
          </Link>
        }
        title="Create AI Agent"
        description="An automation identity with a limited budget. It can request payments only inside the rules you set here."
      />

      <Panel title="Identity">
        <div className="flex flex-col gap-5">
          <FormField label="Name" htmlFor="agent-name" error={shown('name')}>
            <PillInput
              id="agent-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Research Assistant"
              aria-invalid={Boolean(shown('name')) || undefined}
            />
          </FormField>
          <FormField label="What does it do?" htmlFor="agent-purpose" error={shown('purpose')}>
            <Textarea
              id="agent-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="min-h-20 rounded-xl"
              placeholder="e.g. Buys market data for weekly research briefs."
              aria-invalid={Boolean(shown('purpose')) || undefined}
            />
          </FormField>
          <FormField label="Budget it spends from" htmlFor="agent-budget" error={shown('budget')}>
            {budgets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Create a budget first. The agent needs one to spend from.
              </p>
            ) : (
              <SimpleSelect
                id="agent-budget"
                value={budgetId}
                onValueChange={setBudgetId}
                options={budgets.map((b) => ({
                  value: b.id,
                  label: b.name,
                  description: `${formatUsd(budgetUsage(state, b, now).available)} available`,
                }))}
              />
            )}
          </FormField>
        </div>
      </Panel>

      <Panel title="Limits" description="Checked on every payment, in the app and at settlement.">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <FormField label="Daily cap" htmlFor="agent-daily" error={shown('dailyCap')}>
            <MoneyInput
              id="agent-daily"
              value={dailyCap}
              onChange={setDailyCap}
              invalid={Boolean(shown('dailyCap'))}
            />
          </FormField>
          <FormField label="Per-operation max" htmlFor="agent-per-op" error={shown('perOperation')}>
            <MoneyInput
              id="agent-per-op"
              value={perOperation}
              onChange={setPerOperation}
              invalid={Boolean(shown('perOperation'))}
            />
          </FormField>
          <FormField label="Working balance" htmlFor="agent-balance" hint="The most it can hold at once.">
            <MoneyInput id="agent-balance" value={balance} onChange={setBalance} />
          </FormField>
          <FormField label="Allowed providers" className="sm:col-span-3" error={shown('providers')}>
            {destinations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Add a payment destination in Settings first. Agents only pay approved providers.
              </p>
            ) : (
              <ChipSelect
                ariaLabel="Allowed providers"
                value={providers}
                onChange={setProviders}
                options={destinations.map((d) => ({ value: d.id, label: d.name }))}
              />
            )}
          </FormField>
          <FormField label="Expires on" htmlFor="agent-expires" error={shown('expires')}>
            <PillInput
              id="agent-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              aria-invalid={Boolean(shown('expires')) || undefined}
            />
          </FormField>
        </div>
      </Panel>

      {dailyCap && perOperation ? (
        <Panel>
          <PolicySummary
            title="In plain English"
            lines={[
              `${name.trim() || 'This agent'} can spend at most ${formatUsd(dailyCap, { withCode: true })} per day and ${formatUsd(perOperation, { withCode: true })} per payment.`,
              providers.length
                ? `It can only pay ${joinList(providers.map((id) => destinationName(state, id)))}.`
                : 'Choose at least one provider it may pay.',
              budget ? `It spends from ${budget.name} and never touches other accounts.` : 'Choose a budget.',
              'Anything outside these rules is denied and logged. No money moves.',
              'You can pause it instantly at any time.',
            ]}
          />
        </Panel>
      ) : null}

      {create.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={create.phase} error={create.error} />
        </Panel>
      ) : null}

      <FormActions>
        <Button
          variant="ghost"
          size="pill-sm"
          onClick={() => router.push(href('automations'))}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create AI Agent'}
        </Button>
      </FormActions>
    </div>
  )
}

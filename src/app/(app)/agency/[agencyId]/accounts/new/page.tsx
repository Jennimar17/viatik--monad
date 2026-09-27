'use client'

import { AppLink as Link } from '@/components/viatik/app-link'
import { useRouter } from 'next/navigation'
import * as React from 'react'

import { accountIcons, accountTemplateOptions } from '@/components/app/account-parts'
import { FormField, PillInput, SimpleSelect } from '@/components/app/form-controls'
import { useHref, useRole } from '@/components/app/role-context'
import { useBottomBar } from '@/components/app/shell/app-shell'
import { Button } from '@/components/ui/button'
import { ChoiceCard, FormActions, MoneyInput } from '@/components/viatik/forms'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { PendingOperation } from '@/components/viatik/operation'
import { useCommand, useViatikState } from '@/data/react'
import { accountTemplate } from '@/domain/labels'
import { formatUsd, ZERO, type Cents } from '@/domain/money'
import { accountBalance } from '@/domain/selectors'
import type { AccountTemplate } from '@/domain/types'

export default function NewAccountPage() {
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const router = useRouter()
  const create = useCommand('createAccount', { success: (account) => `${account.name} account created.` })
  useBottomBar()

  const templates = accountTemplateOptions()
  const accounts = state.accounts.filter((a) => a.agencyId === agencyId && a.status === 'active')
  const [template, setTemplate] = React.useState<AccountTemplate>('project')
  const [name, setName] = React.useState(accountTemplate.project.label)
  const [purpose, setPurpose] = React.useState('')
  const [fromId, setFromId] = React.useState<string | null>(
    accounts.find((a) => a.template === 'operations')?.id ?? accounts[0]?.id ?? null,
  )
  const [amount, setAmount] = React.useState<Cents | null>(null)
  const [touched, setTouched] = React.useState(false)

  const available = fromId ? accountBalance(state, fromId) : ZERO
  const errors = {
    name: name.trim() ? undefined : 'Give the account a name.',
    amount:
      amount !== null && amount > available
        ? `Only ${formatUsd(available, { withCode: true })} is available.`
        : undefined,
  }
  const valid = !Object.values(errors).some(Boolean)
  const busy = create.phase !== 'idle' && create.phase !== 'failed' && create.phase !== 'completed'

  const submit = async () => {
    setTouched(true)
    if (!valid) return
    const account = await create.run({
      agencyId,
      template,
      name: name.trim(),
      purpose: purpose.trim(),
      initialFunding: amount && fromId ? { fromAccountId: fromId, amount } : undefined,
    })
    if (account) router.push(href(`accounts/${account.id}`))
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader
        eyebrow={
          <Link href={href('accounts')} className="hover:text-foreground">
            Accounts
          </Link>
        }
        title="Create account"
        description="Separate money by purpose. Accounts hold money; budgets hold the rules for spending it."
      />

      <Panel title="Template">
        <div
          role="radiogroup"
          aria-label="Account template"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        >
          {templates.map((t) => (
            <ChoiceCard
              key={t.key}
              selected={template === t.key}
              onSelect={() => {
                setTemplate(t.key)
                setName(t.label)
              }}
              title={t.label}
              description={t.description}
              icon={accountIcons[t.key]}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Name and purpose">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FormField label="Account name" htmlFor="name" error={touched ? errors.name : undefined}>
            <PillInput
              id="name"
              value={name}
              aria-invalid={(touched && Boolean(errors.name)) || undefined}
              onChange={(e) => setName(e.target.value)}
            />
          </FormField>
          <FormField label="Purpose" htmlFor="purpose" optional>
            <PillInput
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder={accountTemplate[template].description}
            />
          </FormField>
        </div>
      </Panel>

      <Panel title="Initial funding" description="Optional. Move money from another account right away.">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This is the first account. Released funding lands here once a tranche is approved.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="From account" htmlFor="from">
              <SimpleSelect
                id="from"
                value={fromId}
                onValueChange={setFromId}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: `${formatUsd(accountBalance(state, a.id))} available`,
                }))}
              />
            </FormField>
            <FormField label="Amount" htmlFor="amount" error={errors.amount}>
              <MoneyInput
                id="amount"
                value={amount}
                onChange={setAmount}
                available={available}
                invalid={Boolean(errors.amount)}
              />
            </FormField>
          </div>
        )}
      </Panel>

      {create.phase !== 'idle' ? (
        <Panel>
          <PendingOperation phase={create.phase} error={create.error} />
        </Panel>
      ) : null}

      <FormActions>
        <Button variant="ghost" size="pill-sm" onClick={() => router.push(href('accounts'))} disabled={busy}>
          Cancel
        </Button>
        <Button size="pill-sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </FormActions>
    </div>
  )
}

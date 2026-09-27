'use client'

import { Bot, Plus, ShieldCheck } from 'lucide-react'
import Link from 'next/link'

import { ButtonLink } from '@/components/app/button-link'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Amount } from '@/components/viatik/amount'
import { EmptyState } from '@/components/viatik/feedback'
import { UsageBar } from '@/components/viatik/finance'
import { PageHeader, Panel } from '@/components/viatik/layout'
import { AgentAvatar } from '@/components/viatik/people'
import { StatusBadge } from '@/components/viatik/status'
import { useViatikState } from '@/data/react'
import { formatUsd } from '@/domain/money'
import { budgetName, destinationName } from '@/domain/queries'
import { agentSpentToday } from '@/domain/selectors'
import { agentStatus } from '@/domain/status'
import { formatDate, formatRelative } from '@/lib/format'

const decisionWord = { approved: 'allowed', rejected: 'denied', needs_approval: 'sent for approval' } as const

export default function AutomationsPage() {
  const { state, now } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const agents = state.agents.filter((a) => a.agencyId === agencyId)
  const canConfigure = can('configure_ai_agent')

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Automations"
        description="Give AI Agents a budget, not unlimited access. Each one has its own caps, allowed providers, expiry and an emergency pause."
        actions={
          canConfigure ? (
            <ButtonLink href={href('automations/new')} size="pill">
              <Plus data-icon="inline-start" /> Create AI Agent
            </ButtonLink>
          ) : null
        }
      />

      <Panel>
        <div className="flex items-start gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden="true" />
          <p className="text-pretty">
            AI Agents are programmatic resources managed by Agency Admins, not people. Every automated payment
            is checked against a deterministic policy, enforced at settlement, and logged as a decision
            record.
          </p>
        </div>
      </Panel>

      {agents.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title="No automations yet"
          description="Create an AI Agent with a daily cap and the providers it may pay."
          action={
            canConfigure ? (
              <ButtonLink href={href('automations/new')} size="pill-sm">
                <Plus data-icon="inline-start" /> Create AI Agent
              </ButtonLink>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {agents.map((agent) => {
            const today = agentSpentToday(state, agent.id, now)
            const last = state.agentDecisions
              .filter((d) => d.agentId === agent.id)
              .sort((a, b) => (a.at < b.at ? 1 : -1))[0]
            return (
              <Link
                key={agent.id}
                href={href(`automations/${agent.id}`)}
                className="surface flex flex-col gap-4 rounded-xl p-5 transition-colors outline-none hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <AgentAvatar size="lg" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{agent.name}</span>
                      <span className="truncate text-xs text-subtle">
                        Budget · {budgetName(state, agent.budgetId)}
                      </span>
                    </span>
                  </span>
                  <StatusBadge status={agentStatus[agent.status]} pulse={agent.status === 'active'} />
                </div>
                <p className="text-sm text-pretty text-muted-foreground">{agent.purpose}</p>
                <div className="flex flex-col gap-1.5">
                  <span className="flex justify-between text-xs text-subtle">
                    <span>Today</span>
                    <span>
                      <Amount value={today} size="xs" /> of {formatUsd(agent.dailyCap)} daily cap
                    </span>
                  </span>
                  <UsageBar used={today} limit={agent.dailyCap} showLegend={false} label="Daily cap used" />
                </div>
                <div className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs">
                  <span className="flex flex-col gap-0.5">
                    <span className="text-subtle">Per operation</span>
                    <span className="num">{formatUsd(agent.perOperationMax)}</span>
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-subtle">Providers</span>
                    <span className="truncate">
                      {agent.allowedDestinationIds.map((id) => destinationName(state, id)).join(', ')}
                    </span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-subtle">Expires</span>
                    <span>{formatDate(agent.expiresAt)}</span>
                  </span>
                </div>
                <p className="text-xs text-subtle">
                  {last
                    ? `Last decision ${formatRelative(last.at, now)} · ${decisionWord[last.outcome]}`
                    : 'No decisions yet'}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

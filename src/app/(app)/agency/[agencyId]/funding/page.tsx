'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { ArrowRight, HandCoins, ShieldCheck } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as React from 'react'

import { ButtonLink } from '@/components/app/button-link'
import {
  AgreementProgress,
  AgreementTerms,
  EvidenceList,
  MilestoneTimelineFor,
} from '@/components/app/funding-parts'
import { PageTabs } from '@/components/app/page-tabs'
import { trancheRequestRecord, useReceiptDrawer } from '@/components/app/receipt-details'
import { useHref, usePermissions, useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { Amount } from '@/components/viatik/amount'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { DataTable } from '@/components/viatik/data-table'
import { EmptyState, PageSkeleton } from '@/components/viatik/feedback'
import { CapitalBar } from '@/components/viatik/finance'
import { PageHeader, Panel } from '@/components/viatik/layout'
import Link from '@/components/viatik/link'
import { OrgAvatar } from '@/components/viatik/people'
import { StatusBadge, Tag } from '@/components/viatik/status'
import { VerifiedDetailsButton } from '@/components/viatik/verified-details-drawer'
import { useCommand, useViatikState } from '@/data/react'
import { agencyNextTranche, releaseModelLabel } from '@/domain/labels'
import { agreementsOf, receiptFor } from '@/domain/queries'
import {
  agreementBadge,
  agreementCapital,
  agreementDisplayStatus,
  isFullyReleased,
  trancheIsOver,
} from '@/domain/selectors'
import type { AgreementStatus, FundingAgreement, MilestoneStatus } from '@/domain/types'
import { formatDate } from '@/lib/format'
import { formatLocalDate } from '@/lib/local-time'

/** Milestones the Agency can (re)submit evidence for. */
const SUBMITTABLE: ReadonlySet<MilestoneStatus> = new Set(['not_started', 'in_progress', 'changes_requested'])

const CLOSED: ReadonlySet<AgreementStatus> = new Set(['completed', 'cancelled', 'expired'])

export default function AgencyFundingPage() {
  // useSearchParams needs a boundary for the static prerender.
  return (
    <React.Suspense fallback={<PageSkeleton />}>
      <AgencyFunding />
    </React.Suspense>
  )
}

function AgencyFunding() {
  const { state } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const href = useHref()
  const { can } = usePermissions()
  const accept = useCommand('acceptAgreement')
  const receipts = useReceiptDrawer()
  const [acceptOpen, setAcceptOpen] = React.useState(false)
  const requested = useSearchParams().get('agreement')

  // With several agreements the page is a list, like the Investor's Funding; a row opens one
  // (`?agreement=<id>`). With a single agreement it opens straight onto it.
  const agreements = agreementsOf(state, agencyId)
  const agreement = requested
    ? agreements.find((a) => a.id === requested)
    : agreements.length === 1
      ? agreements[0]
      : undefined
  const investor = agreement ? state.portfolios.find((p) => p.id === agreement.portfolioId)?.name : undefined

  if (!agreement && agreements.length > 1) return <AgreementList agencyId={agencyId} />
  if (!agreement) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Funding" />
        <EmptyState
          icon={<HandCoins />}
          title="No active funding agreement"
          description="Once an Investor creates and activates an agreement, its tranches and milestones will appear here."
        />
      </div>
    )
  }

  const pending = agreement.status === 'pending_acceptance'
  const settled = isFullyReleased(state, agreement.id)
  const anyRejected = state.tranches.some((t) => t.agreementId === agreement.id && t.status === 'rejected')
  const releases = state.tranches
    .filter((t) => t.agreementId === agreement.id && t.status === 'released')
    .sort((a, b) => a.index - b.index)
  const submitted = state.milestones.filter((m) => m.agreementId === agreement.id && m.evidence.length > 0)

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            {agreements.length > 1 ? (
              <Link href={href('funding')} className="hover:text-foreground">
                Funding
              </Link>
            ) : (
              <Tag>Funding</Tag>
            )}
            <span>From {investor}</span>
          </>
        }
        title={agreement.title}
        description={agreement.purpose}
        meta={
          <>
            <StatusBadge status={agreementBadge(state, agreement)} size="md" />
            <span className="text-sm text-subtle">
              {formatDate(agreement.startDate)} – {formatDate(agreement.endDate)}
            </span>
          </>
        }
        actions={
          pending && can('request_tranche') ? (
            <Button size="pill" onClick={() => setAcceptOpen(true)}>
              Accept agreement
            </Button>
          ) : null
        }
      />

      {pending ? (
        <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          {investor} sent you this agreement. Review the terms and accept it to start receiving funding.
        </div>
      ) : null}
      {settled ? (
        <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-pretty">
          {anyRejected
            ? 'No tranche of this agreement is left to release.'
            : `${investor} released every tranche of this agreement.`}{' '}
          The money is in your accounts: keep operating with it, or return what you don’t need with Return to
          Investor.
        </div>
      ) : null}

      <Panel>
        <AgreementProgress state={state} agreement={agreement} />
      </Panel>

      <PageTabs
        tabs={[
          {
            value: 'tranches',
            label: 'Tranches and milestones',
            content: (
              <Panel
                title="Release schedule"
                description={
                  agreement.releaseModel === 'milestone'
                    ? 'Submit evidence for a milestone to request its tranche.'
                    : 'The Investor releases each tranche; no request is needed. You can request one to choose the account it lands in.'
                }
              >
                <MilestoneTimelineFor
                  state={state}
                  agreementId={agreement.id}
                  actionFor={(tranche, milestone) => {
                    if (tranche.status === 'released' && tranche.receiptId) {
                      return (
                        <Button
                          variant="ghost"
                          size="pill-sm"
                          onClick={() => receipts.show(receiptFor(state, tranche.receiptId))}
                        >
                          <ShieldCheck data-icon="inline-start" /> Verified details
                        </Button>
                      )
                    }
                    // A request waiting for the Investor: what the ledger recorded when it was sent.
                    const requested =
                      tranche.status === 'under_review' && trancheRequestRecord(state, tranche)
                    if (requested)
                      return (
                        <VerifiedDetailsButton record={requested} label="Verified details" variant="ghost" />
                      )
                    if (agreement.status !== 'active' || !can('submit_milestone_evidence')) return null
                    if (milestone && SUBMITTABLE.has(milestone.status)) {
                      return (
                        <ButtonLink href={href(`funding/milestones/${milestone.id}/submit`)} size="pill-sm">
                          Submit evidence <ArrowRight data-icon="inline-end" />
                        </ButtonLink>
                      )
                    }
                    if (!milestone && (tranche.status === 'available' || tranche.status === 'planned')) {
                      return (
                        <ButtonLink
                          href={href(`funding/tranches/${tranche.id}/request`)}
                          variant={tranche.status === 'available' ? 'default' : 'outline'}
                          size="pill-sm"
                        >
                          Request funding
                        </ButtonLink>
                      )
                    }
                    return null
                  }}
                />
              </Panel>
            ),
          },
          {
            value: 'terms',
            label: 'Agreement terms',
            content: (
              <Panel>
                <AgreementTerms state={state} agreement={agreement} />
              </Panel>
            ),
          },
          {
            value: 'evidence',
            label: 'Submitted evidence',
            count: submitted.length,
            content:
              submitted.length === 0 ? (
                <Panel>
                  <EmptyState
                    compact
                    title="No evidence submitted yet"
                    description="Evidence you submit for milestones is listed here."
                  />
                </Panel>
              ) : (
                <div className="flex flex-col gap-6">
                  {submitted.map((m) => (
                    <Panel
                      key={m.id}
                      title={m.title}
                      description={m.submittedAt ? `Submitted ${formatLocalDate(m.submittedAt)}` : undefined}
                    >
                      <EvidenceList milestone={m} />
                    </Panel>
                  ))}
                </div>
              ),
          },
          {
            value: 'releases',
            label: 'Release history',
            count: releases.length,
            content: (
              <Panel title="Released tranches" description="Each release has a verifiable receipt.">
                {releases.length === 0 ? (
                  <EmptyState
                    compact
                    title="No tranches released yet"
                    description={
                      agreement.releaseModel === 'milestone'
                        ? 'Releases appear here once the Investor approves a milestone.'
                        : 'Releases appear here once the Investor releases a tranche.'
                    }
                  />
                ) : (
                  <ul className="flex flex-col">
                    {releases.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-center justify-between gap-3 border-t border-border py-3 first:border-t-0"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="text-sm font-medium">{t.name}</span>
                          <span className="text-xs text-subtle">
                            {t.releasedAt ? `Released ${formatLocalDate(t.releasedAt)}` : 'Released'}
                          </span>
                        </span>
                        <span className="flex items-center gap-3">
                          <Amount value={t.amount} size="sm" />
                          <Button
                            variant="ghost"
                            size="pill-sm"
                            onClick={() => receipts.show(receiptFor(state, t.receiptId))}
                          >
                            Verified details
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ),
          },
        ]}
      />

      <ApprovalSheet
        open={acceptOpen}
        onOpenChange={setAcceptOpen}
        onClosed={accept.reset}
        title="Accept agreement"
        summary={{
          what: `You accept ${agreement.title} and its conditions: tranches, milestones, spending policy, and return conditions. If the Agency has no Operations account yet, Viatik opens one to receive released funding.`,
          amount: agreement.committed,
          reversible: 'The Investor can pause the agreement; changes to its terms need an amendment.',
          policy:
            'Viatik Funding Agreements are operational funding policies, not legal equity or debt agreements.',
        }}
        confirmLabel="Accept agreement"
        phase={accept.phase}
        error={accept.error}
        onConfirm={() => accept.run({ agreementId: agreement.id })}
        success={{
          title: 'Agreement accepted',
          body: `${investor} was notified. Released funding lands in your Operations account unless you choose another when you request it. ${agencyNextTranche[agreement.releaseModel]}`,
        }}
      />
      {receipts.drawer}
    </div>
  )
}

/** The Agency's agreements as a table with tabs, like the Investor's Funding: a row opens the agreement. */
function AgreementList({ agencyId }: { agencyId: string }) {
  const { state } = useViatikState()
  const href = useHref()
  const router = useRouter()
  const agreements = state.agreements.filter((a) => a.agencyId === agencyId)
  const investorOf = (a: FundingAgreement) =>
    state.portfolios.find((p) => p.id === a.portfolioId)?.name ?? 'Investor'
  // The next tranche that can still be released: a rejected or cancelled one never will be.
  const nextTranche = (a: FundingAgreement) =>
    state.tranches
      .filter((t) => t.agreementId === a.id && !trancheIsOver(t))
      .sort((x, y) => x.index - y.index)[0]
  const anyRejected = (a: FundingAgreement) =>
    state.tranches.some((t) => t.agreementId === a.id && t.status === 'rejected')

  const columns: ColumnDef<FundingAgreement, unknown>[] = [
    {
      id: 'agreement',
      header: 'Agreement',
      cell: ({ row }) => (
        <span className="flex items-center gap-3">
          <OrgAvatar name={investorOf(row.original)} size="sm" />
          <span className="flex flex-col">
            <span className="font-medium">{row.original.title}</span>
            <span className="text-xs text-subtle">From {investorOf(row.original)}</span>
          </span>
        </span>
      ),
    },
    {
      accessorKey: 'committed',
      header: 'Committed',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={row.original.committed} size="sm" />,
    },
    {
      id: 'funded',
      header: 'Funded',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={agreementCapital(state, row.original.id).funded} size="sm" />,
    },
    {
      id: 'released',
      header: 'Released',
      meta: { align: 'right' },
      cell: ({ row }) => <Amount value={agreementCapital(state, row.original.id).released} size="sm" />,
    },
    {
      id: 'remaining',
      header: 'Remaining',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <Amount value={agreementCapital(state, row.original.id).remainingCommitment} size="sm" tone="muted" />
      ),
    },
    {
      id: 'model',
      header: 'Release model',
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {releaseModelLabel[row.original.releaseModel].label}
        </span>
      ),
    },
    {
      id: 'next',
      header: 'Next tranche',
      cell: ({ row }) => {
        const next = nextTranche(row.original)
        return (
          <span className="text-sm text-muted-foreground">
            {next
              ? `${next.name}${next.scheduledFor ? ` · ${formatDate(next.scheduledFor)}` : ''}`
              : anyRejected(row.original)
                ? 'Nothing left to release'
                : 'All released'}
          </span>
        )
      },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusBadge status={agreementBadge(state, row.original)} />,
    },
  ]

  const table = (rows: FundingAgreement[]) => (
    <DataTable
      data={rows}
      columns={columns}
      caption="Funding agreements"
      searchPlaceholder="Search agreements"
      searchText={(a) => `${a.title} ${investorOf(a)}`}
      onRowClick={(a) => router.push(href(`funding?agreement=${a.id}`))}
      empty={
        <EmptyState
          compact
          icon={<HandCoins />}
          title="No agreements here"
          description="Agreements in this status will appear here."
        />
      }
      renderMobile={(a) => {
        const capital = agreementCapital(state, a.id)
        return (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex flex-col">
                <span className="text-sm font-medium">{a.title}</span>
                <span className="text-xs text-subtle">From {investorOf(a)}</span>
              </span>
              <StatusBadge status={agreementBadge(state, a)} />
            </div>
            <CapitalBar committed={capital.committed} funded={capital.funded} released={capital.released} />
          </div>
        )
      }}
    />
  )

  // By the status the badge shows: an agreement with every tranche released is listed as Closed.
  const byStatus = (predicate: (status: AgreementStatus) => boolean) =>
    agreements.filter((a) => predicate(agreementDisplayStatus(state, a)))
  const active = byStatus((s) => s === 'active')
  const pending = byStatus((s) => s === 'pending_acceptance')
  const closed = byStatus((s) => CLOSED.has(s))

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Funding"
        description="The funding agreements from your Investors. Open one to see its tranches, submit evidence or accept it."
      />
      <PageTabs
        tabs={[
          { value: 'all', label: 'All', content: table(agreements) },
          { value: 'active', label: 'Active', count: active.length, content: table(active) },
          { value: 'pending', label: 'Pending acceptance', count: pending.length, content: table(pending) },
          { value: 'paused', label: 'Paused', content: table(byStatus((s) => s === 'paused')) },
          { value: 'closed', label: 'Closed', count: closed.length, content: table(closed) },
        ]}
      />
    </div>
  )
}

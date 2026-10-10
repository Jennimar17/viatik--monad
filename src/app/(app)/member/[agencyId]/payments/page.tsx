'use client'

import { ArrowDownLeft, ArrowUpRight, Undo2 } from 'lucide-react'
import * as React from 'react'

import { AccountAddressCard, useAccountBalanceLine } from '@/components/app/account-address-card'
import {
  justifyHint,
  justifySummary,
  MemberAdvanceList,
  useMemberAccountability,
} from '@/components/app/member-advances'
import { MemberBalanceMovements } from '@/components/app/member-balance-movements'
import type { OwnAccount } from '@/components/app/member-own-account'
import { MemberReturnSheet } from '@/components/app/member-return-sheet'
import { MemberSavedAddresses } from '@/components/app/member-saved-addresses'
import { SettlementNote, useMemberViatikAccount } from '@/components/app/member-viatik-account'
import { MemberWithdrawSheet } from '@/components/app/member-withdraw-sheet'
import { PageTabs, type PageTab } from '@/components/app/page-tabs'
import { PaymentsTable } from '@/components/app/payments-table'
import { useRole } from '@/components/app/role-context'
import { useTabParam } from '@/components/app/use-tab-param'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { sum } from '@/domain/money'
import { justificationState, justificationStatus } from '@/domain/status'
import type { Id } from '@/domain/types'
import { networkInfo } from '@/domain/verification'
import { publicEnv } from '@/lib/env'
import { formatDate, pluralize } from '@/lib/format'

export default function MemberPaymentsPage() {
  // The open tab follows `?tab=` (useSearchParams), which needs a boundary for the static prerender.
  return (
    <React.Suspense>
      <MemberPayments />
    </React.Suspense>
  )
}

function MemberPayments() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const agency = state.agencies.find((a) => a.id === agencyId)
  const agencyName = agency?.name ?? 'your Agency'
  const account = useMemberViatikAccount(agencyId)
  const { held, own, canMove, canSendNow } = account
  const acc = useMemberAccountability(agencyId)
  const [sendOpen, setSendOpen] = React.useState(false)
  const [returnOpen, setReturnOpen] = React.useState(false)
  // The money for purchases the return sheet opens on (none: the oldest still open). It is kept
  // while the sheet closes, so its choice does not flip during the closing animation.
  const [returnFor, setReturnFor] = React.useState<Id | undefined>(undefined)
  const openReturn = (paymentId?: Id) => {
    setReturnFor(paymentId)
    setReturnOpen(true)
  }

  const received = state.payments.filter(
    (p) => p.agencyId === agencyId && p.recipient.kind === 'member' && p.recipient.userId === userId,
  )
  const completed = received.filter((p) => p.status === 'completed')
  const year = now.slice(0, 4)
  const thisYear = completed.filter((p) => (p.completedAt ?? '').startsWith(year))
  const next = received
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))[0]
  // Money for purchases gets its own tab (and KPI) once the person has received some.
  const hasAdvances = acc.all.length > 0
  // In Received, money for purchases shows how far it is justified instead of "Completed".
  const standingOf = new Map(acc.all.map((s) => [s.payment.id, s]))
  const receivedStatus = (p: { id: Id }) => {
    const standing = standingOf.get(p.id)
    return standing ? justificationStatus[justificationState(standing)] : undefined
  }

  const tabs: PageTab[] = [
    ...(hasAdvances
      ? [
          {
            value: 'justify',
            label: 'To justify',
            count: acc.open.length,
            content: (
              <Panel title="Money to justify" description={justifySummary(acc)}>
                <MemberAdvanceList advances={acc.all} onReturn={openReturn} from="payments" />
              </Panel>
            ),
          },
        ]
      : []),
    {
      value: 'received',
      label: 'Received',
      count: received.length,
      content: (
        <PaymentsTable
          payments={received}
          direction="in"
          showBudget={false}
          statusFor={receivedStatus}
          empty={
            <EmptyState
              compact
              icon={<ArrowDownLeft />}
              title="No payments yet"
              description="Payments from your Agency will appear here with their receipts."
            />
          }
        />
      ),
    },
    {
      value: 'movements',
      label: 'Movements',
      content: (
        <Panel
          title="In and out of your balance"
          description={`Payments from ${agencyName}, what you sent to an account, and what you returned. Each one opens its receipt.`}
        >
          <MemberBalanceMovements agencyId={agencyId} agencyName={agencyName} ownAddress={own.address} />
        </Panel>
      ),
    },
    {
      value: 'addresses',
      label: 'Addresses',
      content: (
        <div className="flex flex-col gap-6">
          <OwnAccountCard own={own} />
          <Panel
            title="Where you can send it"
            description="Your Viatik account is the default. Save other addresses you own to send there too."
          >
            <MemberSavedAddresses own={own} />
          </Panel>
        </div>
      ),
    },
  ]
  // While something is still to justify, Payments opens on it (where "Money for purchases"
  // notifications land); `?tab=` links open any tab.
  const tab = useTabParam(
    tabs.map((t) => t.value),
    acc.open.length > 0 ? 'justify' : 'received',
  )

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        // Two actions: the text keeps the full width until there is room beside them.
        className="md:flex-col md:items-start lg:flex-row lg:items-end"
        title="Payments"
        description={`Money ${agencyName} paid you, each payment with its receipt. Send it to your Viatik account or return what you do not need. Money for purchases needs receipts for what you buy, or goes back.`}
        actions={
          canMove ? (
            <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <Button size="pill" disabled={!canSendNow} onClick={() => setSendOpen(true)}>
                <ArrowUpRight data-icon="inline-start" /> Send to my account
              </Button>
              <Button variant="outline" size="pill" disabled={held <= 0} onClick={() => openReturn()}>
                <Undo2 data-icon="inline-start" /> Return unused funds
              </Button>
            </div>
          ) : null
        }
      />

      <div className="flex flex-col gap-3">
        <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Viatik balance"
            value={held}
            hint={held <= 0 ? 'Nothing to send yet' : canSendNow ? 'Ready to send' : 'Held for you'}
            emphasis
          />
          <KpiTile
            label="Received this year"
            value={sum(thisYear, (p) => p.amount)}
            hint={pluralize(thisYear.length, 'payment')}
          />
          {hasAdvances ? (
            <KpiTile label="To justify" value={acc.pending} hint={justifyHint(acc)} />
          ) : (
            <KpiTile
              label="Received in total"
              value={sum(completed, (p) => p.amount)}
              hint={pluralize(completed.length, 'payment')}
            />
          )}
          <KpiTile
            label="Next expected payment"
            value={
              next ? next.amount : <span className="text-sm text-muted-foreground">Nothing scheduled</span>
            }
            hint={next ? `${next.memo} · ${formatDate(next.scheduledFor)}` : 'Scheduled payouts show here'}
          />
        </HairlineGrid>
        <SettlementNote account={account} agencyName={agencyName} />
      </div>

      <PageTabs tabs={tabs} {...tab} />

      <MemberWithdrawSheet
        open={sendOpen && canMove}
        onOpenChange={setSendOpen}
        agencyId={agencyId}
        agencyName={agencyName}
        held={held}
        own={own}
      />
      {/* One return sheet for the page: the header opens it on the oldest open money for purchases, a row on its own. */}
      <MemberReturnSheet
        open={returnOpen && canMove}
        onOpenChange={setReturnOpen}
        agencyId={agencyId}
        agencyName={agencyName}
        advanceId={returnFor}
      />
    </div>
  )
}

/**
 * The person's own Viatik account, where "Send to my account" lands: the full
 * address, the TestUSD it holds on Monad and its QR code behind "Show QR code".
 * Rendered only while the Addresses tab is open, so its live read runs only then.
 */
function OwnAccountCard({ own }: { own: OwnAccount }) {
  const balance = useAccountBalanceLine(own)
  const network = networkInfo(publicEnv.NEXT_PUBLIC_MONAD_NETWORK)
  return (
    <AccountAddressCard
      own={own}
      description="Where “Send to my account” sends your Viatik balance."
      qr="collapsed"
      balance={balance}
      settlementNotes={{
        monad: `What you send from your Viatik balance arrives here as TestUSD on ${network.name}.`,
        test: 'Test environment: Viatik records what you send, but nothing arrives at this address yet.',
      }}
      note="Money sent here from elsewhere stays in this account: it does not add to your Viatik balance or count as a return."
    />
  )
}

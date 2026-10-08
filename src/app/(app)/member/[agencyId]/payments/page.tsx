'use client'

import { ArrowDownLeft, ArrowUpRight, Undo2 } from 'lucide-react'
import * as React from 'react'

import { MemberBalanceMovements } from '@/components/app/member-balance-movements'
import { MemberReturnSheet } from '@/components/app/member-return-sheet'
import { MemberSavedAddresses } from '@/components/app/member-saved-addresses'
import { SettlementNote, useMemberViatikAccount } from '@/components/app/member-viatik-account'
import { MemberWithdrawSheet } from '@/components/app/member-withdraw-sheet'
import { PageTabs } from '@/components/app/page-tabs'
import { PaymentsTable } from '@/components/app/payments-table'
import { useRole } from '@/components/app/role-context'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/viatik/feedback'
import { KpiTile } from '@/components/viatik/finance'
import { HairlineGrid, PageHeader, Panel } from '@/components/viatik/layout'
import { useViatikState } from '@/data/react'
import { sum } from '@/domain/money'
import { formatDate, pluralize } from '@/lib/format'

export default function MemberPaymentsPage() {
  const { state, now, userId } = useViatikState()
  const { scopeId: agencyId } = useRole()
  const agency = state.agencies.find((a) => a.id === agencyId)
  const agencyName = agency?.name ?? 'your Agency'
  const account = useMemberViatikAccount(agencyId)
  const { held, own, canMove, canSendNow } = account
  const [sendOpen, setSendOpen] = React.useState(false)
  const [returnOpen, setReturnOpen] = React.useState(false)

  const received = state.payments.filter(
    (p) => p.agencyId === agencyId && p.recipient.kind === 'member' && p.recipient.userId === userId,
  )
  const completed = received.filter((p) => p.status === 'completed')
  const year = now.slice(0, 4)
  const thisYear = completed.filter((p) => (p.completedAt ?? '').startsWith(year))
  const next = received
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))[0]

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        // Two actions: the text keeps the full width until there is room beside them.
        className="md:flex-col md:items-start lg:flex-row lg:items-end"
        title="Payments"
        description={`Money ${agencyName} paid you. Once paid, it is yours: send it to your account or return what you do not need. Each payment has its receipt.`}
        actions={
          canMove ? (
            <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
              <Button size="pill" disabled={!canSendNow} onClick={() => setSendOpen(true)}>
                <ArrowUpRight data-icon="inline-start" /> Send to my account
              </Button>
              <Button variant="outline" size="pill" disabled={held <= 0} onClick={() => setReturnOpen(true)}>
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
          <KpiTile
            label="Received in total"
            value={sum(completed, (p) => p.amount)}
            hint={pluralize(completed.length, 'payment')}
          />
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

      <PageTabs
        tabs={[
          {
            value: 'received',
            label: 'Received',
            count: received.length,
            content: (
              <PaymentsTable
                payments={received}
                direction="in"
                showBudget={false}
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
                <MemberBalanceMovements
                  agencyId={agencyId}
                  agencyName={agencyName}
                  ownAddress={own.address}
                />
              </Panel>
            ),
          },
          {
            value: 'addresses',
            label: 'Addresses',
            content: (
              <Panel
                title="Where you can send it"
                description="Your own account is the default. Save other addresses to send there too."
              >
                <MemberSavedAddresses own={own} />
              </Panel>
            ),
          },
        ]}
      />

      <MemberWithdrawSheet
        open={sendOpen && canMove}
        onOpenChange={setSendOpen}
        agencyId={agencyId}
        agencyName={agencyName}
        held={held}
        own={own}
      />
      <MemberReturnSheet
        open={returnOpen && canMove}
        onOpenChange={setReturnOpen}
        agencyId={agencyId}
        agencyName={agencyName}
        held={held}
      />
    </div>
  )
}

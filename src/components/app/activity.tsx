import {
  ArrowLeftRight,
  BadgeCheck,
  Ban,
  Bot,
  Building2,
  CircleCheck,
  FilePlus2,
  FileText,
  HandCoins,
  Landmark,
  Link2,
  type LucideIcon,
  PauseCircle,
  PieChart,
  PlayCircle,
  Send,
  ShieldX,
  UserPlus,
  UserRound,
} from 'lucide-react'

import { ActivityFeed, type ActivityItem } from '@/components/viatik/activity-feed'
import { actorName } from '@/domain/queries'
import type { Activity, ActivityType, ViatikState } from '@/domain/types'

const icons: Record<ActivityType, LucideIcon> = {
  agreement_created: FilePlus2,
  agreement_paused: PauseCircle,
  agreement_frozen: PauseCircle,
  capital_deposited: Landmark,
  agreement_funded: HandCoins,
  tranche_requested: Send,
  milestone_submitted: FileText,
  milestone_changes_requested: FileText,
  tranche_released: BadgeCheck,
  account_created: Landmark,
  funds_transferred: ArrowLeftRight,
  budget_created: PieChart,
  budget_paused: PauseCircle,
  budget_resumed: PlayCircle,
  allowance_assigned: UserRound,
  allowance_revoked: Ban,
  payment_requested: Send,
  payment_approved: CircleCheck,
  payment_declined: Ban,
  payment_completed: CircleCheck,
  policy_rejected: ShieldX,
  bill_added: FileText,
  bill_reconciled: Link2,
  expense_added: FileText,
  member_invited: UserPlus,
  member_joined: UserPlus,
  agent_created: Bot,
  agent_paused: PauseCircle,
  agent_resumed: PlayCircle,
  agency_created: Building2,
}

const DANGER: ReadonlySet<ActivityType> = new Set(['policy_rejected', 'payment_declined', 'agreement_frozen'])
const SUCCESS: ReadonlySet<ActivityType> = new Set([
  'tranche_released',
  'payment_completed',
  'bill_reconciled',
])

/** Domain activity records → the presentational feed (person or AI Agent, icon, tone). */
export function toActivityItems(
  state: ViatikState,
  records: Activity[],
  options: { showAgency?: boolean } = {},
) {
  return records.map<ActivityItem>((record) => ({
    id: record.id,
    actor: {
      kind: record.actor.kind === 'ai_agent' ? 'ai_agent' : 'user',
      name: actorName(state, record.actor),
    },
    summary: record.summary,
    at: record.createdAt,
    amount: record.amount,
    icon: icons[record.type],
    tone: DANGER.has(record.type) ? 'danger' : SUCCESS.has(record.type) ? 'success' : 'default',
    context:
      options.showAgency && record.agencyId
        ? state.agencies.find((a) => a.id === record.agencyId)?.name
        : undefined,
  }))
}

export function ActivityList({
  state,
  records,
  now,
  grouped,
  showAgency,
}: {
  state: ViatikState
  records: Activity[]
  now: string
  grouped?: boolean
  showAgency?: boolean
}) {
  return <ActivityFeed items={toActivityItems(state, records, { showAgency })} now={now} grouped={grouped} />
}

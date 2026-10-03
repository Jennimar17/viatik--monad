import { ArrowDownToLine, FileText, Landmark, PieChart, ShieldX, Wallet } from 'lucide-react'
import type * as React from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ActivityFeed, type ActivityItem } from '@/components/viatik/activity-feed'
import { Amount, CompactAmount } from '@/components/viatik/amount'
import { MoneyAreaChart, MoneyBarChart, MoneyDonut, UsageRing } from '@/components/viatik/charts'
import { EmptyState, ErrorState, OfflineState } from '@/components/viatik/feedback'
import {
  BudgetCard,
  BudgetHealth,
  CapitalBar,
  CapitalStateList,
  CapitalTrail,
  FundingProgress,
  KpiTile,
  MilestoneTimeline,
  TrancheCard,
  UsageBar,
  type CapitalStates,
} from '@/components/viatik/finance'
import {
  GlassPanel,
  HairlineGrid,
  KeyValueList,
  PageHeader,
  Panel,
  SectionLabel,
} from '@/components/viatik/layout'
import { AgentAvatar, OrgAvatar, PersonAvatar, roleIcons } from '@/components/viatik/people'
import { PolicySummary } from '@/components/viatik/policy'
import { ReceiptView } from '@/components/viatik/receipt-view'
import { StatusBadge, StatusDot, Tag, type StatusTone } from '@/components/viatik/status'
import { ViatikLogo, ViatikMark } from '@/components/viatik/viatik-logo'
import { usd } from '@/domain/money'

import { ContrastTable } from './_components/contrast-table'
import {
  ButtonStatesDemo,
  InputsDemo,
  OperationPhasesDemo,
  OverlaysDemo,
  TableDemo,
} from './_components/interactive'

// Fictional sample data. Amounts are integer cents.
const NOW = '2026-09-23T12:00:00.000Z'

const capital: CapitalStates = {
  committed: usd(100_000),
  funded: usd(50_000),
  released: usd(25_000),
  allocated: usd(5_000),
  reserved: usd(380),
  spent: usd(1_620),
  returned: usd(0),
}

const months = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep']
const capitalOverTime = months.map((month, index) => ({
  month,
  released: usd([0, 0, 25_000, 25_000, 25_000, 50_000][index] ?? 0),
  spent: usd([0, 0, 4_200, 9_800, 16_400, 24_300][index] ?? 0),
}))
const spendByBudget = months.map((month, index) => ({
  month,
  delivery: usd([0, 0, 1_800, 2_400, 2_900, 3_100][index] ?? 0),
  tools: usd([0, 0, 600, 900, 1_100, 1_250][index] ?? 0),
  ops: usd([0, 0, 1_200, 1_400, 1_500, 1_600][index] ?? 0),
}))
const deploymentByAgency = [
  { agency: 'Arc Studio', released: usd(25_000), spent: usd(18_400) },
  { agency: 'Lumen Labs', released: usd(40_000), spent: usd(31_200) },
  { agency: 'Fieldwork', released: usd(15_000), spent: usd(6_300) },
]

const activity: ActivityItem[] = [
  {
    id: 'a1',
    actor: { kind: 'user', name: 'Northstar Capital' },
    summary: 'Released tranche 2 after “Prototype delivered” was approved',
    at: '2026-09-23T10:12:00.000Z',
    amount: usd(25_000),
    icon: Landmark,
    tone: 'success',
  },
  {
    id: 'a2',
    actor: { kind: 'ai_agent', name: 'Research Assistant' },
    summary: 'Requested a payment to Vertex Cloud within its daily cap',
    at: '2026-09-23T08:40:00.000Z',
    amount: usd(18),
    context: 'Arc Studio',
  },
  {
    id: 'a3',
    actor: { kind: 'user', name: 'Alex Morgan' },
    summary: 'A 900.00 USD request was rejected by the budget rules',
    at: '2026-09-22T16:05:00.000Z',
    icon: ShieldX,
    tone: 'danger',
  },
  {
    id: 'a4',
    actor: { kind: 'user', name: 'Maya Chen' },
    summary: 'Created the Product Delivery budget and assigned 500.00 USD per month to Alex',
    at: '2026-09-22T11:20:00.000Z',
    amount: usd(5_000),
    icon: PieChart,
  },
]

const tones: StatusTone[] = ['neutral', 'info', 'accent', 'success', 'warning', 'danger']
const toneLabels: Record<StatusTone, string> = {
  neutral: 'Draft',
  info: 'Scheduled',
  accent: 'Processing',
  success: 'Completed',
  warning: 'Action required',
  danger: 'Rejected',
}

const swatches = [
  { name: 'Plum', token: '--brand-plum', className: 'bg-brand' },
  { name: 'Mist', token: '--brand-mist', className: 'bg-mist' },
  { name: 'Stone', token: '--brand-stone', className: 'bg-stone' },
  { name: 'Sage', token: '--brand-sage', className: 'bg-sage' },
  { name: 'Paper', token: '--brand-paper', className: 'bg-paper' },
  { name: 'Success', token: '--v-success', className: 'bg-success' },
  { name: 'Warning', token: '--v-warning', className: 'bg-warning' },
  { name: 'Danger', token: '--v-danger', className: 'bg-danger' },
  { name: 'Info', token: '--v-info', className: 'bg-info' },
]

const typeScale = [
  { className: 'font-display text-6xl', label: 'Display · 6xl' },
  { className: 'font-display text-4xl', label: 'Heading · 4xl' },
  { className: 'font-display text-2xl', label: 'Heading · 2xl' },
  { className: 'text-lg', label: 'Body large · lg' },
  { className: 'text-base', label: 'Body · base' },
  { className: 'text-sm', label: 'Body small · sm' },
  { className: 'text-xs', label: 'Caption · xs (0.75rem in product)' },
  { className: 'text-2xs uppercase tracking-[0.08em]', label: 'Micro · 2xs' },
  { className: 'font-mono text-sm', label: 'Mono · JetBrains Mono' },
]

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-8 flex-col gap-6 border-t border-border pt-10"
    >
      <div className="flex flex-col gap-1.5">
        <h2 id={`${id}-title`} className="font-display text-2xl font-medium tracking-tight">
          {title}
        </h2>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

export default function DesignPage() {
  const InvestorIcon = roleIcons.investor
  const AdminIcon = roleIcons.agency_admin
  const MemberIcon = roleIcons.member
  const AgentIcon = roleIcons.ai_agent

  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-[1360px] flex-col gap-12 px-4 py-10 sm:px-8 sm:py-14"
    >
      <PageHeader
        eyebrow={
          <>
            <ViatikMark className="size-6" /> <span>Viatik</span> <Tag>Internal</Tag>
          </>
        }
        title="Design system"
        description="Tokens, surfaces and components shared by the landing and the product. Every example uses fictional data."
      />

      <Section
        id="surfaces"
        title="Surfaces"
        description="Grain on the canvas, glass only on floating chrome, opaque surfaces wherever money is shown."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex h-32 flex-col justify-end rounded-xl border border-border bg-canvas p-4 text-sm">
            Canvas
          </div>
          <div className="surface flex h-32 flex-col justify-end rounded-xl p-4 text-sm">
            Surface · cards, tables, forms
          </div>
          <GlassPanel className="flex h-32 flex-col justify-end p-4 text-sm">
            Glass · floating chrome
          </GlassPanel>
          <div className="theme-light flex h-32 flex-col justify-end rounded-xl border border-border p-4 text-sm">
            Paper · receipts
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <ViatikLogo href="" />
          <ViatikMark />
          <div className="theme-light flex items-center gap-4 rounded-xl px-4 py-2">
            <ViatikLogo href="" tone="dark" />
            <ViatikMark tone="dark" />
          </div>
        </div>
      </Section>

      <Section
        id="color"
        title="Color"
        description="Brand colors from the logos. Status hues are restrained and only used to describe data."
      >
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
          {swatches.map((swatch) => (
            <div key={swatch.name} className="flex flex-col gap-2">
              <span
                className={`h-14 rounded-lg border border-border ${swatch.className}`}
                aria-hidden="true"
              />
              <span className="text-sm">{swatch.name}</span>
              <span className="font-mono text-2xs text-subtle">{swatch.token}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tones.map((tone) => (
            <StatusBadge key={tone} status={{ label: toneLabels[tone], tone }} />
          ))}
          <StatusBadge status={{ label: 'Under review', tone: 'warning' }} pulse size="md" />
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <StatusDot tone="success" /> Healthy
          </span>
          <Tag>Investor</Tag>
          <Tag>Agency admin</Tag>
          <Tag>Member</Tag>
        </div>
      </Section>

      <Section
        id="type"
        title="Typography"
        description="Inter for text, Archivo for display, JetBrains Mono for hashes and addresses."
      >
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {typeScale.map((item) => (
            <div
              key={item.label}
              className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <span className={`${item.className} truncate`}>Fund the work</span>
              <span className="shrink-0 text-xs text-subtle">{item.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        id="buttons"
        title="Buttons"
        description="One primary action per screen: a mist pill on plum. Secondary actions use outline, glass or ghost."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button size="pill">Create funding agreement</Button>
          <Button size="pill" variant="secondary">
            Add funds
          </Button>
          <Button size="pill" variant="outline">
            Export CSV
          </Button>
          <Button size="pill" variant="ghost">
            Cancel
          </Button>
          <Button size="pill" variant="destructive">
            Freeze agreement
          </Button>
          <Button size="pill-sm">Small pill</Button>
          <Button size="icon-pill" variant="outline" aria-label="Download receipt">
            <ArrowDownToLine />
          </Button>
          <Button size="pill" disabled>
            Disabled
          </Button>
          <Button variant="link">View all</Button>
        </div>
        <ButtonStatesDemo />
      </Section>

      <Section
        id="forms"
        title="Forms"
        description="Pill inputs, money in integer cents, and a live policy preview while the amount is typed."
      >
        <InputsDemo />
      </Section>

      <Section
        id="money"
        title="Money and capital"
        description="Amounts always show USD; capital states are never merged into one balance."
      >
        <div className="flex flex-wrap items-baseline gap-8">
          <Amount value={usd(25_000)} size="display" />
          <Amount value={usd(5_000)} size="xl" />
          <Amount value={usd(1_250)} size="lg" />
          <Amount value={usd(120)} size="md" code />
          <Amount value={usd(-900)} size="sm" signed tone="negative" />
          <CompactAmount value={usd(124_500)} className="text-lg" />
        </div>
        <HairlineGrid className="grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Total committed"
            value={usd(100_000)}
            icon={<Landmark />}
            hint="Across 3 agreements"
          />
          <KpiTile
            label="Total released"
            value={usd(25_000)}
            delta={{ value: '+25%', direction: 'up' }}
            trend={[0, 0, 25, 25, 25, 50]}
          />
          <KpiTile label="Available to operate" value={usd(18_400)} icon={<Wallet />} emphasis />
          <KpiTile
            label="Pending tranche requests"
            value={<span className="font-display text-2xl">2</span>}
          />
        </HairlineGrid>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Capital states" description="Northstar Capital portfolio">
            <CapitalStateList states={capital} />
          </Panel>
          <Panel title="Agreement progress" description="Arc Studio · Seed build">
            <div className="flex flex-col gap-6">
              <CapitalBar
                committed={usd(100_000)}
                funded={usd(50_000)}
                released={usd(25_000)}
                spent={usd(1_620)}
              />
              <FundingProgress
                segments={[
                  { id: 't1', label: 'Kickoff', amount: usd(25_000), state: 'released' },
                  { id: 't2', label: 'Prototype', amount: usd(25_000), state: 'review' },
                  { id: 't3', label: 'Beta', amount: usd(25_000), state: 'available' },
                  { id: 't4', label: 'Launch', amount: usd(25_000), state: 'planned' },
                ]}
              />
              <KeyValueList
                dense
                items={[
                  { label: 'Release model', value: 'Milestone-based' },
                  { label: 'Next tranche', value: <Amount value={usd(25_000)} size="sm" code /> },
                  { label: 'Ends', value: 'Mar 31, 2027' },
                ]}
              />
            </div>
          </Panel>
        </div>
      </Section>

      <Section id="funding" title="Tranches and milestones">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <TrancheCard
            label="Tranche 1 · Kickoff"
            amount={usd(25_000)}
            status={{ label: 'Released', tone: 'success' }}
            milestone="Team and plan confirmed"
            detail="Released Jun 3 to Arc Studio Operations"
          />
          <TrancheCard
            label="Tranche 2 · Prototype"
            amount={usd(25_000)}
            status={{ label: 'Under review', tone: 'warning' }}
            milestone="Prototype delivered"
            detail="Evidence submitted Sep 21 by Maya Chen"
            action={<Button size="pill-sm">Review milestone</Button>}
          />
          <TrancheCard
            label="Tranche 3 · Beta"
            amount={usd(25_000)}
            status={{ label: 'Planned', tone: 'neutral' }}
            milestone="Private beta with 20 teams"
          />
        </div>
        <Panel title="Milestones">
          <MilestoneTimeline
            items={[
              {
                id: 'm1',
                title: 'Team and plan confirmed',
                date: 'Approved Jun 2',
                amount: usd(25_000),
                status: { label: 'Approved', tone: 'success' },
                state: 'done',
              },
              {
                id: 'm2',
                title: 'Prototype delivered',
                subtitle: 'Clickable prototype and technical design',
                date: 'Submitted Sep 21',
                amount: usd(25_000),
                status: { label: 'Ready for review', tone: 'warning' },
                state: 'current',
              },
              {
                id: 'm3',
                title: 'Private beta with 20 teams',
                date: 'Due Dec 15',
                amount: usd(25_000),
                status: { label: 'Not started', tone: 'neutral' },
                state: 'upcoming',
              },
            ]}
          />
        </Panel>
        <CapitalTrail
          steps={[
            { id: 's1', label: 'Commitment', title: 'Northstar Capital commits', amount: usd(100_000) },
            { id: 's2', label: 'Release', title: 'Tranche 2 released', amount: usd(25_000) },
            { id: 's3', label: 'Budget', title: 'Product Delivery', amount: usd(5_000) },
            { id: 's4', label: 'Payment', title: 'Vertex Cloud', amount: usd(120) },
            { id: 's5', label: 'Receipt', title: 'RCT-0042', detail: 'Verified on Monad' },
          ]}
        />
      </Section>

      <Section id="budgets" title="Budgets and policy">
        <div className="grid gap-4 lg:grid-cols-3">
          <BudgetCard
            name="Product Delivery"
            source="Operations"
            allocated={usd(5_000)}
            spent={usd(1_620)}
            reserved={usd(380)}
            period="Monthly · resets Oct 1"
            status={{ label: 'Active', tone: 'success' }}
            assignees={[
              { name: 'Alex Morgan', kind: 'user' },
              { name: 'Maya Chen', kind: 'user' },
              { name: 'Research Assistant', kind: 'ai_agent' },
            ]}
            action={
              <Button variant="ghost" size="pill-sm">
                Open budget
              </Button>
            }
          />
          <Panel title="Budget health">
            <BudgetHealth
              budgets={[
                {
                  id: 'b1',
                  name: 'Product Delivery',
                  used: usd(1_620),
                  reserved: usd(380),
                  limit: usd(5_000),
                },
                { id: 'b2', name: 'Research & Tools', used: usd(1_150), limit: usd(1_500) },
                { id: 'b3', name: 'Operations', used: usd(2_900), limit: usd(3_000) },
              ]}
            />
          </Panel>
          <Panel title="Allowance">
            <div className="flex items-center gap-6">
              <UsageRing value={120} max={500} label="Monthly allowance">
                <Amount value={usd(380)} size="md" />
                <span className="text-xs text-subtle">left of 500</span>
              </UsageRing>
              <UsageBar used={usd(120)} limit={usd(500)} className="flex-1" />
            </div>
          </Panel>
        </div>
        <Panel>
          <PolicySummary
            lines={[
              'Up to 500.00 USD per operation.',
              'Up to 5,000.00 USD per month in total.',
              'Requests above 250.00 USD need approval from an Agency Admin.',
              'Only Vertex Cloud, Figma, Linear and Notion can be paid.',
            ]}
          />
        </Panel>
      </Section>

      <Section
        id="charts"
        title="Charts"
        description="Recharts through the shadcn chart, using the brand chart palette."
      >
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Capital over time">
            <MoneyAreaChart
              data={capitalOverTime}
              series={[
                { key: 'released', label: 'Released', color: 'var(--chart-1)' },
                { key: 'spent', label: 'Spent', color: 'var(--chart-2)' },
              ]}
            />
          </Panel>
          <Panel title="Spend by budget">
            <MoneyBarChart
              data={spendByBudget}
              series={[
                { key: 'delivery', label: 'Product Delivery', color: 'var(--chart-1)' },
                { key: 'tools', label: 'Research & Tools', color: 'var(--chart-2)' },
                { key: 'ops', label: 'Operations', color: 'var(--chart-3)' },
              ]}
            />
          </Panel>
          <Panel title="Capital deployment by agency">
            <MoneyBarChart
              layout="horizontal-bars"
              xKey="agency"
              data={deploymentByAgency}
              series={[
                { key: 'spent', label: 'Spent', color: 'var(--chart-2)' },
                { key: 'released', label: 'Released', color: 'var(--chart-4)' },
              ]}
            />
          </Panel>
          <Panel title="Spend by category">
            <MoneyDonut
              centerValue="4.9K"
              centerLabel="this month"
              data={[
                { key: 'cloud', label: 'Cloud', value: usd(2_100), color: 'var(--chart-1)' },
                { key: 'design', label: 'Design tools', value: usd(1_250), color: 'var(--chart-2)' },
                { key: 'people', label: 'Contractors', value: usd(1_600), color: 'var(--chart-3)' },
              ]}
            />
          </Panel>
        </div>
      </Section>

      <Section
        id="table"
        title="Data table"
        description="Search, filter chips, sorting and pagination; rows become cards on phones."
      >
        <TableDemo />
      </Section>

      <Section
        id="overlays"
        title="Overlays and operations"
        description="Money-moving actions always confirm what, how much, from where to where, whether it can be undone and which policy allows it."
      >
        <OverlaysDemo />
        <OperationPhasesDemo />
      </Section>

      <Section id="activity" title="People and activity">
        <div className="flex flex-wrap items-center gap-4">
          <PersonAvatar name="Maya Chen" size="lg" />
          <PersonAvatar name="Alex Morgan" size="md" />
          <AgentAvatar size="md" />
          <OrgAvatar name="Arc Studio" size="md" />
          <span className="flex items-center gap-3 text-subtle">
            <InvestorIcon className="size-5" aria-label="Investor" />
            <AdminIcon className="size-5" aria-label="Agency Admin" />
            <MemberIcon className="size-5" aria-label="Member" />
            <AgentIcon className="size-5" aria-label="AI Agent" />
          </span>
        </div>
        <Panel title="Recent activity">
          <ActivityFeed items={activity} now={NOW} grouped />
        </Panel>
      </Section>

      <Section id="states" title="Empty, error, offline and loading">
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState
            icon={<FileText />}
            title="No budgets yet"
            description="Budgets set the rules for how money in an account can be spent."
            action={<Button size="pill-sm">Create budget</Button>}
          />
          <ErrorState />
        </div>
        <OfflineState />
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </Section>

      <Section id="receipt" title="Receipt">
        <ReceiptView
          className="max-w-2xl"
          kindLabel="Payment receipt"
          number="RCT-0042"
          description="Vertex Cloud · September compute"
          amount={usd(120)}
          issuedAt="2026-09-22T14:32:00.000Z"
          rows={[
            { label: 'From', value: 'Product Delivery budget' },
            { label: 'To', value: 'Vertex Cloud' },
            { label: 'Organization', value: 'Arc Studio' },
            { label: 'Policy applied', value: 'Within the per-operation limit' },
            { label: 'Receipt hash', value: '0x4e6a8c0b2d…d2f4a6c', mono: true },
          ]}
          evidence={[
            {
              id: 'ev_sample',
              name: 'vertex-invoice-0917.pdf',
              label: 'vertex-invoice-0917.pdf',
              fingerprint: '9f2c41ab77e0d5c3b8a1',
            },
          ]}
        />
      </Section>

      <Section
        id="accessibility"
        title="Focus and contrast"
        description="Every control shows a visible focus ring. Ratios below are measured from the live styles; AA needs 4.5:1 for text."
      >
        <div className="flex flex-wrap items-center gap-3">
          <SectionLabel>Tab through</SectionLabel>
          <Button size="pill-sm">Primary</Button>
          <Button size="pill-sm" variant="outline">
            Outline
          </Button>
          <Input className="w-56" placeholder="Input" aria-label="Focus demo" />
        </div>
        <ContrastTable />
      </Section>
    </main>
  )
}

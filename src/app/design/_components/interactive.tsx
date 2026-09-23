'use client'

import type { ColumnDef } from '@tanstack/react-table'
import {
  Bell,
  ChevronDown,
  Command as CommandIcon,
  Landmark,
  MoreHorizontal,
  PieChart,
  Send,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ApprovalSheet } from '@/components/viatik/approval-sheet'
import { Amount } from '@/components/viatik/amount'
import { DataTable } from '@/components/viatik/data-table'
import { ChoiceCard, EvidenceUploader, MoneyInput, Stepper, type DraftFile } from '@/components/viatik/forms'
import { PendingOperation, type OperationPhase } from '@/components/viatik/operation'
import { OrgAvatar } from '@/components/viatik/people'
import { PolicyVerdict, type PolicyDecision } from '@/components/viatik/policy'
import { StatusBadge, type StatusDescriptor } from '@/components/viatik/status'
import { VerifiedDetailsButton, type VerifiedRecord } from '@/components/viatik/verified-details-drawer'
import { usd, type Cents } from '@/domain/money'

// ─── Inputs ──────────────────────────────────────────────────────────────────

const PER_OPERATION_LIMIT = usd(500)
const APPROVAL_THRESHOLD = usd(250)

/** Live policy preview, as the Member request form will show it. */
function previewPolicy(amount: Cents | null): PolicyDecision | null {
  if (amount === null || amount <= 0) return null
  const withinLimit = amount <= PER_OPERATION_LIMIT
  const underThreshold = amount <= APPROVAL_THRESHOLD
  return {
    outcome: !withinLimit ? 'rejected' : underThreshold ? 'approved' : 'needs_approval',
    reason: withinLimit
      ? { message: 'Requests above 250.00 USD need an Agency Admin to approve them.' }
      : { message: 'Exceeds your per-operation limit of 500.00 USD.' },
    checks: [
      {
        rule: 'per_operation',
        passed: withinLimit,
        blocking: true,
        message: 'Up to 500.00 USD per operation',
      },
      {
        rule: 'destination',
        passed: true,
        blocking: true,
        message: 'Vertex Cloud is an allowed destination',
      },
      {
        rule: 'approval_threshold',
        passed: underThreshold,
        blocking: false,
        message: 'Approves automatically up to 250.00 USD',
      },
    ],
  }
}

export function InputsDemo() {
  const [amount, setAmount] = React.useState<Cents | null>(usd(120))
  const [files, setFiles] = React.useState<DraftFile[]>([])
  const [template, setTemplate] = React.useState('operations')
  const decision = previewPolicy(amount)

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="demo-name">Budget name</FieldLabel>
          <Input id="demo-name" placeholder="Product Delivery" />
          <FieldDescription>Shown to everyone assigned to this budget.</FieldDescription>
        </Field>
        <Field data-invalid>
          <FieldLabel htmlFor="demo-email">Admin email</FieldLabel>
          <Input id="demo-email" defaultValue="maya@" aria-invalid />
          <FieldError>Enter a valid email address.</FieldError>
        </Field>
        <Field>
          <FieldLabel>Period</FieldLabel>
          <Select
            defaultValue="monthly"
            items={[
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'quarterly', label: 'Quarterly' },
            ]}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="demo-purpose">Purpose</FieldLabel>
          <Textarea id="demo-purpose" placeholder="What this budget pays for" />
        </Field>
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox defaultChecked /> Require a receipt
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch defaultChecked /> Email me about approvals
          </label>
        </div>
        <RadioGroup defaultValue="milestone" className="gap-2">
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="milestone" /> Milestone-based release
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="scheduled" /> Scheduled release
          </label>
        </RadioGroup>
      </FieldGroup>

      <div className="flex flex-col gap-6">
        <Field>
          <FieldLabel htmlFor="demo-amount">Amount</FieldLabel>
          <MoneyInput id="demo-amount" value={amount} onChange={setAmount} available={usd(380)} />
        </Field>
        {decision ? <PolicyVerdict decision={decision} /> : null}
        <Stepper steps={['Account', 'Template', 'Amount', 'Rules', 'Review']} current={2} />
        <div role="radiogroup" aria-label="Account template" className="grid gap-3 sm:grid-cols-2">
          <ChoiceCard
            selected={template === 'operations'}
            onSelect={() => setTemplate('operations')}
            title="Operations"
            description="Day-to-day tools and services."
            icon={<Landmark />}
          />
          <ChoiceCard
            selected={template === 'project'}
            onSelect={() => setTemplate('project')}
            title="Project"
            description="Ring-fenced money for one deliverable."
            icon={<PieChart />}
          />
        </div>
        <EvidenceUploader files={files} onChange={setFiles} />
      </div>
    </div>
  )
}

// ─── Buttons with state ──────────────────────────────────────────────────────

export function ButtonStatesDemo() {
  const [loading, setLoading] = React.useState(false)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="pill"
        disabled={loading}
        onClick={() => {
          setLoading(true)
          setTimeout(() => setLoading(false), 1600)
        }}
      >
        {loading ? <Spinner data-icon="inline-start" /> : <Send data-icon="inline-start" />}
        {loading ? 'Sending…' : 'Send payment'}
      </Button>
      <div className="inline-flex">
        <Button size="pill" className="rounded-r-none pr-4">
          Send payment
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-pill"
                aria-label="More payment types"
                className="rounded-l-none border-l border-primary-foreground/20"
              />
            }
          >
            <ChevronDown />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Pay team</DropdownMenuItem>
            <DropdownMenuItem>Pay bill</DropdownMenuItem>
            <DropdownMenuItem>Reimburse expense</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Tooltip>
        <TooltipTrigger render={<Button variant="outline" size="icon-pill" aria-label="Notifications" />}>
          <Bell />
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── Overlays ────────────────────────────────────────────────────────────────

const verifiedRecord: VerifiedRecord = {
  title: 'RCT-0042 · Vertex Cloud invoice',
  amount: usd(120),
  fromLabel: 'Product Delivery budget',
  toLabel: 'Vertex Cloud',
  details: {
    status: 'confirmed',
    network: 'Monad Testnet',
    chainId: 10143,
    account: '0x5f3a9c2e8b41d07a6e9f13c4b2d8a70e91c6b3fa',
    transaction: '0x9b1e4c7a2d6f80e35a1c9b7d4e2f6a8c0b3d5e7f9a1c2b4d6e8f0a2c4e6b8d0f',
    block: 18_204_551,
    timestamp: '2026-09-22T14:32:00.000Z',
    receiptHash: '0x4e6a8c0b2d4f6a8c0e2b4d6f8a0c2e4b6d8f0a2c4e6b8d0f2a4c6e8b0d2f4a6c',
    contractPolicy: 'Product Delivery · up to 500.00 USD per operation',
    explorerUrl: 'https://testnet.monadexplorer.com',
    simulated: true,
  },
}

export function OverlaysDemo() {
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [phase, setPhase] = React.useState<OperationPhase>('idle')
  const [commandOpen, setCommandOpen] = React.useState(false)

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const release = () => {
    const sequence: OperationPhase[] = ['preparing', 'waiting_for_confirmation', 'processing', 'completed']
    sequence.forEach((next, index) => setTimeout(() => setPhase(next), index * 700))
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="pill" onClick={() => setSheetOpen(true)}>
        Release tranche
      </Button>
      <ApprovalSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onClosed={() => setPhase('idle')}
        title="Release tranche 2"
        description="Prototype delivered · Arc Studio"
        summary={{
          what: 'Arc Studio receives the second tranche of its funding agreement.',
          amount: usd(25_000),
          from: 'Northstar Capital funding vault',
          to: 'Arc Studio Operations',
          reversible: 'Cannot be undone once released.',
          policy: 'Milestone "Prototype delivered" approved by the Investor.',
        }}
        confirmLabel="Release tranche"
        onConfirm={release}
        phase={phase}
        success={{
          title: 'Funding released',
          body: '25,000.00 USD is now available in the Arc Studio Operations account.',
        }}
      />

      <VerifiedDetailsButton record={verifiedRecord} />

      <Dialog>
        <DialogTrigger render={<Button variant="outline" size="pill-sm" />}>Invite member</DialogTrigger>
        <DialogContent surface="glass" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl font-medium">Invite a member</DialogTitle>
            <DialogDescription>They get access to Arc Studio as soon as they accept.</DialogDescription>
          </DialogHeader>
          <Input placeholder="alex@arcstudio.co" />
          <Button
            size="pill-sm"
            className="justify-self-end"
            onClick={() => toast.success('Invitation sent')}
          >
            Send invitation
          </Button>
        </DialogContent>
      </Dialog>

      <Sheet>
        <SheetTrigger render={<Button variant="outline" size="pill-sm" />}>Open sheet</SheetTrigger>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Notifications</SheetTitle>
            <SheetDescription>2 new since yesterday.</SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>

      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-pill" aria-label="Row actions" />}>
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Payment</DropdownMenuLabel>
          <DropdownMenuItem>View receipt</DropdownMenuItem>
          <DropdownMenuItem>View verified details</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">Cancel request</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger render={<Button variant="outline" size="pill-sm" />}>Policy</PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>Product Delivery rules</PopoverTitle>
            <PopoverDescription>
              Up to 500.00 USD per operation; above 250.00 USD needs approval.
            </PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>

      <HoverCard>
        <HoverCardTrigger render={<button type="button" className="text-sm underline underline-offset-4" />}>
          Arc Studio
        </HoverCardTrigger>
        <HoverCardContent className="flex items-center gap-3">
          <OrgAvatar name="Arc Studio" size="md" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Arc Studio</span>
            <span className="text-xs text-subtle">Software team · Active</span>
          </div>
        </HoverCardContent>
      </HoverCard>

      <Button variant="outline" size="pill-sm" onClick={() => setCommandOpen(true)}>
        <CommandIcon data-icon="inline-start" /> Search <Kbd className="ml-1">⌘K</Kbd>
      </Button>
      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <Command>
          <CommandInput placeholder="Search budgets, payments, people…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Go to">
              <CommandItem>
                Budgets <CommandShortcut>G B</CommandShortcut>
              </CommandItem>
              <CommandItem>
                Payments <CommandShortcut>G P</CommandShortcut>
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Budgets">
              <CommandItem>Product Delivery</CommandItem>
              <CommandItem>Research & Tools</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <Button
        variant="secondary"
        size="pill-sm"
        onClick={() => toast.success('Payment completed', { description: '120.00 USD to Vertex Cloud' })}
      >
        Success toast
      </Button>
      <Button
        variant="secondary"
        size="pill-sm"
        onClick={() => toast.error('This request is outside the budget rules')}
      >
        Error toast
      </Button>
    </div>
  )
}

export function OperationPhasesDemo() {
  const phases: OperationPhase[] = ['preparing', 'processing', 'completed', 'failed']
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {phases.map((phase) => (
        <div key={phase} className="surface rounded-xl p-4">
          <PendingOperation phase={phase} />
        </div>
      ))}
    </div>
  )
}

// ─── Table ───────────────────────────────────────────────────────────────────

type PaymentRow = {
  id: string
  date: string
  recipient: string
  budget: string
  amount: Cents
  status: StatusDescriptor
}

const paymentRows: PaymentRow[] = [
  {
    id: 'p1',
    date: 'Sep 22',
    recipient: 'Vertex Cloud',
    budget: 'Product Delivery',
    amount: usd(120),
    status: { label: 'Completed', tone: 'success' },
  },
  {
    id: 'p2',
    date: 'Sep 21',
    recipient: 'Alex Morgan',
    budget: 'Product Delivery',
    amount: usd(900),
    status: { label: 'Rejected', tone: 'danger' },
  },
  {
    id: 'p3',
    date: 'Sep 20',
    recipient: 'Figma',
    budget: 'Research & Tools',
    amount: usd(45),
    status: { label: 'Completed', tone: 'success' },
  },
  {
    id: 'p4',
    date: 'Sep 19',
    recipient: 'Linear',
    budget: 'Research & Tools',
    amount: usd(96),
    status: { label: 'Processing', tone: 'accent' },
  },
  {
    id: 'p5',
    date: 'Sep 18',
    recipient: 'Notion',
    budget: 'Operations',
    amount: usd(64),
    status: { label: 'Action required', tone: 'warning' },
  },
  {
    id: 'p6',
    date: 'Sep 17',
    recipient: 'Research Assistant',
    budget: 'Research & Tools',
    amount: usd(18),
    status: { label: 'Completed', tone: 'success' },
  },
]

const paymentColumns: ColumnDef<PaymentRow, unknown>[] = [
  { accessorKey: 'date', header: 'Date' },
  { accessorKey: 'recipient', header: 'Recipient' },
  { accessorKey: 'budget', header: 'Budget' },
  {
    accessorKey: 'amount',
    header: 'Amount',
    meta: { align: 'right' },
    cell: ({ row }) => <Amount value={row.original.amount} size="sm" />,
  },
  {
    id: 'status',
    header: 'Status',
    enableSorting: false,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
]

export function TableDemo() {
  return (
    <DataTable
      data={paymentRows}
      columns={paymentColumns}
      caption="Recent payments"
      searchPlaceholder="Search payments"
      searchText={(row) => `${row.recipient} ${row.budget}`}
      facets={[
        {
          id: 'budget',
          label: 'Budget',
          accessor: (row) => row.budget,
          options: [
            { value: 'Product Delivery', label: 'Product Delivery' },
            { value: 'Research & Tools', label: 'Research & Tools' },
            { value: 'Operations', label: 'Operations' },
          ],
        },
      ]}
      pageSize={5}
      renderMobile={(row) => (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm text-foreground">{row.recipient}</span>
            <span className="text-xs text-subtle">
              {row.date} · {row.budget}
            </span>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Amount value={row.amount} size="sm" />
            <StatusBadge status={row.status} />
          </div>
        </div>
      )}
    />
  )
}

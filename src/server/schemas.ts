import { z } from 'zod'

import { EVIDENCE_MAX_BYTES } from '@/data/api-contract'
import type { CommandInput, CommandName } from '@/domain/engine'
import type { Cents } from '@/domain/money'

/**
 * One schema per domain command. They check shapes and types before the
 * engine runs on the shared state: unknown keys are dropped (so a caller
 * cannot assign fields the engine would copy), enums are closed, money is
 * whole cents and dates are ISO. Business rules and their product-language
 * messages stay in the engine.
 */

// Postgres cannot store NUL in jsonb: reject it here as a 422 instead of failing the write.
const noNul = /^[^\u0000]*$/
const id = z.string().min(1).max(80).regex(noNul)
const text = (max = 2000) => z.string().max(max).regex(noNul)
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const isoDate = z.union([z.iso.datetime({ offset: true }), z.iso.date()])
const ids = z.array(id).max(200)

const category = z.enum([
  'team',
  'contractors',
  'software',
  'cloud',
  'ai_services',
  'research',
  'marketing',
  'travel',
  'legal',
  'equipment',
])

const evidence = z
  .object({
    kind: z.enum(['file', 'link', 'note']),
    name: text(300),
    url: z
      .string()
      .max(2000)
      .regex(/^https?:\/\//i)
      .regex(noNul)
      .optional(),
    mimeType: text(120).optional(),
    sizeBytes: z.number().int().min(0).max(EVIDENCE_MAX_BYTES).optional(),
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  // Each kind carries only its own fields: a file is an upload (its fingerprint,
  // with type and size taken from the verified upload), a link is a URL.
  .superRefine((item, ctx) => {
    const file = item.kind === 'file'
    if (file && !item.sha256)
      ctx.addIssue({ code: 'custom', path: ['sha256'], message: 'Upload the file first.' })
    if (!file && (item.sha256 || item.mimeType || item.sizeBytes !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['kind'], message: 'Only files carry file details.' })
    }
    if (item.kind === 'link' ? !item.url : item.url) {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'Only links have a web address.' })
    }
  })

const allowanceHolder = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), userId: id }),
  z.object({ kind: z.literal('ai_agent'), agentId: id }),
])

const recipient = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('destination'), destinationId: id }),
  z.object({ kind: z.literal('member'), userId: id }),
])

const allowanceDraft = {
  holder: allowanceHolder,
  periodLimit: cents,
  perOperationLimit: cents.optional(),
}

export const commandSchemas = {
  // ─── Funding ──────────────────────────────────────────────────────────────
  createPortfolio: z.object({
    name: text(80),
    organization: text(80),
    timeZone: text(80),
    ownerName: text(80).optional(),
  }),
  createAgency: z.object({
    portfolioId: id,
    name: text(80),
    type: z.enum([
      'startup',
      'agency',
      'creative_studio',
      'software_team',
      'project_company',
      'contractor_collective',
      'grant_recipient',
      'venture_studio_project',
    ]),
    description: text(400),
    website: text(300).optional(),
    timeZone: text(80),
    admin: z.object({ name: text(80), email: text(160) }),
  }),
  createAgreement: z.object({
    portfolioId: id,
    agencyId: id,
    title: text(160),
    purpose: text(2000),
    committed: cents,
    releaseModel: z.enum(['milestone', 'scheduled', 'manual', 'recurring']),
    startDate: isoDate,
    endDate: isoDate,
    tranches: z
      .array(
        z.object({
          name: text(160),
          amount: cents,
          releaseCondition: z.enum(['milestone', 'scheduled', 'manual']),
          scheduledFor: isoDate.optional(),
          milestone: z
            .object({
              title: text(160),
              description: text(2000),
              acceptanceCriteria: z.array(text(500)).max(30),
              dueDate: isoDate,
            })
            .optional(),
        }),
      )
      .max(24),
    spendingPolicy: z.object({
      allowedCategories: z.array(category).max(10),
      exceptionThreshold: cents,
      reportingCadence: z.enum(['monthly', 'quarterly', 'per_milestone']),
      returnConditions: text(2000),
    }),
    evidenceRequirements: text(2000),
  }),
  acceptAgreement: z.object({ agreementId: id }),
  setAgreementPaused: z.object({ agreementId: id, paused: z.boolean() }),
  addFunds: z.object({ portfolioId: id, amount: cents, source: text(120) }),
  fundAgreement: z.object({ agreementId: id, amount: cents }),
  submitMilestoneEvidence: z.object({
    milestoneId: id,
    evidence: z.array(evidence).max(20),
    note: text(2000),
    destinationAccountId: id,
  }),
  requestTranche: z.object({ trancheId: id, destinationAccountId: id, note: text(2000).optional() }),
  releaseTranche: z.object({
    trancheId: id,
    checkedCriteria: z.array(z.number().int().min(0).max(100)).max(30).optional(),
    note: text(2000).optional(),
  }),
  requestMilestoneChanges: z.object({ milestoneId: id, note: text(2000), reject: z.boolean().optional() }),

  // ─── Accounts, budgets and allowances ─────────────────────────────────────
  createAccount: z.object({
    agencyId: id,
    template: z.enum(['operations', 'people', 'vendors', 'taxes', 'reserve', 'project']),
    name: text(80),
    purpose: text(400),
    initialFunding: z.object({ fromAccountId: id, amount: cents }).optional(),
  }),
  openOperationsAccount: z.object({ agencyId: id }),
  transferFunds: z.object({
    agencyId: id,
    fromAccountId: id,
    toAccountId: id,
    amount: cents,
    note: text(500).optional(),
  }),
  createBudget: z.object({
    agencyId: id,
    sourceAccountId: id,
    name: text(80),
    purpose: text(400),
    template: z.enum(['team_spend', 'tools', 'vendors', 'travel', 'project', 'ai_automation']),
    period: z.enum(['monthly', 'quarterly', 'one_time']),
    allocation: cents,
    perOperationLimit: cents,
    periodLimit: cents,
    approvalThreshold: cents,
    allowedCategories: z.array(category).max(10),
    allowedDestinationIds: ids,
    expiresAt: isoDate.optional(),
    allowances: z.array(z.object(allowanceDraft)).max(100),
  }),
  allocateToBudget: z.object({ budgetId: id, amount: cents, direction: z.enum(['allocate', 'return']) }),
  updateBudgetRules: z.object({
    budgetId: id,
    perOperationLimit: cents.optional(),
    periodLimit: cents.optional(),
    approvalThreshold: cents.optional(),
    allowedCategories: z.array(category).max(10).optional(),
    allowedDestinationIds: ids.optional(),
    expiresAt: isoDate.optional(),
    name: text(80).optional(),
    purpose: text(400).optional(),
  }),
  setBudgetPaused: z.object({ budgetId: id, paused: z.boolean() }),
  assignAllowance: z.object({ budgetId: id, ...allowanceDraft }),
  revokeAllowance: z.object({ allowanceId: id }),

  // ─── Requests, payments, bills and expenses ───────────────────────────────
  requestPayment: z.object({
    agencyId: id,
    budgetId: id,
    type: z.enum(['funds', 'vendor_payment', 'reimbursement', 'automation']),
    destinationId: id,
    amount: cents,
    category,
    purpose: text(500),
    attachments: z.array(evidence).max(10).optional(),
    idempotencyKey: z.string().min(8).max(120).regex(noNul),
  }),
  approveRequest: z.object({ requestId: id }),
  declineRequest: z.object({ requestId: id, reason: text(500) }),
  cancelRequest: z.object({ requestId: id }),
  // billId and batchId are set only by payBill and sendTeamPayments, never by a caller.
  sendPayment: z.object({
    agencyId: id,
    type: z.enum([
      'team',
      'contractor',
      'reimbursement',
      'vendor',
      'tool',
      'refund',
      'capital_return',
      'automation',
    ]),
    recipient,
    accountId: id,
    budgetId: id.optional(),
    amount: cents,
    category,
    memo: text(500),
    scheduledFor: isoDate.optional(),
  }),
  sendTeamPayments: z.object({
    agencyId: id,
    accountId: id,
    budgetId: id.optional(),
    memo: text(500),
    items: z.array(z.object({ userId: id, amount: cents })).max(100),
  }),
  addBill: z.object({
    agencyId: id,
    destinationId: id,
    number: text(80),
    issueDate: isoDate,
    dueDate: isoDate,
    amount: cents,
    category,
    accountId: id,
    budgetId: id.optional(),
    document: evidence,
    notes: text(2000).optional(),
  }),
  payBill: z.object({
    billId: id,
    accountId: id.optional(),
    budgetId: id.nullable().optional(),
    scheduledFor: isoDate.optional(),
  }),
  reconcile: z.object({ agencyId: id, paymentId: id, billId: id.optional(), expenseId: id.optional() }),
  addExpense: z.object({
    agencyId: id,
    budgetId: id,
    merchant: text(160),
    amount: cents,
    category,
    spentAt: isoDate,
    receipt: evidence.optional(),
    paymentId: id.optional(),
  }),
  attachReceipt: z.object({ expenseId: id, receipt: evidence }),
  addDestination: z.object({
    agencyId: id,
    name: text(120),
    kind: z.enum(['vendor', 'service', 'contractor']),
    category,
    settlementLabel: text(120),
    website: text(300).optional(),
  }),
  returnUnusedFunds: z.object({ agencyId: id, amount: cents }),
  // The engine checks the address (a valid, non-zero account): the schema only bounds the text.
  withdrawFunds: z.object({ portfolioId: id, amount: cents, to: text(64) }),
  withdrawBalance: z.object({ agencyId: id, amount: cents, to: text(64) }),
  addPayoutAddress: z.object({ label: text(40), address: text(64) }),
  removePayoutAddress: z.object({ addressId: id }),
  updateDestination: z.object({
    destinationId: id,
    name: text(120).optional(),
    kind: z.enum(['vendor', 'service', 'contractor']).optional(),
    category: category.optional(),
    settlementLabel: text(120).optional(),
    website: text(300).optional(),
  }),
  setDestinationStatus: z.object({
    destinationId: id,
    status: z.enum(['approved', 'paused', 'archived']),
  }),

  // ─── People and automations ───────────────────────────────────────────────
  invite: z.object({
    name: text(80),
    email: text(160),
    role: z.enum(['investor', 'agency_admin', 'member']),
    scope: z.union([z.object({ agencyId: id }), z.object({ portfolioId: id })]),
  }),
  acceptInvitation: z.object({ code: id }),
  cancelInvitation: z.object({ invitationId: id }),
  revokeMembership: z.object({ membershipId: id }),
  createAgent: z.object({
    agencyId: id,
    name: text(80),
    purpose: text(400),
    budgetId: id,
    dailyCap: cents,
    perOperationMax: cents,
    allowedDestinationIds: ids,
    workingBalanceLimit: cents,
    expiresAt: isoDate,
  }),
  updateAgentPolicy: z.object({
    agentId: id,
    dailyCap: cents.optional(),
    perOperationMax: cents.optional(),
    allowedDestinationIds: ids.optional(),
    expiresAt: isoDate.optional(),
    workingBalanceLimit: cents.optional(),
    purpose: text(400).optional(),
  }),
  setAgentPaused: z.object({ agentId: id, paused: z.boolean() }),
  markNotificationsRead: z.object({ ids: ids.optional() }),
  updateProfile: z.object({
    name: text(80).optional(),
    title: text(80).optional(),
    timeZone: text(80).optional(),
    locale: text(20).optional(),
  }),
} satisfies { [N in CommandName]: z.ZodType }

// ─── Compile-time guarantees ─────────────────────────────────────────────────
// Every input the UI can build (the engine's own types, with branded cents as
// plain numbers) must pass its schema, and every parsed value must fit the
// engine's input. A change to a command's types that a schema does not follow
// fails the typecheck here.

type Unbrand<T> = T extends Cents
  ? number
  : T extends readonly (infer U)[]
    ? Unbrand<U>[]
    : T extends object
      ? { [K in keyof T]: Unbrand<T[K]> }
      : T

type Schemas = typeof commandSchemas
type AcceptsEveryInput = {
  [N in CommandName]: Unbrand<CommandInput<N>> extends z.input<Schemas[N]> ? true : false
}
type FitsTheEngine = {
  [N in CommandName]: z.output<Schemas[N]> extends Unbrand<CommandInput<N>> ? true : false
}
const _acceptsEveryInput: { [N in CommandName]: true } = {} as AcceptsEveryInput
const _fitsTheEngine: { [N in CommandName]: true } = {} as FitsTheEngine

/** Own keys only: `constructor` or `__proto__` are not commands. */
export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(commandSchemas, name)
}

/** Parsed and stripped input; throws a ZodError the API maps to 422. */
export function parseCommandInput<N extends CommandName>(name: N, body: unknown): CommandInput<N> {
  return (commandSchemas[name] as z.ZodType).parse(body) as CommandInput<N>
}

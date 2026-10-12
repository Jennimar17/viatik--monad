import {
  accountabilityByPerson,
  advanceStanding,
  JUSTIFY_WITHIN_DAYS,
  missingReceipts,
} from '../accountability'
import { shortAddress } from '../address'
import { paymentTypeForCategory, workPaymentId } from '../engine/operations'
import { attachmentsHash, evidenceSetHash } from '../evidence'
import { budgetTemplate } from '../labels'
import { cents, usd, type Cents } from '../money'
import { evaluatePolicy, paysRequester, withAgreementRules } from '../policy'
import { exceptionThresholdOf, governingAgreement } from '../queries'
import { agentSpentToday, budgetUsage, holderSpentInPeriod, memberHeld } from '../selectors'
import type {
  Account,
  AccountTemplate,
  Actor,
  AiAgent,
  Budget,
  Evidence,
  Expense,
  Id,
  ISODate,
  Location,
  NotificationSubject,
  Payment,
  PaymentDestination,
  PaymentRequest,
  PaymentType,
  Reminder,
  RequestDestination,
  RequestType,
  SpendingCategory,
  User,
  ViatikState,
} from '../types'
import { simulatedVerification } from '../verification'
import { SeedBuilder, usdLabel } from './builder'
import { DEMO } from './ids'

/**
 * Fictional, globally neutral demo data: Northstar Capital funds Arc Studio,
 * Lumen Labs and Fieldwork Collective. The state is the moment right before
 * the hackathon demo — Arc Studio has submitted "Prototype delivered" and is
 * waiting for its second tranche. Its people have money for purchases to justify
 * (one of them overdue), payment for work paid and waiting, and Maya has paid two
 * tools outside Viatik (one invoice still missing); Lumen Labs has returned part
 * of its second tranche to the Portfolio Vault.
 *
 * All history is generated as ledger movements so every total in the product
 * is derived and consistent. Dates are relative to `now`.
 */
export function createDemoState(now: ISODate = new Date().toISOString()): ViatikState {
  const b = new SeedBuilder(now)
  const s = b.state
  const P = DEMO.portfolio
  const U = DEMO.users
  const A = DEMO.agencies
  const ACC = DEMO.accounts
  const BUD = DEMO.budgets
  const DST = DEMO.destinations

  const user = (id: Id): Actor => ({ kind: 'user', userId: id })
  const vault = (vaultId: Id): Location => ({ kind: 'vault', vaultId })
  const account = (accountId: Id): Location => ({ kind: 'account', accountId })
  const budget = (budgetId: Id): Location => ({ kind: 'budget', budgetId })
  const toDestination = (destinationId: Id): Location => ({
    kind: 'recipient',
    recipient: { kind: 'destination', destinationId },
  })
  const toMember = (userId: Id): Location => ({ kind: 'recipient', recipient: { kind: 'member', userId } })

  // ─── People ────────────────────────────────────────────────────────────────

  const people: [Id, string, string, string, string][] = [
    [U.elena, 'Elena Duarte', 'elena@northstar.example', 'Partner, Northstar Capital', 'Europe/Lisbon'],
    [U.marcus, 'Marcus Hale', 'marcus@northstar.example', 'Principal, Northstar Capital', 'America/New_York'],
    [U.maya, 'Maya Chen', 'maya@arcstudio.example', 'Head of Operations, Arc Studio', 'Asia/Singapore'],
    [U.jordan, 'Jordan Lee', 'jordan@arcstudio.example', 'Founder, Arc Studio', 'America/Los_Angeles'],
    [U.alex, 'Alex Morgan', 'alex@arcstudio.example', 'Product engineer', 'Europe/Berlin'],
    [U.priya, 'Priya Nair', 'priya@arcstudio.example', 'Product designer', 'Asia/Kolkata'],
    [U.daniel, 'Daniel Okafor', 'daniel@arcstudio.example', 'Frontend engineer', 'Africa/Lagos'],
    [U.sofia, 'Sofia Marin', 'sofia@arcstudio.example', 'User researcher', 'America/Mexico_City'],
    [U.ren, 'Ren Takahashi', 'ren@lumenlabs.example', 'COO, Lumen Labs', 'Asia/Tokyo'],
    [U.noah, 'Noah Brennan', 'noah@lumenlabs.example', 'Backend engineer', 'Europe/Dublin'],
    [U.lina, 'Lina Park', 'lina@lumenlabs.example', 'Data engineer', 'Asia/Seoul'],
    [U.ines, 'Ines Vidal', 'ines@fieldwork.example', 'Program lead, Fieldwork Collective', 'America/Bogota'],
  ]
  for (const [id, name, email, title, timeZone] of people) {
    s.users.push({ id, name, email, title, timeZone, locale: 'en-US', createdAt: b.ago(220) } satisfies User)
  }
  const nameOf = (id: Id) => s.users.find((u) => u.id === id)?.name ?? 'Someone'

  const membership = (
    userId: Id,
    role: 'investor' | 'agency_admin' | 'member',
    scope: 'portfolio' | Id,
    at: ISODate,
  ) => {
    s.memberships.push({
      id: b.id('mem'),
      userId,
      role,
      scope:
        scope === 'portfolio' ? { kind: 'portfolio', portfolioId: P } : { kind: 'agency', agencyId: scope },
      status: 'active',
      createdAt: at,
    })
  }
  membership(U.elena, 'investor', 'portfolio', b.ago(220))
  membership(U.marcus, 'investor', 'portfolio', b.ago(215))
  membership(U.maya, 'agency_admin', A.arc, b.ago(186))
  membership(U.jordan, 'agency_admin', A.arc, b.ago(186))
  membership(U.alex, 'member', A.arc, b.ago(172))
  membership(U.priya, 'member', A.arc, b.ago(172))
  membership(U.daniel, 'member', A.arc, b.ago(171))
  membership(U.sofia, 'member', A.arc, b.ago(160))
  membership(U.ren, 'agency_admin', A.lumen, b.ago(138))
  membership(U.noah, 'member', A.lumen, b.ago(126))
  membership(U.lina, 'member', A.lumen, b.ago(126))
  membership(U.ines, 'agency_admin', A.fieldwork, b.ago(19))

  s.invitations.push(
    {
      id: b.id('inv'),
      code: 'arc-sam-rivera',
      email: 'sam@arcstudio.example',
      name: 'Sam Rivera',
      role: 'member',
      scope: { kind: 'agency', agencyId: A.arc },
      invitedBy: U.maya,
      createdAt: b.ago(3),
      status: 'pending',
    },
    {
      id: b.id('inv'),
      code: 'northstar-ana-costa',
      email: 'ana@northstar.example',
      name: 'Ana Costa',
      role: 'investor',
      scope: { kind: 'portfolio', portfolioId: P },
      invitedBy: U.elena,
      createdAt: b.ago(6),
      status: 'pending',
    },
  )

  // ─── Portfolio, agencies, vaults ───────────────────────────────────────────

  s.portfolios.push({
    id: P,
    name: 'Northstar Capital',
    organization: 'Northstar Capital',
    baseCurrency: 'USD',
    timeZone: 'Europe/Lisbon',
    createdAt: b.ago(220),
  })

  s.agencies.push(
    {
      id: A.arc,
      portfolioId: P,
      name: 'Arc Studio',
      type: 'creative_studio',
      description: 'Product design and engineering studio building a field-service scheduling app.',
      website: 'https://arcstudio.example',
      timeZone: 'Asia/Singapore',
      status: 'active',
      createdAt: b.ago(190),
    },
    {
      id: A.lumen,
      portfolioId: P,
      name: 'Lumen Labs',
      type: 'startup',
      description: 'Early-stage startup building data tooling for energy cooperatives.',
      website: 'https://lumenlabs.example',
      timeZone: 'Asia/Tokyo',
      status: 'active',
      createdAt: b.ago(140),
    },
    {
      id: A.fieldwork,
      portfolioId: P,
      name: 'Fieldwork Collective',
      type: 'contractor_collective',
      description: 'Research collective running community field studies.',
      timeZone: 'America/Bogota',
      status: 'onboarding',
      createdAt: b.ago(20),
    },
  )

  s.vaults.push(
    {
      id: DEMO.vaults.portfolio,
      kind: 'portfolio',
      portfolioId: P,
      name: 'Northstar Portfolio Vault',
      asset: 'USDC',
      available: true,
    },
    {
      id: DEMO.vaults.arcFunding,
      kind: 'funding',
      portfolioId: P,
      agreementId: DEMO.agreements.arc,
      agencyId: A.arc,
      name: 'Arc Studio Funding Vault',
      asset: 'USDC',
      available: true,
    },
    {
      id: DEMO.vaults.lumenFunding,
      kind: 'funding',
      portfolioId: P,
      agreementId: DEMO.agreements.lumen,
      agencyId: A.lumen,
      name: 'Lumen Labs Funding Vault',
      asset: 'USDC',
      available: true,
    },
    {
      id: DEMO.vaults.fieldworkFunding,
      kind: 'funding',
      portfolioId: P,
      agreementId: DEMO.agreements.fieldwork,
      agencyId: A.fieldwork,
      name: 'Fieldwork Collective Funding Vault',
      asset: 'USDC',
      available: true,
    },
    {
      id: DEMO.vaults.yield,
      kind: 'yield',
      portfolioId: P,
      name: 'Yield Vault',
      asset: 'USDC',
      available: false,
    },
  )

  b.activity(
    'agency_created',
    user(U.elena),
    'Created the Arc Studio Agency',
    { kind: 'agency', id: A.arc },
    b.ago(190),
    {
      portfolioId: P,
      agencyId: A.arc,
    },
  )
  b.activity(
    'agency_created',
    user(U.elena),
    'Created the Lumen Labs Agency',
    { kind: 'agency', id: A.lumen },
    b.ago(140),
    {
      portfolioId: P,
      agencyId: A.lumen,
    },
  )
  b.activity(
    'agency_created',
    user(U.marcus),
    'Created the Fieldwork Collective Agency',
    { kind: 'agency', id: A.fieldwork },
    b.ago(20),
    { portfolioId: P, agencyId: A.fieldwork },
  )

  // ─── Capital into the portfolio ────────────────────────────────────────────

  const deposit = (amount: Cents, at: ISODate, by: Id) => {
    const opId = b.id('dep')
    const receipt = b.receipt({
      kind: 'deposit',
      amount,
      fromLabel: 'Northstar Capital',
      toLabel: 'Northstar Portfolio Vault',
      description: 'Funds added to the Portfolio Vault',
      policyLabel: 'Portfolio Vault deposit',
      operationId: opId,
      at,
      portfolioId: P,
      account: by,
    })
    b.move('deposit', amount, { kind: 'external', label: 'USDC deposit' }, vault(DEMO.vaults.portfolio), {
      at,
      portfolioId: P,
      refId: opId,
      receiptId: receipt.id,
    })
    b.activity(
      'capital_deposited',
      user(by),
      `Added ${usdLabel(amount)} to the Portfolio Vault`,
      { kind: 'receipt', id: receipt.id },
      at,
      {
        portfolioId: P,
        amount,
      },
    )
  }
  deposit(usd(100_000), b.ago(200, 14), U.elena)
  deposit(usd(50_000), b.ago(136, 15), U.marcus)

  // ─── Funding agreements ────────────────────────────────────────────────────

  s.agreements.push(
    {
      id: DEMO.agreements.arc,
      portfolioId: P,
      agencyId: A.arc,
      title: 'Product Delivery Program',
      purpose: 'Fund Arc Studio through prototype, beta and public release of its scheduling product.',
      committed: usd(100_000),
      releaseModel: 'milestone',
      startDate: b.ago(185),
      endDate: b.ahead(180),
      status: 'active',
      spendingPolicy: {
        allowedCategories: [
          'team',
          'contractors',
          'software',
          'cloud',
          'ai_services',
          'research',
          'travel',
          'equipment',
        ],
        exceptionThreshold: usd(10_000),
        reportingCadence: 'per_milestone',
        returnConditions:
          'Unreleased capital stays in the Funding Vault until the parties agree on what happens to it.',
      },
      evidenceRequirements:
        'Each milestone needs a written summary, a demo link or build, and supporting documents.',
      createdBy: U.elena,
      createdAt: b.ago(185),
    },
    {
      id: DEMO.agreements.lumen,
      portfolioId: P,
      agencyId: A.lumen,
      title: 'Seed operating agreement',
      purpose: 'Twelve months of operating capital released on a fixed schedule.',
      committed: usd(60_000),
      releaseModel: 'scheduled',
      startDate: b.ago(135),
      endDate: b.ahead(230),
      status: 'active',
      spendingPolicy: {
        allowedCategories: ['team', 'contractors', 'software', 'cloud', 'legal'],
        exceptionThreshold: usd(5_000),
        reportingCadence: 'monthly',
        returnConditions:
          'Released capital the Agency does not use is returned to the Portfolio Vault with Return to Investor.',
      },
      evidenceRequirements: 'Monthly spend report before each scheduled release.',
      createdBy: U.elena,
      createdAt: b.ago(135),
    },
    {
      id: DEMO.agreements.fieldwork,
      portfolioId: P,
      agencyId: A.fieldwork,
      title: 'Community pilot program',
      purpose: 'Fund a two-phase community field study with a published report.',
      committed: usd(40_000),
      releaseModel: 'milestone',
      startDate: b.ahead(7),
      endDate: b.ahead(200),
      status: 'pending_acceptance',
      spendingPolicy: {
        allowedCategories: ['team', 'research', 'travel', 'equipment'],
        exceptionThreshold: usd(5_000),
        reportingCadence: 'per_milestone',
        returnConditions:
          'Unreleased capital stays in the Funding Vault until the parties agree on what happens to it.',
      },
      evidenceRequirements: 'Field notes, participant consent summary, and a phase report.',
      createdBy: U.marcus,
      createdAt: b.ago(18),
    },
  )
  b.activity(
    'agreement_created',
    user(U.elena),
    'Created the Product Delivery Program agreement for Arc Studio',
    { kind: 'agreement', id: DEMO.agreements.arc },
    b.ago(185),
    { portfolioId: P, agencyId: A.arc, amount: usd(100_000) },
  )
  b.activity(
    'agreement_created',
    user(U.elena),
    'Created the Seed operating agreement for Lumen Labs',
    { kind: 'agreement', id: DEMO.agreements.lumen },
    b.ago(135),
    { portfolioId: P, agencyId: A.lumen, amount: usd(60_000) },
  )
  b.activity(
    'agreement_created',
    user(U.marcus),
    'Created the Community pilot program for Fieldwork Collective',
    { kind: 'agreement', id: DEMO.agreements.fieldwork },
    b.ago(18),
    { portfolioId: P, agencyId: A.fieldwork, amount: usd(40_000) },
  )

  const fund = (
    agreementId: Id,
    vaultId: Id,
    agencyId: Id,
    amount: Cents,
    at: ISODate,
    by: Id,
    agencyName: string,
  ) => {
    const opId = b.id('fund')
    const receipt = b.receipt({
      kind: 'funding',
      amount,
      fromLabel: 'Northstar Portfolio Vault',
      toLabel: `${agencyName} Funding Vault`,
      description: `Funding Agreement funded for ${agencyName}`,
      policyLabel: 'Funded capital cannot exceed the agreement commitment',
      operationId: opId,
      at,
      portfolioId: P,
      agencyId,
      account: by,
    })
    b.move('fund_agreement', amount, vault(DEMO.vaults.portfolio), vault(vaultId), {
      at,
      portfolioId: P,
      agencyId,
      agreementId,
      refId: opId,
      receiptId: receipt.id,
    })
    b.activity(
      'agreement_funded',
      user(by),
      `Funded the ${agencyName} agreement with ${usdLabel(amount)}`,
      { kind: 'agreement', id: agreementId },
      at,
      {
        portfolioId: P,
        agencyId,
        amount,
      },
    )
  }
  fund(DEMO.agreements.arc, DEMO.vaults.arcFunding, A.arc, usd(50_000), b.ago(180, 13), U.elena, 'Arc Studio')
  fund(
    DEMO.agreements.lumen,
    DEMO.vaults.lumenFunding,
    A.lumen,
    usd(45_000),
    b.ago(130, 11),
    U.elena,
    'Lumen Labs',
  )

  // ─── Agency accounts ───────────────────────────────────────────────────────

  const createAccount = (
    id: Id,
    agencyId: Id,
    template: AccountTemplate,
    name: string,
    purpose: string,
    at: ISODate,
    by: Id,
  ) => {
    const acct: Account = { id, agencyId, template, name, purpose, status: 'active', createdAt: at }
    s.accounts.push(acct)
    b.activity('account_created', user(by), `Created the ${name} account`, { kind: 'account', id }, at, {
      portfolioId: P,
      agencyId,
    })
    return acct
  }
  createAccount(
    ACC.arcOperations,
    A.arc,
    'operations',
    'Operations',
    'Receives released funding and covers day-to-day costs.',
    b.ago(184),
    U.maya,
  )
  createAccount(ACC.arcPeople, A.arc, 'people', 'People', 'Contractor and team payments.', b.ago(184), U.maya)
  createAccount(
    ACC.arcVendors,
    A.arc,
    'vendors',
    'Vendors',
    'Tools, cloud services and supplier bills.',
    b.ago(184),
    U.maya,
  )
  createAccount(
    ACC.arcTaxes,
    A.arc,
    'taxes',
    'Taxes',
    'Amounts set aside for tax obligations.',
    b.ago(184),
    U.maya,
  )
  createAccount(
    ACC.arcReserve,
    A.arc,
    'reserve',
    'Reserve',
    'Capital held back from normal spending.',
    b.ago(184),
    U.maya,
  )
  createAccount(
    ACC.arcProject,
    A.arc,
    'project',
    'Product Delivery',
    'Ring-fenced capital for the prototype-to-launch work.',
    b.ago(120),
    U.maya,
  )
  createAccount(
    ACC.lumenOperations,
    A.lumen,
    'operations',
    'Operations',
    'Receives scheduled releases.',
    b.ago(128),
    U.ren,
  )
  createAccount(ACC.lumenPeople, A.lumen, 'people', 'Payroll', 'Monthly team payments.', b.ago(128), U.ren)
  createAccount(
    ACC.lumenVendors,
    A.lumen,
    'vendors',
    'Infrastructure',
    'Hosting and developer tools.',
    b.ago(128),
    U.ren,
  )

  const transfer = (agencyId: Id, from: Id, to: Id, amount: Cents, at: ISODate, by: Id) => {
    const fromName = s.accounts.find((a) => a.id === from)?.name
    const toName = s.accounts.find((a) => a.id === to)?.name
    b.move('transfer', amount, account(from), account(to), {
      at,
      portfolioId: P,
      agencyId,
      refId: b.id('xfer'),
    })
    b.activity(
      'funds_transferred',
      user(by),
      `Moved ${usdLabel(amount)} from ${fromName} to ${toName}`,
      { kind: 'account', id: to },
      at,
      {
        portfolioId: P,
        agencyId,
        amount,
      },
    )
  }

  // ─── Payment destinations ──────────────────────────────────────────────────

  const destination = (
    id: Id,
    agencyId: Id,
    name: string,
    kind: PaymentDestination['kind'],
    category: SpendingCategory,
    settlementLabel: string,
    at: ISODate,
  ) =>
    s.destinations.push({
      id,
      agencyId,
      name,
      kind,
      category,
      settlementLabel,
      status: 'approved',
      addedAt: at,
    })
  destination(DST.vertex, A.arc, 'Vertex Cloud', 'vendor', 'cloud', 'Customer no. 4821', b.ago(183))
  destination(DST.canvasly, A.arc, 'Canvasly', 'service', 'software', 'Customer no. 1107', b.ago(183))
  destination(DST.tasklane, A.arc, 'Tasklane', 'service', 'software', 'Customer no. 1107', b.ago(183))
  destination(DST.pagecraft, A.arc, 'Pagecraft', 'service', 'software', 'Customer no. 1107', b.ago(183))
  destination(DST.pulse, A.arc, 'Pulse Data API', 'service', 'ai_services', 'Customer no. 9f3a', b.ago(160))
  destination(DST.northwind, A.arc, 'Northwind Travel', 'vendor', 'travel', 'Customer no. 7730', b.ago(165))
  destination(DST.atlas, A.arc, 'Atlas Legal', 'vendor', 'legal', 'Customer no. 2204', b.ago(150))
  destination(
    DST.harbor,
    A.arc,
    'Harbor Contractors',
    'contractor',
    'contractors',
    'Customer no. 5518',
    b.ago(40),
  )
  destination(DST.stratus, A.lumen, 'Stratus Hosting', 'vendor', 'cloud', 'Customer no. 3190', b.ago(127))
  destination(DST.codepath, A.lumen, 'Codepath Tools', 'service', 'software', 'Customer no. 6612', b.ago(127))
  destination(
    DST.sentinel,
    A.lumen,
    'Sentinel Security Audits',
    'vendor',
    'legal',
    'Customer no. 8045',
    b.ago(12),
  )

  // ─── Tranches and milestones ───────────────────────────────────────────────

  const arcMilestones = [
    {
      id: DEMO.milestones.arc1,
      tranche: DEMO.tranches.arc1,
      title: 'Discovery and product plan',
      description:
        'Interview field-service teams, validate the scheduling problem, and deliver a scoped product plan.',
      criteria: [
        'Twelve customer interviews summarized',
        'Product plan with scope and timeline',
        'Clickable concept prototype',
      ],
      due: b.ago(172),
    },
    {
      id: DEMO.milestones.arc2,
      tranche: DEMO.tranches.arc2,
      title: 'Prototype delivered',
      description: 'A working prototype of the scheduling app tested with at least five pilot teams.',
      criteria: [
        'Prototype deployed to a staging environment',
        'Usability sessions with five pilot teams',
        'Summary of findings and next iteration plan',
        'Spend report for Tranche 1',
      ],
      due: b.ago(1),
    },
    {
      id: DEMO.milestones.arc3,
      tranche: DEMO.tranches.arc3,
      title: 'Beta launch',
      description: 'Private beta with paying pilot customers and onboarding documentation.',
      criteria: ['Beta available to 20 teams', 'Onboarding guide published', 'Support process in place'],
      due: b.ahead(75),
    },
    {
      id: DEMO.milestones.arc4,
      tranche: DEMO.tranches.arc4,
      title: 'Public release',
      description: 'General availability with billing, analytics and a public launch.',
      criteria: ['Public release announced', 'Billing live', 'Retention report for the first month'],
      due: b.ahead(165),
    },
  ]
  arcMilestones.forEach((m, i) => {
    s.tranches.push({
      id: m.tranche,
      agreementId: DEMO.agreements.arc,
      index: i + 1,
      name: `Tranche ${i + 1}`,
      amount: usd(25_000),
      releaseCondition: 'milestone',
      milestoneId: m.id,
      status: 'planned',
    })
    s.milestones.push({
      id: m.id,
      agreementId: DEMO.agreements.arc,
      trancheId: m.tranche,
      title: m.title,
      description: m.description,
      acceptanceCriteria: m.criteria,
      dueDate: m.due,
      status: 'not_started',
      evidence: [],
    })
  })

  const tranche = (id: Id) => s.tranches.find((t) => t.id === id)!
  const milestone = (id: Id) => s.milestones.find((m) => m.id === id)!

  const releaseTranche = (
    trancheId: Id,
    agreementId: Id,
    fundingVault: Id,
    agencyId: Id,
    agencyName: string,
    toAccount: Id,
    at: ISODate,
    by: Id,
  ) => {
    const t = tranche(trancheId)
    const receipt = b.receipt({
      kind: 'tranche_release',
      amount: t.amount,
      fromLabel: `${agencyName} Funding Vault`,
      toLabel: `${agencyName} · Operations`,
      description: `${t.name} released to ${agencyName}`,
      policyLabel: 'Released capital cannot exceed funded capital · Investor approval required',
      operationId: t.id,
      at,
      portfolioId: P,
      agencyId,
      account: by,
    })
    b.move('release_tranche', t.amount, vault(fundingVault), account(toAccount), {
      at,
      portfolioId: P,
      agencyId,
      agreementId,
      refId: t.id,
      receiptId: receipt.id,
    })
    Object.assign(t, {
      status: 'released',
      releasedAt: at,
      releasedBy: by,
      receiptId: receipt.id,
      destinationAccountId: toAccount,
    })
    b.activity(
      'tranche_released',
      user(by),
      `Released ${t.name} (${usdLabel(t.amount)}) to ${agencyName}`,
      { kind: 'tranche', id: t.id },
      at,
      {
        portfolioId: P,
        agencyId,
        amount: t.amount,
      },
    )
  }

  // Tranche 1 — Discovery, approved and released.
  const m1 = milestone(DEMO.milestones.arc1)
  Object.assign(m1, {
    status: 'approved',
    submittedAt: b.ago(176, 9),
    submittedBy: U.maya,
    submissionNote: 'Interview synthesis, product plan and concept prototype attached.',
    evidence: [
      b.evidence('file', 'Interview synthesis.pdf', U.maya, b.ago(176, 9), {
        mimeType: 'application/pdf',
        sizeBytes: 2_480_000,
      }),
      b.evidence('file', 'Product plan v1.pdf', U.maya, b.ago(176, 9), {
        mimeType: 'application/pdf',
        sizeBytes: 1_120_000,
      }),
      b.evidence('link', 'Concept prototype', U.maya, b.ago(176, 9), {
        url: 'https://prototype.arcstudio.example/concept',
      }),
    ],
    decision: {
      outcome: 'approved',
      checkedCriteria: [0, 1, 2],
      decidedAt: b.ago(171, 16),
      decidedBy: U.elena,
      note: 'Clear plan. Approved.',
    },
  })
  tranche(DEMO.tranches.arc1).requestedAt = b.ago(176, 9)
  tranche(DEMO.tranches.arc1).requestedBy = U.maya
  b.activity(
    'milestone_submitted',
    user(U.maya),
    'Submitted evidence for Discovery and product plan',
    { kind: 'milestone', id: m1.id },
    b.ago(176, 9),
    { portfolioId: P, agencyId: A.arc },
  )
  releaseTranche(
    DEMO.tranches.arc1,
    DEMO.agreements.arc,
    DEMO.vaults.arcFunding,
    A.arc,
    'Arc Studio',
    ACC.arcOperations,
    b.ago(170, 15),
    U.elena,
  )

  // ─── Arc Studio budgets ────────────────────────────────────────────────────

  const createBudget = (
    input: Omit<Budget, 'status' | 'allowedCategories'> & { allowedCategories?: SpendingCategory[] },
  ) => {
    const created: Budget = {
      ...input,
      allowedCategories: input.allowedCategories ?? budgetTemplate[input.template].categories,
      status: 'active',
    }
    s.budgets.push(created)
    b.activity(
      'budget_created',
      user(input.createdBy),
      `Created the ${input.name} budget`,
      { kind: 'budget', id: input.id },
      input.createdAt,
      {
        portfolioId: P,
        agencyId: input.agencyId,
      },
    )
    return created
  }

  const allowance = (
    budgetId: Id,
    holderUser: Id,
    periodLimit: Cents,
    at: ISODate,
    by: Id,
    agencyId: Id,
    perOperationLimit?: Cents,
  ) => {
    s.allowances.push({
      id: b.id('alw'),
      budgetId,
      holder: { kind: 'member', userId: holderUser },
      periodLimit,
      perOperationLimit,
      status: 'active',
      createdAt: at,
    })
    const budgetName = s.budgets.find((x) => x.id === budgetId)?.name
    b.activity(
      'allowance_assigned',
      user(by),
      `Gave ${nameOf(holderUser)} a ${usdLabel(periodLimit)} allowance on ${budgetName}`,
      { kind: 'budget', id: budgetId },
      at,
      {
        portfolioId: P,
        agencyId,
        subjectUserId: holderUser,
      },
    )
  }

  const setupAt = b.ago(168, 11)
  transfer(A.arc, ACC.arcOperations, ACC.arcPeople, usd(10_500), b.ago(169, 10), U.maya)
  transfer(A.arc, ACC.arcOperations, ACC.arcVendors, usd(6_000), b.ago(169, 10, 5), U.maya)
  transfer(A.arc, ACC.arcOperations, ACC.arcReserve, usd(1_500), b.ago(169, 10, 10), U.maya)
  transfer(A.arc, ACC.arcOperations, ACC.arcTaxes, usd(500), b.ago(169, 10, 15), U.maya)

  createBudget({
    id: BUD.arcTeam,
    agencyId: A.arc,
    sourceAccountId: ACC.arcPeople,
    name: 'Team payments',
    purpose: 'Monthly contractor payments for the core team.',
    template: 'team_spend',
    allowedCategories: ['team', 'contractors'],
    period: 'monthly',
    perOperationLimit: usd(1_500),
    periodLimit: usd(3_000),
    approvalThreshold: usd(0),
    allowedDestinationIds: [],
    createdBy: U.maya,
    createdAt: setupAt,
  })
  createBudget({
    id: BUD.arcTools,
    agencyId: A.arc,
    sourceAccountId: ACC.arcVendors,
    name: 'Tools and software',
    purpose: 'Subscriptions, cloud services and small tool purchases.',
    template: 'tools',
    allowedCategories: ['software', 'cloud'],
    period: 'monthly',
    perOperationLimit: usd(500),
    periodLimit: usd(1_200),
    approvalThreshold: usd(250),
    allowedDestinationIds: [DST.vertex, DST.canvasly, DST.tasklane, DST.pagecraft],
    createdBy: U.maya,
    createdAt: setupAt,
  })
  createBudget({
    id: BUD.arcResearch,
    agencyId: A.arc,
    sourceAccountId: ACC.arcOperations,
    name: 'Research automation',
    purpose: 'Capped data spending for the Research Assistant automation.',
    template: 'ai_automation',
    period: 'monthly',
    perOperationLimit: usd(25),
    periodLimit: usd(300),
    approvalThreshold: usd(25),
    allowedDestinationIds: [DST.pulse],
    createdBy: U.maya,
    createdAt: b.ago(160, 11),
  })
  createBudget({
    id: BUD.arcTravel,
    agencyId: A.arc,
    sourceAccountId: ACC.arcOperations,
    name: 'Travel',
    purpose: 'Pilot-site visits and research trips.',
    template: 'travel',
    period: 'quarterly',
    perOperationLimit: usd(800),
    periodLimit: usd(1_500),
    approvalThreshold: usd(300),
    allowedDestinationIds: [DST.northwind],
    createdBy: U.maya,
    createdAt: b.ago(165, 11),
  })

  allowance(BUD.arcTools, U.alex, usd(200), setupAt, U.maya, A.arc)
  allowance(BUD.arcTools, U.priya, usd(300), setupAt, U.maya, A.arc)
  allowance(BUD.arcTools, U.daniel, usd(500), setupAt, U.maya, A.arc)
  allowance(BUD.arcTravel, U.sofia, usd(800), b.ago(165, 11), U.maya, A.arc)
  allowance(BUD.arcTravel, U.daniel, usd(500), b.ago(165, 11), U.maya, A.arc)
  allowance(BUD.arcTravel, U.maya, usd(1_000), b.ago(165, 11), U.jordan, A.arc)
  allowance(BUD.arcTravel, U.jordan, usd(1_000), b.ago(165, 11), U.maya, A.arc)

  // Research Assistant — a programmatic resource with its own limits.
  const agent: AiAgent = {
    id: DEMO.agent,
    agencyId: A.arc,
    name: 'Research Assistant',
    purpose: 'Buys market and usage data from approved data providers for weekly research briefs.',
    budgetId: BUD.arcResearch,
    dailyCap: usd(15),
    perOperationMax: usd(5),
    allowedDestinationIds: [DST.pulse],
    workingBalanceLimit: usd(50),
    expiresAt: b.ahead(100),
    status: 'active',
    managedBy: U.maya,
    createdAt: b.ago(160, 12),
  }
  s.agents.push(agent)
  s.allowances.push({
    id: b.id('alw'),
    budgetId: BUD.arcResearch,
    holder: { kind: 'ai_agent', agentId: agent.id },
    periodLimit: usd(300),
    perOperationLimit: usd(5),
    status: 'active',
    createdAt: agent.createdAt,
  })
  b.activity(
    'agent_created',
    user(U.maya),
    'Set up the Research Assistant automation with a 15.00 USD daily cap',
    { kind: 'agent', id: agent.id },
    agent.createdAt,
    {
      portfolioId: P,
      agencyId: A.arc,
    },
  )

  // ─── Operations helpers ────────────────────────────────────────────────────

  const destinationName = (id: Id) => s.destinations.find((d) => d.id === id)?.name ?? 'Payment destination'
  const budgetById = (id: Id) => s.budgets.find((x) => x.id === id)!

  /** Keeps a budget topped up to `target`, pulling from Operations when the source is short. */
  const topUp = (budgetId: Id, target: Cents, at: ISODate, by: Id, agencyId: Id, operationsAccount: Id) => {
    const bud = budgetById(budgetId)
    const need = target - b.balance(budget(budgetId))
    if (need <= 0) return
    const sourceBalance = b.balance(account(bud.sourceAccountId))
    if (sourceBalance < need && bud.sourceAccountId !== operationsAccount) {
      const shortfall = cents(Math.min(need - sourceBalance, b.balance(account(operationsAccount))))
      if (shortfall > 0) transfer(agencyId, operationsAccount, bud.sourceAccountId, shortfall, at, by)
    }
    const amount = cents(Math.min(need, b.balance(account(bud.sourceAccountId))))
    if (amount <= 0) return
    b.move('allocate', amount, account(bud.sourceAccountId), budget(budgetId), {
      at,
      portfolioId: P,
      agencyId,
      refId: b.id('alloc'),
    })
  }

  const policyLabel = (bud: Budget) => `${bud.name} · per-operation limit ${usdLabel(bud.perOperationLimit)}`

  /** A captured payment out of a budget (or account), with receipt and activity. */
  const pay = (input: {
    agencyId: Id
    type: PaymentType
    fromBudget?: Id
    fromAccount: Id
    to: { kind: 'destination'; id: Id } | { kind: 'member'; id: Id }
    amount: Cents
    category: SpendingCategory
    memo: string
    at: ISODate
    createdBy: Actor
    approvedBy?: Id
    requestId?: Id
    billId?: Id
    silent?: boolean
    /** How the recipient reads on the receipt and in activity, when not just its name (a request's). */
    labels?: { receipt: string; activity: string }
    policyLabel?: string
    /** Payment for work is paid under its request's own id (the engine's `workPaymentId`). */
    paymentId?: Id
    /** A request's files, listed on its receipt as the engine's capture does. */
    evidenceIds?: Id[]
  }) => {
    const paymentId = input.paymentId ?? b.id('pay')
    const recipientName = input.to.kind === 'member' ? nameOf(input.to.id) : destinationName(input.to.id)
    const labels = input.labels ?? { receipt: recipientName, activity: recipientName }
    const bud = input.fromBudget ? budgetById(input.fromBudget) : undefined
    const sourceName = s.accounts.find((a) => a.id === input.fromAccount)?.name ?? 'Account'
    const actorKey =
      input.createdBy.kind === 'user'
        ? input.createdBy.userId
        : input.createdBy.kind === 'ai_agent'
          ? input.createdBy.agentId
          : 'system'
    const receipt = b.receipt({
      kind: 'payment',
      amount: input.amount,
      fromLabel: bud ? `${sourceName} · ${bud.name}` : sourceName,
      toLabel: labels.receipt,
      description: input.memo,
      policyLabel:
        input.policyLabel ?? (bud ? policyLabel(bud) : 'Agency account payment · Agency Admin authorization'),
      operationId: paymentId,
      at: input.at,
      portfolioId: P,
      agencyId: input.agencyId,
      account: actorKey,
      evidenceIds: input.evidenceIds,
    })
    const from = input.fromBudget ? budget(input.fromBudget) : account(input.fromAccount)
    const to = input.to.kind === 'member' ? toMember(input.to.id) : toDestination(input.to.id)
    b.move('payment', input.amount, from, to, {
      at: input.at,
      portfolioId: P,
      agencyId: input.agencyId,
      refId: paymentId,
      receiptId: receipt.id,
    })
    s.payments.push({
      id: paymentId,
      agencyId: input.agencyId,
      type: input.type,
      sourceAccountId: input.fromAccount,
      budgetId: input.fromBudget,
      recipient:
        input.to.kind === 'member'
          ? { kind: 'member', userId: input.to.id }
          : { kind: 'destination', destinationId: input.to.id },
      amount: input.amount,
      category: input.category,
      memo: input.memo,
      status: 'completed',
      createdBy: input.createdBy,
      approvedBy: input.approvedBy,
      scheduledFor: input.at,
      completedAt: input.at,
      requestId: input.requestId,
      billId: input.billId,
      receiptId: receipt.id,
    })
    if (!input.silent) {
      b.activity(
        'payment_completed',
        input.createdBy,
        `Paid ${usdLabel(input.amount)} to ${labels.activity}`,
        { kind: 'payment', id: paymentId },
        input.at,
        {
          portfolioId: P,
          agencyId: input.agencyId,
          amount: input.amount,
          subjectUserId: input.to.kind === 'member' ? input.to.id : undefined,
        },
      )
    }
    return { paymentId, receiptId: receipt.id }
  }

  /**
   * Runs the real policy engine, then records the request and, when approved, the payment.
   * It mirrors the engine's requestPayment and capture: money for purchases, a reimbursement and
   * payment for work pay the requester's own Viatik balance; the other types pay `destinationId`.
   */
  const request = (input: {
    agencyId: Id
    budgetId: Id
    requester: Actor
    type: RequestType
    /** vendor_payment / automation only. */
    destinationId?: Id
    amount: Cents
    category: SpendingCategory
    purpose: string
    /** reimbursement only (required there). */
    merchant?: string
    /** reimbursement only: when the requester paid (defaults to `at`). */
    spentAt?: ISODate
    /** Files a person attaches (proof of work, a quote). A reimbursement's receipt is made here. */
    files?: { name: string; sizeBytes: number }[]
    at: ISODate
    approver?: Id
    /** Leave approved-by-policy requests pending (for the current approval queue). */
    leavePending?: boolean
    withReceipt?: boolean
    silentPayment?: boolean
  }): PaymentRequest | null => {
    const bud = budgetById(input.budgetId)
    const requesterUserId = input.requester.kind === 'user' ? input.requester.userId : undefined
    let destination: RequestDestination
    if (paysRequester(input.type)) {
      if (!requesterUserId) throw new Error(`Seed: a ${input.type} request is made by a person.`)
      destination = { kind: 'member', userId: requesterUserId }
    } else {
      if (!input.destinationId) throw new Error(`Seed: a ${input.type} request needs a destinationId.`)
      destination = { kind: 'destination', destinationId: input.destinationId }
    }
    const vendorId = destination.kind === 'destination' ? destination.destinationId : null
    if (input.type === 'reimbursement' && !input.merchant)
      throw new Error('Seed: a reimbursement needs its merchant.')
    const holder =
      input.requester.kind === 'ai_agent'
        ? ({ kind: 'ai_agent', agentId: input.requester.agentId } as const)
        : ({ kind: 'member', userId: (input.requester as { userId: Id }).userId } as const)
    const allowanceRecord =
      s.allowances.find(
        (a) =>
          a.budgetId === bud.id &&
          a.status === 'active' &&
          (holder.kind === 'member'
            ? a.holder.kind === 'member' && a.holder.userId === holder.userId
            : a.holder.kind === 'ai_agent' && a.holder.agentId === holder.agentId),
      ) ?? null
    const agentRecord =
      holder.kind === 'ai_agent' ? (s.agents.find((x) => x.id === holder.agentId) ?? null) : null
    const usage = budgetUsage(s, bud, input.at)
    // The agreement's rules too, as the engine applies them: the Investor decides exceptions, and
    // payment for work is always reviewed by an Agency Admin.
    const { decision } = withAgreementRules(
      evaluatePolicy({
        budget: bud,
        allowance: allowanceRecord,
        agent: agentRecord,
        request: { amount: input.amount, category: input.category, destinationId: vendorId },
        usage: {
          budgetAvailable: usage.available,
          holderSpentThisPeriod: holderSpentInPeriod(s, bud, holder, input.at),
          budgetSpentThisPeriod: usage.committedThisPeriod,
          agentSpentToday: agentRecord ? agentSpentToday(s, agentRecord.id, input.at) : undefined,
        },
        now: input.at,
      }),
      input,
      exceptionThresholdOf(s, input.agencyId),
    )

    // A reimbursement carries the receipt of what was bought; other requests the files given.
    const spentAt = input.spentAt ?? input.at
    if (input.files?.length && !requesterUserId) throw new Error('Seed: only a person attaches files.')
    const attachments =
      input.type === 'reimbursement' && requesterUserId
        ? [
            b.evidence('file', `${input.merchant} receipt.pdf`, requesterUserId, spentAt, {
              mimeType: 'application/pdf',
              sizeBytes: b.random.int(80_000, 420_000),
            }),
          ]
        : (input.files ?? []).map((file) =>
            b.evidence('file', file.name, requesterUserId!, input.at, {
              mimeType: 'application/pdf',
              sizeBytes: file.sizeBytes,
            }),
          )

    const req: PaymentRequest = {
      id: b.id('req'),
      agencyId: input.agencyId,
      budgetId: bud.id,
      requester: input.requester,
      type: input.type,
      destination,
      amount: input.amount,
      category: input.category,
      purpose: input.purpose,
      attachments,
      ...(input.type === 'reimbursement' ? { merchant: input.merchant, spentAt: input.spentAt } : {}),
      status:
        decision.outcome === 'rejected'
          ? 'rejected'
          : decision.outcome === 'needs_approval'
            ? 'needs_approval'
            : 'approved',
      decision,
      idempotencyKey: `seed-${input.at}-${input.purpose}`,
      createdAt: input.at,
    }
    s.requests.push(req)

    const requesterName =
      input.requester.kind === 'user' ? nameOf(input.requester.userId) : (agentRecord?.name ?? 'Automation')

    if (agentRecord && vendorId) {
      s.agentDecisions.push({
        id: b.id('dec'),
        agentId: agentRecord.id,
        destinationId: vendorId,
        amount: input.amount,
        outcome: decision.outcome,
        reason: decision.reason?.message ?? 'Within the automation policy.',
        requestId: req.id,
        at: input.at,
      })
    }

    if (decision.outcome === 'rejected') {
      b.activity(
        'policy_rejected',
        input.requester,
        `Policy rejected a ${usdLabel(input.amount)} request from ${requesterName}`,
        { kind: 'request', id: req.id },
        input.at,
        {
          portfolioId: P,
          agencyId: input.agencyId,
          amount: input.amount,
          subjectUserId: requesterUserId,
        },
      )
      return req
    }

    if (!agentRecord) {
      b.activity(
        'payment_requested',
        input.requester,
        `${requesterName} requested ${usdLabel(input.amount)} for ${input.purpose.toLowerCase()}`,
        { kind: 'request', id: req.id },
        input.at,
        {
          portfolioId: P,
          agencyId: input.agencyId,
          amount: input.amount,
          subjectUserId: requesterUserId,
        },
      )
    }

    if (input.leavePending && decision.outcome === 'needs_approval') return req

    let paidAt = new Date(new Date(input.at).getTime() + 35 * 60 * 1000).toISOString()
    if (decision.outcome === 'needs_approval') {
      const approver = input.approver ?? U.maya
      const decidedAt = new Date(new Date(input.at).getTime() + 5 * 60 * 60 * 1000).toISOString()
      Object.assign(req, { status: 'approved', approvedBy: approver, decidedAt })
      b.activity(
        'payment_approved',
        user(approver),
        `Approved ${requesterName}'s ${usdLabel(input.amount)} request`,
        { kind: 'request', id: req.id },
        decidedAt,
        {
          portfolioId: P,
          agencyId: input.agencyId,
          amount: input.amount,
          subjectUserId: requesterUserId,
        },
      )
      paidAt = new Date(new Date(decidedAt).getTime() + 20 * 60 * 1000).toISOString()
    }

    // The same payment types and labels as the engine's capture.
    const paymentType: PaymentType = agentRecord
      ? 'automation'
      : input.type === 'funds'
        ? 'advance'
        : input.type === 'reimbursement'
          ? 'reimbursement'
          : input.type === 'work'
            ? 'team'
            : 'tool'
    const memberName = destination.kind === 'member' ? nameOf(destination.userId) : undefined
    const { paymentId } = pay({
      agencyId: input.agencyId,
      type: paymentType,
      fromBudget: bud.id,
      fromAccount: bud.sourceAccountId,
      to:
        destination.kind === 'member'
          ? { kind: 'member', id: destination.userId }
          : { kind: 'destination', id: destination.destinationId },
      amount: input.amount,
      category: input.category,
      memo: input.purpose,
      at: paidAt,
      createdBy: input.requester,
      approvedBy: req.approvedBy,
      requestId: req.id,
      silent: input.silentPayment,
      labels: memberName
        ? { receipt: `${memberName} · Viatik balance`, activity: `${memberName}'s Viatik balance` }
        : undefined,
      policyLabel: input.type === 'work' ? 'Payment for work · approved by an Agency Admin' : undefined,
      paymentId: input.type === 'work' ? workPaymentId(req.id) : undefined,
      evidenceIds: req.attachments.map((a) => a.id),
    })
    Object.assign(req, { status: 'completed', paymentId })

    // Only a vendor payment and a reimbursement document a purchase: money for purchases is
    // justified later with its own receipts, and payment for work needs none.
    if (requesterUserId && vendorId && input.type === 'vendor_payment') {
      const withReceipt = input.withReceipt ?? true
      s.expenses.push({
        id: b.id('exp'),
        agencyId: input.agencyId,
        userId: requesterUserId,
        budgetId: bud.id,
        merchant: destinationName(vendorId),
        amount: input.amount,
        category: input.category,
        spentAt: paidAt,
        paymentId,
        receipt: withReceipt
          ? b.evidence('file', `${destinationName(vendorId)} receipt.pdf`, requesterUserId, paidAt, {
              mimeType: 'application/pdf',
              sizeBytes: b.random.int(80_000, 420_000),
            })
          : undefined,
        createdAt: paidAt,
      })
    }
    if (requesterUserId && input.type === 'reimbursement' && input.merchant) {
      s.expenses.push({
        id: b.id('exp'),
        agencyId: input.agencyId,
        userId: requesterUserId,
        budgetId: bud.id,
        merchant: input.merchant,
        amount: input.amount,
        category: input.category,
        spentAt,
        paymentId,
        receipt: attachments[0],
        createdAt: paidAt,
      })
    }
    return req
  }

  // ─── Bills ─────────────────────────────────────────────────────────────────

  const bill = (input: {
    destinationId: Id
    number: string
    issue: ISODate
    due: ISODate
    amount: Cents
    category: SpendingCategory
    payAt?: ISODate
    reconcile?: boolean
    accountId?: Id
    budgetId?: Id | null
  }) => {
    const billId = b.id('bill')
    const vendorName = destinationName(input.destinationId)
    const doc = b.evidence('file', `${vendorName} ${input.number}.pdf`, U.maya, input.issue, {
      mimeType: 'application/pdf',
      sizeBytes: b.random.int(60_000, 240_000),
    })
    const budgetId = input.budgetId === null ? undefined : (input.budgetId ?? BUD.arcTools)
    const accountId = input.accountId ?? ACC.arcVendors
    s.bills.push({
      id: billId,
      agencyId: A.arc,
      destinationId: input.destinationId,
      number: input.number,
      issueDate: input.issue,
      dueDate: input.due,
      amount: input.amount,
      category: input.category,
      accountId,
      budgetId,
      // Never seeded as scheduled: a schedule lives on the ledger, so scheduled bills are created live.
      status: 'to_pay',
      document: doc,
      createdBy: U.maya,
      createdAt: input.issue,
    })
    b.activity(
      'bill_added',
      user(U.maya),
      `Added ${vendorName} bill ${input.number}`,
      { kind: 'bill', id: billId },
      input.issue,
      {
        portfolioId: P,
        agencyId: A.arc,
        amount: input.amount,
      },
    )
    if (!input.payAt || !b.isPast(input.payAt)) return
    const { paymentId, receiptId } = pay({
      agencyId: A.arc,
      type: input.category === 'cloud' ? 'vendor' : 'tool',
      fromBudget: budgetId,
      fromAccount: accountId,
      to: { kind: 'destination', id: input.destinationId },
      amount: input.amount,
      category: input.category,
      memo: `${vendorName} bill ${input.number}`,
      at: input.payAt,
      createdBy: user(U.maya),
      billId,
    })
    const record = s.bills.find((x) => x.id === billId)!
    Object.assign(record, { status: 'paid', paymentId })
    if (input.reconcile) {
      const reconciledAt = new Date(new Date(input.payAt).getTime() + 26 * 60 * 60 * 1000).toISOString()
      s.reconciliations.push({
        id: b.id('rec'),
        agencyId: A.arc,
        paymentId,
        billId,
        evidenceIds: [doc.id],
        receiptId,
        reconciledBy: U.maya,
        reconciledAt,
      })
      record.status = 'reconciled'
      b.activity(
        'bill_reconciled',
        user(U.maya),
        `Reconciled ${vendorName} bill ${input.number}`,
        { kind: 'bill', id: billId },
        reconciledAt,
        {
          portfolioId: P,
          agencyId: A.arc,
          amount: input.amount,
        },
      )
    }
  }

  // ─── Arc Studio: month-by-month history ────────────────────────────────────

  const memberPurchases: Record<
    Id,
    { destinationId: Id; purpose: string; min: number; max: number; category: SpendingCategory }[]
  > = {
    [U.alex]: [
      { destinationId: DST.vertex, purpose: 'Staging database add-on', min: 18, max: 45, category: 'cloud' },
      { destinationId: DST.tasklane, purpose: 'API testing seat', min: 12, max: 29, category: 'software' },
      { destinationId: DST.vertex, purpose: 'Load testing credits', min: 25, max: 60, category: 'cloud' },
      {
        destinationId: DST.pagecraft,
        purpose: 'Developer docs theme',
        min: 19,
        max: 39,
        category: 'software',
      },
    ],
    [U.priya]: [
      { destinationId: DST.canvasly, purpose: 'Icon set license', min: 29, max: 79, category: 'software' },
      { destinationId: DST.canvasly, purpose: 'Prototype hosting', min: 15, max: 35, category: 'software' },
    ],
    [U.daniel]: [
      {
        destinationId: DST.tasklane,
        purpose: 'Browser testing plan',
        min: 39,
        max: 89,
        category: 'software',
      },
      { destinationId: DST.vertex, purpose: 'Preview environments', min: 22, max: 48, category: 'cloud' },
    ],
  }

  const releaseMonthOffset = monthOffsetOf(b.ago(170), now)
  for (let offset = releaseMonthOffset; offset <= 0; offset++) {
    const first = offset === releaseMonthOffset
    const allocationAt = first ? b.ago(168, 11, 30) : b.inMonth(offset, 1, 8)
    if (!b.isPast(allocationAt)) break

    topUp(BUD.arcTeam, usd(2_100), allocationAt, U.maya, A.arc, ACC.arcOperations)
    topUp(BUD.arcTools, usd(1_000), allocationAt, U.maya, A.arc, ACC.arcOperations)
    if (first) topUp(BUD.arcResearch, usd(120), b.ago(160, 12, 30), U.maya, A.arc, ACC.arcOperations)
    else topUp(BUD.arcResearch, usd(120), allocationAt, U.maya, A.arc, ACC.arcOperations)
    const monthIndex = new Date(allocationAt).getUTCMonth()
    if (first || monthIndex % 3 === 0)
      topUp(BUD.arcTravel, usd(1_500), allocationAt, U.maya, A.arc, ACC.arcOperations)

    // Vendor bills.
    const monthLabel = new Date(b.inMonth(offset, 1)).toISOString().slice(0, 7).replace('-', '')
    const isCurrent = offset === 0
    const isPrevious = offset === -1
    const issueDay = first ? 8 : 1
    if (!isCurrent) {
      bill({
        destinationId: DST.vertex,
        number: `VC-${monthLabel}`,
        issue: b.inMonth(offset, issueDay, 7),
        due: b.inMonth(offset, 15),
        amount: b.amountBetween(380, 460),
        category: 'cloud',
        payAt: b.inMonth(offset, 12, 11),
        reconcile: true,
      })
      bill({
        destinationId: DST.canvasly,
        number: `CV-${monthLabel}`,
        issue: b.inMonth(offset, issueDay, 7, 5),
        due: b.inMonth(offset, 15),
        amount: usd(144),
        category: 'software',
        payAt: b.inMonth(offset, 10, 9),
        reconcile: !isPrevious,
      })
      bill({
        destinationId: DST.tasklane,
        number: `TL-${monthLabel}`,
        issue: b.inMonth(offset, issueDay, 7, 10),
        due: b.inMonth(offset, 15),
        amount: usd(96),
        category: 'software',
        payAt: b.inMonth(offset, 14, 10),
        reconcile: !isPrevious,
      })
      bill({
        destinationId: DST.pagecraft,
        number: `PG-${monthLabel}`,
        issue: b.inMonth(offset, issueDay, 7, 15),
        due: b.inMonth(offset, 15),
        amount: usd(60),
        category: 'software',
        payAt: b.inMonth(offset, 11, 9),
        reconcile: true,
      })
    } else {
      bill({
        destinationId: DST.canvasly,
        number: `CV-${monthLabel}`,
        issue: b.inMonth(0, 1, 7, 5),
        due: b.inMonth(0, 15),
        amount: usd(144),
        category: 'software',
        payAt: b.inMonth(0, 10, 9),
      })
      bill({
        destinationId: DST.pagecraft,
        number: `PG-${monthLabel}`,
        issue: b.inMonth(0, 1, 7, 15),
        due: b.ago(4, 12),
        amount: usd(60),
        category: 'software',
      })
      bill({
        destinationId: DST.tasklane,
        number: `TL-${monthLabel}`,
        issue: b.inMonth(0, 1, 7, 10),
        due: b.ahead(5, 12),
        amount: usd(96),
        category: 'software',
      })
      bill({
        destinationId: DST.vertex,
        number: `VC-${monthLabel}`,
        issue: b.ago(3, 7),
        due: b.ahead(3, 12),
        amount: cents(41_280),
        category: 'cloud',
      })
      bill({
        destinationId: DST.harbor,
        number: 'HC-0917',
        issue: b.ago(5, 8),
        due: b.ahead(9, 12),
        amount: usd(1_800),
        category: 'contractors',
        accountId: ACC.arcOperations,
        budgetId: null,
      })
    }

    // Member purchases through their allowances.
    const plan: [Id, number, number][] = [
      [U.alex, 6, 14],
      [U.priya, 9, 11],
      [U.alex, 18, 16],
      [U.daniel, 16, 13],
    ]
    plan.forEach(([memberId, day, hour], i) => {
      const at = b.inMonth(offset, first ? Math.max(day, 10) : day, hour, i * 7)
      if (!b.isPast(at)) return
      const options = memberPurchases[memberId]!
      const pick = b.random.pick(options)
      const recentAlex = memberId === U.alex && (isCurrent || (isPrevious && day === 18))
      request({
        agencyId: A.arc,
        budgetId: BUD.arcTools,
        requester: user(memberId),
        type: 'vendor_payment',
        destinationId: pick.destinationId,
        amount: b.amountBetween(pick.min, pick.max),
        category: pick.category,
        purpose: pick.purpose,
        at,
        withReceipt: !recentAlex,
      })
    })

    // Research Assistant micro-purchases, twice a week.
    for (const day of [3, 7, 10, 14, 17, 21, 24, 28]) {
      const at = b.inMonth(offset, day, 6, 30)
      if (!b.isPast(at) || at < agent.createdAt) continue
      request({
        agencyId: A.arc,
        budgetId: BUD.arcResearch,
        requester: { kind: 'ai_agent', agentId: agent.id },
        type: 'automation',
        destinationId: DST.pulse,
        amount: b.amountBetween(2, 4),
        category: 'ai_services',
        purpose: b.random.pick([
          'Usage benchmark dataset',
          'Market signals query',
          'Competitor pricing snapshot',
          'Field-service survey data',
        ]),
        at,
      })
    }

    // Team payouts on the 25th.
    const payoutAt = b.inMonth(offset, 25, 9)
    const payouts: [Id, Cents][] = [
      [U.alex, usd(800)],
      [U.priya, usd(700)],
      [U.daniel, usd(600)],
    ]
    const payoutMemo = `${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(payoutAt))} contractor payment`
    for (const [memberId, amount] of payouts) {
      if (b.isPast(payoutAt)) {
        if (!b.canMove(amount, budget(BUD.arcTeam))) continue
        pay({
          agencyId: A.arc,
          type: 'contractor',
          fromBudget: BUD.arcTeam,
          fromAccount: ACC.arcPeople,
          to: { kind: 'member', id: memberId },
          amount,
          category: 'contractors',
          memo: payoutMemo,
          at: payoutAt,
          createdBy: user(U.maya),
        })
      }
      // Future payouts are not seeded: scheduled payments are created live (they run on Monad).
    }
  }

  // Travel history and the automation's two policy rejections.
  const travel = (memberId: Id, daysAgo: number, amount: Cents, purpose: string) =>
    request({
      agencyId: A.arc,
      budgetId: BUD.arcTravel,
      requester: user(memberId),
      type: 'vendor_payment',
      destinationId: DST.northwind,
      amount,
      category: 'travel',
      purpose,
      at: b.ago(daysAgo, 13),
    })
  travel(U.sofia, 131, usd(640), 'Pilot-site visit, Guadalajara')
  travel(U.daniel, 64, usd(180), 'Train to pilot workshop')
  travel(U.sofia, 22, usd(210), 'Field interviews, day trip')

  request({
    agencyId: A.arc,
    budgetId: BUD.arcResearch,
    requester: { kind: 'ai_agent', agentId: agent.id },
    type: 'automation',
    destinationId: DST.vertex,
    amount: cents(400),
    category: 'ai_services',
    purpose: 'GPU inference credits',
    at: b.ago(47, 6, 40),
  })
  request({
    agencyId: A.arc,
    budgetId: BUD.arcResearch,
    requester: { kind: 'ai_agent', agentId: agent.id },
    type: 'automation',
    destinationId: DST.pulse,
    amount: usd(12),
    category: 'ai_services',
    purpose: 'Full industry report',
    at: b.ago(19, 6, 45),
  })

  // A declined request, for history.
  const declined = request({
    agencyId: A.arc,
    budgetId: BUD.arcTools,
    requester: user(U.priya),
    type: 'vendor_payment',
    destinationId: DST.canvasly,
    amount: usd(280),
    category: 'software',
    purpose: 'Annual plugin bundle',
    at: b.ago(40, 10),
    leavePending: true,
  })
  if (declined) {
    Object.assign(declined, {
      status: 'declined',
      declinedReason: 'The team license already includes this plugin.',
      decidedAt: b.ago(40, 15),
    })
    b.activity(
      'payment_declined',
      user(U.maya),
      `Declined Priya Nair's ${usdLabel(declined.amount)} request`,
      { kind: 'request', id: declined.id },
      b.ago(40, 15),
      { portfolioId: P, agencyId: A.arc, amount: declined.amount, subjectUserId: U.priya },
    )
  }

  // Current approval queue.
  const canvaslyUpgrade = request({
    agencyId: A.arc,
    budgetId: BUD.arcTools,
    requester: user(U.daniel),
    type: 'vendor_payment',
    destinationId: DST.canvasly,
    amount: usd(320),
    category: 'software',
    purpose: 'Canvasly team plan upgrade',
    at: b.ago(1, 9, 20),
    leavePending: true,
  })
  // Jordan's is Maya's to decide: nobody approves their own request.
  const summitTicket = request({
    agencyId: A.arc,
    budgetId: BUD.arcTravel,
    requester: user(U.jordan),
    type: 'vendor_payment',
    destinationId: DST.northwind,
    amount: usd(450),
    category: 'travel',
    purpose: 'Product Design Summit ticket',
    at: b.ago(1, 16, 5),
    leavePending: true,
  })

  // Tranche 2 — "Prototype delivered" submitted two days ago, waiting for the Investor.
  const m2 = milestone(DEMO.milestones.arc2)
  const submittedAt = b.ago(2, 8, 40)
  Object.assign(m2, {
    status: 'ready_for_review',
    submittedAt,
    submittedBy: U.maya,
    submissionNote:
      'The prototype is live on staging and was tested with six pilot teams. Findings and the Tranche 1 spend report are attached. We would like the second tranche to start the beta build.',
    evidence: [
      b.evidence('link', 'Staging prototype', U.maya, submittedAt, {
        url: 'https://staging.arcstudio.example',
      }),
      b.evidence('file', 'Pilot usability findings.pdf', U.maya, submittedAt, {
        mimeType: 'application/pdf',
        sizeBytes: 3_640_000,
      }),
      b.evidence('file', 'Session recordings index.pdf', U.maya, submittedAt, {
        mimeType: 'application/pdf',
        sizeBytes: 540_000,
      }),
      b.evidence('file', 'Tranche 1 spend report.pdf', U.maya, submittedAt, {
        mimeType: 'application/pdf',
        sizeBytes: 820_000,
      }),
      b.evidence('file', 'Next iteration plan.pdf', U.maya, submittedAt, {
        mimeType: 'application/pdf',
        sizeBytes: 1_020_000,
      }),
    ],
  })
  m2.evidenceHash = evidenceSetHash(m2.evidence)
  Object.assign(tranche(DEMO.tranches.arc2), {
    status: 'under_review',
    requestedAt: submittedAt,
    requestedBy: U.maya,
    destinationAccountId: ACC.arcOperations,
  })
  b.activity(
    'milestone_submitted',
    user(U.maya),
    'Submitted evidence for Prototype delivered',
    { kind: 'milestone', id: m2.id },
    submittedAt,
    { portfolioId: P, agencyId: A.arc },
  )
  b.activity(
    'tranche_requested',
    user(U.maya),
    `Requested Tranche 2 (${usdLabel(usd(25_000))})`,
    { kind: 'tranche', id: DEMO.tranches.arc2 },
    submittedAt,
    { portfolioId: P, agencyId: A.arc, amount: usd(25_000) },
  )
  milestone(DEMO.milestones.arc3).status = 'in_progress'
  tranche(DEMO.tranches.arc3).status = 'planned'

  // ─── Lumen Labs ────────────────────────────────────────────────────────────

  // Tranche 2 was larger, for a second data hire. The hire moved to next quarter, so Ren returned
  // 5,000 of it to the Portfolio Vault (see the end of the story); Tranche 3 is smaller to match.
  const lumenTranches = [
    [DEMO.tranches.lumen1, b.ago(125, 12), usd(15_000)],
    [DEMO.tranches.lumen2, b.ago(32, 12), usd(20_000)],
    [DEMO.tranches.lumen3, b.ahead(58, 12), usd(10_000)],
    [DEMO.tranches.lumen4, b.ahead(148, 12), usd(15_000)],
  ] as const
  lumenTranches.forEach(([id, date, amount], i) => {
    s.tranches.push({
      id,
      agreementId: DEMO.agreements.lumen,
      index: i + 1,
      name: `Tranche ${i + 1}`,
      amount,
      releaseCondition: 'scheduled',
      scheduledFor: date,
      status: 'planned',
    })
  })
  releaseTranche(
    DEMO.tranches.lumen1,
    DEMO.agreements.lumen,
    DEMO.vaults.lumenFunding,
    A.lumen,
    'Lumen Labs',
    ACC.lumenOperations,
    b.ago(125, 12),
    U.elena,
  )
  transfer(A.lumen, ACC.lumenOperations, ACC.lumenPeople, usd(9_000), b.ago(124, 9), U.ren)
  transfer(A.lumen, ACC.lumenOperations, ACC.lumenVendors, usd(3_000), b.ago(124, 9, 5), U.ren)

  createBudget({
    id: BUD.lumenPayroll,
    agencyId: A.lumen,
    sourceAccountId: ACC.lumenPeople,
    name: 'Engineering payroll',
    purpose: 'Monthly contractor payments.',
    template: 'team_spend',
    allowedCategories: ['team', 'contractors'],
    period: 'monthly',
    perOperationLimit: usd(2_000),
    periodLimit: usd(2_600),
    approvalThreshold: usd(0),
    allowedDestinationIds: [],
    createdBy: U.ren,
    createdAt: b.ago(123, 10),
  })
  createBudget({
    id: BUD.lumenInfra,
    agencyId: A.lumen,
    sourceAccountId: ACC.lumenVendors,
    name: 'Infrastructure',
    purpose: 'Hosting and developer tools.',
    template: 'tools',
    period: 'monthly',
    perOperationLimit: usd(600),
    periodLimit: usd(900),
    approvalThreshold: usd(300),
    allowedDestinationIds: [DST.stratus, DST.codepath],
    createdBy: U.ren,
    createdAt: b.ago(123, 10),
  })

  const lumenStart = monthOffsetOf(b.ago(123), now)
  for (let offset = lumenStart; offset <= 0; offset++) {
    const allocationAt = offset === lumenStart ? b.ago(123, 10, 30) : b.inMonth(offset, 1, 8)
    if (!b.isPast(allocationAt)) break
    topUp(BUD.lumenPayroll, usd(2_600), allocationAt, U.ren, A.lumen, ACC.lumenOperations)
    topUp(BUD.lumenInfra, usd(800), allocationAt, U.ren, A.lumen, ACC.lumenOperations)
    const infraAt = b.inMonth(offset, 12, 10)
    if (b.isPast(infraAt) && infraAt > b.ago(123, 10, 30)) {
      const hosting = b.amountBetween(480, 560)
      if (b.canMove(hosting, budget(BUD.lumenInfra)))
        pay({
          agencyId: A.lumen,
          type: 'vendor',
          fromBudget: BUD.lumenInfra,
          fromAccount: ACC.lumenVendors,
          to: { kind: 'destination', id: DST.stratus },
          amount: hosting,
          category: 'cloud',
          memo: 'Monthly hosting',
          at: infraAt,
          createdBy: user(U.ren),
        })
      if (b.canMove(usd(210), budget(BUD.lumenInfra)))
        pay({
          agencyId: A.lumen,
          type: 'tool',
          fromBudget: BUD.lumenInfra,
          fromAccount: ACC.lumenVendors,
          to: { kind: 'destination', id: DST.codepath },
          amount: usd(210),
          category: 'software',
          memo: 'Developer tools subscription',
          at: b.inMonth(offset, 12, 10, 20),
          createdBy: user(U.ren),
        })
    }
    // The second scheduled tranche is released mid-cycle.
    const secondRelease = b.ago(32, 12)
    if (secondRelease >= b.inMonth(offset, 1) && secondRelease < b.inMonth(offset + 1, 1)) {
      releaseTranche(
        DEMO.tranches.lumen2,
        DEMO.agreements.lumen,
        DEMO.vaults.lumenFunding,
        A.lumen,
        'Lumen Labs',
        ACC.lumenOperations,
        secondRelease,
        U.elena,
      )
      // Split the same day: a day later can fall after next month's top-ups, which counted on it.
      transfer(A.lumen, ACC.lumenOperations, ACC.lumenPeople, usd(6_000), b.ago(32, 15), U.ren)
      transfer(A.lumen, ACC.lumenOperations, ACC.lumenVendors, usd(1_500), b.ago(32, 15, 5), U.ren)
    }
    const payoutAt = b.inMonth(offset, 25, 9)
    const memo = `${new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(payoutAt))} contractor payment`
    for (const [memberId, amount] of [
      [U.noah, usd(1_400)],
      [U.lina, usd(1_200)],
    ] as const) {
      if (b.isPast(payoutAt)) {
        if (b.canMove(amount, budget(BUD.lumenPayroll)))
          pay({
            agencyId: A.lumen,
            type: 'contractor',
            fromBudget: BUD.lumenPayroll,
            fromAccount: ACC.lumenPeople,
            to: { kind: 'member', id: memberId },
            amount,
            category: 'contractors',
            memo,
            at: payoutAt,
            createdBy: user(U.ren),
          })
      }
    }
  }
  tranche(DEMO.tranches.lumen3).status = 'planned'

  createBudget({
    id: BUD.lumenSecurity,
    agencyId: A.lumen,
    sourceAccountId: ACC.lumenOperations,
    name: 'Security and compliance',
    purpose: 'One-time budget for the annual security audit.',
    template: 'vendors',
    allowedCategories: ['legal'],
    period: 'one_time',
    perOperationLimit: usd(7_000),
    periodLimit: usd(7_000),
    approvalThreshold: usd(2_000),
    allowedDestinationIds: [DST.sentinel],
    createdBy: U.ren,
    createdAt: b.ago(10, 10),
  })
  const securityAllocation = cents(Math.min(usd(6_500), b.balance(account(ACC.lumenOperations))))
  if (securityAllocation > 0) {
    b.move('allocate', securityAllocation, account(ACC.lumenOperations), budget(BUD.lumenSecurity), {
      at: b.ago(10, 10, 30),
      portfolioId: P,
      agencyId: A.lumen,
      refId: b.id('alloc'),
    })
  }
  allowance(BUD.lumenSecurity, U.ren, usd(7_000), b.ago(10, 10), U.ren, A.lumen)
  // Above the agreement's exception threshold: routed to the Investor.
  const securityAudit = request({
    agencyId: A.lumen,
    budgetId: BUD.lumenSecurity,
    requester: user(U.ren),
    type: 'vendor_payment',
    destinationId: DST.sentinel,
    amount: cents(Math.min(usd(6_200), securityAllocation)),
    category: 'legal',
    purpose: 'Annual security audit',
    at: b.ago(1, 11),
    leavePending: true,
  })

  // ─── Fieldwork Collective ──────────────────────────────────────────────────

  ;[
    [DEMO.tranches.fieldwork1, DEMO.milestones.fieldwork1, 'Pilot fieldwork completed', b.ahead(60)],
    [DEMO.tranches.fieldwork2, DEMO.milestones.fieldwork2, 'Final report published', b.ahead(150)],
  ].forEach(([trancheId, milestoneId, title, due], i) => {
    s.tranches.push({
      id: trancheId as Id,
      agreementId: DEMO.agreements.fieldwork,
      index: i + 1,
      name: `Tranche ${i + 1}`,
      amount: usd(20_000),
      releaseCondition: 'milestone',
      milestoneId: milestoneId as Id,
      status: 'planned',
    })
    s.milestones.push({
      id: milestoneId as Id,
      agreementId: DEMO.agreements.fieldwork,
      trancheId: trancheId as Id,
      title: title as string,
      description:
        i === 0
          ? 'Complete the first round of community field studies.'
          : 'Publish the pilot report and dataset.',
      acceptanceCriteria:
        i === 0
          ? ['Thirty field interviews', 'Consent summary', 'Phase report']
          : ['Final report', 'Anonymized dataset', 'Presentation to partners'],
      dueDate: due as ISODate,
      status: 'not_started',
      evidence: [],
    })
  })

  // ─── Money to justify, payments outside Viatik, capital returned ───────────
  //
  // The accountability story, recorded the way the engine records it (requestPayment and its
  // capture, addExpense, returnUnusedFunds, payOutside, addPaymentProof, createReminder,
  // remindReceipts, returnToInvestor), with the same texts, links and shapes:
  // - Alex, Priya and Daniel get spending access to Team payments (payment for work) and to a
  //   Pilot purchases budget (money for purchases), funded from the Reserve while Tranche 2 waits.
  // - Money for purchases: Daniel's is 40 days old, nothing justified, overdue, and Maya reminded
  //   him; Priya's is justified with two receipts and the unused rest given back; Alex's is 11
  //   days old and partly justified.
  // - Alex: payment for work paid (approved by Maya) and another waiting; a reimbursement paid.
  // - Maya pays Claude Teams outside Viatik (its invoice the next day, a monthly reminder next due
  //   in about two weeks) and Figma (no invoice yet: overdue after 7 days).
  // - Lumen Labs returns 5,000 of Tranche 2 to the Portfolio Vault.
  // It comes after the rest of the history, so it draws nothing from the seeded randomness the
  // amounts above depend on. A budget a story payment uses is first given that amount, so no
  // balance the history already had is lower at any time in between.

  const arcAdmins = [U.maya, U.jordan]
  const investors = [U.elena, U.marcus]
  const accountName = (id: Id) => s.accounts.find((a) => a.id === id)?.name ?? 'Account'
  const agencyNameOf = (id: Id) => s.agencies.find((a) => a.id === id)?.name ?? 'Agency'
  const notifyAll = (
    userIds: Id[],
    title: string,
    body: string,
    href: string,
    at: ISODate,
    read = false,
    subject?: NotificationSubject,
  ) => {
    for (const userId of userIds) b.notify(userId, title, body, href, at, read, subject)
  }
  /** What a "needs approval" notification asks to decide, as the engine names it. */
  const asksAbout = (req: PaymentRequest | null): NotificationSubject | undefined =>
    req ? { kind: 'request', id: req.id } : undefined
  const balanceHref = `/member/${A.arc}/payments`
  const personHref = (userId: Id) => `/agency/${A.arc}/team/${userId}`
  const approvalsHref = `/agency/${A.arc}/approvals`
  const monthName = (at: ISODate) =>
    new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(at))
  const memberOf = (payment: Payment): Id => {
    if (payment.recipient.kind !== 'member') throw new Error(`Seed: ${payment.id} does not pay a person.`)
    return payment.recipient.userId
  }

  /** A budget gets what a story payment takes, from Operations (through its own source account). */
  const fundFromOperations = (budgetId: Id, amount: Cents, at: ISODate) => {
    const bud = budgetById(budgetId)
    if (bud.sourceAccountId !== ACC.arcOperations)
      transfer(A.arc, ACC.arcOperations, bud.sourceAccountId, amount, at, U.maya)
    b.move('allocate', amount, account(bud.sourceAccountId), budget(budgetId), {
      at,
      portfolioId: P,
      agencyId: A.arc,
      refId: b.id('alloc'),
    })
  }

  /** A story request the policy pays, as the engine would decide it; anything else is a seed bug. */
  const mustBePaid = (req: PaymentRequest | null, what: string): Payment => {
    const payment = req?.paymentId ? s.payments.find((p) => p.id === req.paymentId) : undefined
    if (!req || req.status !== 'completed' || !payment)
      throw new Error(`Seed: ${what} was not paid (${req?.status}: ${req?.decision.reason?.message ?? ''})`)
    return payment
  }

  /** What the requester hears when a request into their Viatik balance is paid (the engine's paidNotice). */
  const paidNotice = (payment: Payment, type: RequestType, read: boolean) => {
    const amount = usdLabel(payment.amount)
    const [title, body]: [string, string] =
      type === 'funds'
        ? [
            'Money for your purchase',
            `${amount} is in your Viatik balance. Add its receipts within ${JUSTIFY_WITHIN_DAYS} days or return what you do not use.`,
          ]
        : type === 'reimbursement'
          ? ['Reimbursement paid', `${amount} is back in your Viatik balance.`]
          : ['Payment for your work', `${amount} is in your Viatik balance.`]
    b.notify(memberOf(payment), title, body, balanceHref, payment.completedAt ?? payment.scheduledFor, read)
  }

  /** A receipt that justifies part of an advance, added in one step (the engine's addExpense). */
  const addReceipt = (
    advance: Payment,
    input: {
      merchant: string
      amount: Cents
      category: SpendingCategory
      spentAt: ISODate
      at: ISODate
      sizeBytes: number
      read: boolean
    },
  ) => {
    const userId = memberOf(advance)
    const bud = budgetById(advance.budgetId ?? '')
    const requestedAt = s.requests.find((r) => r.id === advance.requestId)?.createdAt ?? advance.scheduledFor
    const { pending } = advanceStanding(s, advance, input.at)
    if (
      advance.type !== 'advance' ||
      input.amount > pending ||
      !bud.allowedCategories.includes(input.category) ||
      input.spentAt.slice(0, 10) < requestedAt.slice(0, 10) ||
      input.spentAt > input.at
    )
      throw new Error(`Seed: the ${input.merchant} receipt does not fit ${advance.id}.`)
    const expense: Expense = {
      id: b.id('exp'),
      agencyId: advance.agencyId,
      userId,
      budgetId: bud.id,
      merchant: input.merchant,
      amount: input.amount,
      category: input.category,
      spentAt: input.spentAt,
      paymentId: advance.id,
      receipt: b.evidence('file', `${input.merchant} receipt.pdf`, userId, input.at, {
        mimeType: 'application/pdf',
        sizeBytes: input.sizeBytes,
      }),
      createdAt: input.at,
    }
    s.expenses.push(expense)
    const summary = `${usdLabel(input.amount)} receipt from ${input.merchant}`
    b.activity(
      'receipt_added',
      user(userId),
      `Added a ${summary}`,
      { kind: 'expense', id: expense.id },
      input.at,
      { portfolioId: P, agencyId: advance.agencyId, amount: input.amount, subjectUserId: userId },
    )
    notifyAll(
      arcAdmins,
      'Receipt uploaded',
      `${nameOf(userId)} added a ${summary}.`,
      personHref(userId),
      input.at,
      input.read,
    )
    return expense
  }

  /** "Return the rest": the unused part of an advance back to Operations (the engine's returnUnusedFunds). */
  const giveBack = (advance: Payment, amount: Cents, at: ISODate, read: boolean) => {
    const userId = memberOf(advance)
    const name = nameOf(userId)
    if (amount > advanceStanding(s, advance, at).pending || amount > memberHeld(s, advance.agencyId, userId))
      throw new Error(`Seed: ${name} cannot give back ${amount} of ${advance.id}.`)
    const operations = ACC.arcOperations
    const operationId = b.id('ret')
    const receipt = b.receipt({
      kind: 'transfer',
      amount,
      fromLabel: name,
      toLabel: accountName(operations),
      description: `Unused money returned · ${advance.memo}`,
      policyLabel: 'Member return · personal funds',
      operationId,
      at,
      portfolioId: P,
      agencyId: advance.agencyId,
      account: userId,
    })
    b.move('transfer', amount, toMember(userId), account(operations), {
      at,
      portfolioId: P,
      agencyId: advance.agencyId,
      refId: operationId,
      receiptId: receipt.id,
      settlesPaymentId: advance.id,
    })
    b.activity(
      'advance_returned',
      user(userId),
      `${name} returned ${usdLabel(amount)} unused from ${advance.memo}`,
      { kind: 'receipt', id: receipt.id },
      at,
      { portfolioId: P, agencyId: advance.agencyId, amount, subjectUserId: userId },
    )
    notifyAll(
      arcAdmins,
      'Unused money returned',
      `${name} returned ${usdLabel(amount)} unused from ${advance.memo} to ${accountName(operations)}.`,
      personHref(userId),
      at,
      read,
    )
  }

  /** Maya pays an address outside Viatik from an Arc account (the engine's payOutside, invoice to follow). */
  const payOutsideViatik = (input: {
    accountId: Id
    payee: string
    address: string
    amount: Cents
    category: SpendingCategory
    memo: string
    at: ISODate
    reminderId?: Id
    read: boolean
  }) => {
    const id = b.id('pay')
    const receipt = b.receipt({
      kind: 'outside_payment',
      amount: input.amount,
      fromLabel: accountName(input.accountId),
      toLabel: `${input.payee} · ${shortAddress(input.address)}`,
      description: input.memo,
      policyLabel: 'Paid outside Viatik · Agency Admin authorization',
      operationId: id,
      at: input.at,
      portfolioId: P,
      agencyId: A.arc,
      account: U.maya,
    })
    b.move(
      'payment',
      input.amount,
      account(input.accountId),
      { kind: 'external', label: input.payee, address: input.address },
      { at: input.at, portfolioId: P, agencyId: A.arc, refId: id, receiptId: receipt.id },
    )
    const payment: Payment = {
      id,
      agencyId: A.arc,
      type: paymentTypeForCategory(input.category),
      sourceAccountId: input.accountId,
      recipient: { kind: 'address', payee: input.payee, address: input.address },
      amount: input.amount,
      category: input.category,
      memo: input.memo,
      status: 'completed',
      createdBy: user(U.maya),
      scheduledFor: input.at,
      completedAt: input.at,
      receiptId: receipt.id,
      reminderId: input.reminderId,
    }
    s.payments.push(payment)
    b.activity(
      'paid_outside',
      user(U.maya),
      `Paid ${usdLabel(input.amount)} to ${input.payee} outside Viatik`,
      { kind: 'payment', id },
      input.at,
      { portfolioId: P, agencyId: A.arc, amount: input.amount },
    )
    notifyAll(
      investors,
      'Paid outside Viatik',
      `${agencyNameOf(A.arc)} paid ${usdLabel(input.amount)} to ${input.payee}. Invoice pending.`,
      `/receipts/${receipt.id}`,
      input.at,
      input.read,
    )
    return payment
  }

  /** Its invoice, added after the payment and anchored once (the engine's addPaymentProof). */
  const addInvoice = (payment: Payment, name: string, at: ISODate, read: boolean) => {
    const recipient = payment.recipient
    if (recipient.kind !== 'address' || payment.proof)
      throw new Error(`Seed: ${payment.id} does not take an invoice.`)
    const payee = recipient.payee
    const proof: Evidence = b.evidence('file', name, U.maya, at, {
      mimeType: 'application/pdf',
      sizeBytes: 182_400,
    })
    payment.proof = proof
    payment.proofVerified = {
      ...simulatedVerification({
        operationId: `${payment.id}:invoice`,
        account: U.maya,
        timestamp: at,
        contractPolicy: 'Invoice fingerprinted · anchored once',
      }),
      evidenceHash: attachmentsHash([proof]),
    }
    const receipt = s.receipts.find((r) => r.id === payment.receiptId)
    if (receipt && !receipt.evidenceIds.includes(proof.id)) receipt.evidenceIds.push(proof.id)
    b.activity(
      'payment_proof_added',
      user(U.maya),
      `Added the invoice for ${usdLabel(payment.amount)} paid to ${payee}`,
      { kind: 'payment', id: payment.id },
      at,
      { portfolioId: P, agencyId: payment.agencyId, amount: payment.amount },
    )
    notifyAll(
      investors,
      'Invoice uploaded',
      `${agencyNameOf(payment.agencyId)} added the invoice for ${usdLabel(payment.amount)} paid to ${payee}.`,
      `/receipts/${payment.receiptId}`,
      at,
      read,
    )
  }

  // Spending access, and the money behind money for purchases: Arc runs low while Tranche 2 is
  // reviewed, so Maya moves part of the Reserve to Operations.
  transfer(A.arc, ACC.arcReserve, ACC.arcOperations, usd(1_000), b.ago(51, 10), U.maya)
  const accessAt = b.ago(50, 11)
  createBudget({
    id: BUD.arcPurchases,
    agencyId: A.arc,
    sourceAccountId: ACC.arcOperations,
    name: 'Pilot purchases',
    purpose: 'Devices, supplies and printing for pilot sessions, justified with receipts.',
    template: 'team_spend',
    period: 'monthly',
    perOperationLimit: usd(400),
    periodLimit: usd(1_000),
    approvalThreshold: usd(200),
    allowedDestinationIds: [],
    createdBy: U.maya,
    createdAt: accessAt,
  })
  fundFromOperations(BUD.arcPurchases, usd(700), b.ago(50, 11, 30))
  for (const [budgetId, periodLimit, perOperationLimit] of [
    [BUD.arcPurchases, usd(400), undefined],
    [BUD.arcTeam, usd(3_000), usd(1_000)],
  ] as const) {
    for (const memberId of [U.alex, U.priya, U.daniel]) {
      allowance(budgetId, memberId, periodLimit, accessAt, U.maya, A.arc, perOperationLimit)
      b.notify(
        memberId,
        'New spending access',
        `You can now spend up to ${usdLabel(periodLimit)} from ${budgetById(budgetId).name}.`,
        `/member/${A.arc}/budget/${budgetId}`,
        accessAt,
        true,
      )
    }
  }

  // Daniel: money for test phones, 40 days ago. Nothing justified yet: overdue.
  const danielAdvance = mustBePaid(
    request({
      agencyId: A.arc,
      budgetId: BUD.arcPurchases,
      requester: user(U.daniel),
      type: 'funds',
      amount: usd(180),
      category: 'equipment',
      purpose: 'Test phones for the pilot',
      at: b.ago(40, 11),
    }),
    "Daniel's money for purchases",
  )
  paidNotice(danielAdvance, 'funds', true)

  // The monthly reminder to pay Claude Teams, next due in about two weeks: its day of the month is
  // the one 14 days from now (1–28, a day every month has). Last month's Claude Teams was paid
  // outside Viatik on that day (two to three weeks ago) and its invoice added the next day; Maya
  // set the reminder up a few days before that payment. (Recorded here, ahead of stories that
  // come before it in time: activity, notifications and movements are sorted at the end.)
  const claudePayee = 'Anthropic · Claude Teams'
  const claudeDay = Math.min(28, Math.max(1, new Date(b.ahead(14)).getUTCDate()))
  const claudeMonth = monthOffsetOf(b.ahead(14), now) - 1
  const claudeAt = b.inMonth(claudeMonth, claudeDay, 15)
  const reminderAt = b.inMonth(claudeMonth, claudeDay - 4, 9)
  const claudeReminder: Reminder = {
    id: b.id('rmd'),
    agencyId: A.arc,
    title: 'Pay Claude Teams and upload the invoice',
    payee: claudePayee,
    amount: usd(150),
    category: 'ai_services',
    cadence: 'monthly',
    dayOfMonth: claudeDay,
    sourceAccountId: ACC.arcOperations,
    status: 'active',
    createdBy: U.maya,
    createdAt: reminderAt,
    updatedAt: reminderAt,
  }
  s.reminders.push(claudeReminder)
  b.activity(
    'reminder_created',
    user(U.maya),
    `Created the monthly reminder "${claudeReminder.title}"`,
    { kind: 'reminder', id: claudeReminder.id },
    reminderAt,
    { portfolioId: P, agencyId: A.arc, amount: claudeReminder.amount },
  )
  const claude = payOutsideViatik({
    accountId: ACC.arcOperations,
    payee: claudePayee,
    address: DEMO.outsideAddresses.anthropic,
    amount: usd(150),
    category: 'ai_services',
    memo: `Claude Teams, ${monthName(claudeAt)} · 5 seats`,
    at: claudeAt,
    reminderId: claudeReminder.id,
    read: true,
  })
  addInvoice(
    claude,
    `Anthropic invoice, ${monthName(claudeAt)}.pdf`,
    b.inMonth(claudeMonth, claudeDay + 1, 10),
    true,
  )

  // Priya: a paper prototyping kit. Two receipts and the unused rest given back: settled.
  const priyaAdvance = mustBePaid(
    request({
      agencyId: A.arc,
      budgetId: BUD.arcPurchases,
      requester: user(U.priya),
      type: 'funds',
      amount: usd(120),
      category: 'equipment',
      purpose: 'Paper prototyping kit',
      at: b.ago(26, 10),
    }),
    "Priya's money for purchases",
  )
  paidNotice(priyaAdvance, 'funds', true)
  addReceipt(priyaAdvance, {
    merchant: 'PaperLab Supplies',
    amount: cents(6_480),
    category: 'equipment',
    spentAt: b.ago(25, 12),
    at: b.ago(24, 15),
    sizeBytes: 96_300,
    read: true,
  })
  addReceipt(priyaAdvance, {
    merchant: 'Print House',
    amount: cents(4_320),
    category: 'research',
    spentAt: b.ago(23, 17),
    at: b.ago(22, 11),
    sizeBytes: 121_800,
    read: true,
  })
  giveBack(priyaAdvance, advanceStanding(s, priyaAdvance, b.ago(21, 12)).pending, b.ago(21, 12), true)

  // Alex: paid back for a screen recording app he bought himself.
  const reimbursed = request({
    agencyId: A.arc,
    budgetId: BUD.arcPurchases,
    requester: user(U.alex),
    type: 'reimbursement',
    amount: usd(49),
    category: 'software',
    purpose: 'Screen recording app for pilot sessions',
    merchant: 'Capturely',
    spentAt: b.ago(21, 18),
    at: b.ago(20, 15),
  })
  paidNotice(mustBePaid(reimbursed, "Alex's reimbursement"), 'reimbursement', true)

  // Alex: payment for work, reviewed and approved by Maya, paid from Team payments with `pay`.
  const workPurpose = 'On-call support for the pilot launch'
  const workAt = b.ago(15, 9)
  fundFromOperations(BUD.arcTeam, usd(180), b.ago(15, 8, 30))
  const workPaid = mustBePaid(
    request({
      agencyId: A.arc,
      budgetId: BUD.arcTeam,
      requester: user(U.alex),
      type: 'work',
      amount: usd(180),
      category: 'team',
      purpose: workPurpose,
      files: [{ name: 'Pilot launch on-call log.pdf', sizeBytes: 148_200 }],
      at: workAt,
      approver: U.maya,
    }),
    "Alex's payment for work",
  )
  notifyAll(
    arcAdmins,
    'Request needs approval',
    `${nameOf(U.alex)} requested ${usdLabel(workPaid.amount)} for ${workPurpose}.`,
    approvalsHref,
    workAt,
    true,
  )
  paidNotice(workPaid, 'work', true)

  // Alex: money for a field kit 11 days ago (well inside its 30 days), partly justified so far.
  const alexAdvance = mustBePaid(
    request({
      agencyId: A.arc,
      budgetId: BUD.arcPurchases,
      requester: user(U.alex),
      type: 'funds',
      amount: usd(150),
      category: 'equipment',
      purpose: 'Field kit for the pilot visit',
      at: b.ago(11, 10),
    }),
    "Alex's money for purchases",
  )
  paidNotice(alexAdvance, 'funds', true)
  addReceipt(alexAdvance, {
    merchant: 'Northline Electronics',
    amount: cents(6_490),
    category: 'equipment',
    spentAt: b.ago(10, 15),
    at: b.ago(9, 17),
    sizeBytes: 88_700,
    read: false,
  })

  // Figma, paid outside Viatik ten days ago: its invoice is overdue.
  payOutsideViatik({
    accountId: ACC.arcOperations,
    payee: 'Figma',
    address: DEMO.outsideAddresses.figma,
    amount: usd(45),
    category: 'software',
    memo: 'Figma Professional · 3 editor seats',
    at: b.ago(10, 16),
    read: false,
  })

  // Lumen Labs returns the unused part of Tranche 2 (no inflow reaches its Operations after it).
  const returnAt = b.ago(3, 11)
  const returnedCapital = usd(5_000)
  const capitalReturnId = b.id('cret')
  const capitalReceipt = b.receipt({
    kind: 'capital_return',
    amount: returnedCapital,
    fromLabel: accountName(ACC.lumenOperations),
    toLabel: `${s.portfolios.find((p) => p.id === P)?.name ?? 'Portfolio'} · Portfolio Vault`,
    description: 'Unused part of Tranche 2: the second data hire moved to next quarter',
    policyLabel: 'Capital return · from an Agency account to its Portfolio Vault',
    operationId: capitalReturnId,
    at: returnAt,
    portfolioId: P,
    agencyId: A.lumen,
    account: U.ren,
  })
  b.move('capital_return', returnedCapital, account(ACC.lumenOperations), vault(DEMO.vaults.portfolio), {
    at: returnAt,
    portfolioId: P,
    agencyId: A.lumen,
    agreementId: governingAgreement(s, A.lumen)?.id,
    refId: capitalReturnId,
    receiptId: capitalReceipt.id,
  })
  b.activity(
    'capital_returned',
    user(U.ren),
    `Returned ${usdLabel(returnedCapital)} from ${accountName(ACC.lumenOperations)} to the Portfolio Vault`,
    { kind: 'receipt', id: capitalReceipt.id },
    returnAt,
    { portfolioId: P, agencyId: A.lumen, amount: returnedCapital },
  )
  notifyAll(
    investors,
    'Capital returned',
    `${agencyNameOf(A.lumen)} returned ${usdLabel(returnedCapital)} to the Portfolio Vault.`,
    `/investor/${P}/vaults`,
    returnAt,
  )

  // Maya reminds Daniel about his receipts (the engine's remindReceipts, for one person).
  const remindedAt = b.ago(2, 9)
  const danielOwes = accountabilityByPerson(s, A.arc, remindedAt).find((p) => p.userId === U.daniel)
  if (!danielOwes || danielOwes.pending <= 0) throw new Error('Seed: Daniel has nothing to justify.')
  b.activity(
    'receipts_reminded',
    user(U.maya),
    `Reminded ${nameOf(U.daniel)} to add receipts for ${usdLabel(danielOwes.pending)}`,
    { kind: 'user', id: U.daniel },
    remindedAt,
    { portfolioId: P, agencyId: A.arc, amount: danielOwes.pending, subjectUserId: U.daniel },
  )
  b.notify(
    U.daniel,
    'Receipts needed',
    `${usdLabel(danielOwes.pending)} from ${agencyNameOf(A.arc)} still needs receipts${danielOwes.overdueCount > 0 ? ', some overdue' : ''}.`,
    `/member/${A.arc}/expenses`,
    remindedAt,
  )

  // Alex: more payment for work, waiting for an Agency Admin (never on the ledger until it is paid).
  // Team payments must hold it to be approvable; after the month's payouts it is given the rest.
  const waitingAt = b.ago(1, 11, 30)
  const waitingAmount = usd(350)
  const teamFree = budgetUsage(s, budgetById(BUD.arcTeam), waitingAt).available
  if (teamFree < waitingAmount) fundFromOperations(BUD.arcTeam, cents(waitingAmount - teamFree), b.ago(1, 11))
  const waitingWork = request({
    agencyId: A.arc,
    budgetId: BUD.arcTeam,
    requester: user(U.alex),
    type: 'work',
    amount: waitingAmount,
    category: 'team',
    purpose: 'Pilot onboarding guide',
    files: [{ name: 'Pilot onboarding guide v1.pdf', sizeBytes: 1_260_000 }],
    at: waitingAt,
    leavePending: true,
  })
  if (!waitingWork || waitingWork.status !== 'needs_approval')
    throw new Error(`Seed: Alex's payment for work is ${waitingWork?.status}, not waiting.`)
  notifyAll(
    arcAdmins,
    'Request needs approval',
    `${nameOf(U.alex)} requested ${usdLabel(waitingAmount)} for ${waitingWork.purpose}.`,
    approvalsHref,
    waitingAt,
    false,
    asksAbout(waitingWork),
  )

  // ─── Notifications ─────────────────────────────────────────────────────────
  // The ones that ask for a decision name what they ask about: deciding it marks them read.

  const agencyHref = (path: string) => `/agency/${A.arc}/${path}`
  b.notify(
    U.elena,
    'Milestone ready for review',
    'Arc Studio submitted evidence for "Prototype delivered".',
    `/investor/${P}/funding/${DEMO.agreements.arc}/milestones/${DEMO.milestones.arc2}`,
    submittedAt,
    false,
    { kind: 'milestone', id: DEMO.milestones.arc2 },
  )
  b.notify(
    U.elena,
    'Exception needs your decision',
    'Lumen Labs requested 6,200.00 USD for an annual security audit.',
    `/investor/${P}/approvals`,
    b.ago(1, 11, 5),
    false,
    asksAbout(securityAudit),
  )
  b.notify(
    U.elena,
    'Tranche released',
    'Lumen Labs received its scheduled Tranche 2.',
    `/investor/${P}/funding/${DEMO.agreements.lumen}`,
    b.ago(32, 12),
    true,
  )
  b.notify(
    U.elena,
    'Agreement awaiting acceptance',
    'Fieldwork Collective has not accepted the Community pilot program yet.',
    `/investor/${P}/funding/${DEMO.agreements.fieldwork}`,
    b.ago(8, 9),
    true,
  )
  b.notify(
    U.maya,
    'Request needs approval',
    'Daniel Okafor requested 320.00 USD for Canvasly team plan upgrade.',
    agencyHref('approvals'),
    b.ago(1, 9, 25),
    false,
    asksAbout(canvaslyUpgrade),
  )
  // The due dates of this month's Vertex Cloud and Pagecraft bills (Vendor bills above), as dates:
  // "in 3 days" would be wrong on any later day the notification is read.
  const dueDay = (at: ISODate) =>
    new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(at))
  b.notify(
    U.maya,
    'Bill due soon',
    `Vertex Cloud bill is due ${dueDay(b.ahead(3, 12))}.`,
    agencyHref('bills'),
    b.ago(1, 7),
  )
  b.notify(
    U.maya,
    'Bill overdue',
    `Pagecraft bill was due ${dueDay(b.ago(4, 12))}.`,
    agencyHref('bills'),
    b.ago(3, 12),
  )
  b.notify(
    U.maya,
    'Evidence submitted',
    'Prototype delivered is now with Northstar Capital for review.',
    agencyHref('funding'),
    submittedAt,
    true,
  )
  b.notify(
    U.maya,
    'Request needs approval',
    'Jordan Lee requested 450.00 USD for Product Design Summit ticket.',
    agencyHref('approvals'),
    b.ago(1, 16, 10),
    false,
    asksAbout(summitTicket),
  )
  // Only vendor payments' expenses miss receipts now (money for purchases is "to justify"), and
  // only those there were when Alex was told.
  const missingNoticeAt = b.ago(1, 8)
  const alexMissing = missingReceipts(s, { agencyId: A.arc, userId: U.alex }).filter(
    (e) => Date.parse(e.createdAt) <= Date.parse(missingNoticeAt),
  ).length
  if (alexMissing > 0) {
    b.notify(
      U.alex,
      'Receipts missing',
      alexMissing === 1
        ? 'A vendor payment you requested still needs its receipt.'
        : `${alexMissing} vendor payments you requested still need their receipts.`,
      `/member/${A.arc}/expenses`,
      missingNoticeAt,
    )
  }
  b.notify(
    U.ren,
    'Exception sent to Investor',
    'Annual security audit is waiting for Northstar Capital.',
    `/agency/${A.lumen}/approvals`,
    b.ago(1, 11, 5),
  )

  // Newest first everywhere.
  s.activity.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
  s.notifications.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
  s.movements.sort((x, y) => (x.createdAt < y.createdAt ? -1 : 1))

  return s
}

/** Whole calendar months between `date` and `now` (0 = same month, negative = past). */
function monthOffsetOf(date: ISODate, now: ISODate): number {
  const a = new Date(date)
  const n = new Date(now)
  return (a.getUTCFullYear() - n.getUTCFullYear()) * 12 + (a.getUTCMonth() - n.getUTCMonth())
}

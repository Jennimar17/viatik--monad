import { accountabilityByPerson, lastReminded, REMIND_EVERY_HOURS } from '../accountability'
import { parseAddress, shortAddress } from '../address'
import { newId } from '../ids'
import type { Cents } from '../money'
import {
  agencyName,
  exceptionThresholdOf,
  governingAgreement,
  isOutsidePayment,
  portfolioVaultOf,
} from '../queries'
import { accountBalance, budgetUsage } from '../selectors'
import { canTransitionReminder, reminderStatus } from '../status'
import type {
  Account,
  Budget,
  Id,
  Payment,
  Receipt,
  Reminder,
  ReminderStatus,
  SpendingCategory,
} from '../types'
import {
  DomainError,
  evidenceFrom,
  requirePositive,
  requireText,
  usdText,
  type EvidenceDraft,
  type Tx,
} from './core'
import { paymentTypeForCategory, requireUnusedReceipts } from './operations'

/**
 * What an Agency Admin does with money outside Viatik's own payment flows:
 * paying something Viatik cannot pay directly (a tool, a subscription) to an
 * address, documenting it with its invoice, returning capital to the Investor,
 * and the reminders that keep receipts and monthly payments on time.
 */

const HOUR = 60 * 60 * 1000

// ─── Paying outside Viatik ───────────────────────────────────────────────────

export type PayOutsideInput = {
  agencyId: Id
  source: { kind: 'account'; accountId: Id } | { kind: 'budget'; budgetId: Id }
  /** The address to pay (0x + 40 hex). */
  to: string
  /** Who gets paid, e.g. "Anthropic · Claude Teams". */
  payee: string
  amount: Cents
  category: SpendingCategory
  memo: string
  proof?: EvidenceDraft
  reminderId?: Id
}

/**
 * An Agency Admin pays an address from an agency account or an open budget.
 * The same limits as a payment apply, in the ledger's order: a paused budget
 * pays nothing, a budget's per-operation limit holds, a budget limited to
 * approved vendors never pays an address, and nothing above the Investor's
 * exception threshold (there is no Investor path: it is refused). Immediate
 * only. The invoice can come with the payment or later (`addPaymentProof`).
 */
export function payOutside(tx: Tx, input: PayOutsideInput): Payment {
  tx.authorize('pay_outside', { agencyId: input.agencyId })
  requirePositive(input.amount)
  const address = parseAddress(input.to)
  if (!address) throw new DomainError('validation', 'Enter a valid address (0x followed by 40 characters).')
  const payee = requireText(input.payee, 'Payee', 120)
  const memo = requireText(input.memo, 'What it pays', 500)
  if (input.proof) {
    requireInvoiceFile(input.proof)
    requireUnusedReceipts(tx, input.agencyId, [input.proof])
  }
  const { account, budget } = outsideSource(tx, input.agencyId, input.source)

  if (budget) {
    if (budget.status !== 'active') {
      throw new DomainError(
        'policy_rejected',
        budget.status === 'paused'
          ? 'This budget is paused. New payments are on hold.'
          : `${budget.name} is no longer active.`,
      )
    }
    if (input.amount > budget.perOperationLimit) {
      throw new DomainError(
        'policy_rejected',
        `The amount exceeds the budget's per-operation limit of ${usdText(budget.perOperationLimit)}.`,
      )
    }
    if (budget.allowedDestinationIds.length > 0) {
      throw new DomainError(
        'policy_rejected',
        `${budget.name} only pays its approved vendors. Pay from an account instead.`,
      )
    }
  }

  const exceptionThreshold = exceptionThresholdOf(tx.state, input.agencyId)
  if (exceptionThreshold !== undefined && input.amount > exceptionThreshold) {
    throw new DomainError(
      'limit_exceeded',
      `Above the Investor's exception threshold of ${usdText(exceptionThreshold)}.`,
    )
  }

  const available = budget
    ? budgetUsage(tx.state, budget, tx.now).available
    : accountBalance(tx.state, account.id)
  if (available < input.amount) {
    throw new DomainError(
      'insufficient_funds',
      `${budget ? budget.name : account.name} has ${usdText(available)} available.`,
    )
  }

  const reminder = input.reminderId ? requireActiveReminder(tx, input.reminderId, input.agencyId) : undefined

  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const id = newId('pay')
  const proof = input.proof ? evidenceFrom(input.proof, tx.userId, tx.now) : undefined
  const receipt = tx.receipt({
    kind: 'outside_payment',
    amount: input.amount,
    fromLabel: budget ? `${account.name} · ${budget.name}` : account.name,
    toLabel: `${payee} · ${shortAddress(address)}`,
    description: memo,
    policyLabel: 'Paid outside Viatik · Agency Admin authorization',
    operationId: id,
    portfolioId,
    agencyId: input.agencyId,
    evidenceIds: proof ? [proof.id] : [],
  })
  tx.move(
    'payment',
    input.amount,
    budget ? { kind: 'budget', budgetId: budget.id } : { kind: 'account', accountId: account.id },
    { kind: 'external', label: payee, address },
    { portfolioId, agencyId: input.agencyId, refId: id, receiptId: receipt.id },
  )
  const payment: Payment = {
    id,
    agencyId: input.agencyId,
    type: paymentTypeForCategory(input.category),
    sourceAccountId: account.id,
    budgetId: budget?.id,
    recipient: { kind: 'address', payee, address },
    amount: input.amount,
    category: input.category,
    memo,
    status: 'completed',
    createdBy: tx.actor,
    scheduledFor: tx.now,
    completedAt: tx.now,
    receiptId: receipt.id,
    proof,
    reminderId: reminder?.id,
  }
  tx.state.payments.push(payment)
  tx.activity(
    'paid_outside',
    `Paid ${usdText(input.amount)} to ${payee} outside Viatik`,
    { kind: 'payment', id: payment.id },
    { portfolioId, agencyId: input.agencyId, amount: input.amount },
  )
  tx.notify(
    tx.holders('investor', { portfolioId }),
    'Paid outside Viatik',
    `${agencyName(tx.state, input.agencyId)} paid ${usdText(input.amount)} to ${payee}.${proof ? '' : ' Invoice pending.'}`,
    `/receipts/${receipt.id}`,
  )
  return payment
}

export type AddPaymentProofInput = { paymentId: Id; proof: EvidenceDraft }

/**
 * The invoice of a payment made outside Viatik, added after the payment. It is
 * attached once: the ledger anchors its fingerprint once and never replaces it.
 */
export function addPaymentProof(tx: Tx, input: AddPaymentProofInput): Payment {
  const payment = tx.find('payments', input.paymentId, 'Payment')
  tx.authorize('pay_outside', { agencyId: payment.agencyId })
  const recipient = payment.recipient
  if (!isOutsidePayment(payment) || recipient.kind !== 'address')
    throw new DomainError('validation', 'Only payments made outside Viatik take an invoice here.')
  if (payment.proof) throw new DomainError('invalid_state', 'This payment already has its invoice.')
  requireInvoiceFile(input.proof)
  requireUnusedReceipts(tx, payment.agencyId, [input.proof])
  const proof = evidenceFrom(input.proof, tx.userId, tx.now)
  payment.proof = proof
  // The receipt lists the invoice from now on; what the ledger recorded with the payment stays as it was.
  const receipt = tx.state.receipts.find((r) => r.id === payment.receiptId)
  if (receipt && !receipt.evidenceIds.includes(proof.id)) receipt.evidenceIds.push(proof.id)
  const portfolioId = tx.portfolioOfAgency(payment.agencyId)
  const payee = recipient.payee
  tx.activity(
    'payment_proof_added',
    `Added the invoice for ${usdText(payment.amount)} paid to ${payee}`,
    { kind: 'payment', id: payment.id },
    { portfolioId, agencyId: payment.agencyId, amount: payment.amount },
  )
  tx.notify(
    tx.holders('investor', { portfolioId }),
    'Invoice uploaded',
    `${agencyName(tx.state, payment.agencyId)} added the invoice for ${usdText(payment.amount)} paid to ${payee}.`,
    receipt
      ? `/receipts/${receipt.id}`
      : `/investor/${portfolioId}/agencies/${payment.agencyId}?tab=accountability`,
  )
  return payment
}

/** Where an outside payment comes from: an active account of the Agency, or one of its budgets. */
function outsideSource(
  tx: Tx,
  agencyId: Id,
  source: PayOutsideInput['source'],
): { account: Account; budget?: Budget } {
  if (source.kind === 'account') {
    return { account: requireActiveAccount(tx, source.accountId, agencyId) }
  }
  const budget = tx.find('budgets', source.budgetId, 'Budget')
  if (budget.agencyId !== agencyId)
    throw new DomainError('forbidden', 'The budget belongs to another Agency.')
  return { account: tx.find('accounts', budget.sourceAccountId, 'Account'), budget }
}

/** An invoice is a document: one file, never a link or a note. */
function requireInvoiceFile(draft: EvidenceDraft) {
  if (draft.kind !== 'file') throw new DomainError('validation', 'Attach the invoice as a file.')
}

// ─── Returning capital ───────────────────────────────────────────────────────

export type ReturnToInvestorInput = { agencyId: Id; accountId: Id; amount: Cents; note?: string }

/**
 * An Agency Admin sends money from an agency account back to the Investor's
 * Portfolio Vault. Only an account (never a budget or a funding vault); only
 * limited by its balance, not by the exception threshold. It is attributed to
 * the agreement that governs the Agency, when there is one.
 */
export function returnToInvestor(tx: Tx, input: ReturnToInvestorInput): Receipt {
  tx.authorize('return_capital', { agencyId: input.agencyId })
  requirePositive(input.amount)
  const note = optionalText(input.note, 'Note', 300)
  const account = requireActiveAccount(tx, input.accountId, input.agencyId)
  const available = accountBalance(tx.state, account.id)
  if (available < input.amount)
    throw new DomainError('insufficient_funds', `${account.name} has ${usdText(available)} available.`)
  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const vault = portfolioVaultOf(tx.state, portfolioId)
  if (!vault) throw new DomainError('not_found', 'Portfolio Vault not found.')
  const portfolio = tx.state.portfolios.find((p) => p.id === portfolioId)
  const agreementId = governingAgreement(tx.state, input.agencyId)?.id
  const operationId = newId('cret')
  const receipt = tx.receipt({
    kind: 'capital_return',
    amount: input.amount,
    fromLabel: account.name,
    toLabel: `${portfolio?.name ?? 'Portfolio'} · Portfolio Vault`,
    description: note ?? 'Capital returned to the Investor',
    policyLabel: 'Capital return · from an Agency account to its Portfolio Vault',
    operationId,
    portfolioId,
    agencyId: input.agencyId,
  })
  tx.move(
    'capital_return',
    input.amount,
    { kind: 'account', accountId: account.id },
    { kind: 'vault', vaultId: vault.id },
    { portfolioId, agencyId: input.agencyId, agreementId, refId: operationId, receiptId: receipt.id },
  )
  tx.activity(
    'capital_returned',
    `Returned ${usdText(input.amount)} from ${account.name} to the Portfolio Vault`,
    { kind: 'receipt', id: receipt.id },
    { portfolioId, agencyId: input.agencyId, amount: input.amount },
  )
  tx.notify(
    tx.holders('investor', { portfolioId }),
    'Capital returned',
    `${agencyName(tx.state, input.agencyId)} returned ${usdText(input.amount)} to the Portfolio Vault.`,
    `/investor/${portfolioId}/vaults`,
  )
  return receipt
}

// ─── Receipt reminders ───────────────────────────────────────────────────────

export type RemindReceiptsInput = { agencyId: Id; userId?: Id }

/**
 * An Agency Admin reminds the people who still owe receipts for money they
 * requested (everyone, or one person). Each person is reminded at most once
 * every REMIND_EVERY_HOURS; the last reminder is read from the activity log.
 */
export function remindReceipts(tx: Tx, input: RemindReceiptsInput): { notified: Id[] } {
  tx.authorize('manage_reminders', { agencyId: input.agencyId })
  const actorId = tx.actor.kind === 'user' ? tx.actor.userId : undefined
  // Only people still in the Agency can open their expenses and act on a reminder.
  const inAgency = (userId: Id) =>
    tx.state.memberships.some(
      (m) =>
        m.userId === userId &&
        m.status === 'active' &&
        m.scope.kind === 'agency' &&
        m.scope.agencyId === input.agencyId,
    )
  const owing = accountabilityByPerson(tx.state, input.agencyId, tx.now).filter(
    (person) => person.pending > 0 && inAgency(person.userId),
  )
  const remindedRecently = (userId: Id) => {
    const at = lastReminded(tx.state, input.agencyId, userId)
    return at !== undefined && Date.parse(tx.now) - Date.parse(at) < REMIND_EVERY_HOURS * HOUR
  }

  let targets: typeof owing
  if (input.userId) {
    const name = tx.nameOf(input.userId)
    if (input.userId === actorId)
      throw new DomainError('invalid_state', 'You cannot remind yourself. Add your receipts from Expenses.')
    const person = owing.find((p) => p.userId === input.userId)
    if (!person) throw new DomainError('invalid_state', `${name} has no receipts to send.`)
    if (remindedRecently(person.userId)) {
      throw new DomainError(
        'invalid_state',
        `You reminded ${name} less than ${REMIND_EVERY_HOURS} hours ago.`,
      )
    }
    targets = [person]
  } else {
    const others = owing.filter((p) => p.userId !== actorId)
    if (others.length === 0) throw new DomainError('invalid_state', 'Nobody has receipts to send.')
    targets = others.filter((p) => !remindedRecently(p.userId))
    if (targets.length === 0) {
      throw new DomainError(
        'invalid_state',
        `Everyone with receipts to send was reminded less than ${REMIND_EVERY_HOURS} hours ago.`,
      )
    }
  }

  const portfolioId = tx.portfolioOfAgency(input.agencyId)
  const agency = agencyName(tx.state, input.agencyId)
  for (const person of targets) {
    tx.notify(
      [person.userId],
      'Receipts needed',
      `${usdText(person.pending)} from ${agency} still needs receipts${person.overdueCount > 0 ? ', some overdue' : ''}.`,
      `/member/${input.agencyId}/expenses`,
    )
    tx.activity(
      'receipts_reminded',
      `Reminded ${tx.nameOf(person.userId)} to add receipts for ${usdText(person.pending)}`,
      { kind: 'user', id: person.userId },
      { portfolioId, agencyId: input.agencyId, amount: person.pending, subjectUserId: person.userId },
    )
  }
  return { notified: targets.map((p) => p.userId) }
}

// ─── Monthly reminders ───────────────────────────────────────────────────────

export type CreateReminderInput = {
  agencyId: Id
  title: string
  payee: string
  amount?: Cents
  category: SpendingCategory
  dayOfMonth: number
  sourceAccountId?: Id
}

/**
 * A monthly reminder for something the Agency pays outside Viatik. Nothing is
 * scheduled and nothing reaches the ledger: when it is due is derived from its
 * day of the month and the last payment made for it.
 */
export function createReminder(tx: Tx, input: CreateReminderInput): Reminder {
  tx.authorize('manage_reminders', { agencyId: input.agencyId })
  const title = requireText(input.title, 'Title', 120)
  const payee = requireText(input.payee, 'Payee', 120)
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28)
    throw new DomainError('validation', 'Choose a day of the month from 1 to 28.')
  if (input.amount !== undefined) requirePositive(input.amount)
  if (input.sourceAccountId !== undefined) {
    const account = tx.find('accounts', input.sourceAccountId, 'Account')
    if (account.agencyId !== input.agencyId)
      throw new DomainError('forbidden', 'The account belongs to another Agency.')
  }
  const reminder: Reminder = {
    id: newId('rmd'),
    agencyId: input.agencyId,
    title,
    payee,
    amount: input.amount,
    category: input.category,
    cadence: 'monthly',
    dayOfMonth: input.dayOfMonth,
    sourceAccountId: input.sourceAccountId,
    status: 'active',
    createdBy: tx.userId,
    createdAt: tx.now,
    updatedAt: tx.now,
  }
  tx.state.reminders.push(reminder)
  tx.activity(
    'reminder_created',
    `Created the monthly reminder "${title}"`,
    { kind: 'reminder', id: reminder.id },
    { portfolioId: tx.portfolioOfAgency(input.agencyId), agencyId: input.agencyId, amount: input.amount },
  )
  return reminder
}

export type SetReminderStatusInput = { reminderId: Id; status: ReminderStatus }

const reminderVerb: Record<ReminderStatus, string> = {
  active: 'Resumed',
  paused: 'Paused',
  archived: 'Archived',
}

/** Pauses, resumes or archives a reminder. Archived is final. */
export function setReminderStatus(tx: Tx, input: SetReminderStatusInput): Reminder {
  const reminder = tx.find('reminders', input.reminderId, 'Reminder')
  tx.authorize('manage_reminders', { agencyId: reminder.agencyId })
  if (reminder.status === input.status) {
    throw new DomainError(
      'invalid_state',
      `This reminder is already ${reminderStatus[reminder.status].label.toLowerCase()}.`,
    )
  }
  if (!canTransitionReminder(reminder.status, input.status)) {
    throw new DomainError(
      'invalid_state',
      reminder.status === 'archived'
        ? 'This reminder is archived. Create a new one instead.'
        : 'This reminder cannot change to that status.',
    )
  }
  reminder.status = input.status
  reminder.updatedAt = tx.now
  tx.activity(
    'reminder_updated',
    `${reminderVerb[input.status]} the monthly reminder "${reminder.title}"`,
    { kind: 'reminder', id: reminder.id },
    { portfolioId: tx.portfolioOfAgency(reminder.agencyId), agencyId: reminder.agencyId },
  )
  return reminder
}

// ─── Shared checks ───────────────────────────────────────────────────────────

/** An account of this Agency that can still move money. */
function requireActiveAccount(tx: Tx, accountId: Id, agencyId: Id): Account {
  const account = tx.find('accounts', accountId, 'Account')
  if (account.agencyId !== agencyId)
    throw new DomainError('forbidden', 'The account belongs to another Agency.')
  if (account.status !== 'active')
    throw new DomainError('invalid_state', `${account.name} is frozen. Choose another account.`)
  return account
}

/** A reminder of this Agency that is still running (not paused or archived). */
function requireActiveReminder(tx: Tx, reminderId: Id, agencyId: Id): Reminder {
  const reminder = tx.find('reminders', reminderId, 'Reminder')
  if (reminder.agencyId !== agencyId)
    throw new DomainError('forbidden', 'This reminder belongs to another Agency.')
  if (reminder.status !== 'active')
    throw new DomainError('invalid_state', `The reminder "${reminder.title}" is ${reminder.status}.`)
  return reminder
}

/** Optional free text: trimmed, empty means absent. */
function optionalText(value: string | undefined, label: string, max: number): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  return requireText(trimmed, label, max)
}

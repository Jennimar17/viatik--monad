import type { Id, ViatikState } from '@/domain/types'
import type { SettlementPlan } from '@/ledger/types'

/**
 * What an operation changes, as `kind:id` keys, so a new command can tell
 * whether it touches something an operation still waiting for its signature
 * will change.
 *
 * Why: on Monad a command that moves money is only prepared, and changes
 * nothing until its transaction lands and is confirmed. Meanwhile the ledger
 * stops some second attempts by itself (a request it holds is approved or
 * closed once), but not all of them: payment for work exists on the ledger
 * only as its `pay`, whose id the contract claims per account, so a second
 * Admin can pay it again; a decline, a cancellation or a receipt is saved
 * offchain at once, under a transaction already on its way; the ledger knows
 * nothing of receipts, so two reimbursements carrying the same file are both
 * paid. The confirmation then finds a state its command no longer fits, and
 * the money has moved. The command layer refuses such a command while that
 * operation is open (`refuseConflicts` in commands.ts).
 *
 * Keys:
 * - `request:<id>`: a payment request, by the ledger calls that name it, the
 *   commands that decide it, and (for a new command) every request whose
 *   status it changed, a cascade included (a revoked allowance or membership
 *   cancels its open requests).
 * - `payment:<id>`: a payment, by the ledger calls that name it (work is paid
 *   under an id taken from its request), and the money for purchases
 *   (advance) a receipt or a return of the unused rest settles.
 * - `receipt:<sha256>`: a file (receipt, invoice) by its fingerprint, on a
 *   request, an expense or an outside payment. The engine refuses a receipt
 *   already used, but only against the state, and an operation waiting for its
 *   signature is not in it yet.
 * - `balance:<agencyId>:<userId>`: a person's Viatik balance in an Agency, by
 *   the commands that take money out of it where the engine allows less than
 *   the ledger. A return of "Other money" (no `paymentId`) gives back at most
 *   what the balance holds beyond what the person's open money for purchases
 *   still has pending (`otherMoneyReturnable`), while the ledger only checks
 *   the balance: a withdrawal or another such return of theirs landing first
 *   lowers that cap, the ledger still takes the return, and its confirmation
 *   no longer fits. So both hold the balance. A return of the rest of money
 *   for purchases lowers the balance and what that money has pending alike,
 *   which leaves the cap as it was, and a receipt only raises it: neither
 *   holds the balance.
 * - `op:<id>`: a money operation's id on the ledger.
 * - `bill:<id>`: a bill being paid or reconciled.
 */
export type HeldKeys = Set<string>

/** The requests, payments and operations the plan's ledger calls name. */
function addPlanKeys(keys: HeldKeys, plan: SettlementPlan | null | undefined) {
  for (const op of plan?.ops ?? []) {
    if ('requestId' in op) keys.add(`request:${op.requestId}`)
    if ('paymentId' in op) keys.add(`payment:${op.paymentId}`)
    if ('opId' in op) keys.add(`op:${op.opId}`)
  }
}

/** The fingerprint of every file among `drafts` (one evidence draft or a list of them). */
function addReceiptKeys(keys: HeldKeys, drafts: unknown) {
  for (const draft of Array.isArray(drafts) ? drafts : [drafts]) {
    if (!draft || typeof draft !== 'object') continue
    const { kind, sha256 } = draft as { kind?: unknown; sha256?: unknown }
    if (kind === 'file' && typeof sha256 === 'string' && sha256) keys.add(`receipt:${sha256.toLowerCase()}`)
  }
}

/**
 * What the input names that the plan may not: a request decided offchain
 * (work, or a decline), the advance a receipt or a return settles (a receipt
 * is offchain; a return's ledger call names no payment), the files it brings
 * (no ledger call names them), a bill paid or reconciled, the Viatik balance
 * of the person who signs (`signer`) a return of other money or a
 * withdrawal. An `attachReceipt` names its expense: the advance is read from
 * `state`.
 */
function addInputKeys(
  keys: HeldKeys,
  command: string,
  input: unknown,
  state: ViatikState,
  signer: Id | null | undefined,
) {
  const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const field = (name: string) => (typeof fields[name] === 'string' ? (fields[name] as string) : undefined)
  const add = (kind: string, id: string | undefined) => {
    if (id) keys.add(`${kind}:${id}`)
  }
  const addBalance = () => {
    const agencyId = field('agencyId')
    if (agencyId && signer) keys.add(`balance:${agencyId}:${signer}`)
  }
  switch (command) {
    case 'approveRequest':
    case 'declineRequest':
    case 'cancelRequest':
      add('request', field('requestId'))
      break
    case 'requestPayment':
      addReceiptKeys(keys, fields.attachments)
      break
    case 'addExpense':
      add('payment', field('paymentId'))
      addReceiptKeys(keys, fields.receipt)
      break
    case 'returnUnusedFunds':
      add('payment', field('paymentId'))
      // "Other money": capped below what the ledger checks (see `balance:` above).
      if (!fields.paymentId) addBalance()
      break
    case 'withdrawBalance':
      addBalance()
      break
    case 'attachReceipt':
      add('payment', state.expenses.find((expense) => expense.id === field('expenseId'))?.paymentId)
      addReceiptKeys(keys, fields.receipt)
      break
    case 'payOutside':
    case 'addPaymentProof':
      addReceiptKeys(keys, fields.proof)
      break
    case 'addBill':
      addReceiptKeys(keys, fields.document)
      break
    case 'payBill':
    case 'reconcile':
      add('bill', field('billId'))
      break
  }
}

/**
 * What a new command holds: its plan (null when it moves nothing), its input
 * read on `before`, every request whose status it changed from `before` to
 * `after`, and the advance each give-back it added settles.
 */
export function heldByCommand(
  command: string,
  input: unknown,
  plan: SettlementPlan | null,
  before: ViatikState,
  after: ViatikState,
): HeldKeys {
  const keys: HeldKeys = new Set()
  addPlanKeys(keys, plan)
  addInputKeys(keys, command, input, before, plan?.signerUserId)
  const was = new Map(before.requests.map((request) => [request.id, request.status]))
  for (const request of after.requests) {
    const status = was.get(request.id)
    if (status !== undefined && status !== request.status) keys.add(`request:${request.id}`)
  }
  // The advance each new give-back settles, read from what the engine did rather than from the input.
  const moved = new Set(before.movements.map((movement) => movement.id))
  for (const movement of after.movements)
    if (!moved.has(movement.id) && movement.settlesPaymentId) keys.add(`payment:${movement.settlesPaymentId}`)
  return keys
}

/**
 * What an open operation holds: its prepared plan and its stored input, read
 * on the state as it is now (its own changes are not applied until it is
 * confirmed, so a cascade of its own is not seen here).
 */
export function heldByOperation(
  command: string,
  input: unknown,
  plan: SettlementPlan,
  state: ViatikState,
): HeldKeys {
  const keys: HeldKeys = new Set()
  addPlanKeys(keys, plan)
  addInputKeys(keys, command, input, state, plan.signerUserId)
  return keys
}

/** Whether two operations hold something in common. */
export function sharesAny(a: HeldKeys, b: HeldKeys): boolean {
  for (const key of a) if (b.has(key)) return true
  return false
}

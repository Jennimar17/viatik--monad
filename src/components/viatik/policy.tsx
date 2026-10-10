import { Check, CircleAlert, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react'

import { cn } from '@/lib/utils'

/** One rule the policy checked, in plain English. */
export type PolicyCheck = { rule: string; passed: boolean; blocking: boolean; message: string }

/** The outcome of evaluating a request against a budget's rules. */
export type PolicyDecision = {
  outcome: 'approved' | 'needs_approval' | 'rejected'
  /** `rule` names the check that decided it (e.g. the exception threshold routes it to the Investor). */
  reason?: { message: string; rule?: string }
  checks: PolicyCheck[]
}

/** Budget rules in plain English, as reviewed before creating a budget. */
export function PolicySummary({
  lines,
  className,
  title = 'Budget rules',
}: {
  lines: string[]
  className?: string
  title?: string
}) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ShieldCheck className="size-4 text-sage" aria-hidden="true" />
        {title}
      </p>
      <ul className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line} className="flex gap-2.5 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-3.5 shrink-0 text-sage" aria-hidden="true" />
            <span className="text-pretty">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const outcomeCopy = {
  approved: {
    title: 'Within your limit — approves automatically',
    icon: ShieldCheck,
    tone: 'border-success/30 bg-success-soft text-success',
  },
  needs_approval: {
    title: 'Needs approval from your Agency Admin',
    icon: TriangleAlert,
    tone: 'border-warning/30 bg-warning-soft text-warning',
  },
  rejected: {
    title: 'This request is outside the budget rules',
    icon: ShieldX,
    tone: 'border-danger/35 bg-danger-soft text-danger',
  },
} as const

/** The same verdict read by the person who decides on it, not by the requester. */
const reviewerTitle: Record<PolicyDecision['outcome'], string> = {
  approved: 'Within the budget rules — approved automatically',
  needs_approval: 'Above the automatic limit — needs an Agency Admin',
  rejected: 'Outside the budget rules — rejected before anyone decided',
}

/**
 * The verdict's headline: who decides a request that needs approval follows the rule that routed it,
 * and a request refused by the Investor's exception threshold (payment for work) says so.
 */
function verdictTitle(decision: PolicyDecision, perspective: 'requester' | 'reviewer'): string {
  const reviewer = perspective === 'reviewer'
  if (decision.outcome === 'rejected' && decision.reason?.rule === 'exception_threshold') {
    return reviewer
      ? "Above the Investor's exception threshold — rejected before anyone decided"
      : "This request is above the Investor's exception threshold"
  }
  if (decision.outcome === 'needs_approval') {
    if (decision.reason?.rule === 'exception_threshold') {
      return reviewer
        ? 'Above the exception threshold — the Investor decides'
        : 'Needs approval from the Investor'
    }
    if (decision.reason?.rule === 'work_review' && reviewer) {
      return 'Payment for work — always reviewed by an Agency Admin'
    }
  }
  return reviewer ? reviewerTitle[decision.outcome] : outcomeCopy[decision.outcome].title
}

/**
 * Live policy evaluation. Shows the outcome in words, then each rule that
 * was checked, so the requester knows why before anything is submitted.
 */
export function PolicyVerdict({
  decision,
  showChecks = true,
  perspective = 'requester',
  className,
}: {
  decision: PolicyDecision
  showChecks?: boolean
  /** Who is reading: the requester (default) or the person reviewing the request. */
  perspective?: 'requester' | 'reviewer'
  className?: string
}) {
  const copy = outcomeCopy[decision.outcome]
  const title = verdictTitle(decision, perspective)
  const Icon = copy.icon
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-xl border p-4', copy.tone, className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {decision.reason && decision.outcome !== 'approved' ? (
            <p className="text-sm text-pretty text-muted-foreground">{decision.reason.message}</p>
          ) : null}
        </div>
      </div>
      {showChecks && decision.checks.length > 0 ? (
        <ul className="flex flex-col gap-1.5 border-t border-current/15 pt-3">
          {decision.checks.map((check) => (
            <CheckRow key={check.rule} check={check} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function CheckRow({ check }: { check: PolicyCheck }) {
  const Icon = check.passed ? Check : check.blocking ? CircleAlert : TriangleAlert
  return (
    <li className="flex gap-2 text-xs text-muted-foreground">
      <Icon
        className={cn(
          'mt-px size-3.5 shrink-0',
          check.passed ? 'text-success' : check.blocking ? 'text-danger' : 'text-warning',
        )}
        role="img"
        aria-label={check.passed ? 'Passed' : 'Not met'}
      />
      <span className="text-pretty">{check.message}</span>
    </li>
  )
}

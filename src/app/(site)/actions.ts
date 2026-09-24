'use server'

import { z } from 'zod'

const waitlistSchema = z.object({
  email: z.email(),
  organization: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(60),
})

export type WaitlistResult = { ok: true } | { ok: false; error: string }

/**
 * Waitlist sign-up. Validates on the server; persistence arrives with the
 * backend phase (Supabase). Until then accepted entries are not stored.
 */
export async function joinWaitlist(input: unknown): Promise<WaitlistResult> {
  const parsed = waitlistSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Check the form fields and try again.' }
  return { ok: true }
}

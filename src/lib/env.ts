import { z } from 'zod'

const booleanFlag = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true')

/**
 * Public environment. Next.js inlines NEXT_PUBLIC_* values at build time, so
 * every key is read explicitly below (no dynamic access to process.env).
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),
  NEXT_PUBLIC_DATA_SOURCE: z.enum(['mock', 'api']).default('mock'),
  NEXT_PUBLIC_DEMO_MODE: booleanFlag,
  NEXT_PUBLIC_MONAD_NETWORK: z.enum(['testnet', 'mainnet']).default('testnet'),
  // Accounts: Privy login, embedded wallet and smart account.
  NEXT_PUBLIC_PRIVY_APP_ID: z.string().min(1).optional(),
})

export type PublicEnv = z.infer<typeof publicEnvSchema>

export const publicEnv: PublicEnv = publicEnvSchema.parse({
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_DATA_SOURCE: process.env.NEXT_PUBLIC_DATA_SOURCE,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  NEXT_PUBLIC_MONAD_NETWORK: process.env.NEXT_PUBLIC_MONAD_NETWORK,
  NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
})

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Expected a contract address.')
  .transform((value) => value as `0x${string}`)

/**
 * `userId=email` pairs, comma separated, that bind sign-in emails to the
 * seeded demo people (e.g. `u_elena=test-1234@privy.io`). Parsed to
 * `{ [email]: userId }` with lowercased emails.
 */
const demoAccounts = z
  .string()
  .optional()
  .transform((value, ctx) => {
    const accounts: Record<string, string> = {}
    for (const pair of (value ?? '').split(',')) {
      if (!pair.trim()) continue
      const [userId, email] = pair.split('=').map((part) => part.trim())
      // A person listed without an email yet (`u_maya=`) is simply not bound.
      if (userId && email === '') continue
      if (!userId || !email || !email.includes('@')) {
        ctx.addIssue({ code: 'custom', message: 'each entry must look like userId=email' })
        return z.NEVER
      }
      accounts[email.toLowerCase()] = userId
    }
    return accounts
  })

/** Server-only secrets. Read lazily so client bundles never reference them. */
const serverEnvSchema = z.object({
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  /** Dashboard verification key: verifies access tokens without calling Privy. */
  PRIVY_JWT_VERIFICATION_KEY: z.string().min(1).optional(),
  DEMO_ACCOUNTS: demoAccounts,
  MONAD_RPC_URL: z.url().optional(),
  /** Deployed ViatikLedger contract. While unset, operations settle on the mock ledger. */
  VIATIK_LEDGER_ADDRESS: address.optional(),
  DATABASE_URL: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

/**
 * Server environment. A key left blank in a .env file (`VIATIK_LEDGER_ADDRESS=`)
 * counts as unset. Invalid values fail with the key names only, never the values.
 */
export function readServerEnv(): ServerEnv {
  const values = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''))
  const parsed = serverEnvSchema.safeParse(values)
  if (parsed.success) return parsed.data
  const keys = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
  throw new Error(`Invalid server environment. ${keys.join('; ')}`)
}

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
  /** Enables POST /api/v1/admin/seed (restores the demo story); without it the route does not exist. */
  ADMIN_SEED_TOKEN: z.string().min(24).optional(),
  /** Every server read and write on Monad. Can be an Alchemy Monad Testnet URL (it may carry the provider key). */
  MONAD_RPC_URL: z.url().optional(),
  /**
   * Only for finding a signed transaction whose hash is unknown (`findConfirmation`):
   * `eth_blockNumber` and `eth_getLogs` over the ledger, 100 blocks per call. Defaults to
   * MONAD_RPC_URL. When MONAD_RPC_URL is Alchemy on the Free plan (10 blocks per `eth_getLogs`
   * on Monad Testnet), set this to the public RPC, https://testnet-rpc.monad.xyz.
   */
  MONAD_LOGS_RPC_URL: z.url().optional(),
  /** Deployed ViatikLedger contract. While unset, operations settle on the mock ledger. */
  VIATIK_LEDGER_ADDRESS: address.optional(),
  /** Settlement token the ledger was deployed with (TestUSD on testnet). Must equal the ledger's TOKEN(). */
  TEST_USD_ADDRESS: address.optional(),
  /** Signs role permits and runs the genesis. Server only; on testnet, the deployer's key. */
  LEDGER_REGISTRAR_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 0x-prefixed private key.')
    .transform((value) => value as `0x${string}`)
    .optional(),
  DATABASE_URL: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /**
   * Alchemy Notify: the signing key of the Address Activity webhook (top right of its page).
   * Enables POST /api/v1/webhooks/alchemy ("Funds arrived" notifications); without it the
   * route does not exist.
   */
  ALCHEMY_WEBHOOK_SIGNING_KEY: z.string().min(1).optional(),
  /** That webhook's id (`wh_…`): deliveries from any other webhook are ignored, and new Viatik accounts are added to it. */
  ALCHEMY_WEBHOOK_ID: z.string().min(1).optional(),
  /** Alchemy dashboard Auth Token (Webhooks ▸ Auth Token, not the app key): adds each new Viatik account to the webhook. */
  ALCHEMY_NOTIFY_AUTH_TOKEN: z.string().min(1).optional(),
  /** Kimi API key (platform.kimi.ai) for reading receipts and invoices. Without it the reader is off. */
  KIMI_API_KEY: z.string().min(1).optional(),
  /** Kimi model; the reader picks its default when unset. */
  KIMI_MODEL: z.string().min(1).optional(),
  /** Kimi API base URL; the reader picks its default when unset. */
  KIMI_BASE_URL: z.url().optional(),
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

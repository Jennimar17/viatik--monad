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

/** Server-only secrets. Read lazily so client bundles never reference them. */
const serverEnvSchema = z.object({
  PRIVY_APP_SECRET: z.string().min(1).optional(),
  PIMLICO_API_KEY: z.string().min(1).optional(),
  MONAD_RPC_URL: z.url().optional(),
  /** Deployed ViatikLedger contract. While unset, operations settle on the mock ledger. */
  VIATIK_LEDGER_ADDRESS: address.optional(),
  DATABASE_URL: z.string().min(1).optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
})

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function readServerEnv(): ServerEnv {
  return serverEnvSchema.parse(process.env)
}

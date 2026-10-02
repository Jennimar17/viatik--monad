# Viatik

Programmable funding for modern teams. Investors fund Agencies through Funding Agreements; Agencies turn released capital into accounts, budgets and payments; Members spend within clear rules. Settlement runs in USDC on Monad, while people see US dollars.

Built for the Monad Metropolis hackathon (Consumer Products & Payments track).

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS 4 and shadcn/ui (`base-nova`, on Base UI)
- viem with the Monad chains (mainnet 143, testnet 10143)
- TanStack Query and Table, Recharts, zod

One app serves both the marketing site and the product.

## Requirements

- Node.js 22
- pnpm 10 (`corepack enable`; the version is pinned in `package.json`)

## Getting started

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

The app runs on http://localhost:3000.

| Command          | What it does                       |
| ---------------- | ---------------------------------- |
| `pnpm dev`       | Start the development server       |
| `pnpm build`     | Production build                   |
| `pnpm start`     | Serve the production build         |
| `pnpm lint`      | ESLint                             |
| `pnpm typecheck` | Generate route types and run `tsc` |

## Environment

All variables are optional in development. See `.env.example`.

| Variable                     | Purpose                                         |
| ---------------------------- | ----------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`       | Public origin, used for metadata                |
| `NEXT_PUBLIC_DATA_SOURCE`    | Real accounts on `mock` (default) or `api` data |
| `NEXT_PUBLIC_DEMO_MODE`      | Enables the demo personas and reset (`true`)    |
| `NEXT_PUBLIC_MONAD_NETWORK`  | `testnet` (10143, default) or `mainnet` (143)   |
| `NEXT_PUBLIC_PRIVY_APP_ID`   | Privy app for sign-in and embedded accounts     |
| `PRIVY_APP_SECRET`           | Server-side Privy token verification            |
| `PRIVY_JWT_VERIFICATION_KEY` | Optional, verifies tokens without calling Privy |
| `DEMO_ACCOUNTS`              | Sign-in emails bound to the demo people         |
| `MONAD_RPC_URL`              | RPC endpoint for server-side reads and writes   |
| `VIATIK_LEDGER_ADDRESS`      | Deployed ViatikLedger contract                  |
| `DATABASE_URL`, `SUPABASE_*` | Offchain data                                   |
| `ADMIN_SEED_TOKEN`           | Optional, enables restoring the seeded data     |

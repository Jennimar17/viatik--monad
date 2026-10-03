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
- Foundry 1.8+ for the contracts

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

## Contracts

`contracts/` is a Foundry project. Its dependencies (OpenZeppelin, forge-std) install with `pnpm install`.

```bash
cd contracts
forge test
```

Tests run locally. `FOUNDRY_PROFILE=monad` applies Monad's execution rules; use it for deploy scripts and for a last test run before deploying.

`TestUSD` is the testnet stand-in for USDC: 6 decimals, an open faucet capped at 1,000,000 per mint, and no value. It refuses to deploy on Monad mainnet.

### Deployment (Monad Testnet)

| Contract       | Address                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ViatikLedger` | [`0x58e316B722006F5961ED3A6cDbF54A06b7C6d4C6`](https://testnet.monadvision.com/address/0x58e316B722006F5961ED3A6cDbF54A06b7C6d4C6) |
| `TestUSD`      | [`0xDcA5eE8982675C7bf7E8a2da84Cc2F1a4EFaD65C`](https://testnet.monadvision.com/address/0xDcA5eE8982675C7bf7E8a2da84Cc2F1a4EFaD65C) |

Both are verified on MonadVision (Sourcify). The deploy and the smoke run that exercised it are in `contracts/broadcast/`.

```bash
cd contracts
# Deploy: the deployer owns the ledger and, on testnet, signs role permits and receives vendor payouts
FOUNDRY_PROFILE=monad forge script script/Deploy.s.sol --rpc-url "$MONAD_RPC_URL" --broadcast
# Verify (ViatikLedger also takes --constructor-args "$(cast abi-encode 'constructor(address,address,address)' <token> <registrar> <payout sink>)")
forge verify-contract <address> src/TestUSD.sol:TestUSD --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
# Smoke run: agreement, funding, tranche, budget, and payments of 120 (paid), 900 (rejected) and 300 (approved)
LEDGER=<address> SMOKE_NS=<new namespace> SMOKE_ADMIN_KEY=<key> SMOKE_MEMBER_KEY=<key> \
  FOUNDRY_PROFILE=monad forge script script/Smoke.s.sol --rpc-url "$MONAD_RPC_URL" --broadcast --slow
```

The app reads the contracts through the ABIs in `src/web3/abi/`. After changing a contract, regenerate them:

```bash
cd contracts
(printf 'export const viatikLedgerAbi = '; forge inspect ViatikLedger abi --json | sed '$s/$/ as const/') > ../src/web3/abi/viatik-ledger.ts
(printf 'export const testUsdAbi = '; forge inspect TestUSD abi --json | sed '$s/$/ as const/') > ../src/web3/abi/test-usd.ts
pnpm exec prettier --write ../src/web3/abi
```

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
| `TEST_USD_ADDRESS`           | Settlement token the ledger was deployed with   |
| `LEDGER_DEPLOY_BLOCK`        | Block the ledger was deployed in                |
| `DEPLOYER_PRIVATE_KEY`       | Deploy scripts only; a dedicated testnet wallet |
| `DATABASE_URL`, `SUPABASE_*` | Offchain data                                   |
| `ADMIN_SEED_TOKEN`           | Optional, enables restoring the seeded data     |

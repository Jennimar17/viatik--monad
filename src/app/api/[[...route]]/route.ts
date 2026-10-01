import { handle } from 'hono/vercel'

import { app } from '@/server/app'

// Node runtime: the Postgres driver needs TCP sockets, and the ledger phase needs viem with Node crypto.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handle(app)
export const POST = handle(app)

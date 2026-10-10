import { handle } from 'hono/vercel'

import { app } from '@/server/app'

/**
 * `POST /api/v1/evidence/read` (Kimi reads a receipt or invoice) is served by
 * the same Hono app as every other route (src/app/api/[[...route]]/route.ts);
 * this more specific segment only gives it a longer maxDuration. kimi-k3 always
 * thinks before answering, and a PDF also takes an upload and a text
 * extraction at Kimi, so a read can pass the 60 s the other routes get. The
 * reader keeps its own deadline under this one (READ_DEADLINE_MS), so the PDF
 * it uploads to Kimi is always deleted before the function is stopped.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export const POST = handle(app)

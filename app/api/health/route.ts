import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'

// Diagnostic-only endpoint. Returns a concise health snapshot of the
// process's view of the database connection. Used to surface the actual
// Postgres error when the higher-level page render swallows it. No
// secrets are returned — only host fragments and error class/code.
export async function GET() {
  const dbUrl = process.env.DATABASE_URL ?? ''
  const dbUrlDirect = process.env.DATABASE_URL_DIRECT ?? ''
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''

  const hostFragment = (() => {
    try {
      return new URL(dbUrl).host
    } catch {
      return 'invalid-url'
    }
  })()

  const directHostFragment = (() => {
    try {
      return new URL(dbUrlDirect).host
    } catch {
      return 'invalid-url'
    }
  })()

  let pingError: { message: string; code?: string; name?: string } | null = null
  try {
    await db.execute(sql`select 1 as ok`)
  } catch (err) {
    const e = err as { message?: string; code?: string; name?: string; cause?: unknown }
    const cause = e?.cause as { message?: string; code?: string } | undefined
    pingError = {
      message: cause?.message ?? e?.message ?? 'unknown',
      code: cause?.code ?? e?.code,
      name: e?.name,
    }
  }

  return NextResponse.json({
    nodeEnv: process.env.NODE_ENV,
    databaseUrlHost: hostFragment,
    databaseUrlDirectHost: directHostFragment,
    supabaseUrl: supaUrl,
    voyageKeyPresent: Boolean(process.env.VOYAGE_API_KEY),
    anthropicKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    pingOk: pingError === null,
    pingError,
  })
}

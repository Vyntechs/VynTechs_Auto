import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db/client'

// Public liveness endpoint. Returns ONLY whether the database ping
// succeeded. Earlier versions echoed the database host, Supabase URL,
// and which third-party API keys were configured — that turned a routine
// health check into unauthenticated reconnaissance, so it was stripped.
// For richer diagnostics, run them locally with the env loaded.
export async function GET() {
  let pingOk = true
  try {
    await db.execute(sql`select 1 as ok`)
  } catch {
    pingOk = false
  }
  return NextResponse.json(
    { ok: pingOk },
    { status: pingOk ? 200 : 503 },
  )
}

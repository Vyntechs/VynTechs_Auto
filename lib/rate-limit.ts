import { and, eq, lt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { AppDb } from './db/queries'
import { rateLimitBuckets } from './db/schema'

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: Date
}

// Fixed-window per-minute rate limiter backed by Postgres. Two-step to keep
// the SQL boring:
//   1. DELETE any stale bucket for this key (window_start older than the
//      current minute) so the upsert below starts fresh on rollover.
//   2. INSERT … ON CONFLICT DO UPDATE that increments count by 1.
//
// Splitting it lets the SET clause stay a plain `count = count + 1` instead
// of a CASE expression. The race window between the two queries is tiny
// (~1ms) and only matters at the minute boundary; the worst outcome is a
// single extra request slipping through, which is acceptable for a rate
// limiter.
export async function checkRateLimit(
  db: AppDb,
  key: string,
  maxPerMinute: number,
): Promise<RateLimitResult> {
  const now = new Date()
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000)

  await db
    .delete(rateLimitBuckets)
    .where(
      and(
        eq(rateLimitBuckets.key, key),
        lt(rateLimitBuckets.windowStart, windowStart),
      ),
    )

  const rows = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning()

  const row = rows[0]
  const resetAt = new Date(row.windowStart.getTime() + 60_000)
  return {
    allowed: row.count <= maxPerMinute,
    remaining: Math.max(0, maxPerMinute - row.count),
    resetAt,
  }
}

// Convenience for API route handlers. Returns null when the request is
// allowed; a 429 NextResponse with Retry-After when it is not. Any error
// during the rate-limit check is logged and treated as "allow" — we never
// want a counter-table hiccup to take down an intake.
export async function rateLimitReject(
  db: AppDb,
  key: string,
  maxPerMinute: number,
): Promise<NextResponse | null> {
  let rl: RateLimitResult
  try {
    rl = await checkRateLimit(db, key, maxPerMinute)
  } catch (err) {
    console.error('[rate-limit] check failed, allowing request:', err)
    return null
  }
  if (rl.allowed) return null
  const retryAfter = Math.max(1, Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000))
  return NextResponse.json(
    { error: 'rate_limited', resetAt: rl.resetAt.toISOString() },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfter) },
    },
  )
}

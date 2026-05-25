import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import type { AppDb } from './db/queries'
import { rateLimitBuckets } from './db/schema'

export type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: Date
}

// Fixed-window per-minute rate limiter backed by Postgres. The bucket key
// is shared by all callers in the same window; the atomic upsert either
// increments the count for the current window or rolls the row over to a
// fresh window when the stored window_start is older than `now`'s window.
//
// One DB round-trip per check. The bucket row is keyed by `key` (caller
// chooses the shape, e.g. 'intake:<userId>'), so different scopes for the
// same user don't compete.
export async function checkRateLimit(
  db: AppDb,
  key: string,
  maxPerMinute: number,
): Promise<RateLimitResult> {
  const now = new Date()
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000)

  const rows = await db
    .insert(rateLimitBuckets)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitBuckets.key,
      set: {
        windowStart: sql`CASE WHEN ${rateLimitBuckets.windowStart} < ${windowStart} THEN ${windowStart} ELSE ${rateLimitBuckets.windowStart} END`,
        count: sql`CASE WHEN ${rateLimitBuckets.windowStart} < ${windowStart} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
      },
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
// allowed; a 429 NextResponse with Retry-After when it is not.
export async function rateLimitReject(
  db: AppDb,
  key: string,
  maxPerMinute: number,
): Promise<NextResponse | null> {
  const rl = await checkRateLimit(db, key, maxPerMinute)
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

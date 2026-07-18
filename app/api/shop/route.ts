import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { shops } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

// Mirrors the DB range checks on the shops table (schema.ts): tax rate is
// stored in basis points (0–10,000 = 0–100%); labor rate is stored in cents
// and is bounded by the safe-integer range.
const MAX_TAX_RATE_BPS = 10_000

export async function POST(req: Request) {
  let body: { name?: unknown; taxRateBps?: unknown; laborRateCents?: unknown }
  try {
    body = (await req.json()) as {
      name?: unknown
      taxRateBps?: unknown
      laborRateCents?: unknown
    }
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  // Belt-and-suspenders: page-level gate also blocks Tech, but the API
  // re-checks because a Tech can hit this endpoint directly with curl.
  const isAdmin =
    ctx.profile.role === 'owner' || isFounder(ctx.user.email)
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  // Partial update: only the fields present in the body are validated and
  // written, so the "Shop name" and "Rates & tax" forms can each save
  // independently without clobbering the other's column.
  const updates: {
    name?: string
    taxRateBps?: number
    laborRateCents?: number
  } = {}

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length === 0 || name.length > 80) {
      return NextResponse.json({ error: 'invalid_name' }, { status: 422 })
    }
    updates.name = name
  }

  if (body.taxRateBps !== undefined && body.taxRateBps !== null) {
    const bps = body.taxRateBps
    if (
      typeof bps !== 'number' ||
      !Number.isInteger(bps) ||
      bps < 0 ||
      bps > MAX_TAX_RATE_BPS
    ) {
      return NextResponse.json({ error: 'invalid_tax_rate' }, { status: 422 })
    }
    updates.taxRateBps = bps
  }

  if (body.laborRateCents !== undefined && body.laborRateCents !== null) {
    const cents = body.laborRateCents
    if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents < 0) {
      return NextResponse.json({ error: 'invalid_labor_rate' }, { status: 422 })
    }
    updates.laborRateCents = cents
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no_changes' }, { status: 422 })
  }

  await db.update(shops).set(updates).where(eq(shops.id, ctx.profile.shopId))
  return NextResponse.json({ ok: true })
}

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { shops } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

export async function POST(req: Request) {
  let body: { name?: unknown }
  try {
    body = (await req.json()) as { name?: unknown }
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

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (name.length === 0 || name.length > 80) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 422 })
  }

  await db.update(shops).set({ name }).where(eq(shops.id, ctx.profile.shopId))
  return NextResponse.json({ ok: true })
}

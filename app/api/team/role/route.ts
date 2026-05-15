import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

const ALLOWED_ROLES = new Set(['tech', 'owner'])

export async function POST(req: Request) {
  let body: { userId?: unknown; role?: unknown }
  try {
    body = (await req.json()) as { userId?: unknown; role?: unknown }
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

  const isAdmin =
    ctx.profile.role === 'owner' || isFounder(ctx.user.email)
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const role = typeof body.role === 'string' ? body.role : ''
  if (!targetUserId) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 422 })
  }
  // Explicit rejection of 'curator' — the spec reserves this role for
  // out-of-band grants done in SQL. The UI never surfaces it as a choice,
  // but a hand-crafted curl call could try to set it; refuse.
  if (!ALLOWED_ROLES.has(role)) {
    return NextResponse.json({ error: 'invalid_role' }, { status: 422 })
  }

  const [target] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.userId, targetUserId))
    .limit(1)
  if (!target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (target.shopId !== ctx.profile.shopId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (target.role === role) {
    return NextResponse.json({ ok: true, noop: true })
  }

  // Last-Admin protection: if we're demoting an Admin to Tech, count how
  // many active (non-deactivated) Admins remain in the shop. Refuse if
  // this demotion would empty the Admin set. Same shop only.
  if (target.role === 'owner' && role === 'tech') {
    const activeOwners = await db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(
        and(
          eq(profiles.shopId, ctx.profile.shopId),
          eq(profiles.role, 'owner'),
          isNull(profiles.deactivatedAt),
        ),
      )
    if (activeOwners.length <= 1) {
      return NextResponse.json({ error: 'last_admin' }, { status: 400 })
    }
  }

  await db
    .update(profiles)
    .set({ role })
    .where(eq(profiles.userId, targetUserId))

  return NextResponse.json({ ok: true })
}

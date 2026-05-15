import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

export async function POST(req: Request) {
  let body: { userId?: unknown }
  try {
    body = (await req.json()) as { userId?: unknown }
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
  if (!targetUserId) {
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 422 })
  }

  // Cannot deactivate yourself — even if there are other Admins, this
  // would immediately log the caller out (middleware redirects to
  // /deactivated on next request). Refuse via the API; the UI also greys
  // out the action on the caller's own row.
  if (targetUserId === ctx.user.id) {
    return NextResponse.json({ error: 'cannot_self' }, { status: 400 })
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

  // Idempotent: a target that's already deactivated returns ok with a
  // noop flag rather than a 409.
  if (target.deactivatedAt) {
    return NextResponse.json({ ok: true, noop: true })
  }

  // Last-Admin protection: count active Admins in the shop. If the target
  // is the last active Admin, refuse. Mirrors the rule in /api/team/role.
  if (target.role === 'owner') {
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
    .set({ deactivatedAt: new Date() })
    .where(eq(profiles.userId, targetUserId))

  return NextResponse.json({ ok: true })
}

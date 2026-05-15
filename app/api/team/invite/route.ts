import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Loose RFC-ish email shape check. Server-side validation only — the real
// "is this address reachable" answer is whether the Supabase invite email
// gets delivered. We just want to reject obvious typos before spending an
// admin-SDK round-trip.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export async function POST(req: NextRequest) {
  let body: { email?: unknown }
  try {
    body = (await req.json()) as { email?: unknown }
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

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 422 })
  }

  // Send the invite first. Supabase creates the auth.users row and returns
  // its id, which we then point a new profile row at. If the auth user
  // already exists, Supabase returns an error we surface as `already_user`.
  const origin = new URL(req.url).origin
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/reset-password`,
  })
  if (error || !data?.user) {
    const code = error?.message?.toLowerCase().includes('already')
      ? 'already_user'
      : 'invite_failed'
    return NextResponse.json(
      { error: code, detail: error?.message ?? null },
      { status: code === 'already_user' ? 409 : 502 },
    )
  }

  // Defensive: if a profile already exists for this userId (e.g. the
  // invitee was previously in another shop, or a stale invite collided),
  // do NOT overwrite their shopId — surface the conflict instead.
  const [existing] = await db
    .select({ id: profiles.id, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, data.user.id))
    .limit(1)
  if (existing) {
    if (existing.shopId === ctx.profile.shopId) {
      return NextResponse.json({ error: 'already_in_shop' }, { status: 409 })
    }
    return NextResponse.json({ error: 'already_in_other_shop' }, { status: 409 })
  }

  await db.insert(profiles).values({
    userId: data.user.id,
    shopId: ctx.profile.shopId,
    role: 'tech',
    fullName: null,
    isComp: false,
    deactivatedAt: null,
  })

  return NextResponse.json({ ok: true, invitedEmail: email })
}

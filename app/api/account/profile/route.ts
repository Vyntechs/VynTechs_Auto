import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

export async function POST(req: Request) {
  let body: { fullName?: unknown }
  try {
    body = (await req.json()) as { fullName?: unknown }
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

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (fullName.length === 0 || fullName.length > 100) {
    return NextResponse.json({ error: 'invalid_name' }, { status: 422 })
  }

  await db.update(profiles).set({ fullName }).where(eq(profiles.userId, ctx.user.id))
  return NextResponse.json({ ok: true })
}

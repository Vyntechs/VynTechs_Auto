import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { searchIntake } from '@/lib/intake/search'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'

type Body = { q?: string }

export async function POST(req: Request) {
  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const q = typeof body.q === 'string' ? body.q : ''

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  const start = performance.now()

  if (q.trim() === '') {
    const recents = await getRecentIntakeCustomers({
      db,
      shopId: ctx.profile.shopId,
      withinHours: 12,
      limit: 8,
    })
    return NextResponse.json(
      { customers: recents, vehicles: [], latencyMs: Math.round(performance.now() - start) },
      { status: 200 },
    )
  }

  const result = await searchIntake({ db, shopId: ctx.profile.shopId, q })
  return NextResponse.json(
    { ...result, latencyMs: Math.round(performance.now() - start) },
    { status: 200 },
  )
}

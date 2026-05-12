import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { requireUserAndProfile } from '@/lib/auth'
import { createCheckoutSessionForUser } from '@/lib/stripe'
import { getServerSupabase } from '@/lib/supabase-server'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const origin = req.headers.get('origin') ?? new URL(req.url).origin
  const priceId = process.env.STRIPE_PRICE_ID_TECH_MONTHLY ?? ''

  const result = await createCheckoutSessionForUser({
    db,
    userId: ctx.user.id,
    email: ctx.user.email,
    origin,
    priceId,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ url: result.url })
}

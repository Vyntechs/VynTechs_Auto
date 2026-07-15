import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { decodeVin } from '@/lib/intake/decode-vin'

type Body = { vin?: string }

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const vin = typeof body.vin === 'string' ? body.vin.trim() : ''
  if (vin === '') {
    return NextResponse.json({ error: 'vin_required' }, { status: 400 })
  }

  const result = await decodeVin(vin)
  return NextResponse.json(result, { status: 200 })
}

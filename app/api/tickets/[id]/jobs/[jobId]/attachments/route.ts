import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { OPERATIONAL_MEDIA_UNAVAILABLE } from '@/lib/release-policy'
import { getServerSupabase } from '@/lib/supabase-server'

export const maxDuration = 30

export async function POST(
  _req: Request,
  { params: _params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(
    OPERATIONAL_MEDIA_UNAVAILABLE.body,
    { status: OPERATIONAL_MEDIA_UNAVAILABLE.status },
  )
}

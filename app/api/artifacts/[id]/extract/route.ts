import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { OPERATIONAL_MEDIA_UNAVAILABLE } from '@/lib/release-policy'

// Vision extraction can take several seconds on large images.
export const maxDuration = 60

/**
 * POST /api/artifacts/:id/extract
 *
 * Manually trigger AI extraction for an artifact. Useful when inline auto-extract
 * failed or was skipped. Auth-gated — requires a valid user session.
 */
export async function POST(
  _req: Request,
  { params: _params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  return NextResponse.json(
    OPERATIONAL_MEDIA_UNAVAILABLE.body,
    { status: OPERATIONAL_MEDIA_UNAVAILABLE.status },
  )
}

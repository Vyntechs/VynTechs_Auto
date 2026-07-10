import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { deactivateTeamMember, teamMutationStatus } from '@/lib/shop-os/team'

export async function POST(req: Request) {
  let body: { userId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  const result = await deactivateTeamMember(db, {
    actor: {
      userId: ctx.user.id,
      shopId: ctx.profile.shopId,
      role: ctx.profile.role,
      membershipStatus: ctx.profile.membershipStatus,
      isFounder: isFounder(ctx.user.email),
    },
    targetUserId: body.userId,
  })
  return NextResponse.json(result, { status: teamMutationStatus(result) })
}

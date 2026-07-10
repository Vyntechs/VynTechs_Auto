import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { inviteTeamMember, teamMutationStatus } from '@/lib/shop-os/team'

export async function POST(req: NextRequest) {
  let body: { email?: unknown; role?: unknown; skillTier?: unknown }
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

  const result = await inviteTeamMember(
    db,
    {
      actor: {
        userId: ctx.user.id,
        shopId: ctx.profile.shopId,
        role: ctx.profile.role,
        isFounder: isFounder(ctx.user.email),
      },
      email: body.email,
      role: body.role,
      skillTier: body.skillTier,
      redirectTo: `${new URL(req.url).origin}/reset-password`,
    },
    async (email, redirectTo) =>
      supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo }),
  )
  return NextResponse.json(result, { status: teamMutationStatus(result) })
}

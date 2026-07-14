import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { declineOrDeferSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { entitlementReject } from '@/lib/auth-access'
import { generateDeclineLanguage } from '@/lib/gating/decline-language'

// Defer language-generation AI call. Cap at 60s for safety on cold starts.
export const maxDuration = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const denied = await entitlementReject(db, user.id)
  if (denied) return denied

  const body = await req.json().catch(() => null)

  const result = await declineOrDeferSessionForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
    generateLanguage: generateDeclineLanguage,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ status: result.status, language: result.language })
}

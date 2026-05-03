import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { createBillingPortalSessionForUser } from '@/lib/stripe'
import { getServerSupabase } from '@/lib/supabase-server'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const origin = req.headers.get('origin') ?? new URL(req.url).origin

  const result = await createBillingPortalSessionForUser({
    db,
    userId: user.id,
    origin,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ url: result.url })
}

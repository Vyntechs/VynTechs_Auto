import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { createSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { intakeSchema } from '@/lib/types'
import { getOpenSessionForTech, getProfileByUserId } from '@/lib/db/queries'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const parsed = intakeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const profile = await getProfileByUserId(db, user.id)
  if (profile) {
    const openSession = await getOpenSessionForTech(db, profile.id)
    if (openSession) {
      return NextResponse.json(
        { error: 'open_session', openSessionId: openSession.id },
        { status: 409 },
      )
    }
  }

  let treeState
  try {
    treeState = await generateInitialTree(parsed.data)
  } catch (err) {
    console.error('tree generation failed:', err)
    return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
  }

  const result = await createSessionForUser({
    db,
    userId: user.id,
    body: parsed.data,
    treeState,
  })

  if (!result.ok) {
    if (result.status === 409) {
      return NextResponse.json(
        { error: result.error, openSessionId: result.openSessionId },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ id: result.id })
}

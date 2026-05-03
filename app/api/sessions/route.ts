import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { createSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import { retrieveCorpus, type CorpusMatch } from '@/lib/corpus/retrieval'
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

  let corpus: CorpusMatch[] = []
  try {
    corpus = await retrieveCorpus(db, {
      vehicleYear: parsed.data.vehicleYear,
      vehicleMake: parsed.data.vehicleMake,
      vehicleModel: parsed.data.vehicleModel,
      vehicleEngine: parsed.data.vehicleEngine,
      complaintText: parsed.data.customerComplaint,
    })
  } catch (err) {
    console.warn('corpus retrieval failed (proceeding with empty):', err)
  }

  let treeState
  try {
    treeState = await generateInitialTree(parsed.data, corpus)
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
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ id: result.id })
}

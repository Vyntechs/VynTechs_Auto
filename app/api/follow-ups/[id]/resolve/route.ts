import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { resolveFollowUp } from '@/lib/comeback/resolve'
import { recordCorpusComeback } from '@/lib/corpus/decay'

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

  const body = await req.json().catch(() => null)

  const result = await resolveFollowUp({
    db,
    userId: user.id,
    followUpId: id,
    body,
    recordCorpusComeback,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, comebackRecorded: result.comebackRecorded })
}

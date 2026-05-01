import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { advanceSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { updateTree } from '@/lib/ai/tree-engine'

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

  const result = await advanceSession({
    db,
    userId: user.id,
    sessionId: id,
    body,
    updateTree,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.tree)
}

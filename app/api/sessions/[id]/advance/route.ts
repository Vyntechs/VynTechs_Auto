import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { advanceSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { updateTree } from '@/lib/ai/tree-engine'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import { WebSearchAdapter } from '@/lib/retrieval/adapters/web-search'
import { retrieveCorpus } from '@/lib/corpus/retrieval'

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

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

  const updateTreeWithRetrieval = buildUpdateTreeWithRetrieval({
    db,
    adapters: ADAPTERS,
    updateTree,
    runRetrieval,
    validateRetrievalResults,
    retrieveCorpus,
    sessionId: id,
  })

  const result = await advanceSession({
    db,
    userId: user.id,
    sessionId: id,
    body,
    updateTree: updateTreeWithRetrieval,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json(result.tree)
}

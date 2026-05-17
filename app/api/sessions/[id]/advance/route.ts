import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { advanceSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { updateTree } from '@/lib/ai/tree-engine'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import {
  buildUpdateTreeWithRetrieval,
  defaultBuildKnowledgeDispatcher,
} from '@/lib/retrieval/wire-into-tree'
import { getProfileByUserId } from '@/lib/db/queries'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import { WebSearchAdapter } from '@/lib/retrieval/adapters/web-search'
import { retrieveCorpus } from '@/lib/corpus/retrieval'

// AI tree-update + risk classifier + 6 web-retrieval adapters in parallel
// can stack past Vercel's default 10s hobby-tier limit, especially when
// retries fire. 60s caps at the Pro tier ceiling — harmless on hobby
// (still 10s) but avoids the killed-mid-request "Load failed" the tech
// otherwise sees on long /advance round-trips.
export const maxDuration = 60

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

  // PR 4: scope knowledge tools to the caller's shop so vetted-knowledge
  // lookups can never leak across shops. Profile lookup is cheap and
  // already done downstream in advanceSession; we re-do it here so the
  // wrapper has shopId at construction time. (Refactoring this to a
  // single lookup would touch advanceSession's signature unnecessarily.)
  const profile = await getProfileByUserId(db, user.id)
  const shopId = profile?.shopId

  const updateTreeWithRetrieval = buildUpdateTreeWithRetrieval({
    db,
    adapters: ADAPTERS,
    updateTree,
    runRetrieval,
    validateRetrievalResults,
    retrieveCorpus,
    sessionId: id,
    ...(shopId
      ? { buildKnowledgeDispatcher: defaultBuildKnowledgeDispatcher, shopId }
      : {}),
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
  return NextResponse.json({
    ...result.tree,
    citedItems: result.citedItems ?? [],
    consultedItems: result.consultedItems ?? [],
  })
}

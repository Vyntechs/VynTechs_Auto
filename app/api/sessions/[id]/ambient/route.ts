import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { recordAmbientConditions } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { entitlementReject } from '@/lib/auth-access'
import { fetchAmbientConditions } from '@/lib/external/weather'
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

// Geolocation lookup (Open-Meteo, ~500ms) plus the same tree-update +
// retrieval pipeline as /advance — same 60s cap to avoid mid-flight kills
// on long round-trips.
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

  const denied = await entitlementReject(db, user.id)
  if (denied) return denied

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

  const result = await recordAmbientConditions({
    db,
    userId: user.id,
    sessionId: id,
    body,
    lookupAmbient: ({ latitude, longitude }) =>
      fetchAmbientConditions({ latitude, longitude }),
    updateTree: updateTreeWithRetrieval,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ conditions: result.conditions, tree: result.tree })
}

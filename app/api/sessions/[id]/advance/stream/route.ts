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
import { getSessionById, listArtifactsForSession } from '@/lib/db/queries'
import {
  encodeEvent,
  type AdvanceStreamEvent,
  type AdvanceStreamStage,
} from '@/lib/advance-stream-events'

export const runtime = 'nodejs'
// Mirrors the non-stream /advance route: AI tree-update + 6 retrieval adapters
// can stack past Vercel's default 10s hobby-tier function limit, especially when
// retries fire. Without this, the streaming connection gets killed mid-flight
// and the client sees a TypeError fetch ("AI took too long or your connection
// dropped"). 60s caps at the Pro-tier ceiling; harmless on hobby (still 10s).
export const maxDuration = 60

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

const PHOTO_KINDS = new Set(['photo', 'scan_screen', 'wiring_diagram'])

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
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.json().catch(() => null)

  // Predict the stage list BEFORE advanceSession runs, so the client gets a
  // truthful `init` event up front and every subsequent stage event streams
  // live. The cost is one extra DB read for the current node's artifacts.
  let plannedStages: AdvanceStreamStage[]
  try {
    const session = await getSessionById(db, id)
    const currentNodeId = session?.treeState.currentNodeId
    const allArtifacts = currentNodeId
      ? await listArtifactsForSession(db, id)
      : []
    const photoCount = allArtifacts.filter(
      (a) =>
        a.nodeId === currentNodeId &&
        a.extractionStatus === 'done' &&
        PHOTO_KINDS.has(a.kind),
    ).length

    plannedStages = [
      { label: 'Recording observation' },
      ...(photoCount > 0
        ? [{ label: `Parsing photo · ${photoCount} frames` }]
        : []),
      { label: 'Updating retrieval ladder' },
      { label: 'Re-scoring confidence' },
      { label: 'Promoting next step' },
    ]
  } catch {
    plannedStages = [
      { label: 'Recording observation' },
      { label: 'Updating retrieval ladder' },
      { label: 'Re-scoring confidence' },
      { label: 'Promoting next step' },
    ]
  }

  const labelToIdx = new Map(plannedStages.map((s, i) => [s.label, i]))

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: AdvanceStreamEvent) =>
        controller.enqueue(encoder.encode(encodeEvent(event)))

      // Send init FIRST so the client knows the canonical stage set.
      emit({ type: 'init', stages: plannedStages })

      // Translate the wrapper/advance's idx-agnostic stage events into
      // canonical-idx stage events using the prebuilt label→idx map.
      const onProgress = (event: AdvanceStreamEvent) => {
        if (event.type !== 'stage') {
          emit(event)
          return
        }
        const idx = labelToIdx.get(event.label)
        if (idx !== undefined) {
          emit({ type: 'stage', idx, label: event.label })
        }
        // If a label arrives that wasn't in plannedStages (unexpected), drop
        // it silently — better than emitting a misleading idx.
      }

      const updateTreeWithRetrieval = buildUpdateTreeWithRetrieval({
        db,
        adapters: ADAPTERS,
        updateTree,
        runRetrieval,
        validateRetrievalResults,
        retrieveCorpus,
        sessionId: id,
        onProgress,
      })

      try {
        const result = await advanceSession({
          db,
          userId: user.id,
          sessionId: id,
          body,
          updateTree: updateTreeWithRetrieval,
          onProgress,
        })

        if (!result.ok) {
          emit({
            type: 'error',
            status: result.status,
            message: result.error,
          })
        } else {
          emit({ type: 'done', tree: result.tree })
        }
      } catch (err) {
        emit({
          type: 'error',
          status: 500,
          message: err instanceof Error ? err.message : 'stream error',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

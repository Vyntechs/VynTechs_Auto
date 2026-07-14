import { db } from '@/lib/db/client'
import { advanceSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { entitlementReject } from '@/lib/auth-access'
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

// This streaming route runs long: sequential retrieval (budgeted 30s) + a
// validator LLM call (~11s) + the reasoning LLM call (~22s, up to 3 retries).
// Measured: ~34s cache-warm, ~63s cold, 90s+ when retrying. Two distinct
// things can sever the response mid-flight, both of which surface to the
// client as "AI took too long or your connection dropped":
//   (1) exceeding the function execution cap (504 FUNCTION_INVOCATION_TIMEOUT);
//   (2) the long silent gaps below (no bytes for ~20-30s) letting an HTTP/1.1
//       client or intermediate proxy drop the idle connection — Vercel's
//       duration doc calls this out explicitly and prescribes streaming a
//       heartbeat while work runs.
// maxDuration=300 (the per-plan ceiling, valid on all plans) removes (1) across
// the full 34-90s range; the heartbeat below removes (2). Both are load-bearing.
export const maxDuration = 300

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

  const denied = await entitlementReject(db, user.id)
  if (denied) return denied

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
      { label: 'Advancing to next step' },
    ]
  } catch {
    plannedStages = [
      { label: 'Recording observation' },
      { label: 'Updating retrieval ladder' },
      { label: 'Re-scoring confidence' },
      { label: 'Advancing to next step' },
    ]
  }

  const labelToIdx = new Map(plannedStages.map((s, i) => [s.label, i]))

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      let closed = false
      // Guard every write: the heartbeat interval and the main body both
      // enqueue, and a write after the stream closes (client disconnected)
      // throws. Swallowing that lets the request unwind cleanly.
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return
        try {
          controller.enqueue(chunk)
        } catch {
          closed = true
        }
      }
      const emit = (event: AdvanceStreamEvent) =>
        safeEnqueue(encoder.encode(encodeEvent(event)))

      // Heartbeat: a bare newline every 10s. The work below goes silent for
      // long stretches — up to ~30s during cold retrieval and ~22s during the
      // reasoning LLM call — and a stream with no bytes flowing can be severed
      // as idle by the platform/proxy or the browser, which surfaces to the
      // client as the "AI took too long or your connection dropped" error. The
      // client's NDJSON parser skips empty lines, so heartbeats never reach the UI.
      const heartbeat = setInterval(
        () => safeEnqueue(encoder.encode('\n')),
        10_000,
      )

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
        clearInterval(heartbeat)
        closed = true
        // close() also throws if the client already disconnected (the stream
        // was cancelled). Swallow it so the request unwinds cleanly.
        try {
          controller.close()
        } catch {
          // already closed — nothing to do
        }
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

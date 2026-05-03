import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { advanceSession } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { updateTree } from '@/lib/ai/tree-engine'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import type { RetrievalContext, RetrievalResult } from '@/lib/retrieval/types'

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
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

  // Wrap the prod updateTree so it runs Rung-1 internet retrieval + LLM grading
  // before delegating to the real updateTree. Failures fall through with
  // retrieval: [] and a console.warn — the advance flow should never block on
  // optional supporting evidence.
  const updateTreeWithRetrieval: typeof updateTree = async (input) => {
    const dtcs = (input.artifacts ?? []).flatMap((a) => {
      const codes = (a.structured as { dtcs?: Array<{ code?: string }> } | undefined)?.dtcs
      return Array.isArray(codes)
        ? codes.map((d) => d?.code).filter((c): c is string => typeof c === 'string')
        : []
    })

    const ctx: RetrievalContext = {
      vehicleYear: input.intake.vehicleYear,
      vehicleMake: input.intake.vehicleMake,
      vehicleModel: input.intake.vehicleModel,
      vehicleEngine: input.intake.vehicleEngine,
      dtcs: dtcs.length ? dtcs : undefined,
      complaintText: input.intake.customerComplaint,
      observation: input.observation,
    }

    let retrieval: RetrievalResult[] = []
    try {
      const run = await runRetrieval({ db, adapters: ADAPTERS, ctx })
      try {
        retrieval = await validateRetrievalResults({ ctx, results: run.results })
      } catch (validateErr) {
        console.warn('retrieval validation failed:', validateErr)
        retrieval = run.results
      }
    } catch (err) {
      console.warn('retrieval failed:', err)
      retrieval = []
    }

    return updateTree({
      ...input,
      // Phase K not built — corpus is wired through but always undefined for now.
      corpus: undefined,
      retrieval,
    })
  }

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

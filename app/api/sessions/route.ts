import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { createSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { generateInitialTree } from '@/lib/ai/tree-engine'
import type { TreeState } from '@/lib/ai/tree-engine'
import { retrieveCorpus } from '@/lib/corpus/retrieval'
import { runRetrieval } from '@/lib/retrieval/orchestrator'
import { validateRetrievalResults } from '@/lib/retrieval/validator'
import { buildGenerateInitialTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import { NHTSAAdapter } from '@/lib/retrieval/adapters/nhtsa'
import { ManufacturerRecallAdapter } from '@/lib/retrieval/adapters/manufacturer-recall'
import { ForumAdapter } from '@/lib/retrieval/adapters/forum'
import { YouTubeAdapter } from '@/lib/retrieval/adapters/youtube'
import { RedditAdapter } from '@/lib/retrieval/adapters/reddit'
import { WebSearchAdapter } from '@/lib/retrieval/adapters/web-search'
import { intakeSchema } from '@/lib/types'
import {
  countOpenSessionsForTech,
  getOpenSessionForTech,
  getProfileByUserId,
} from '@/lib/db/queries'
import { platforms, symptoms } from '@/lib/db/schema'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'

// Initial tree generation + corpus + 6 web-retrieval adapters + grader.
// Cap at 60s — same envelope as /api/intake/submit.
export const maxDuration = 60

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

// Soft cap on concurrent open jobs per tech. Real shops run 2–4 in flight
// constantly (parts wait, customer phone tag, mid-bay interruptions). The
// cap keeps the queue manageable without forcing a one-at-a-time workflow
// that doesn't match shop reality. Bumped from 1 → 5 on 2026-05-08.
const MAX_OPEN_SESSIONS_PER_TECH = 5

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const denied = await paywallReject(db, user.id)
  if (denied) return denied

  const body = await req.json().catch(() => null)
  const parsed = intakeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 })
  }

  const profile = await getProfileByUserId(db, user.id)
  if (profile) {
    const openCount = await countOpenSessionsForTech(db, profile.id)
    if (openCount >= MAX_OPEN_SESSIONS_PER_TECH) {
      const openSession = await getOpenSessionForTech(db, profile.id)
      return NextResponse.json(
        {
          error: 'open_session_limit',
          openSessionId: openSession?.id,
          limit: MAX_OPEN_SESSIONS_PER_TECH,
        },
        { status: 409 },
      )
    }
  }

  // Pre-flight cache check: resolve platform + symptom before spending AI budget.
  let cacheHitPlatformId: string | null = null
  let cacheHitSymptomId: string | null = null

  const platformSlug = resolvePlatformSlug({
    year: parsed.data.vehicleYear,
    make: parsed.data.vehicleMake,
    model: parsed.data.vehicleModel,
    engine: parsed.data.vehicleEngine ?? '',
  })

  if (platformSlug) {
    const symptomSlug = await resolveSymptomSlug({
      db,
      platformSlug,
      selectedSymptomSlug: parsed.data.selectedSymptomSlug,
      dtcCodes: parsed.data.dtcCodes,
      complaintText: parsed.data.customerComplaint,
    })

    if (symptomSlug) {
      const platformRow = await db.query.platforms.findFirst({
        where: eq(platforms.slug, platformSlug),
        columns: { id: true },
      })
      const symptomRow = await db.query.symptoms.findFirst({
        where: eq(symptoms.slug, symptomSlug),
        columns: { id: true },
      })
      if (platformRow && symptomRow) {
        cacheHitPlatformId = platformRow.id
        cacheHitSymptomId = symptomRow.id
      }
    }
  }

  // Empty-sentinel treeState for cache-hit sessions — nodes[] is empty so the
  // routing layer can distinguish "not generated yet" from "AI tree active".
  // Required fields are filled with neutral values per the real TreeState type.
  const CACHE_HIT_SENTINEL: TreeState = {
    nodes: [],
    currentNodeId: '',
    message: '',
  }

  let treeState: TreeState
  if (cacheHitSymptomId) {
    // Cache hit: skip AI entirely.
    treeState = CACHE_HIT_SENTINEL
  } else {
    // Cache miss: run the existing AI tree generation unchanged.
    const generateInitialTreeWithRetrieval = buildGenerateInitialTreeWithRetrieval({
      db,
      adapters: ADAPTERS,
      generateInitialTree,
      runRetrieval,
      validateRetrievalResults,
      retrieveCorpus,
    })

    try {
      treeState = await generateInitialTreeWithRetrieval(parsed.data)
    } catch (err) {
      console.error('tree generation failed:', err)
      return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
    }
  }

  const result = await createSessionForUser({
    db,
    userId: user.id,
    body: parsed.data,
    treeState,
    cacheHitPlatformId,
    cacheHitSymptomId,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ id: result.id })
}

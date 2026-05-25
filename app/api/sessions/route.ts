import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { createSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { rateLimitReject } from '@/lib/rate-limit'
import { generateInitialTree } from '@/lib/ai/tree-engine'
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

  // Cap creation rate. The full pipeline below burns Anthropic + Voyage +
  // Tavily credits per call; without this an authenticated attacker in a
  // tight loop can drain budgets. Real techs create 1–3 sessions/hour.
  const limited = await rateLimitReject(db, `intake:${user.id}`, 10)
  if (limited) return limited

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

  const generateInitialTreeWithRetrieval = buildGenerateInitialTreeWithRetrieval({
    db,
    adapters: ADAPTERS,
    generateInitialTree,
    runRetrieval,
    validateRetrievalResults,
    retrieveCorpus,
  })

  let treeState
  try {
    treeState = await generateInitialTreeWithRetrieval(parsed.data)
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

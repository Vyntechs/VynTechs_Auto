import { NextResponse } from 'next/server'
import { after } from 'next/server'
import {
  startResearchRun,
  executePipeline,
  findRecentResearchRun,
} from '@/lib/research/orchestrator'
import { requireCurator } from '@/lib/curator/route-helpers'
import {
  platformDisplayName,
  symptomDisplayName,
  isKnownPlatformSlug,
  isKnownSymptomSlug,
} from '@/lib/curator/slug-catalog'

export const runtime = 'nodejs'
// Pro/Enterprise Fluid Compute Functions support up to 800s — comfortably above a
// 3-6 min dispatch + synthesis. The after() callback below runs within this window.
export const maxDuration = 800

export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const body = (await req.json().catch(() => null)) as
    | { platformSlug?: string; symptomSlug?: string; flowId?: string; reusePriorRunId?: string }
    | null
  if (!body?.platformSlug || !body?.symptomSlug) {
    return NextResponse.json({ error: 'platformSlug + symptomSlug required' }, { status: 400 })
  }

  // Defensive slug validation (the canonical publish-time check is PR-N2's publish gate).
  if (!isKnownPlatformSlug(body.platformSlug) || !isKnownSymptomSlug(body.symptomSlug)) {
    return NextResponse.json({ error: 'unknown platform or symptom slug' }, { status: 422 })
  }

  // Client opted to reuse a prior run → echo its id back (no new dispatch, no cost).
  if (body.reusePriorRunId) {
    return NextResponse.json({ runId: body.reusePriorRunId, reused: true })
  }

  // Cost guard (agent-05): on the "check" call (no flowId yet), surface a recent prior
  // run so the client can offer reuse before spending on a fresh dispatch.
  if (!body.flowId) {
    const prior = await findRecentResearchRun({
      platformSlug: body.platformSlug,
      symptomSlug: body.symptomSlug,
    })
    return NextResponse.json({ priorRun: prior }, { status: 200 })
  }

  // Committed dispatch (flowId present): insert the run row, then run the heavy fan-out +
  // synthesis AFTER the response flushes via after() (survives on Vercel Fluid Compute;
  // a bare fire-and-forget promise would be frozen once the response returns).
  const input = {
    platformSlug: body.platformSlug,
    symptomSlug: body.symptomSlug,
    platformDisplay: platformDisplayName(body.platformSlug),
    symptomDisplay: symptomDisplayName(body.symptomSlug),
    flowId: body.flowId,
    initiatedByProfileId: auth.profileId,
  }
  const { runId } = await startResearchRun(input)
  after(() => executePipeline(runId, input))

  return NextResponse.json({ runId })
}

import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { createSessionFromIntake } from '@/lib/intake/session'
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

// Initial tree generation + corpus retrieval + 6 web-retrieval adapters +
// retrieval-validator AI grader stack past 10s easily. Cap at 60s.
export const maxDuration = 60

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

type IntakeBody = {
  customer?: { name?: string; phone?: string; email?: string }
  vehicle?: {
    vin?: string
    year?: string
    make?: string
    model?: string
    engine?: string
    mileage?: string
    plate?: string
  }
  complaint?: {
    description?: string
    whenStarted?: string
    howOften?: string
    authorized?: string
  }
}

function nonEmpty(v: string | undefined): string | null {
  if (!v) return null
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed
}

function toIntOrNull(v: string | undefined): number | null {
  const trimmed = nonEmpty(v)
  if (trimmed === null) return null
  const parsed = Number.parseInt(trimmed, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export async function POST(req: Request) {
  let body: IntakeBody
  try {
    body = (await req.json()) as IntakeBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  const name = nonEmpty(body.customer?.name)
  const phone = nonEmpty(body.customer?.phone)
  const email = nonEmpty(body.customer?.email)
  const vin = nonEmpty(body.vehicle?.vin)
  const year = toIntOrNull(body.vehicle?.year)
  const make = nonEmpty(body.vehicle?.make)
  const model = nonEmpty(body.vehicle?.model)
  const engine = nonEmpty(body.vehicle?.engine)
  const mileage = toIntOrNull(body.vehicle?.mileage)
  const description = nonEmpty(body.complaint?.description)

  if (!name || !phone) {
    return NextResponse.json({ error: 'customer name and phone are required' }, { status: 422 })
  }
  if (!year || !make || !model) {
    return NextResponse.json({ error: 'vehicle year, make, and model are required' }, { status: 422 })
  }
  if (!description) {
    return NextResponse.json({ error: 'complaint description is required' }, { status: 422 })
  }

  // Mirror /api/sessions: best-effort corpus + retrieval, then mandatory AI
  // tree generation. Without a populated tree, the diagnostic page hangs on
  // "Building your diagnostic plan..." forever.
  const intakePayload = {
    vehicleYear: year,
    vehicleMake: make,
    vehicleModel: model,
    vehicleEngine: engine ?? undefined,
    mileage: mileage ?? undefined,
    customerComplaint: description,
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
    treeState = await generateInitialTreeWithRetrieval(intakePayload)
  } catch (err) {
    console.error('tree generation failed:', err)
    return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
  }

  const { sessionId } = await createSessionFromIntake(db, {
    shopId: ctx.profile.shopId,
    advisorProfileId: ctx.profile.id,
    customer: { name, phone, email },
    vehicle: {
      year,
      make,
      model,
      engine,
      vin,
      mileage,
      plate: nonEmpty(body.vehicle?.plate),
    },
    complaint: {
      description,
      whenStarted: body.complaint?.whenStarted?.trim() ?? '',
      howOften: body.complaint?.howOften?.trim() ?? '',
      authorized: body.complaint?.authorized?.trim() ?? '',
    },
    treeState,
  })

  return NextResponse.json({ sessionId }, { status: 201 })
}

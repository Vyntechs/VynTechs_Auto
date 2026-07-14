import { NextResponse, after } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { entitlementReject } from '@/lib/auth-access'
import { rateLimitReject } from '@/lib/rate-limit'
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
import { customers as customersTable, profiles, vehicles as vehiclesTable } from '@/lib/db/schema'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { resolveSymptomSlug, extractDtcCodes } from '@/lib/diagnostics/symptom-resolver'
import { reconcileSeededSymptom } from '@/lib/diagnostics/reconcile-seeded-symptom'
import { startResearchRun, executePipeline, findRecentResearchRun } from '@/lib/research/orchestrator'
import { isColdCaseSynthesisEnabled } from '@/lib/feature-flags'
import { platformDisplayName, symptomDisplayName } from '@/lib/curator/slug-catalog'
import type { TreeState } from '@/lib/db/schema'

// Initial tree generation + corpus retrieval + 6 web-retrieval adapters +
// retrieval-validator AI grader stack past 10s easily. 300s = Vercel platform max.
export const maxDuration = 300

const ADAPTERS = [
  new NHTSAAdapter(),
  new ManufacturerRecallAdapter(),
  new ForumAdapter(),
  new YouTubeAdapter(),
  new RedditAdapter(),
  new WebSearchAdapter(),
]

type IntakeBody = {
  // Pick-existing path:
  existingVehicleId?: string

  // Manual path (existing):
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
  assignedTechId?: string | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const denied = await entitlementReject(db, ctx.user.id)
  if (denied) return denied

  // Cap creation rate — same key as /api/sessions so an attacker can't
  // double their burn by alternating between the two intake endpoints.
  const limited = await rateLimitReject(db, `intake:${ctx.user.id}`, 10)
  if (limited) return limited

  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  const description = nonEmpty(body.complaint?.description)
  if (!description) {
    return NextResponse.json({ error: 'complaint description is required' }, { status: 422 })
  }

  // ---- Validate assignedTechId (optional override) ----
  // Null / undefined falls through to the helper's advisor fallback. A provided
  // value must be a UUID belonging to the caller's shop.
  let assignedTechId: string | null = null
  if (body.assignedTechId !== undefined && body.assignedTechId !== null) {
    if (typeof body.assignedTechId !== 'string' || !UUID_RE.test(body.assignedTechId)) {
      return NextResponse.json({ error: 'invalid_assigned_tech_id' }, { status: 422 })
    }
    const [target] = await db
      .select({ id: profiles.id, shopId: profiles.shopId })
      .from(profiles)
      .where(eq(profiles.id, body.assignedTechId))
      .limit(1)
    if (!target) {
      return NextResponse.json({ error: 'profile_not_found' }, { status: 404 })
    }
    if (target.shopId !== ctx.profile.shopId) {
      return NextResponse.json({ error: 'cross_shop_forbidden' }, { status: 403 })
    }
    assignedTechId = body.assignedTechId
  }

  // ---- Resolve customer + vehicle (two branches) ----
  let resolvedCustomerId: string | undefined
  let resolvedVehicleId: string | undefined
  let resolvedYear: number
  let resolvedMake: string
  let resolvedModel: string
  let resolvedEngine: string | null
  let resolvedVin: string | null
  let resolvedMileage: number | null
  let resolvedPlate: string | null
  let resolvedCustomerName: string
  let resolvedCustomerPhone: string
  let resolvedCustomerEmail: string | null

  if (body.existingVehicleId) {
    // Pick-existing branch. Look up the vehicle and validate cross-shop
    // BEFORE the heavy tree-generation work.
    const [v] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, body.existingVehicleId))
      .limit(1)
    if (!v) {
      return NextResponse.json({ error: 'vehicle_not_found' }, { status: 404 })
    }
    const [c] = await db
      .select()
      .from(customersTable)
      .where(eq(customersTable.id, v.customerId))
      .limit(1)
    if (!c || c.shopId !== ctx.profile.shopId) {
      return NextResponse.json({ error: 'cross_shop_forbidden' }, { status: 403 })
    }
    resolvedCustomerId = c.id
    resolvedVehicleId = v.id
    resolvedYear = v.year
    resolvedMake = v.make
    resolvedModel = v.model
    resolvedEngine = v.engine
    resolvedVin = v.vin
    // Mileage may be updated on this visit; use the body value if provided,
    // otherwise stay with the stored value. The helper will write the update
    // to the row in its transaction when a new value is present.
    const newMileage = toIntOrNull(body.vehicle?.mileage)
    resolvedMileage = newMileage ?? v.mileage
    resolvedPlate = v.plate
    resolvedCustomerName = c.name
    resolvedCustomerPhone = c.phone
    resolvedCustomerEmail = c.email
  } else {
    // Manual-entry branch (unchanged).
    const name = nonEmpty(body.customer?.name)
    const phone = nonEmpty(body.customer?.phone)
    const email = nonEmpty(body.customer?.email)
    const vin = nonEmpty(body.vehicle?.vin)
    const year = toIntOrNull(body.vehicle?.year)
    const make = nonEmpty(body.vehicle?.make)
    const model = nonEmpty(body.vehicle?.model)
    const engine = nonEmpty(body.vehicle?.engine)
    const mileage = toIntOrNull(body.vehicle?.mileage)
    const plate = nonEmpty(body.vehicle?.plate)

    if (!name || !phone) {
      return NextResponse.json({ error: 'customer name and phone are required' }, { status: 422 })
    }
    if (!year || !make || !model) {
      return NextResponse.json({ error: 'vehicle year, make, and model are required' }, { status: 422 })
    }
    resolvedYear = year
    resolvedMake = make
    resolvedModel = model
    resolvedEngine = engine
    resolvedVin = vin
    resolvedMileage = mileage
    resolvedPlate = plate
    resolvedCustomerName = name
    resolvedCustomerPhone = phone
    resolvedCustomerEmail = email
  }

  // Pre-flight topology check: resolve platform (pure), then reconcile the
  // resolver's candidate symptom to an actually-seeded, topology-reachable slug.
  // reconcileSeededSymptom returns a slug ONLY when loadSystemTopology would hit,
  // so a non-null result means topology exists — skip AI and let the session
  // page's render-time gate (which runs the identical reconcile) show the diagram.
  const platformSlug = resolvePlatformSlug({
    year: resolvedYear,
    make: resolvedMake,
    model: resolvedModel,
    engine: resolvedEngine ?? '',
  })
  // The resolver's candidate symptom slug (null when no pattern/DTC matched).
  // Used BOTH as the reconcile input and as the cold-case synthesis trigger key.
  const symptomSlug = resolveSymptomSlug({
    dtcCodes: extractDtcCodes(description),
    complaintText: description,
  })
  const reconciledSymptomSlug = platformSlug
    ? await reconcileSeededSymptom(db, platformSlug, {
        candidateSlug: symptomSlug,
        complaintText: description,
      })
    : null
  const topologyExists = Boolean(reconciledSymptomSlug)

  // ---- Cold-case system-data DRAFT generation (fire-and-forget, DRAFT-ONLY) ----
  // A SUPPORTED vehicle (platformSlug resolved) arriving with an UN-SEEDED symptom
  // (symptomSlug resolved, topologyExists=false) and the flag ON → kick off the
  // research pipeline in the background via after() and persist a system-data
  // DRAFT (status 'draft'). Nothing here is rendered, promoted, or customer-facing;
  // the chatbot tree path below still runs unchanged. Gated OFF by default, and
  // short-circuited when a recent completed run already exists for the slug pair.
  if (!topologyExists && isColdCaseSynthesisEnabled() && platformSlug !== null && symptomSlug !== null) {
    const recentRun = await findRecentResearchRun({ platformSlug, symptomSlug }, db)
    if (!recentRun) {
      const synthInput = {
        platformSlug,
        symptomSlug,
        platformDisplay: platformDisplayName(platformSlug),
        symptomDisplay: symptomDisplayName(symptomSlug),
        initiatedByProfileId: ctx.profile.id,
      }
      const { runId } = await startResearchRun(synthInput, db)
      after(() => executePipeline(runId, synthInput, db))
    }
  }

  // Mirror /api/sessions: best-effort corpus + retrieval, then mandatory AI
  // tree generation. Without a populated tree, the diagnostic page hangs on
  // "Building your diagnostic plan..." forever.
  const intakePayload = {
    vehicleYear: resolvedYear,
    vehicleMake: resolvedMake,
    vehicleModel: resolvedModel,
    vehicleEngine: resolvedEngine ?? undefined,
    mileage: resolvedMileage ?? undefined,
    customerComplaint: description,
  }

  let treeState: TreeState
  if (topologyExists) {
    // Topology hit: skip AI entirely. Use a sentinel with one node + done=true
    // so routeForSession returns 'active-session' (nodes.length=0 would stall
    // on 'tree-generating'). The session page's topology gate intercepts first
    // and renders the interactive diagram before ActiveSession ever sees this.
    treeState = {
      nodes: [{ id: '_topology', label: 'topology', status: 'active' as const }],
      currentNodeId: '_topology',
      message: '',
      done: true,
    }
  } else {
    const generateInitialTreeWithRetrieval = buildGenerateInitialTreeWithRetrieval({
      db,
      adapters: ADAPTERS,
      generateInitialTree,
      runRetrieval,
      validateRetrievalResults,
      retrieveCorpus,
    })
    try {
      treeState = await generateInitialTreeWithRetrieval(intakePayload)
    } catch (err) {
      console.error('tree generation failed:', err)
      return NextResponse.json({ error: 'tree generation failed' }, { status: 500 })
    }
  }

  const { sessionId } = await createSessionFromIntake(db, {
    shopId: ctx.profile.shopId,
    advisorProfileId: ctx.profile.id,
    assignedTechId,
    customer: {
      name: resolvedCustomerName,
      phone: resolvedCustomerPhone,
      email: resolvedCustomerEmail,
    },
    vehicle: {
      year: resolvedYear,
      make: resolvedMake,
      model: resolvedModel,
      engine: resolvedEngine,
      vin: resolvedVin,
      mileage: resolvedMileage,
      plate: resolvedPlate,
    },
    complaint: {
      description,
      whenStarted: body.complaint?.whenStarted?.trim() ?? '',
      howOften: body.complaint?.howOften?.trim() ?? '',
      authorized: body.complaint?.authorized?.trim() ?? '',
    },
    treeState,
    existingCustomerId: resolvedCustomerId,
    existingVehicleId: resolvedVehicleId,
  })

  return NextResponse.json({ sessionId }, { status: 201 })
}

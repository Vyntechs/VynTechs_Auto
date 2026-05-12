import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
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
import { customers as customersTable, profiles, vehicles as vehiclesTable } from '@/lib/db/schema'

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

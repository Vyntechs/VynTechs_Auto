import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, researchRuns, shops } from '@/lib/db/schema'

// Replace the singleton db client with our PGlite test db (same Proxy pattern as
// intake-submit-route.test.ts).
let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))

// Tree generation hits the Anthropic API; mock to a stable fixture.
vi.mock('@/lib/ai/tree-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/tree-engine')>('@/lib/ai/tree-engine')
  return {
    ...actual,
    generateInitialTree: vi.fn().mockResolvedValue({
      nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
      currentNodeId: 'scan-codes',
      message: 'pull codes',
    }),
  }
})

// Corpus retrieval hits Voyage embeddings + DB; mock to empty.
vi.mock('@/lib/corpus/retrieval', async () => {
  const actual = await vi.importActual<typeof import('@/lib/corpus/retrieval')>('@/lib/corpus/retrieval')
  return {
    ...actual,
    retrieveCorpus: vi.fn().mockResolvedValue([]),
  }
})

// Capture the after() callback but NEVER execute it — the trigger's synchronous
// startResearchRun insert is what we assert on (no background pipeline runs).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: vi.fn() }
})

// Control topologyExists deterministically. Default: no seeded topology (null) →
// topologyExists=false. T2-C overrides to a slug → topologyExists=true.
vi.mock('@/lib/diagnostics/reconcile-seeded-symptom', () => ({
  reconcileSeededSymptom: vi.fn(async () => null),
}))

import { reconcileSeededSymptom } from '@/lib/diagnostics/reconcile-seeded-symptom'

const PLATFORM_SLUG = 'ford-super-duty-3rd-gen-60-psd'
// "P0299" → resolveSymptomSlug returns the DTC slug 'p0299' (non-null).
const EXPECTED_SYMPTOM_SLUG = 'p0299'

// Supported 6.0L PSD that resolvePlatformSlug maps to PLATFORM_SLUG.
const SUPPORTED_VEHICLE = {
  vin: '1FTWW31P05EA00001',
  year: '2005',
  make: 'Ford',
  model: 'F-250',
  engine: '6.0L Power Stroke',
  mileage: '120000',
  plate: 'PSD600',
}

// Unsupported vehicle → resolvePlatformSlug returns null.
const UNSUPPORTED_VEHICLE = {
  vin: '1FTEW1EP5JFC10001',
  year: '2018',
  make: 'Ford',
  model: 'F-150',
  engine: '3.5L EcoBoost',
  mileage: '84000',
  plate: 'ABC123',
}

const bodyFor = (vehicle: Record<string, string>, description: string) => ({
  customer: { name: 'Maria Lopez', phone: '555-1234', email: 'maria@example.com' },
  vehicle,
  complaint: { description, whenStarted: '2 weeks ago', howOften: 'Daily', authorized: 'Diagnostic only' },
})

async function callRoute(body: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/intake/submit/route')
  const req = new Request('http://localhost/api/intake/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return POST(req)
}

describe('POST /api/intake/submit — cold-case synthesis trigger', () => {
  let close: () => Promise<void>
  let shopId: string
  let ownerProfileId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    const [profile] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'owner',
        shopId,
        fullName: 'Owner',
        isComp: true,
      })
      .returning()
    ownerProfileId = profile.id

    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: '00000000-0000-0000-0000-000000000001', email: 'owner@shop.test' },
      profile,
    })

    vi.mocked(reconcileSeededSymptom).mockResolvedValue(null)
    delete process.env.COLD_CASE_SYNTHESIS_ENABLED
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
    delete process.env.COLD_CASE_SYNTHESIS_ENABLED
  })

  // T2-A
  it('inserts a research_runs row for an un-seeded supported vehicle when the flag is on', async () => {
    process.env.COLD_CASE_SYNTHESIS_ENABLED = 'true'
    const res = await callRoute(bodyFor(SUPPORTED_VEHICLE, 'Stored diagnostic trouble code P0299'))
    expect(res.status).toBe(201)

    const runs = await currentDb.select().from(researchRuns)
    expect(runs).toHaveLength(1)
    expect(runs[0].platformSlug).toBe(PLATFORM_SLUG)
    expect(runs[0].symptomSlug).toBe(EXPECTED_SYMPTOM_SLUG)
    expect(runs[0].initiatedBy).toBe(ownerProfileId)
  })

  // T2-B
  it('does NOT insert a new research_runs row when a recent completed run exists (short-circuit)', async () => {
    process.env.COLD_CASE_SYNTHESIS_ENABLED = 'true'
    await currentDb.insert(researchRuns).values({
      platformSlug: PLATFORM_SLUG,
      symptomSlug: EXPECTED_SYMPTOM_SLUG,
      status: 'completed',
      initiatedBy: ownerProfileId,
      completedAt: new Date(),
    })

    const res = await callRoute(bodyFor(SUPPORTED_VEHICLE, 'Stored diagnostic trouble code P0299'))
    expect(res.status).toBe(201)

    const runs = await currentDb.select().from(researchRuns)
    expect(runs).toHaveLength(1) // only the pre-existing completed run
  })

  // T2-C
  it('does NOT insert a research_runs row when topology already exists (topology hit)', async () => {
    process.env.COLD_CASE_SYNTHESIS_ENABLED = 'true'
    vi.mocked(reconcileSeededSymptom).mockResolvedValue('cranks-no-start') // topologyExists=true

    const res = await callRoute(bodyFor(SUPPORTED_VEHICLE, 'Cranks but will not start'))
    expect(res.status).toBe(201)

    const runs = await currentDb.select().from(researchRuns)
    expect(runs).toHaveLength(0)
  })

  // T2-D
  it('does NOT insert a research_runs row when the feature flag is disabled', async () => {
    // COLD_CASE_SYNTHESIS_ENABLED intentionally unset (deleted in beforeEach).
    const res = await callRoute(bodyFor(SUPPORTED_VEHICLE, 'Stored diagnostic trouble code P0299'))
    expect(res.status).toBe(201)

    const runs = await currentDb.select().from(researchRuns)
    expect(runs).toHaveLength(0)
  })

  // T2-E
  it('does NOT insert a research_runs row when the vehicle is unsupported (platformSlug null)', async () => {
    process.env.COLD_CASE_SYNTHESIS_ENABLED = 'true'
    const res = await callRoute(bodyFor(UNSUPPORTED_VEHICLE, 'Stored diagnostic trouble code P0299'))
    expect(res.status).toBe(201)

    const runs = await currentDb.select().from(researchRuns)
    expect(runs).toHaveLength(0)
  })
})

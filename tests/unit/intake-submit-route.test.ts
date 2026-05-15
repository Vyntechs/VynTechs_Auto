import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, profiles, sessions, shops, vehicles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

// The route imports the singleton db client; we replace it with our PGlite test
// db. The Proxy + currentDb capture pattern lets each test seed its own DB
// while the import shape stays a single ESM binding.
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
  const actual = await vi.importActual<typeof import('@/lib/ai/tree-engine')>(
    '@/lib/ai/tree-engine',
  )
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
  const actual = await vi.importActual<typeof import('@/lib/corpus/retrieval')>(
    '@/lib/corpus/retrieval',
  )
  return {
    ...actual,
    retrieveCorpus: vi.fn().mockResolvedValue([]),
  }
})

const SAMPLE_BODY = {
  customer: { name: 'Maria Lopez', phone: '555-1234', email: 'maria@example.com' },
  vehicle: {
    vin: '1FTEW1EP5JFC10001',
    vinScanned: true,
    year: '2018',
    make: 'Ford',
    model: 'F-150',
    engine: '3.5L EcoBoost',
    mileage: '84000',
    plate: 'ABC123',
  },
  complaint: {
    description: 'Loss of power on hills',
    whenStarted: '2 weeks ago',
    howOften: 'Daily',
    authorized: 'Diagnostic only',
  },
}

describe('POST /api/intake/submit', () => {
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
        // isComp:true bypasses the Stripe paywall check; the unit test is
        // about the intake submission flow, not billing.
        isComp: true,
      })
      .returning()
    ownerProfileId = profile.id

    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: '00000000-0000-0000-0000-000000000001', email: 'owner@shop.test' },
      profile,
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('persists customer + vehicle + session and returns sessionId', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BODY),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const json = (await res.json()) as { sessionId: string }
    expect(json.sessionId).toBeTruthy()

    expect(await currentDb.select().from(customers)).toHaveLength(1)
    expect(await currentDb.select().from(vehicles)).toHaveLength(1)
    const sessionRows = await currentDb
      .select()
      .from(sessions)
      .where(eq(sessions.id, json.sessionId))
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0].techId).toBe(ownerProfileId)
  })

  // Regression guard for the "Building your diagnostic plan..." hang. If a
  // future change drops generateInitialTree before createSessionFromIntake,
  // the session lands with EMPTY_TREE and /sessions/<id> renders forever.
  // Lock in the contract: the populated tree from generateInitialTree must
  // actually reach the persisted session row.
  it('persists generated tree to session.treeState (regression: "Building..." hang)', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BODY),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }

    const sessionRows = await currentDb
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
    expect(sessionRows[0].treeState.nodes.length).toBeGreaterThan(0)
    expect(sessionRows[0].treeState.currentNodeId).toBe('scan-codes')
  })

  it('returns 422 when required customer field missing', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, customer: { name: '', phone: '', email: '' } }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('returns 401 when not authenticated', async () => {
    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BODY),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid JSON body', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

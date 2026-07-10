import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, sessions, shops, ticketJobs, tickets } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getShopTeam } from '@/lib/intake/team'

// Same Proxy-mock pattern as intake-submit-route.test.ts — the route imports
// a singleton db client; we swap it for a per-test PGlite instance.
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

describe('POST /api/intake/submit — assignedTechId', () => {
  let close: () => Promise<void>
  let shopId: string
  let ownerProfileId: string
  let teammateProfileId: string
  let otherShopProfileId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    const [owner] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'owner',
        skillTier: 3,
        shopId,
        fullName: 'Owner',
        // isComp:true bypasses the Stripe paywall check; the unit test is
        // about the assignedTechId flow, not billing.
        isComp: true,
      })
      .returning()
    ownerProfileId = owner.id

    const [teammate] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000002',
        role: 'tech',
        skillTier: 2,
        shopId,
        fullName: 'Teammate',
      })
      .returning()
    teammateProfileId = teammate.id

    const [otherShop] = await currentDb
      .insert(shops)
      .values({ name: 'Other Shop' })
      .returning()
    const [otherShopProfile] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000003',
        role: 'tech',
        skillTier: 1,
        shopId: otherShop.id,
        fullName: 'Excluded',
      })
      .returning()
    otherShopProfileId = otherShopProfile.id

    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: '00000000-0000-0000-0000-000000000001', email: 'owner@shop.test' },
      profile: owner,
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('stamps tech_id = advisor when assignedTechId is omitted', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BODY),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const [row] = await currentDb.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(ownerProfileId)
  })

  it('stamps tech_id = advisor when assignedTechId is null', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: null }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const [row] = await currentDb.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(ownerProfileId)
  })

  it('stamps tech_id = teammate when assignedTechId points to a same-shop profile', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: teammateProfileId }),
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    const { sessionId } = (await res.json()) as { sessionId: string }
    const [row] = await currentDb.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(row.techId).toBe(teammateProfileId)
  })

  it('returns 403 cross_shop_forbidden when assignedTechId is in a different shop', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: otherShopProfileId }),
    })
    const res = await POST(req)
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('cross_shop_forbidden')
    expect(await currentDb.select().from(sessions)).toHaveLength(0)
  })

  it('returns 404 profile_not_found when assignedTechId is unknown', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...SAMPLE_BODY,
        assignedTechId: '00000000-0000-0000-0000-0000000000ff',
      }),
    })
    const res = await POST(req)
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('profile_not_found')
  })

  it('returns 422 invalid_assigned_tech_id for non-uuid strings', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const req = new Request('http://localhost/api/intake/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...SAMPLE_BODY, assignedTechId: 'not-a-uuid' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_assigned_tech_id')
  })

  it('returns only active same-shop wrenching profiles with tiers and pins the current user', async () => {
    const [alphabeticalFirst] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000010',
        role: 'advisor',
        skillTier: 1,
        shopId,
        fullName: 'Aaron Wrench',
      })
      .returning()
    await currentDb.insert(profiles).values([
      {
        userId: '00000000-0000-0000-0000-000000000011',
        role: 'parts',
        skillTier: null,
        shopId,
        fullName: 'No Tier',
      },
      {
        userId: '00000000-0000-0000-0000-000000000012',
        role: 'tech',
        skillTier: 3,
        shopId,
        fullName: 'Pending Tech',
        membershipStatus: 'pending',
        membershipActivatedAt: null,
      },
      {
        userId: '00000000-0000-0000-0000-000000000013',
        role: 'owner',
        skillTier: 3,
        shopId,
        fullName: 'Deactivated Owner',
        deactivatedAt: new Date(),
      },
    ])

    const result = await getShopTeam({
      db: currentDb,
      shopId,
      currentUserId: ownerProfileId,
    })

    expect(result.members).toMatchObject([
      { id: ownerProfileId, name: 'Owner', skillTier: 3, isCurrentUser: true },
      { id: alphabeticalFirst.id, name: 'Aaron Wrench', skillTier: 1, isCurrentUser: false },
      { id: teammateProfileId, name: 'Teammate', skillTier: 2, isCurrentUser: false },
    ])
    expect(result.members.map((member) => member.name)).not.toEqual(
      expect.arrayContaining(['No Tier', 'Pending Tech', 'Deactivated Owner', 'Excluded']),
    )
  })

  it('counts assigned open ticket jobs plus ticketless legacy sessions without double-counting linked sessions', async () => {
    const intake = {
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'Noise',
    }
    const treeState = { nodes: [], currentNodeId: '', message: '' }
    const [linkedSession, legacySession] = await currentDb
      .insert(sessions)
      .values([
        { shopId, techId: teammateProfileId, status: 'open', intake, treeState },
        { shopId, techId: teammateProfileId, status: 'open', intake, treeState },
      ])
      .returning()
    await currentDb.insert(sessions).values({
      shopId,
      techId: teammateProfileId,
      status: 'closed',
      intake,
      treeState,
    })
    const [ticket] = await currentDb
      .insert(tickets)
      .values({
        shopId,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Noise',
        createdByProfileId: ownerProfileId,
      })
      .returning()
    await currentDb.insert(ticketJobs).values([
      {
        shopId,
        ticketId: ticket.id,
        title: 'Diagnose noise',
        kind: 'diagnostic',
        requiredSkillTier: 3,
        assignedTechId: teammateProfileId,
        sessionId: linkedSession.id,
        workStatus: 'open',
      },
      {
        shopId,
        ticketId: ticket.id,
        title: 'Inspect belt',
        kind: 'maintenance',
        requiredSkillTier: 1,
        assignedTechId: teammateProfileId,
        workStatus: 'open',
      },
      {
        shopId,
        ticketId: ticket.id,
        title: 'Finished inspection',
        kind: 'maintenance',
        requiredSkillTier: 1,
        assignedTechId: teammateProfileId,
        workStatus: 'done',
      },
    ])

    const result = await getShopTeam({
      db: currentDb,
      shopId,
      currentUserId: ownerProfileId,
    })

    expect(legacySession.id).not.toBe(linkedSession.id)
    expect(result.members.find((member) => member.id === teammateProfileId)?.workload).toEqual({
      open: 3,
      today: 3,
    })
  })

  it('degrades all workload badges when the legacy-session workload query fails', async () => {
    const original = currentDb.select.bind(currentDb)
    let callCount = 0
    const spy = vi
      .spyOn(currentDb, 'select')
      .mockImplementation(((...args: Parameters<typeof original>) => {
        callCount += 1
        if (callCount === 3) {
          throw new Error('simulated legacy workload failure')
        }
        return original(...args)
      }) as typeof currentDb.select)

    const result = await getShopTeam({
      db: currentDb,
      shopId,
      currentUserId: ownerProfileId,
    })

    expect(result.workloadFailed).toBe(true)
    expect(result.members.every((member) => member.workload === undefined)).toBe(true)
    spy.mockRestore()
  })
})

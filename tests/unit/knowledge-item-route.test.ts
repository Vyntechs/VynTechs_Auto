import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, shops, knowledgeItems } from '@/lib/db/schema'

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

async function mockUser(userId: string | null) {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email: 'u@test' } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

function makeReq(method: string, path: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('/api/knowledge/[id]', () => {
  let close: () => Promise<void>
  let shopId: string
  let ownerProfileId: string
  const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001'
  const TECH_USER_ID = '00000000-0000-0000-0000-000000000002'

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    const [ownerProfile] = await currentDb.insert(profiles)
      .values({ userId: OWNER_USER_ID, role: 'owner', shopId, fullName: 'Owner' })
      .returning()
    ownerProfileId = ownerProfile.id
    await currentDb.insert(profiles)
      .values({ userId: TECH_USER_ID, role: 'tech', shopId, fullName: 'Tech' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('GET returns the item', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: ownerProfileId,
    }).returning()
    const { GET } = await import('@/app/api/knowledge/[id]/route')
    const res = await GET(
      makeReq('GET', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { item: { title: string } }
    expect(json.item.title).toBe('T')
  })

  it('GET returns 404 for missing item', async () => {
    await mockUser(OWNER_USER_ID)
    const id = crypto.randomUUID()
    const { GET } = await import('@/app/api/knowledge/[id]/route')
    const res = await GET(
      makeReq('GET', `/api/knowledge/${id}`),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(404)
  })

  it('GET returns 400 for malformed id', async () => {
    await mockUser(OWNER_USER_ID)
    const { GET } = await import('@/app/api/knowledge/[id]/route')
    const res = await GET(
      makeReq('GET', '/api/knowledge/not-a-uuid'),
      { params: Promise.resolve({ id: 'not-a-uuid' }) },
    )
    expect(res.status).toBe(400)
  })

  it('PATCH updates the item', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'old', body: 'old', createdByUserId: ownerProfileId,
    }).returning()
    const { PATCH } = await import('@/app/api/knowledge/[id]/route')
    const res = await PATCH(
      makeReq('PATCH', `/api/knowledge/${item.id}`, {
        type: 'note', title: 'new', body: 'new',
      }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const [updated] = await currentDb
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(updated.title).toBe('new')
    expect(updated.body).toBe('new')
  })

  it('PATCH rejects invalid body with 422', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: ownerProfileId,
    }).returning()
    const { PATCH } = await import('@/app/api/knowledge/[id]/route')
    const res = await PATCH(
      makeReq('PATCH', `/api/knowledge/${item.id}`, { type: 'bogus' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(422)
  })

  it('PATCH 404s when item not found', async () => {
    await mockUser(OWNER_USER_ID)
    const id = crypto.randomUUID()
    const { PATCH } = await import('@/app/api/knowledge/[id]/route')
    const res = await PATCH(
      makeReq('PATCH', `/api/knowledge/${id}`, { type: 'note', title: 'X', body: 'y' }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(404)
  })

  it('DELETE soft-retires the item', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: ownerProfileId,
    }).returning()
    const { DELETE } = await import('@/app/api/knowledge/[id]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(204)
    const [row] = await currentDb
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(true)
    expect(row.retiredAt).toBeTruthy()
  })

  it('DELETE 404s when item not found', async () => {
    await mockUser(OWNER_USER_ID)
    const id = crypto.randomUUID()
    const { DELETE } = await import('@/app/api/knowledge/[id]/route')
    const res = await DELETE(
      makeReq('DELETE', `/api/knowledge/${id}`),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(404)
  })

  it('PATCH and DELETE return 403 for tech role; GET is tech-readable (PR 6)', async () => {
    await mockUser(TECH_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'shop note', body: 'b', createdByUserId: ownerProfileId,
    }).returning()
    const { GET, PATCH, DELETE } = await import('@/app/api/knowledge/[id]/route')

    const getRes = await GET(
      makeReq('GET', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(getRes.status).toBe(200)
    const getJson = (await getRes.json()) as { item: { title: string } }
    expect(getJson.item.title).toBe('shop note')

    const patchRes = await PATCH(
      makeReq('PATCH', `/api/knowledge/${item.id}`, { type: 'note', title: 'x', body: 'y' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(patchRes.status).toBe(403)

    const delRes = await DELETE(
      makeReq('DELETE', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(delRes.status).toBe(403)
  })

  it('GET returns 401 when unauthenticated (no user)', async () => {
    await mockUser(null)
    const id = crypto.randomUUID()
    const { GET } = await import('@/app/api/knowledge/[id]/route')
    const res = await GET(
      makeReq('GET', `/api/knowledge/${id}`),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(401)
  })

  it('GET returns 404 for cross-shop access (not 403 — avoids leaking existence)', async () => {
    // Set up a separate shop with its own item and tech.
    const [otherShop] = await currentDb.insert(shops).values({ name: 'OtherShop' }).returning()
    const OTHER_USER_ID = '00000000-0000-0000-0000-000000000003'
    const [otherProfile] = await currentDb
      .insert(profiles)
      .values({
        userId: OTHER_USER_ID,
        role: 'tech',
        shopId: otherShop.id,
        fullName: 'Other Tech',
      })
      .returning()
    const [otherItem] = await currentDb.insert(knowledgeItems).values({
      shopId: otherShop.id,
      type: 'note',
      title: 'other-shop secret',
      body: 'do not leak',
      createdByUserId: otherProfile.id,
    }).returning()

    // Tech in OUR shop tries to fetch the other shop's item.
    await mockUser(TECH_USER_ID)
    const { GET } = await import('@/app/api/knowledge/[id]/route')
    const res = await GET(
      makeReq('GET', `/api/knowledge/${otherItem.id}`),
      { params: Promise.resolve({ id: otherItem.id }) },
    )
    expect(res.status).toBe(404)
  })

  it('GET returns retired items (citations are historical records)', async () => {
    await mockUser(TECH_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId,
      type: 'bulletin',
      title: 'TSB 17-4012 — superseded',
      body: 'old bulletin',
      createdByUserId: ownerProfileId,
      retired: true,
      retiredAt: new Date('2025-12-06T10:00:00Z'),
    }).returning()
    const { GET } = await import('@/app/api/knowledge/[id]/route')
    const res = await GET(
      makeReq('GET', `/api/knowledge/${item.id}`),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { item: { retired: boolean; title: string } }
    expect(json.item.retired).toBe(true)
    expect(json.item.title).toBe('TSB 17-4012 — superseded')
  })
})

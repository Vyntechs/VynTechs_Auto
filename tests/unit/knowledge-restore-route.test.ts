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

describe('POST /api/knowledge/[id]/restore', () => {
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

  it('restores an item retired within the 24h window', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      retiredByUserId: ownerProfileId, createdByUserId: ownerProfileId,
    }).returning()
    const { POST } = await import('@/app/api/knowledge/[id]/restore/route')
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${item.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(200)
    const [row] = await currentDb
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(false)
  })

  it('returns 409 when 24h window has passed', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      retiredByUserId: ownerProfileId, createdByUserId: ownerProfileId,
    }).returning()
    const { POST } = await import('@/app/api/knowledge/[id]/restore/route')
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${item.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(409)
  })

  it('returns 409 when item is not retired', async () => {
    await mockUser(OWNER_USER_ID)
    const [item] = await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: ownerProfileId,
    }).returning()
    const { POST } = await import('@/app/api/knowledge/[id]/restore/route')
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${item.id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: item.id }) },
    )
    expect(res.status).toBe(409)
  })

  it('returns 404 when item not found', async () => {
    await mockUser(OWNER_USER_ID)
    const id = crypto.randomUUID()
    const { POST } = await import('@/app/api/knowledge/[id]/restore/route')
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 for tech role', async () => {
    await mockUser(TECH_USER_ID)
    const id = crypto.randomUUID()
    const { POST } = await import('@/app/api/knowledge/[id]/restore/route')
    const res = await POST(
      new Request(`http://localhost/api/knowledge/${id}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id }) },
    )
    expect(res.status).toBe(403)
  })
})

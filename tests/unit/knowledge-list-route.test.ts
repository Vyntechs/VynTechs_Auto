import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('GET /api/knowledge', () => {
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

  it('returns this shop\'s items as JSON', async () => {
    await mockUser(OWNER_USER_ID)
    await currentDb.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: ownerProfileId,
    })
    const { GET } = await import('@/app/api/knowledge/route')
    const res = await GET(new Request('http://localhost/api/knowledge'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: Array<{ title: string }> }
    expect(json.items).toHaveLength(1)
    expect(json.items[0].title).toBe('T')
  })

  it('parses filter query params (type)', async () => {
    await mockUser(OWNER_USER_ID)
    await currentDb.insert(knowledgeItems).values([
      { shopId, type: 'note', title: 'A', body: 'a', createdByUserId: ownerProfileId },
      {
        shopId, type: 'cause_fix', title: 'B',
        structuredData: { cause: 'x', correction: 'y' },
        createdByUserId: ownerProfileId,
      },
    ])
    const { GET } = await import('@/app/api/knowledge/route')
    const res = await GET(new Request('http://localhost/api/knowledge?type=cause_fix'))
    const json = (await res.json()) as { items: Array<{ title: string }> }
    expect(json.items).toHaveLength(1)
    expect(json.items[0].title).toBe('B')
  })

  it('returns 403 for tech role', async () => {
    await mockUser(TECH_USER_ID)
    const { GET } = await import('@/app/api/knowledge/route')
    const res = await GET(new Request('http://localhost/api/knowledge'))
    expect(res.status).toBe(403)
  })

  it('returns 401 for unauthenticated requests', async () => {
    await mockUser(null)
    const { GET } = await import('@/app/api/knowledge/route')
    const res = await GET(new Request('http://localhost/api/knowledge'))
    expect(res.status).toBe(401)
  })

  it('returns 422 for invalid filter values', async () => {
    await mockUser(OWNER_USER_ID)
    const { GET } = await import('@/app/api/knowledge/route')
    const res = await GET(new Request('http://localhost/api/knowledge?type=bogus'))
    expect(res.status).toBe(422)
  })
})

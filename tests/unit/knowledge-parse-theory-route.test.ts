import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, shops } from '@/lib/db/schema'

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

vi.mock('@/lib/knowledge/parse-theory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/knowledge/parse-theory')>(
    '@/lib/knowledge/parse-theory',
  )
  return {
    ...actual,
    parseTheory: vi.fn(async ({ rawText }: { rawText: string }) => {
      if (!rawText.trim()) {
        return { status: 'failed' as const, draft: { sections: [] }, sourceSpans: {} }
      }
      return {
        status: 'parsed' as const,
        draft: { sections: [{ heading: 'Description', body: rawText.trim() }] },
        sourceSpans: {},
      }
    }),
  }
})

async function mockUser(userId: string | null) {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email: 'x@y.test' } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER = '00000000-0000-0000-0000-000000000001'
const TECH = '00000000-0000-0000-0000-000000000002'

describe('POST /api/knowledge/parse-theory', () => {
  let close: () => Promise<void>

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    await currentDb.insert(profiles).values({ userId: OWNER, role: 'owner', shopId: shop.id, fullName: 'O' })
    await currentDb.insert(profiles).values({ userId: TECH, role: 'tech', shopId: shop.id, fullName: 'T' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 unauthed', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'X' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user', async () => {
    await mockUser(TECH)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'X' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 422 when rawText is missing', async () => {
    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns 200 with parser result on success', async () => {
    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'Some theory text about the charging system', titleHint: 'Charging' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; draft: { sections: unknown[] } }
    expect(json.status).toBe('parsed')
    expect(json.draft.sections).toHaveLength(1)
  })

  it('returns 502 when parser throws', async () => {
    const { parseTheory } = await import('@/lib/knowledge/parse-theory')
    vi.mocked(parseTheory).mockRejectedValueOnce(new Error('haiku down'))

    await mockUser(OWNER)
    const { POST } = await import('@/app/api/knowledge/parse-theory/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/parse-theory', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'X' }),
      }),
    )
    expect(res.status).toBe(502)
  })
})

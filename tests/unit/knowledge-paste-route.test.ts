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

vi.mock('@/lib/knowledge/classify-paste', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/knowledge/classify-paste')>(
      '@/lib/knowledge/classify-paste',
    )
  return {
    ...actual,
    classifyPaste: vi.fn(),
  }
})

async function mockUser(userId: string | null, email: string | null = 'owner@shop.test') {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

describe('POST /api/knowledge/paste', () => {
  let close: () => Promise<void>
  const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001'
  const TECH_USER_ID = '00000000-0000-0000-0000-000000000002'

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    await currentDb
      .insert(profiles)
      .values({ userId: OWNER_USER_ID, role: 'owner', shopId: shop.id, fullName: 'Owner' })
    await currentDb
      .insert(profiles)
      .values({ userId: TECH_USER_ID, role: 'tech', shopId: shop.id, fullName: 'Tech' })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    await mockUser(null)
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'anything' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 403 for a tech-role user (curator-only gate)', async () => {
    await mockUser(TECH_USER_ID, 'tech@shop.test')
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'anything' }),
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON body', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', { method: 'POST', body: 'not-json' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 422 when rawText is missing or empty', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: '' }),
      }),
    )
    expect(res.status).toBe(422)
  })

  it('returns the classifier proposal on a valid paste', async () => {
    await mockUser(OWNER_USER_ID)
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: {
        type: 'note',
        title: 'Quick note',
        body: 'check the ground strap',
      },
      sourceSpans: { body: 'check the ground strap' },
    })

    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'check the ground strap' }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as { status: string; draft: { type: string; title: string } }
    expect(json.status).toBe('parsed')
    expect(json.draft.type).toBe('note')
    expect(json.draft.title).toBe('Quick note')
  })

  it('passes scopeHint into the classifier when supplied', async () => {
    await mockUser(OWNER_USER_ID)
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockResolvedValue({
      status: 'parsed',
      draft: { type: 'note', title: 'x', body: 'x' },
      sourceSpans: {},
    })

    const { POST } = await import('@/app/api/knowledge/paste/route')
    await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'hello', scopeHint: '2018 F-250 6.7L' }),
      }),
    )
    expect(classifyPaste).toHaveBeenCalledWith(
      expect.objectContaining({ rawText: 'hello', scopeHint: '2018 F-250 6.7L' }),
    )
  })

  it('returns 502 when the classifier throws (LLM error)', async () => {
    await mockUser(OWNER_USER_ID)
    const { classifyPaste } = await import('@/lib/knowledge/classify-paste')
    vi.mocked(classifyPaste).mockRejectedValue(new Error('haiku down'))

    const { POST } = await import('@/app/api/knowledge/paste/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/paste', {
        method: 'POST',
        body: JSON.stringify({ rawText: 'hello' }),
      }),
    )
    expect(res.status).toBe(502)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
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

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    requireUserAndProfile: vi.fn(),
  }
})

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/shop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/shop', () => {
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb
      .insert(shops)
      .values({ name: 'Old Name' })
      .returning()
    shopId = shop.id
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  async function seedProfile(opts: {
    role: 'tech' | 'owner' | 'curator'
    email?: string
    isComp?: boolean
    shopIdOverride?: string | null
  }) {
    const [profile] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: opts.role,
        // isComp:true bypasses the Stripe paywall check; the unit test is
        // about the shop-rename gate logic, not billing.
        isComp: opts.isComp ?? true,
        shopId: opts.shopIdOverride === undefined ? shopId : opts.shopIdOverride,
        fullName: 'Test User',
      })
      .returning()

    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: opts.email ?? 'user@shop.test',
      },
      profile,
    })
    return profile
  }

  it('renames the shop when caller is owner', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: 'Young Motorsports' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [row] = await currentDb.select().from(shops).where(eq(shops.id, shopId))
    expect(row.name).toBe('Young Motorsports')
  })

  it('allows founder even when role is curator', async () => {
    const prev = process.env.FOUNDER_EMAIL
    process.env.FOUNDER_EMAIL = 'brandon@vyntechs.dev'
    try {
      await seedProfile({ role: 'curator', email: 'brandon@vyntechs.dev' })
      const { POST } = await import('@/app/api/shop/route')
      const res = await POST(makeReq({ name: 'Vyntechs HQ' }))
      expect(res.status).toBe(200)

      const [row] = await currentDb.select().from(shops).where(eq(shops.id, shopId))
      expect(row.name).toBe('Vyntechs HQ')
    } finally {
      process.env.FOUNDER_EMAIL = prev
    }
  })

  it('returns 403 when caller is tech (admin-gate, server-side)', async () => {
    await seedProfile({ role: 'tech' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: 'Hacker Co' }))
    expect(res.status).toBe(403)

    const [row] = await currentDb.select().from(shops).where(eq(shops.id, shopId))
    expect(row.name).toBe('Old Name')
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: 'Something' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on invalid JSON body', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq('not-json'))
    expect(res.status).toBe(400)
  })

  it('returns 422 when name is empty after trim', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: '   ' }))
    expect(res.status).toBe(422)
  })

  it('returns 422 when name exceeds 80 chars', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: 'x'.repeat(81) }))
    expect(res.status).toBe(422)
  })

  it('accepts unicode and special characters in name', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: 'José’s Auto & Diagnóstico #1' }))
    expect(res.status).toBe(200)
    const [row] = await currentDb.select().from(shops).where(eq(shops.id, shopId))
    expect(row.name).toBe('José’s Auto & Diagnóstico #1')
  })

  it('trims whitespace before persisting', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: '  Padded Name  ' }))
    expect(res.status).toBe(200)
    const [row] = await currentDb.select().from(shops).where(eq(shops.id, shopId))
    expect(row.name).toBe('Padded Name')
  })

  it('returns 403 when admin has no shop assigned', async () => {
    await seedProfile({ role: 'owner', shopIdOverride: null })
    const { POST } = await import('@/app/api/shop/route')
    const res = await POST(makeReq({ name: 'Will Not Save' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'no_shop' })
  })
})

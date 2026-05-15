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

const INVITER_ID = '00000000-0000-0000-0000-000000000001'
const TECH_ID = '00000000-0000-0000-0000-000000000002'
const OTHER_ADMIN_ID = '00000000-0000-0000-0000-000000000003'
const OUTSIDER_ID = '00000000-0000-0000-0000-000000000004'

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/team/role', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/team/role', () => {
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb
      .insert(shops)
      .values({ name: 'Test Shop' })
      .returning()
    shopId = shop.id

    const [otherShop] = await currentDb
      .insert(shops)
      .values({ name: 'Other Shop' })
      .returning()
    otherShopId = otherShop.id

    // Seed the outsider in another shop (used for cross-shop tests).
    await currentDb.insert(profiles).values({
      userId: OUTSIDER_ID,
      role: 'tech',
      shopId: otherShopId,
      fullName: 'Outsider',
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  async function seedInviter(role: 'tech' | 'owner' | 'curator') {
    const [profile] = await currentDb
      .insert(profiles)
      .values({
        userId: INVITER_ID,
        role,
        isComp: true,
        shopId,
        fullName: 'Inviter',
      })
      .returning()
    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: INVITER_ID, email: 'inviter@shop.test' },
      profile,
    })
    return profile
  }

  async function seedTech() {
    return currentDb.insert(profiles).values({
      userId: TECH_ID,
      role: 'tech',
      shopId,
      fullName: 'Tech',
    })
  }

  async function seedOtherAdmin() {
    return currentDb.insert(profiles).values({
      userId: OTHER_ADMIN_ID,
      role: 'owner',
      shopId,
      fullName: 'Other Admin',
    })
  }

  it('returns 401 when unauthenticated', async () => {
    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: TECH_ID, role: 'owner' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is tech', async () => {
    await seedInviter('tech')
    await seedTech()
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: TECH_ID, role: 'owner' }))
    expect(res.status).toBe(403)
  })

  it('rejects role value "curator"', async () => {
    await seedInviter('owner')
    await seedTech()
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: TECH_ID, role: 'curator' }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('invalid_role')
  })

  it('rejects a garbage role value', async () => {
    await seedInviter('owner')
    await seedTech()
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: TECH_ID, role: 'manager' }))
    expect(res.status).toBe(422)
  })

  it('returns 404 when target user does not exist', async () => {
    await seedInviter('owner')
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(
      makeReq({ userId: '00000000-0000-0000-0000-000000000999', role: 'owner' }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when target is in a different shop', async () => {
    await seedInviter('owner')
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: OUTSIDER_ID, role: 'owner' }))
    expect(res.status).toBe(403)
  })

  it('promotes a tech to admin', async () => {
    await seedInviter('owner')
    await seedTech()
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: TECH_ID, role: 'owner' }))
    expect(res.status).toBe(200)
    const [row] = await currentDb
      .select()
      .from(profiles)
      .where(eq(profiles.userId, TECH_ID))
    expect(row.role).toBe('owner')
  })

  it('demotes an admin to tech when another admin exists', async () => {
    await seedInviter('owner')
    await seedOtherAdmin()
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: OTHER_ADMIN_ID, role: 'tech' }))
    expect(res.status).toBe(200)
    const [row] = await currentDb
      .select()
      .from(profiles)
      .where(eq(profiles.userId, OTHER_ADMIN_ID))
    expect(row.role).toBe('tech')
  })

  it('blocks demoting the last active admin', async () => {
    await seedInviter('owner')
    // No other admin in this shop — the inviter is the only one.
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: INVITER_ID, role: 'tech' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('last_admin')

    // Confirm the role was NOT changed.
    const [row] = await currentDb
      .select()
      .from(profiles)
      .where(eq(profiles.userId, INVITER_ID))
    expect(row.role).toBe('owner')
  })

  it('does not count deactivated admins toward last-admin protection', async () => {
    await seedInviter('owner')
    // Other admin exists but is deactivated → still counts as last active admin.
    await currentDb.insert(profiles).values({
      userId: OTHER_ADMIN_ID,
      role: 'owner',
      shopId,
      fullName: 'Other Admin',
      deactivatedAt: new Date(),
    })
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: INVITER_ID, role: 'tech' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('last_admin')
  })

  it('returns noop on same-role write', async () => {
    await seedInviter('owner')
    await seedTech()
    const { POST } = await import('@/app/api/team/role/route')
    const res = await POST(makeReq({ userId: TECH_ID, role: 'tech' }))
    expect(res.status).toBe(200)
    expect((await res.json()).noop).toBe(true)
  })

  it('allows founder (role=curator) to act as Admin', async () => {
    const prev = process.env.FOUNDER_EMAIL
    process.env.FOUNDER_EMAIL = 'inviter@shop.test'
    try {
      await seedInviter('curator')
      await seedTech()
      const { POST } = await import('@/app/api/team/role/route')
      const res = await POST(makeReq({ userId: TECH_ID, role: 'owner' }))
      expect(res.status).toBe(200)
    } finally {
      process.env.FOUNDER_EMAIL = prev
    }
  })
})

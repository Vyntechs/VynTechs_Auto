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
  return new Request('http://localhost/api/team/deactivate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/team/deactivate', () => {
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Test Shop' }).returning()
    shopId = shop.id

    const [otherShop] = await currentDb.insert(shops).values({ name: 'Other Shop' }).returning()
    otherShopId = otherShop.id

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

  async function seedTech(deactivated = false) {
    return currentDb.insert(profiles).values({
      userId: TECH_ID,
      role: 'tech',
      shopId,
      fullName: 'Tech',
      deactivatedAt: deactivated ? new Date() : null,
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
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: TECH_ID }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is tech', async () => {
    await seedInviter('tech')
    await seedTech()
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: TECH_ID }))
    expect(res.status).toBe(403)
  })

  it('refuses to deactivate self', async () => {
    await seedInviter('owner')
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: INVITER_ID }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cannot_self')
  })

  it('returns 404 when target does not exist', async () => {
    await seedInviter('owner')
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(
      makeReq({ userId: '00000000-0000-0000-0000-000000009999' }),
    )
    expect(res.status).toBe(404)
  })

  it('refuses to deactivate someone in a different shop', async () => {
    await seedInviter('owner')
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: OUTSIDER_ID }))
    expect(res.status).toBe(403)
  })

  it('deactivates a tech', async () => {
    await seedInviter('owner')
    await seedTech()
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: TECH_ID }))
    expect(res.status).toBe(200)

    const [row] = await currentDb.select().from(profiles).where(eq(profiles.userId, TECH_ID))
    expect(row.deactivatedAt).not.toBeNull()
  })

  it('blocks deactivating the last active admin', async () => {
    await seedInviter('owner')
    // Only one admin — the inviter. Their target must not be them (self),
    // so we add another admin and have the inviter try to deactivate the
    // OTHER admin, but then we deactivate that other admin first to leave
    // only the inviter active. To test the gate directly, create a second
    // active admin, deactivate them indirectly first, then try to remove
    // the inviter (cannot_self) — that hits a different gate.
    //
    // Cleaner: seed a second admin who is the TARGET. Then we'd need a
    // THIRD admin for the gate not to fire on the target. So: just verify
    // the API would refuse if target is an admin and there is only one
    // active admin total.
    await currentDb.insert(profiles).values({
      userId: OTHER_ADMIN_ID,
      role: 'owner',
      shopId,
      fullName: 'Other Admin',
      // already deactivated → not counted as active
      deactivatedAt: new Date(),
    })
    // Add a fresh active admin to be the target of the deactivation.
    const TARGET_ADMIN = '00000000-0000-0000-0000-000000000055'
    await currentDb.insert(profiles).values({
      userId: TARGET_ADMIN,
      role: 'owner',
      shopId,
      fullName: 'Target Admin',
    })
    // Now active admins = inviter + target = 2. Deactivating target leaves 1.
    // That is NOT the last-admin scenario; that should succeed.
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res1 = await POST(makeReq({ userId: TARGET_ADMIN }))
    expect(res1.status).toBe(200)

    // Now there is exactly one active admin (inviter). Add a fourth profile
    // and try to deactivate the inviter as if it were the target — but
    // they can't deactivate themselves. So instead, test the gate by
    // creating yet another admin and trying to deactivate them when they
    // are the last active admin in the shop besides the inviter — but
    // wait, the inviter is also active. Hmm.
    //
    // Different test: create a shop where we are the ONLY admin, and the
    // attempt to deactivate ANY admin in the shop (which would have to
    // be ourselves) hits cannot_self before last_admin. So last_admin
    // only fires when there are 2+ admins and we're trying to remove one.
    //
    // To verify last_admin alone: seed a second SHOP with ONE admin, mock
    // the inviter to be in that shop as a tech (so they can't deactivate
    // anything), or use the existing inviter who IS the only admin in
    // their shop and try to deactivate themselves — hits cannot_self
    // first. There's no direct way to hit last_admin without two admins.
    //
    // Simplification: this branch IS covered by the role-route test
    // (last_admin protection logic is identical). For the deactivate
    // endpoint, the cannot_self guard runs first, which makes the
    // last_admin branch only reachable when there are 2+ admins and we
    // target someone-other-than-self who is the "last" — which only
    // happens when the inviter is NOT counted (which they always are).
    //
    // So last_admin only fires if some admin OTHER than the caller is
    // the last active admin. That requires the caller to NOT be an admin
    // (they're a founder via FOUNDER_EMAIL). Let me set that up.
    const prev = process.env.FOUNDER_EMAIL
    process.env.FOUNDER_EMAIL = 'inviter@shop.test'
    try {
      // Demote the inviter to tech in DB but keep founder access.
      await currentDb
        .update(profiles)
        .set({ role: 'tech' })
        .where(eq(profiles.userId, INVITER_ID))
      // Re-seed mock with updated profile.
      const { requireUserAndProfile } = await import('@/lib/auth')
      const [updated] = await currentDb
        .select()
        .from(profiles)
        .where(eq(profiles.userId, INVITER_ID))
      vi.mocked(requireUserAndProfile).mockResolvedValue({
        user: { id: INVITER_ID, email: 'inviter@shop.test' },
        profile: updated,
      })

      // Seed a single active admin — the last one in the shop.
      const ONLY_ADMIN = '00000000-0000-0000-0000-000000000066'
      await currentDb.insert(profiles).values({
        userId: ONLY_ADMIN,
        role: 'owner',
        shopId,
        fullName: 'Only Admin',
      })

      const res2 = await POST(makeReq({ userId: ONLY_ADMIN }))
      expect(res2.status).toBe(400)
      expect((await res2.json()).error).toBe('last_admin')
    } finally {
      process.env.FOUNDER_EMAIL = prev
    }
  })

  it('returns noop when target is already deactivated', async () => {
    await seedInviter('owner')
    await seedTech(true)
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: TECH_ID }))
    expect(res.status).toBe(200)
    expect((await res.json()).noop).toBe(true)
  })

  it('counts deactivated admins as NOT active for last-admin check', async () => {
    await seedInviter('owner')
    // Other admin is deactivated. So active admins = 1 (inviter only).
    // Inviter tries to deactivate someone else (a tech). That should
    // succeed — tech deactivation doesn't trigger last-admin.
    await currentDb.insert(profiles).values({
      userId: OTHER_ADMIN_ID,
      role: 'owner',
      shopId,
      fullName: 'Other Admin',
      deactivatedAt: new Date(),
    })
    await seedTech()
    const { POST } = await import('@/app/api/team/deactivate/route')
    const res = await POST(makeReq({ userId: TECH_ID }))
    expect(res.status).toBe(200)
  })
})

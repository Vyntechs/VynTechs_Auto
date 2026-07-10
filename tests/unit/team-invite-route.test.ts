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

const inviteUserByEmail = vi.fn()
vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        inviteUserByEmail: (...args: unknown[]) => inviteUserByEmail(...args),
      },
    },
  },
}))

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/team/invite', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/team/invite', () => {
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb
      .insert(shops)
      .values({ name: 'Test Shop' })
      .returning()
    shopId = shop.id

    inviteUserByEmail.mockReset()
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  async function seedProfile(opts: {
    role: 'tech' | 'owner' | 'curator'
    isComp?: boolean
    shopIdOverride?: string | null
    email?: string
  }) {
    const [profile] = await currentDb
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: opts.role,
        isComp: opts.isComp ?? true,
        shopId: opts.shopIdOverride === undefined ? shopId : opts.shopIdOverride,
        fullName: 'Inviter',
      })
      .returning()

    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: {
        id: '00000000-0000-0000-0000-000000000001',
        email: opts.email ?? 'inviter@shop.test',
      },
      profile,
    })
    return profile
  }

  it('returns 401 when unauthenticated', async () => {
    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'tech@test.com' }) as never)
    expect(res.status).toBe(401)
  })

  it('returns 403 when caller is tech', async () => {
    await seedProfile({ role: 'tech' })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'tech@test.com' }) as never)
    expect(res.status).toBe(403)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('returns 422 on invalid email', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'not-an-email' }) as never)
    expect(res.status).toBe(422)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq('not-json') as never)
    expect(res.status).toBe(400)
  })

  it('invites new user and pre-creates a profile in inviter shop', async () => {
    await seedProfile({ role: 'owner' })
    const NEW_USER_ID = '00000000-0000-0000-0000-000000000099'
    inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: NEW_USER_ID, email: 'tech@test.com' } },
      error: null,
    })

    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'tech@test.com' }) as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, invitedEmail: 'tech@test.com' })

    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'tech@test.com',
      expect.objectContaining({ redirectTo: expect.stringContaining('/reset-password') }),
    )

    const [newProfile] = await currentDb
      .select()
      .from(profiles)
      .where(eq(profiles.userId, NEW_USER_ID))
    expect(newProfile.role).toBe('tech')
    expect(newProfile.shopId).toBe(shopId)
    expect(newProfile.deactivatedAt).toBeNull()
    expect((newProfile as unknown as Record<string, unknown>).membershipStatus).toBe('pending')
    expect((newProfile as unknown as Record<string, unknown>).membershipActivatedAt).toBeNull()
  })

  it('stores the selected advisor role and nullable wrenching tier', async () => {
    await seedProfile({ role: 'owner' })
    const NEW_USER_ID = '00000000-0000-0000-0000-000000000097'
    inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: NEW_USER_ID, email: 'advisor@test.com' } },
      error: null,
    })

    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(
      makeReq({ email: 'advisor@test.com', role: 'advisor', skillTier: null }) as never,
    )
    expect(res.status).toBe(200)

    const [newProfile] = await currentDb
      .select()
      .from(profiles)
      .where(eq(profiles.userId, NEW_USER_ID))
    expect(newProfile.role).toBe('advisor')
    expect(newProfile.skillTier).toBeNull()
  })

  it('rejects unsupported roles before sending an invite', async () => {
    await seedProfile({ role: 'owner' })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(
      makeReq({ email: 'manager@test.com', role: 'manager', skillTier: 2 }) as never,
    )
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('invalid_role')
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('lowercases and trims the email before invite + storage', async () => {
    await seedProfile({ role: 'owner' })
    inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: '00000000-0000-0000-0000-000000000098', email: 'tech@test.com' } },
      error: null,
    })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: '  Tech@Test.COM  ' }) as never)
    expect(res.status).toBe(200)
    expect(inviteUserByEmail).toHaveBeenCalledWith(
      'tech@test.com',
      expect.any(Object),
    )
  })

  it('returns 409 already_in_shop when invitee profile is already in this shop', async () => {
    await seedProfile({ role: 'owner' })
    const EXISTING_USER = '00000000-0000-0000-0000-000000000077'
    await currentDb.insert(profiles).values({
      userId: EXISTING_USER,
      role: 'tech',
      shopId,
      fullName: 'Already Here',
    })
    inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: EXISTING_USER, email: 'tech@test.com' } },
      error: null,
    })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'tech@test.com' }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_in_shop')
  })

  it('returns 409 already_in_other_shop when invitee profile is in different shop', async () => {
    await seedProfile({ role: 'owner' })
    const OTHER_USER = '00000000-0000-0000-0000-000000000088'
    const [otherShop] = await currentDb
      .insert(shops)
      .values({ name: 'Other Shop' })
      .returning()
    await currentDb.insert(profiles).values({
      userId: OTHER_USER,
      role: 'owner',
      shopId: otherShop.id,
      fullName: 'Other Admin',
    })
    inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: OTHER_USER, email: 'admin@elsewhere.com' } },
      error: null,
    })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'admin@elsewhere.com' }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_in_other_shop')
  })

  it('returns 409 already_user when Supabase says user already exists', async () => {
    await seedProfile({ role: 'owner' })
    inviteUserByEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'User already registered' },
    })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'tech@test.com' }) as never)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('already_user')
  })

  it('returns 502 invite_failed on generic Supabase error', async () => {
    await seedProfile({ role: 'owner' })
    inviteUserByEmail.mockResolvedValueOnce({
      data: null,
      error: { message: 'SMTP exploded' },
    })
    const { POST } = await import('@/app/api/team/invite/route')
    const res = await POST(makeReq({ email: 'tech@test.com' }) as never)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('invite_failed')
  })
})

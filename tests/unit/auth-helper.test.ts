import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { requireUserAndProfile } from '@/lib/auth'
import { profiles, shops, stripeCustomers } from '@/lib/db/schema'

type FakeSupabase = {
  auth: { getUser: () => Promise<{ data: { user: { id: string; email: string } | null } }> }
}

function fakeSupabase(user: { id: string; email: string } | null): FakeSupabase {
  return {
    auth: { getUser: async () => ({ data: { user } }) },
  }
}

describe('requireUserAndProfile', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns null when no user is authenticated', async () => {
    const result = await requireUserAndProfile({
      supabase: fakeSupabase(null) as never,
      db,
    })
    expect(result).toBeNull()
  })

  it('returns a freshly created profile when the authenticated user has none', async () => {
    const userId = crypto.randomUUID()
    const result = await requireUserAndProfile({
      supabase: fakeSupabase({ id: userId, email: 'mike@joesgarage.com' }) as never,
      db,
    })
    expect(result).not.toBeNull()
    expect(result!.profile.userId).toBe(userId)
    expect(result!.profile.role).toBe('owner')
    expect(result!.profile.shopId).not.toBeNull()
    expect(result!.user.id).toBe(userId)
  })

  it('returns the existing profile on a subsequent call without creating a duplicate', async () => {
    const userId = crypto.randomUUID()
    const supabase = fakeSupabase({ id: userId, email: 'mike@joesgarage.com' }) as never
    const first = await requireUserAndProfile({ supabase, db })
    const second = await requireUserAndProfile({ supabase, db })
    expect(second!.profile.id).toBe(first!.profile.id)
    expect(second!.profile.shopId).toBe(first!.profile.shopId)
  })

  it('activates a pending invited membership on first authenticated use', async () => {
    const userId = crypto.randomUUID()
    const [shop] = await db.insert(shops).values({ name: 'Inviting Shop' }).returning()
    await db.insert(profiles).values({
      userId,
      shopId: shop.id,
      role: 'owner',
      skillTier: 3,
      membershipStatus: 'pending',
      membershipActivatedAt: null,
    })
    const ensureCustomer = vi.fn().mockResolvedValue('cus_invited')

    const result = await requireUserAndProfile({
      supabase: fakeSupabase({ id: userId, email: 'invitee@shop.test' }) as never,
      db,
      ensureCustomer,
    })

    expect(result?.profile.membershipStatus).toBe('active')
    expect(result?.profile.membershipActivatedAt).toBeInstanceOf(Date)
    const [stored] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.userId, userId))
    expect(stored.membershipStatus).toBe('active')
    expect(stored.membershipActivatedAt).toBeInstanceOf(Date)
  })

  it('does not reactivate a pending invitation that an owner deactivated', async () => {
    const userId = crypto.randomUUID()
    const [shop] = await db.insert(shops).values({ name: 'Inviting Shop' }).returning()
    await db.insert(profiles).values({
      userId,
      shopId: shop.id,
      role: 'tech',
      membershipStatus: 'pending',
      membershipActivatedAt: null,
      deactivatedAt: new Date(),
    })

    const result = await requireUserAndProfile({
      supabase: fakeSupabase({ id: userId, email: 'revoked@shop.test' }) as never,
      db,
      ensureCustomer: vi.fn().mockResolvedValue('cus_revoked'),
    })

    expect(result?.profile.membershipStatus).toBe('pending')
    expect(result?.profile.membershipActivatedAt).toBeNull()
    expect(result?.profile.deactivatedAt).toBeInstanceOf(Date)
  })

  it('auto-creates a Stripe customer for a brand-new shop on first sign-in', async () => {
    const userId = crypto.randomUUID()
    const ensureCustomer = vi.fn().mockResolvedValue('cus_first_signin')
    const result = await requireUserAndProfile({
      supabase: fakeSupabase({ id: userId, email: 'mike@joesgarage.com' }) as never,
      db,
      ensureCustomer,
    })

    expect(result).not.toBeNull()
    expect(ensureCustomer).toHaveBeenCalledWith({
      db,
      shopId: result!.profile.shopId,
      email: 'mike@joesgarage.com',
    })
  })

  it('does not create external billing state for a complimentary profile', async () => {
    const userId = crypto.randomUUID()
    const [shop] = await db.insert(shops).values({ name: 'Complimentary QA Shop' }).returning()
    await db.insert(profiles).values({
      userId,
      shopId: shop.id,
      role: 'owner',
      membershipStatus: 'active',
      membershipActivatedAt: new Date(),
      isComp: true,
    })
    const ensureCustomer = vi.fn().mockResolvedValue('cus_should_not_exist')

    const result = await requireUserAndProfile({
      supabase: fakeSupabase({ id: userId, email: 'qa-owner@example.invalid' }) as never,
      db,
      ensureCustomer,
    })

    expect(result?.profile.isComp).toBe(true)
    expect(ensureCustomer).not.toHaveBeenCalled()
  })

  it('does not block sign-in when the Stripe customer hook fails', async () => {
    const userId = crypto.randomUUID()
    const ensureCustomer = vi.fn().mockRejectedValue(new Error('stripe is down'))
    const result = await requireUserAndProfile({
      supabase: fakeSupabase({ id: userId, email: 'mike@joesgarage.com' }) as never,
      db,
      ensureCustomer,
    })

    expect(result).not.toBeNull()
    expect(result!.profile.userId).toBe(userId)
    const rows = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, result!.profile.shopId!))
    expect(rows).toHaveLength(0)
  })
})

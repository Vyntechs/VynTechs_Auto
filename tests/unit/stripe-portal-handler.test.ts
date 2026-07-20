import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { stripeCustomers } from '@/lib/db/schema'
import { createBillingPortalSessionForUser } from '@/lib/stripe'

describe('createBillingPortalSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns 400 when the user has no profile yet', async () => {
    const result = await createBillingPortalSessionForUser({
      db,
      userId: crypto.randomUUID(),
      origin: 'https://app.vyntechs.com',
      createPortalSession: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/profile/i)
  })

  it('returns 400 when the profile has no shop', async () => {
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: null as never, role: 'owner' })
    const result = await createBillingPortalSessionForUser({
      db,
      userId,
      origin: 'https://app.vyntechs.com',
      createPortalSession: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/shop/i)
  })

  it('returns 400 when no stripe customer is associated with the shop', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id, role: 'owner' })

    const result = await createBillingPortalSessionForUser({
      db,
      userId,
      origin: 'https://app.vyntechs.com',
      createPortalSession: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/stripe customer/i)
  })

  it('opens a portal session and returns the URL on the happy path', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id, role: 'owner' })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })

    const createPortalSession = vi.fn().mockResolvedValueOnce({
      url: 'https://billing.stripe.com/session/test_xyz',
    })

    const result = await createBillingPortalSessionForUser({
      db,
      userId,
      origin: 'https://app.vyntechs.com',
      createPortalSession,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.url).toBe('https://billing.stripe.com/session/test_xyz')
    expect(createPortalSession).toHaveBeenCalledWith({
      customer: 'cus_garage',
      return_url: 'https://app.vyntechs.com/settings/billing',
    })
  })

  it.each(['tech', 'advisor', 'parts'])('rejects an active %s before minting a portal session', async (role) => {
    const shop = await createShop(db, { name: 'Authority Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id, role })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_authority',
    })
    const createPortalSession = vi.fn()

    const result = await createBillingPortalSessionForUser({
      db,
      userId,
      origin: 'https://app.vyntechs.com',
      createPortalSession,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'forbidden' })
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it('rejects a deactivated owner before minting a portal session', async () => {
    const shop = await createShop(db, { name: 'Inactive Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, {
      userId,
      shopId: shop.id,
      role: 'owner',
      deactivatedAt: new Date('2026-07-19T12:00:00Z'),
    })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_inactive',
    })
    const createPortalSession = vi.fn()

    const result = await createBillingPortalSessionForUser({
      db,
      userId,
      origin: 'https://app.vyntechs.com',
      createPortalSession,
      founderOverride: true,
    })

    expect(result).toEqual({ ok: false, status: 403, error: 'deactivated' })
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it('allows an active configured founder through an explicit override', async () => {
    const shop = await createShop(db, { name: 'Founder Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id, role: 'tech' })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_founder',
    })
    const createPortalSession = vi.fn().mockResolvedValue({
      url: 'https://billing.stripe.com/session/founder',
    })

    const result = await createBillingPortalSessionForUser({
      db,
      userId,
      origin: 'https://app.vyntechs.com',
      createPortalSession,
      founderOverride: true,
    })

    expect(result).toEqual({ ok: true, url: 'https://billing.stripe.com/session/founder' })
    expect(createPortalSession).toHaveBeenCalledTimes(1)
  })
})

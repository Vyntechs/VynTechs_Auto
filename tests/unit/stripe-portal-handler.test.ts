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
    await createProfile(db, { userId, shopId: null as never })
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
    await createProfile(db, { userId, shopId: shop.id })

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
    await createProfile(db, { userId, shopId: shop.id })
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
})

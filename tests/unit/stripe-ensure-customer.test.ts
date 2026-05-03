import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop } from '@/lib/db/queries'
import { stripeCustomers } from '@/lib/db/schema'
import { ensureStripeCustomer } from '@/lib/stripe'

describe('ensureStripeCustomer', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('creates a Stripe customer and persists the mapping on first call', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const createCustomer = vi
      .fn()
      .mockResolvedValueOnce({ id: 'cus_brand_new' })

    const customerId = await ensureStripeCustomer({
      db,
      shopId: shop.id,
      email: 'mike@joesgarage.com',
      createCustomer,
    })

    expect(customerId).toBe('cus_brand_new')
    expect(createCustomer).toHaveBeenCalledWith({
      email: 'mike@joesgarage.com',
      metadata: { shopId: shop.id },
    })
    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.stripeCustomerId).toBe('cus_brand_new')
  })

  it('returns the existing customer id without calling Stripe again', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_already_there' })

    const createCustomer = vi.fn().mockRejectedValue(new Error('should not be called'))
    const customerId = await ensureStripeCustomer({
      db,
      shopId: shop.id,
      email: 'mike@joesgarage.com',
      createCustomer,
    })

    expect(customerId).toBe('cus_already_there')
    expect(createCustomer).not.toHaveBeenCalled()
  })

  it('propagates Stripe API failures so the caller can decide how to handle', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const createCustomer = vi.fn().mockRejectedValue(new Error('stripe down'))

    await expect(
      ensureStripeCustomer({
        db,
        shopId: shop.id,
        email: 'mike@joesgarage.com',
        createCustomer,
      }),
    ).rejects.toThrow(/stripe down/)

    const rows = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(rows).toHaveLength(0)
  })
})

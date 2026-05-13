import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { stripeCustomers } from '@/lib/db/schema'
import { createCheckoutSessionForUser } from '@/lib/stripe'

describe('createCheckoutSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns 400 when the user has no profile yet', async () => {
    const result = await createCheckoutSessionForUser({
      db,
      userId: crypto.randomUUID(),
      email: 'new@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: 'price_test_monthly',
      createCheckout: vi.fn(),
      createCustomer: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/profile/i)
  })

  it('returns 400 when the profile has no shop', async () => {
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: null as never })
    const result = await createCheckoutSessionForUser({
      db,
      userId,
      email: 'noshop@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: 'price_test_monthly',
      createCheckout: vi.fn(),
      createCustomer: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/shop/i)
  })

  it('returns 500 when priceId is empty', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id })

    const result = await createCheckoutSessionForUser({
      db,
      userId,
      email: 'priced@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: '',
      createCheckout: vi.fn(),
      createCustomer: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(500)
    expect(result.error).toMatch(/price/i)
  })

  it('creates a stripe customer when none exists yet for the shop', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id })

    const createCustomer = vi.fn().mockResolvedValueOnce({ id: 'cus_new' })
    const createCheckout = vi.fn().mockResolvedValueOnce({
      id: 'cs_abc',
      url: 'https://checkout.stripe.com/c/pay/cs_abc',
    })

    const result = await createCheckoutSessionForUser({
      db,
      userId,
      email: 'fresh@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: 'price_test_monthly',
      createCustomer,
      createCheckout,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(createCustomer).toHaveBeenCalledWith({
      email: 'fresh@shop.com',
      metadata: { shopId: shop.id },
    })
    const [row] = await db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.shopId, shop.id))
    expect(row.stripeCustomerId).toBe('cus_new')
  })

  it('reuses existing stripe customer when one is already linked to the shop', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_existing' })

    const createCustomer = vi.fn()
    const createCheckout = vi.fn().mockResolvedValueOnce({
      id: 'cs_xyz',
      url: 'https://checkout.stripe.com/c/pay/cs_xyz',
    })

    const result = await createCheckoutSessionForUser({
      db,
      userId,
      email: 'returning@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: 'price_test_monthly',
      createCustomer,
      createCheckout,
    })

    expect(result.ok).toBe(true)
    expect(createCustomer).not.toHaveBeenCalled()
    expect(createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' }),
    )
  })

  it('passes correct line_items, success_url, cancel_url, and mode to Stripe', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })

    const createCheckout = vi.fn().mockResolvedValueOnce({
      id: 'cs_happy',
      url: 'https://checkout.stripe.com/c/pay/cs_happy',
    })

    const result = await createCheckoutSessionForUser({
      db,
      userId,
      email: 'happy@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: 'price_test_monthly',
      createCheckout,
      createCustomer: vi.fn(),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected success')
    expect(result.url).toBe('https://checkout.stripe.com/c/pay/cs_happy')
    expect(createCheckout).toHaveBeenCalledWith({
      customer: 'cus_garage',
      mode: 'subscription',
      line_items: [{ price: 'price_test_monthly', quantity: 1 }],
      success_url:
        'https://app.vyntechs.com/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.vyntechs.com/sign-up?canceled=true',
    })
  })

  it('returns 500 when Stripe omits the checkout url', async () => {
    const shop = await createShop(db, { name: 'Joe Garage' })
    const userId = crypto.randomUUID()
    await createProfile(db, { userId, shopId: shop.id })
    await db
      .insert(stripeCustomers)
      .values({ shopId: shop.id, stripeCustomerId: 'cus_garage' })

    const createCheckout = vi.fn().mockResolvedValueOnce({
      id: 'cs_no_url',
      url: null,
    })

    const result = await createCheckoutSessionForUser({
      db,
      userId,
      email: 'nullable@shop.com',
      origin: 'https://app.vyntechs.com',
      priceId: 'price_test_monthly',
      createCheckout,
      createCustomer: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(500)
    expect(result.error).toMatch(/url/i)
  })
})

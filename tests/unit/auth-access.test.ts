import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { profiles, stripeCustomers } from '@/lib/db/schema'
import { checkAccess, isPaywallExempt } from '@/lib/auth-access'

async function seedProfileWithShop(
  db: TestDb,
  opts: { isComp?: boolean } = {},
): Promise<{ userId: string; shopId: string }> {
  const shop = await createShop(db, { name: 'Test Garage' })
  const userId = crypto.randomUUID()
  await createProfile(db, { userId, shopId: shop.id })
  if (opts.isComp) {
    await db
      .update(profiles)
      .set({ isComp: true })
      .where(eq(profiles.userId, userId))
  }
  return { userId, shopId: shop.id }
}

describe('checkAccess', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('paywalls users with no profile at all', async () => {
    const result = await checkAccess(db, crypto.randomUUID())
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('no_subscription')
  })

  it('allows comp users even with no stripe customer at all', async () => {
    const { userId } = await seedProfileWithShop(db, { isComp: true })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('allow')
  })

  it('allows comp users even when subscription is past_due', async () => {
    const { userId, shopId } = await seedProfileWithShop(db, { isComp: true })
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_comp_pastdue',
      subscriptionStatus: 'past_due',
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('allow')
  })

  it('paywalls users with no stripe customer for their shop', async () => {
    const { userId } = await seedProfileWithShop(db)
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('no_subscription')
  })

  it('allows users with active subscription', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_active',
      subscriptionStatus: 'active',
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('allow')
  })

  it('allows users with trialing subscription', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_trial',
      subscriptionStatus: 'trialing',
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('allow')
  })

  it('allows canceled users while currentPeriodEnd is still in the future', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_canceled_grace',
      subscriptionStatus: 'canceled',
      currentPeriodEnd: sevenDaysFromNow,
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('allow')
  })

  it('paywalls canceled users after currentPeriodEnd passes', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_canceled_expired',
      subscriptionStatus: 'canceled',
      currentPeriodEnd: yesterday,
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('canceled')
  })

  it('paywalls canceled users with no currentPeriodEnd recorded', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_canceled_no_end',
      subscriptionStatus: 'canceled',
      currentPeriodEnd: null,
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('canceled')
  })

  it('paywalls past_due with reason past_due', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_pastdue',
      subscriptionStatus: 'past_due',
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('past_due')
  })

  it('paywalls unpaid with reason unpaid', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_unpaid',
      subscriptionStatus: 'unpaid',
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('unpaid')
  })

  it('paywalls incomplete-status customers as no_subscription (Stripe statuses outside our union)', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_incomplete',
      subscriptionStatus: 'incomplete',
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('no_subscription')
  })

  it('paywalls customer rows with null subscriptionStatus (mid-checkout)', async () => {
    const { userId, shopId } = await seedProfileWithShop(db)
    await db.insert(stripeCustomers).values({
      shopId,
      stripeCustomerId: 'cus_mid_checkout',
      subscriptionStatus: null,
    })
    const result = await checkAccess(db, userId)
    expect(result.kind).toBe('paywall')
    if (result.kind !== 'paywall') throw new Error('expected paywall')
    expect(result.reason).toBe('no_subscription')
  })
})

describe('isPaywallExempt', () => {
  describe('exempt — page routes', () => {
    it.each([
      '/',
      '/sign-in',
      '/sign-up',
      '/subscribe',
      '/auth/callback',
      '/auth/confirm',
      '/checkout/success',
      '/billing',
      '/whats-new',
      '/reset-password',
      '/privacy',
    ])('exempts %s', (path) => {
      expect(isPaywallExempt(path)).toBe(true)
    })
  })

  describe('exempt — API routes', () => {
    it.each([
      '/api/health',
      '/api/stripe/checkout',
      '/api/stripe/portal',
      '/api/stripe/webhook',
      '/api/cron/calibration-weekly',
      '/api/cron/comeback-prompts-daily',
      '/api/auth/anything-future',
      '/api/whats-new/unseen-count',
    ])('exempts %s', (path) => {
      expect(isPaywallExempt(path)).toBe(true)
    })
  })

  describe('gated — pages requiring active access', () => {
    it.each([
      '/today',
      '/sessions',
      '/sessions/abc-123',
      '/vehicles/abc-123',
      '/curator',
      '/curator/sessions/abc',
    ])('gates %s', (path) => {
      expect(isPaywallExempt(path)).toBe(false)
    })
  })

  describe('gated — API routes (Option B: do not blanket-exempt /api/*)', () => {
    it.each([
      '/api/sessions',
      '/api/sessions/abc/advance',
      '/api/sessions/abc/close',
      '/api/intake/search',
      '/api/intake/submit',
      '/api/intake/decode-vin',
      '/api/follow-ups/abc/resolve',
      '/api/artifacts/abc/extract',
      '/api/curator/corpus',
      '/api/curator/sessions/abc/approve',
      '/api/founder-notes',
      '/api/founder-notes/abc/promote',
      '/api/account/profile',
    ])('gates %s', (path) => {
      expect(isPaywallExempt(path)).toBe(false)
    })
  })

  it('does not allow prefix-bleed (e.g., /billingfoo)', () => {
    expect(isPaywallExempt('/billingfoo')).toBe(false)
    expect(isPaywallExempt('/sign-in-impostor')).toBe(false)
    expect(isPaywallExempt('/whats-newer')).toBe(false)
    expect(isPaywallExempt('/api/healthcheck')).toBe(false)
  })
})

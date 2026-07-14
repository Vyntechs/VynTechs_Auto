import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { profiles, shopEntitlements, stripeCustomers } from '@/lib/db/schema'
import {
  DIAGNOSTICS_DEFAULT_UNTIL_PRICED,
  hasDiagnostics,
  resolveShopEntitlements,
} from '@/lib/entitlements'
import {
  checkAccess,
  entitlementReject,
  isDiagnosticsGatedRoute,
} from '@/lib/auth-access'

async function seedPaidShop(
  db: TestDb,
  opts: { isComp?: boolean } = {},
): Promise<{ userId: string; shopId: string }> {
  const shop = await createShop(db, { name: 'Entitlement Garage' })
  const userId = crypto.randomUUID()
  await createProfile(db, { userId, shopId: shop.id })
  if (opts.isComp) {
    await db.update(profiles).set({ isComp: true }).where(eq(profiles.userId, userId))
  }
  await db.insert(stripeCustomers).values({
    shopId: shop.id,
    stripeCustomerId: `cus_${userId.slice(0, 8)}`,
    subscriptionStatus: 'active',
  })
  return { userId, shopId: shop.id }
}

describe('entitlement resolution', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('keeps the missing-row default policy-inert (true) until pricing exists', () => {
    expect(DIAGNOSTICS_DEFAULT_UNTIL_PRICED).toBe(true)
  })

  it('resolves diagnostics=true for a paid shop with no entitlement row (inert default)', async () => {
    const { shopId } = await seedPaidShop(db)
    expect(await hasDiagnostics(db, { shopId })).toBe(true)
    expect(await resolveShopEntitlements(db, { shopId })).toEqual({ diagnostics: true })
  })

  it('resolves diagnostics=false when the row explicitly says false', async () => {
    const { shopId } = await seedPaidShop(db)
    await db.insert(shopEntitlements).values({ shopId, diagnostics: false })
    expect(await hasDiagnostics(db, { shopId })).toBe(false)
  })

  it('resolves diagnostics=true when the row explicitly says true', async () => {
    const { shopId } = await seedPaidShop(db)
    await db.insert(shopEntitlements).values({ shopId, diagnostics: true })
    expect(await hasDiagnostics(db, { shopId })).toBe(true)
  })

  it('isComp implies diagnostics even over an explicit false row', async () => {
    const { shopId } = await seedPaidShop(db, { isComp: true })
    await db.insert(shopEntitlements).values({ shopId, diagnostics: false })
    expect(await hasDiagnostics(db, { shopId, isComp: true })).toBe(true)
  })

  it('fails closed for a non-comp profile without a shop', async () => {
    expect(await hasDiagnostics(db, { shopId: null })).toBe(false)
  })

  describe('checkAccess entitlements', () => {
    it('returns diagnostics=true for a paid shop with no entitlement row', async () => {
      const { userId } = await seedPaidShop(db)
      const result = await checkAccess(db, userId)
      expect(result).toEqual({ kind: 'allow', entitlements: { diagnostics: true } })
    })

    it('returns diagnostics=false for a paid shop with an explicit false row', async () => {
      const { userId, shopId } = await seedPaidShop(db)
      await db.insert(shopEntitlements).values({ shopId, diagnostics: false })
      const result = await checkAccess(db, userId)
      expect(result).toEqual({ kind: 'allow', entitlements: { diagnostics: false } })
    })

    it('returns diagnostics=true for a comp profile regardless of the row', async () => {
      const { userId, shopId } = await seedPaidShop(db, { isComp: true })
      await db.insert(shopEntitlements).values({ shopId, diagnostics: false })
      const result = await checkAccess(db, userId)
      expect(result).toEqual({ kind: 'allow', entitlements: { diagnostics: true } })
    })

    it('resolves entitlements during the canceled-within-grace allow', async () => {
      const shop = await createShop(db, { name: 'Grace Garage' })
      const userId = crypto.randomUUID()
      await createProfile(db, { userId, shopId: shop.id })
      await db.insert(stripeCustomers).values({
        shopId: shop.id,
        stripeCustomerId: 'cus_grace',
        subscriptionStatus: 'canceled',
        currentPeriodEnd: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      const result = await checkAccess(db, userId)
      expect(result).toEqual({ kind: 'allow', entitlements: { diagnostics: true } })
    })
  })

  describe('entitlementReject', () => {
    it('passes an entitled (default) paid shop', async () => {
      const { userId } = await seedPaidShop(db)
      expect(await entitlementReject(db, userId)).toBeNull()
    })

    it('rejects an unentitled paid shop with 403 error=entitlement', async () => {
      const { userId, shopId } = await seedPaidShop(db)
      await db.insert(shopEntitlements).values({ shopId, diagnostics: false })
      const rejected = await entitlementReject(db, userId)
      expect(rejected?.status).toBe(403)
      expect(await rejected?.json()).toEqual({
        error: 'entitlement',
        entitlement: 'diagnostics',
      })
    })

    it('still rejects paywalled users exactly like paywallReject', async () => {
      const shop = await createShop(db, { name: 'Unpaid Garage' })
      const userId = crypto.randomUUID()
      await createProfile(db, { userId, shopId: shop.id })
      const rejected = await entitlementReject(db, userId)
      expect(rejected?.status).toBe(403)
      expect(await rejected?.json()).toEqual({
        error: 'paywall',
        reason: 'no_subscription',
      })
    })

    it('still rejects deactivated users', async () => {
      const { userId } = await seedPaidShop(db)
      await db.update(profiles).set({ deactivatedAt: new Date() })
        .where(eq(profiles.userId, userId))
      const rejected = await entitlementReject(db, userId)
      expect(rejected?.status).toBe(403)
      expect(await rejected?.json()).toEqual({ error: 'deactivated' })
    })
  })
})

describe('isDiagnosticsGatedRoute', () => {
  it.each([
    '/sessions',
    '/sessions/abc-123',
    '/sessions/new',
    '/intake',
    '/intake/anything',
    '/api/sessions',
    '/api/sessions/abc/advance',
    '/api/intake/search',
    '/api/intake/submit',
    '/api/intake/decode-vin',
  ])('gates %s', (path) => {
    expect(isDiagnosticsGatedRoute(path)).toBe(true)
  })

  it.each([
    '/',
    '/today',
    '/tickets/abc',
    '/tickets/abc/quote',
    '/api/tickets/abc/quote',
    '/api/follow-ups/abc/resolve',
    '/curator',
    // no prefix-bleed
    '/sessionsish',
    '/intake-extra',
    '/api/sessionsish',
    '/api/intakeish',
  ])('does not gate %s', (path) => {
    expect(isDiagnosticsGatedRoute(path)).toBe(false)
  })
})

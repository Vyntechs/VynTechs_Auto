import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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
    vi.unstubAllEnvs()
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

  it('resolves every entitlement source false before database lookup when the release is off', async () => {
    const { shopId } = await seedPaidShop(db)
    await db.insert(shopEntitlements).values({ shopId, diagnostics: true })
    const select = vi.spyOn(db, 'select')
    vi.stubEnv('DIAGNOSTICS_RELEASE', 'off')

    expect(await resolveShopEntitlements(db, { shopId })).toEqual({ diagnostics: false })
    expect(await resolveShopEntitlements(db, { shopId, isComp: true })).toEqual({ diagnostics: false })
    expect(await resolveShopEntitlements(db, { shopId: null })).toEqual({ diagnostics: false })
    expect(select).not.toHaveBeenCalled()
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

    it('keeps base access but resolves diagnostics false for paid and comp profiles when release is off', async () => {
      const paid = await seedPaidShop(db)
      const comp = await seedPaidShop(db, { isComp: true })
      vi.stubEnv('DIAGNOSTICS_RELEASE', 'off')

      expect(await checkAccess(db, paid.userId)).toEqual({
        kind: 'allow',
        entitlements: { diagnostics: false },
      })
      expect(await checkAccess(db, comp.userId)).toEqual({
        kind: 'allow',
        entitlements: { diagnostics: false },
      })
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

    it('returns global not-available after base access when the release is off', async () => {
      const { userId, shopId } = await seedPaidShop(db)
      await db.insert(shopEntitlements).values({ shopId, diagnostics: true })
      vi.stubEnv('DIAGNOSTICS_RELEASE', 'off')

      const rejected = await entitlementReject(db, userId)

      expect(rejected?.status).toBe(404)
      expect(await rejected?.json()).toEqual({ error: 'not_available' })
    })
  })
})

describe('isDiagnosticsGatedRoute', () => {
  it.each([
    '/sessions',
    '/sessions/abc-123',
    '/sessions/new',
    '/api/sessions',
    '/api/sessions/abc/advance',
    '/api/intake/submit',
    '/api/artifacts',
    '/api/artifacts/abc/extract',
  ])('gates %s', (path) => {
    expect(isDiagnosticsGatedRoute(path)).toBe(true)
  })

  it.each([
    '/',
    '/today',
    '/intake',
    '/intake/anything',
    '/tickets/abc',
    '/tickets/abc/quote',
    '/api/tickets/abc/quote',
    '/api/follow-ups/abc/resolve',
    '/api/intake/search',
    '/api/intake/decode-vin',
    '/curator',
    // no prefix-bleed
    '/sessionsish',
    '/intake-extra',
    '/api/sessionsish',
    '/api/intakeish',
    '/api/intake/submit-extra',
    '/api/artifactsish',
  ])('does not gate %s', (path) => {
    expect(isDiagnosticsGatedRoute(path)).toBe(false)
  })
})

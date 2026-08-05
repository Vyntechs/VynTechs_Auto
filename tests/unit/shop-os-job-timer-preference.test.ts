import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { profiles, shops } from '@/lib/db/schema'
import {
  getJobTimerPreference,
  updateJobTimerPreference,
} from '@/lib/shop-os/job-timer-preference'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

describe('job timer preference', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    const fixture = await createTestDb()
    db = fixture.db
    close = fixture.close
  })

  afterEach(async () => {
    await close()
  })

  it('lets an active wrenching person read and change only their own preference', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Timer Shop' }).returning()
    const [tech] = await db.insert(profiles).values({
      userId: '00000000-0000-4000-8000-000000000101',
      shopId: shop.id,
      fullName: 'Taylor Tech',
      role: 'tech',
      skillTier: 2,
    }).returning()
    const actor = {
      profileId: tech.id,
      shopId: shop.id,
      role: tech.role,
      membershipStatus: tech.membershipStatus,
      isFounder: false,
    }

    expect(await getJobTimerPreference(db, { actor })).toEqual({
      ok: true,
      preference: { profileId: tech.id, enabled: false },
    })
    expect(await updateJobTimerPreference(db, { actor, enabled: true })).toEqual({
      ok: true,
      preference: { profileId: tech.id, enabled: true },
    })
    expect(await getJobTimerPreference(db, { actor })).toEqual({
      ok: true,
      preference: { profileId: tech.id, enabled: true },
    })
  })

  it('lets an active owner manage an eligible person in the same shop', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Managed Timer Shop' }).returning()
    const [owner, tech] = await db.insert(profiles).values([
      {
        userId: '00000000-0000-4000-8000-000000000201',
        shopId: shop.id,
        fullName: 'Olivia Owner',
        role: 'owner',
        skillTier: null,
      },
      {
        userId: '00000000-0000-4000-8000-000000000202',
        shopId: shop.id,
        fullName: 'Toni Tech',
        role: 'tech',
        skillTier: 1,
      },
    ]).returning()
    const actor = {
      profileId: owner.id,
      shopId: shop.id,
      role: owner.role,
      membershipStatus: owner.membershipStatus,
      isFounder: false,
    }

    expect(await updateJobTimerPreference(db, {
      actor,
      targetProfileId: tech.id,
      enabled: true,
    })).toEqual({
      ok: true,
      preference: { profileId: tech.id, enabled: true },
    })
    expect(await getJobTimerPreference(db, { actor, targetProfileId: tech.id })).toEqual({
      ok: true,
      preference: { profileId: tech.id, enabled: true },
    })
  })

  it('rejects self-service for office-only, pending, deactivated, and shopless people', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Eligibility Shop' }).returning()
    const [office, pending, deactivated, shopless] = await db.insert(profiles).values([
      {
        userId: '00000000-0000-4000-8000-000000000301',
        shopId: shop.id,
        role: 'advisor',
        skillTier: null,
      },
      {
        userId: '00000000-0000-4000-8000-000000000302',
        shopId: shop.id,
        role: 'tech',
        skillTier: 2,
        membershipStatus: 'pending',
        membershipActivatedAt: null,
      },
      {
        userId: '00000000-0000-4000-8000-000000000303',
        shopId: shop.id,
        role: 'tech',
        skillTier: 2,
        deactivatedAt: new Date('2026-08-05T00:00:00Z'),
      },
      {
        userId: '00000000-0000-4000-8000-000000000304',
        shopId: null,
        role: 'tech',
        skillTier: 2,
      },
    ]).returning()
    const actor = (profile: typeof office) => ({
      profileId: profile.id,
      shopId: profile.shopId,
      role: profile.role,
      membershipStatus: profile.membershipStatus,
      isFounder: false,
    })

    expect(await getJobTimerPreference(db, { actor: actor(office) }))
      .toEqual({ ok: false, error: 'forbidden' })
    expect(await getJobTimerPreference(db, { actor: actor(pending) }))
      .toEqual({ ok: false, error: 'membership_pending' })
    expect(await getJobTimerPreference(db, { actor: actor(deactivated) }))
      .toEqual({ ok: false, error: 'forbidden' })
    expect(await getJobTimerPreference(db, { actor: actor(shopless) }))
      .toEqual({ ok: false, error: 'no_shop' })
  })

  it('rechecks persisted authority and hides cross-shop targets', async () => {
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'Authority Shop' },
      { name: 'Other Shop' },
    ]).returning()
    const [tech, teammate, outsider] = await db.insert(profiles).values([
      {
        userId: '00000000-0000-4000-8000-000000000401',
        shopId: shop.id,
        role: 'tech',
        skillTier: 2,
      },
      {
        userId: '00000000-0000-4000-8000-000000000402',
        shopId: shop.id,
        role: 'tech',
        skillTier: 1,
      },
      {
        userId: '00000000-0000-4000-8000-000000000403',
        shopId: otherShop.id,
        role: 'tech',
        skillTier: 3,
      },
    ]).returning()
    const forgedOwner = {
      profileId: tech.id,
      shopId: shop.id,
      role: 'owner',
      membershipStatus: 'active',
      isFounder: false,
    }

    expect(await updateJobTimerPreference(db, {
      actor: forgedOwner,
      targetProfileId: teammate.id,
      enabled: true,
    })).toEqual({ ok: false, error: 'forbidden' })

    const actualOwner = await db.update(profiles)
      .set({ role: 'owner' })
      .where(eq(profiles.id, tech.id))
      .returning()
    expect(await getJobTimerPreference(db, {
      actor: { ...forgedOwner, role: actualOwner[0].role },
      targetProfileId: outsider.id,
    })).toEqual({ ok: false, error: 'not_found' })
  })

  it('lets the authenticated founder override manage an eligible same-shop person', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Founder Timer Shop' }).returning()
    const [founder, tech] = await db.insert(profiles).values([
      {
        userId: '00000000-0000-4000-8000-000000000501',
        shopId: shop.id,
        role: 'advisor',
        skillTier: null,
      },
      {
        userId: '00000000-0000-4000-8000-000000000502',
        shopId: shop.id,
        role: 'tech',
        skillTier: 3,
      },
    ]).returning()

    expect(await updateJobTimerPreference(db, {
      actor: {
        profileId: founder.id,
        shopId: shop.id,
        role: founder.role,
        membershipStatus: founder.membershipStatus,
        isFounder: true,
      },
      targetProfileId: tech.id,
      enabled: true,
    })).toEqual({
      ok: true,
      preference: { profileId: tech.id, enabled: true },
    })
  })

  it('rejects malformed target identity before querying the database', async () => {
    const [shop] = await db.insert(shops).values({ name: 'Input Shop' }).returning()
    const [owner] = await db.insert(profiles).values({
      userId: '00000000-0000-4000-8000-000000000601',
      shopId: shop.id,
      role: 'owner',
      skillTier: null,
    }).returning()
    const actor = {
      profileId: owner.id,
      shopId: shop.id,
      role: owner.role,
      membershipStatus: owner.membershipStatus,
      isFounder: false,
    }

    await expect(getJobTimerPreference(db, {
      actor,
      targetProfileId: 'not-a-profile-id',
    })).resolves.toEqual({ ok: false, error: 'invalid_input' })
  })
})

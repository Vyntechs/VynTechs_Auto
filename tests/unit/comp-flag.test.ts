import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createProfile, createShop } from '@/lib/db/queries'
import { profiles } from '@/lib/db/schema'

describe('profiles.isComp', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('defaults to false for a profile inserted without an explicit value', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const profile = await createProfile(db, {
      userId: '00000000-0000-0000-0000-000000000001',
      shopId: shop.id,
      role: 'owner',
    })

    expect(profile.isComp).toBe(false)

    const [persisted] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profile.id))
    expect(persisted.isComp).toBe(false)
  })

  it('persists and reads back is_comp = true when set explicitly', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const profile = await createProfile(db, {
      userId: '00000000-0000-0000-0000-000000000002',
      shopId: shop.id,
      role: 'owner',
      isComp: true,
    })

    expect(profile.isComp).toBe(true)

    const [persisted] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, profile.id))
    expect(persisted.isComp).toBe(true)
  })
})

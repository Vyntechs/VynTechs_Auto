import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles } from '@/lib/db/schema'

describe('Shop OS profile membership lifecycle', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('defaults directly-created profiles to active membership', async () => {
    const [profile] = await db
      .insert(profiles)
      .values({ userId: crypto.randomUUID() })
      .returning()
    expect(profile.membershipStatus).toBe('active')
    expect(profile.membershipActivatedAt).toBeInstanceOf(Date)
  })

  it('rejects membership status and activation timestamps that disagree', async () => {
    await expect(
      db.insert(profiles).values({
        userId: crypto.randomUUID(),
        membershipStatus: 'pending',
        membershipActivatedAt: new Date(),
      }),
    ).rejects.toThrow()

    await expect(
      db.insert(profiles).values({
        userId: crypto.randomUUID(),
        membershipStatus: 'active',
        membershipActivatedAt: null,
      }),
    ).rejects.toThrow()
  })
})

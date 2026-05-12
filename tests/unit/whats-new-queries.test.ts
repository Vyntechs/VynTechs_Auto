import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createProfile,
  createShop,
  listWhatsNewEntries,
  countUnseenWhatsNewForUser,
  markWhatsNewSeen,
} from '@/lib/db/queries'
import { whatsNewEntries, profiles } from '@/lib/db/schema'

describe('whats-new queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  async function seedEntries() {
    const oldest = new Date('2026-05-01T12:00:00Z')
    const middle = new Date('2026-05-05T12:00:00Z')
    const newest = new Date('2026-05-10T12:00:00Z')

    await db.insert(whatsNewEntries).values([
      { title: 'Oldest', body: 'O', publishedAt: oldest },
      { title: 'Newest', body: 'N', publishedAt: newest },
      { title: 'Middle', body: 'M', publishedAt: middle },
    ])

    return { oldest, middle, newest }
  }

  async function seedProfile(userId: string, lastSeen: Date | null = null) {
    const shop = await createShop(db, { name: 'Test Shop' })
    return createProfile(db, {
      userId,
      shopId: shop.id,
      role: 'owner',
      lastSeenWhatsNewAt: lastSeen,
    })
  }

  describe('listWhatsNewEntries', () => {
    it('returns entries sorted publishedAt DESC', async () => {
      await seedEntries()
      const entries = await listWhatsNewEntries(db)
      expect(entries.map((e) => e.title)).toEqual(['Newest', 'Middle', 'Oldest'])
    })

    it('returns empty array when no entries exist', async () => {
      const entries = await listWhatsNewEntries(db)
      expect(entries).toEqual([])
    })
  })

  describe('countUnseenWhatsNewForUser', () => {
    const userId = '00000000-0000-0000-0000-000000000111'

    it('returns total entry count when lastSeenWhatsNewAt is null', async () => {
      await seedEntries()
      await seedProfile(userId, null)
      expect(await countUnseenWhatsNewForUser(db, userId)).toBe(3)
    })

    it('returns count of entries strictly newer than lastSeen', async () => {
      const { middle } = await seedEntries()
      await seedProfile(userId, middle)
      // Strictly newer than `middle` → only "Newest"
      expect(await countUnseenWhatsNewForUser(db, userId)).toBe(1)
    })

    it('returns zero when lastSeen is after all entries', async () => {
      const { newest } = await seedEntries()
      await seedProfile(userId, new Date(newest.getTime() + 1000))
      expect(await countUnseenWhatsNewForUser(db, userId)).toBe(0)
    })

    it('returns zero when no entries exist (null lastSeen)', async () => {
      await seedProfile(userId, null)
      expect(await countUnseenWhatsNewForUser(db, userId)).toBe(0)
    })

    it('returns zero when profile does not exist', async () => {
      // Defensive: unauthed/unknown user → no badge.
      await seedEntries()
      expect(
        await countUnseenWhatsNewForUser(db, '00000000-0000-0000-0000-000000009999'),
      ).toBe(0)
    })
  })

  describe('markWhatsNewSeen', () => {
    const userId = '00000000-0000-0000-0000-000000000222'

    it('sets lastSeenWhatsNewAt to (approximately) now', async () => {
      await seedProfile(userId, null)
      const before = Date.now()
      await markWhatsNewSeen(db, userId)
      const after = Date.now()

      const [persisted] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
      expect(persisted.lastSeenWhatsNewAt).not.toBeNull()
      const ts = persisted.lastSeenWhatsNewAt!.getTime()
      expect(ts).toBeGreaterThanOrEqual(before - 1000)
      expect(ts).toBeLessThanOrEqual(after + 1000)
    })

    it('updates an existing timestamp to a later value', async () => {
      const old = new Date('2026-01-01T00:00:00Z')
      await seedProfile(userId, old)
      await markWhatsNewSeen(db, userId)

      const [persisted] = await db
        .select()
        .from(profiles)
        .where(eq(profiles.userId, userId))
      expect(persisted.lastSeenWhatsNewAt!.getTime()).toBeGreaterThan(old.getTime())
    })
  })
})

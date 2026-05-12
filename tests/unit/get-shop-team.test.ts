import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, profiles, sessions, shops, vehicles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getShopTeam } from '@/lib/intake/team'

const EMPTY_TREE = { nodes: [], currentNodeId: '', message: '' }

describe('getShopTeam', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let advisorId: string
  let aliceId: string
  let bobId: string

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id

    const [advisor] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'owner',
        shopId,
        fullName: 'Charlie Advisor',
      })
      .returning()
    advisorId = advisor.id

    const [alice] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000002',
        role: 'tech',
        shopId,
        fullName: 'Alice Tech',
      })
      .returning()
    aliceId = alice.id

    const [bob] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000003',
        role: 'tech',
        shopId,
        fullName: 'Bob Tech',
      })
      .returning()
    bobId = bob.id

    const [otherShop] = await db.insert(shops).values({ name: 'Other' }).returning()
    await db.insert(profiles).values({
      userId: '00000000-0000-0000-0000-000000000004',
      role: 'tech',
      shopId: otherShop.id,
      fullName: 'Excluded',
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('returns members scoped to the shop with the current user pinned to the top', async () => {
    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.members.map((m) => m.id)).toEqual([advisorId, aliceId, bobId])
    expect(result.members[0].isCurrentUser).toBe(true)
    expect(result.members[1].isCurrentUser).toBe(false)
    expect(result.workloadFailed).toBe(false)
  })

  it('sorts non-current-user members by fullName ASC (nulls last)', async () => {
    await db.insert(profiles).values({
      userId: '00000000-0000-0000-0000-000000000005',
      role: 'tech',
      shopId,
      fullName: null,
    })
    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.members[0].id).toBe(advisorId)
    expect(result.members[1].name).toBe('Alice Tech')
    expect(result.members[2].name).toBe('Bob Tech')
    expect(result.members[3].name).toBe('Tech')
  })

  it('returns workload counts when sessions exist', async () => {
    const [c] = await db
      .insert(customers)
      .values({ shopId, name: 'C', phone: '555-0000' })
      .returning()
    const [v] = await db
      .insert(vehicles)
      .values({ customerId: c.id, year: 2020, make: 'X', model: 'Y' })
      .returning()
    const intake = {
      vehicleYear: 2020,
      vehicleMake: 'X',
      vehicleModel: 'Y',
      customerComplaint: 'noise',
    }

    await db.insert(sessions).values([
      {
        shopId,
        techId: aliceId,
        vehicleId: v.id,
        status: 'open',
        intake,
        treeState: EMPTY_TREE,
      },
      {
        shopId,
        techId: aliceId,
        vehicleId: v.id,
        status: 'open',
        intake,
        treeState: EMPTY_TREE,
      },
    ])
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000)
    await db.insert(sessions).values({
      shopId,
      techId: bobId,
      vehicleId: v.id,
      status: 'open',
      intake,
      treeState: EMPTY_TREE,
      createdAt: yesterday,
    })

    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    const alice = result.members.find((m) => m.id === aliceId)!
    const bob = result.members.find((m) => m.id === bobId)!
    expect(alice.workload).toEqual({ open: 2, today: 2 })
    expect(bob.workload).toEqual({ open: 1, today: 0 })
  })

  it('sets workloadFailed=true and omits workload when the workload query throws', async () => {
    // The helper makes exactly two `.select` calls (roster then workload).
    // Spy on the second invocation to throw, simulating a DB error on the
    // workload-only path.
    const original = db.select.bind(db)
    let callCount = 0
    const spy = vi
      .spyOn(db, 'select')
      .mockImplementation(((...args: Parameters<typeof original>) => {
        callCount += 1
        if (callCount === 2) {
          throw new Error('simulated workload failure')
        }
        return original(...args)
      }) as typeof db.select)

    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.workloadFailed).toBe(true)
    expect(result.members.every((m) => m.workload === undefined)).toBe(true)
    spy.mockRestore()
  })

  it('returns a single-member array when only the current user is in the shop', async () => {
    await db.delete(profiles).where(eq(profiles.id, aliceId))
    await db.delete(profiles).where(eq(profiles.id, bobId))
    const result = await getShopTeam({ db, shopId, currentUserId: advisorId })
    expect(result.members).toHaveLength(1)
    expect(result.members[0].id).toBe(advisorId)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { profiles, sessions, shops, type IntakePayload, type TreeState } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import { listAllCases, listCaseFilterOptions } from '@/lib/curator/queries'

const SHOP_A = '00000000-0000-0000-0000-00000000000a'
const SHOP_B = '00000000-0000-0000-0000-00000000000b'
const USER_TECH_A = '00000000-0000-0000-0000-0000000000aa'
const USER_TECH_B = '00000000-0000-0000-0000-0000000000bb'
const TECH_A = '00000000-0000-0000-0000-000000000a01'
const TECH_B = '00000000-0000-0000-0000-000000000b01'

const EMPTY_TREE: TreeState = {
  currentNodeId: 'root',
  nodes: { root: { id: 'root', kind: 'observe', prompt: '?' } },
  history: [],
} as unknown as TreeState

function intake(make: string, model: string, complaint: string): IntakePayload {
  return {
    vehicleYear: 2020,
    vehicleMake: make,
    vehicleModel: model,
    customerComplaint: complaint,
  }
}

describe('listAllCases', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values([
      { id: SHOP_A, name: 'Alpha Garage' },
      { id: SHOP_B, name: 'Bravo Auto' },
    ])
    await db.insert(profiles).values([
      { id: TECH_A, userId: USER_TECH_A, shopId: SHOP_A, fullName: 'Alice Tech', role: 'tech' },
      { id: TECH_B, userId: USER_TECH_B, shopId: SHOP_B, fullName: 'Bob Tech', role: 'tech' },
    ])
    await db.insert(sessions).values([
      {
        id: '11111111-1111-1111-1111-111111111111',
        shopId: SHOP_A,
        techId: TECH_A,
        status: 'open',
        intake: intake('Toyota', 'Tacoma', 'misfire on cold start'),
        treeState: EMPTY_TREE,
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        shopId: SHOP_A,
        techId: TECH_A,
        status: 'closed',
        intake: intake('Ford', 'F150', 'power loss under load'),
        treeState: EMPTY_TREE,
        closedAt: new Date(),
      },
      {
        id: '33333333-3333-3333-3333-333333333333',
        shopId: SHOP_B,
        techId: TECH_B,
        status: 'open',
        intake: intake('Chevy', 'Tahoe', 'TPMS warning'),
        treeState: EMPTY_TREE,
      },
      {
        id: '44444444-4444-4444-4444-444444444444',
        shopId: SHOP_B,
        techId: TECH_B,
        status: 'deferred',
        intake: intake('Honda', 'Civic', 'rough idle when warm'),
        treeState: EMPTY_TREE,
        closedAt: new Date(),
      },
    ])
  })

  afterEach(async () => {
    await close()
  })

  it('returns all cases across all shops by default', async () => {
    const rows = await listAllCases(db)
    expect(rows).toHaveLength(4)
    const ids = rows.map((r) => r.id).sort()
    expect(ids).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
    ])
  })

  it('joins shop name and tech full name onto each row', async () => {
    const rows = await listAllCases(db, { shopId: SHOP_A })
    expect(rows.every((r) => r.shopName === 'Alpha Garage')).toBe(true)
    expect(rows.every((r) => r.techName === 'Alice Tech')).toBe(true)
  })

  it('filters by status', async () => {
    const open = await listAllCases(db, { status: 'open' })
    expect(open.map((r) => r.id).sort()).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
    ])
    const deferred = await listAllCases(db, { status: 'deferred' })
    expect(deferred).toHaveLength(1)
    expect(deferred[0].id).toBe('44444444-4444-4444-4444-444444444444')
  })

  it('filters by shop', async () => {
    const rows = await listAllCases(db, { shopId: SHOP_B })
    expect(rows.map((r) => r.id).sort()).toEqual([
      '33333333-3333-3333-3333-333333333333',
      '44444444-4444-4444-4444-444444444444',
    ])
  })

  it('filters by tech', async () => {
    const rows = await listAllCases(db, { techId: TECH_A })
    expect(rows.every((r) => r.techId === TECH_A)).toBe(true)
    expect(rows).toHaveLength(2)
  })

  it('searches case-insensitively across vehicleMake, vehicleModel, customerComplaint', async () => {
    const byMake = await listAllCases(db, { search: 'tahoe' })
    expect(byMake).toHaveLength(1)
    expect(byMake[0].id).toBe('33333333-3333-3333-3333-333333333333')

    const byComplaint = await listAllCases(db, { search: 'MISFIRE' })
    expect(byComplaint).toHaveLength(1)
    expect(byComplaint[0].id).toBe('11111111-1111-1111-1111-111111111111')

    const noMatch = await listAllCases(db, { search: 'nothing-matches' })
    expect(noMatch).toEqual([])
  })

  it('combines status + shop + search', async () => {
    const rows = await listAllCases(db, {
      status: 'open',
      shopId: SHOP_A,
      search: 'misfire',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('11111111-1111-1111-1111-111111111111')
  })

  it('honours limit', async () => {
    const rows = await listAllCases(db, { limit: 2 })
    expect(rows).toHaveLength(2)
  })

  it('orders newest first by createdAt', async () => {
    const rows = await listAllCases(db)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        rows[i].createdAt.getTime(),
      )
    }
  })
})

describe('listCaseFilterOptions', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values([
      { id: SHOP_A, name: 'Alpha Garage' },
      { id: SHOP_B, name: 'Bravo Auto' },
    ])
    await db.insert(profiles).values([
      { id: TECH_A, userId: USER_TECH_A, shopId: SHOP_A, fullName: 'Alice Tech', role: 'tech' },
      { id: TECH_B, userId: USER_TECH_B, shopId: SHOP_B, fullName: 'Bob Tech', role: 'tech' },
      {
        id: '00000000-0000-0000-0000-000000000c01',
        userId: '00000000-0000-0000-0000-0000000000cc',
        shopId: SHOP_A,
        fullName: null,
        role: 'tech',
      },
    ])
  })

  afterEach(async () => {
    await close()
  })

  it('returns shops sorted by name', async () => {
    const { shops } = await listCaseFilterOptions(db)
    expect(shops.map((s) => s.name)).toEqual(['Alpha Garage', 'Bravo Auto'])
  })

  it('returns only techs with a non-null fullName, sorted by name', async () => {
    const { techs } = await listCaseFilterOptions(db)
    expect(techs.map((t) => t.fullName)).toEqual(['Alice Tech', 'Bob Tech'])
  })

  it('includes the shopId on each tech so the page can filter techs by selected shop', async () => {
    const { techs } = await listCaseFilterOptions(db)
    const alice = techs.find((t) => t.fullName === 'Alice Tech')
    expect(alice?.shopId).toBe(SHOP_A)
  })
})

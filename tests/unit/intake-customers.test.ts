import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, shops } from '@/lib/db/schema'
import { upsertCustomer } from '@/lib/intake/customers'
import { eq } from 'drizzle-orm'

describe('upsertCustomer', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopAId: string
  let shopBId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [a] = await db.insert(shops).values({ name: 'Shop A' }).returning()
    const [b] = await db.insert(shops).values({ name: 'Shop B' }).returning()
    shopAId = a.id
    shopBId = b.id
  })

  afterEach(async () => {
    await close()
  })

  it('creates a new customer when no phone match exists', async () => {
    const result = await upsertCustomer(db, {
      shopId: shopAId,
      name: 'Maria Lopez',
      phone: '555-1234',
      email: 'maria@example.com',
    })
    expect(result.id).toBeTruthy()
    expect(result.name).toBe('Maria Lopez')
    const rows = await db.select().from(customers).where(eq(customers.id, result.id))
    expect(rows).toHaveLength(1)
  })

  it('reuses an existing customer when phone matches within the same shop', async () => {
    const first = await upsertCustomer(db, {
      shopId: shopAId,
      name: 'Maria Lopez',
      phone: '555-1234',
      email: null,
    })
    const second = await upsertCustomer(db, {
      shopId: shopAId,
      name: 'Maria L.',
      phone: '555-1234',
      email: null,
    })
    expect(second.id).toBe(first.id)
    const allRows = await db.select().from(customers)
    expect(allRows).toHaveLength(1)
  })

  it('creates separate records for the same phone in different shops (multi-tenant isolation)', async () => {
    const inA = await upsertCustomer(db, {
      shopId: shopAId,
      name: 'Maria Lopez',
      phone: '555-1234',
      email: null,
    })
    const inB = await upsertCustomer(db, {
      shopId: shopBId,
      name: 'Maria Lopez',
      phone: '555-1234',
      email: null,
    })
    expect(inA.id).not.toBe(inB.id)
    const allRows = await db.select().from(customers)
    expect(allRows).toHaveLength(2)
  })

  it('treats null and empty-string email the same (stores as null)', async () => {
    const result = await upsertCustomer(db, {
      shopId: shopAId,
      name: 'Walk-in',
      phone: '555-9999',
      email: '',
    })
    expect(result.email).toBeNull()
  })
})

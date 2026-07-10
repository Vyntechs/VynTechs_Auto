import { getTableColumns } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import {
  profiles,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createTestDb } from '@/tests/helpers/db'

const closeCallbacks: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()))
})

describe('Shop OS ticket spine source schema', () => {
  it('declares the canonical tables and additive columns', () => {
    expect(getTableColumns(shops)).toHaveProperty('nextTicketNumber')
    expect(getTableColumns(profiles)).toHaveProperty('skillTier')
    expect(getTableColumns(vehicles)).toHaveProperty('platformId')
    expect(getTableColumns(tickets)).toMatchObject({
      shopId: expect.anything(),
      ticketNumber: expect.anything(),
      source: expect.anything(),
      customerId: expect.anything(),
      vehicleId: expect.anything(),
      concern: expect.anything(),
    })
    expect(getTableColumns(ticketJobs)).toMatchObject({
      shopId: expect.anything(),
      ticketId: expect.anything(),
      requiredSkillTier: expect.anything(),
      assignedTechId: expect.anything(),
      sessionId: expect.anything(),
      diagnosticStartState: expect.anything(),
    })
  })

  it('creates an empty canonical spine through the clean source migration chain', async () => {
    const { db, close } = await createTestDb()
    closeCallbacks.push(close)

    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })
})

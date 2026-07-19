import { describe, it, expect } from 'vitest'
import { groupVehicleHistoryRows, listVehicleTicketHistory, type VehicleHistoryRow } from '@/lib/tickets'
import { createTestDb } from '@/tests/helpers/db'
import { customers, profiles, shops, tickets, vehicles } from '@/lib/db/schema'

function row(over: Partial<VehicleHistoryRow>): VehicleHistoryRow {
  return {
    ticketId: 't1',
    ticketNumber: 1,
    concern: 'noise',
    status: 'closed',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    closedAt: null,
    jobId: null,
    jobTitle: null,
    jobKind: null,
    jobApprovalState: null,
    jobWorkStatus: null,
    ...over,
  }
}

describe('groupVehicleHistoryRows', () => {
  it('groups job rows under their ticket, preserving row order', () => {
    const rows = [
      row({ ticketId: 't2', ticketNumber: 2, jobId: 'j1', jobTitle: 'Brakes', jobKind: 'repair', jobApprovalState: 'declined', jobWorkStatus: 'open' }),
      row({ ticketId: 't2', ticketNumber: 2, jobId: 'j2', jobTitle: 'Oil', jobKind: 'maintenance', jobApprovalState: 'approved', jobWorkStatus: 'done' }),
      row({ ticketId: 't1', ticketNumber: 1, jobId: 'j3', jobTitle: 'Diag', jobKind: 'diagnostic', jobApprovalState: 'approved', jobWorkStatus: 'done' }),
    ]

    const grouped = groupVehicleHistoryRows(rows)

    expect(grouped.map((t) => t.ticketNumber)).toEqual([2, 1])
    expect(grouped[0].jobs.map((j) => j.title)).toEqual(['Brakes', 'Oil'])
    expect(grouped[0].jobs[0].approvalState).toBe('declined')
    expect(grouped[1].jobs).toHaveLength(1)
  })

  it('yields a ticket with no jobs when the job columns are null', () => {
    const grouped = groupVehicleHistoryRows([row({ ticketId: 't9', ticketNumber: 9 })])

    expect(grouped).toHaveLength(1)
    expect(grouped[0].jobs).toEqual([])
  })

  it('bounds vehicle history to the 100 newest visits and reports older stored history', async () => {
    const { db, close } = await createTestDb()
    try {
      const [shop] = await db.insert(shops).values({ name: 'History Shop' }).returning()
      const [profile] = await db.insert(profiles).values({
        userId: crypto.randomUUID(), shopId: shop.id, role: 'owner', fullName: 'Owner',
      }).returning()
      const [customer] = await db.insert(customers).values({
        shopId: shop.id, name: 'History Customer', phone: '5550000000',
      }).returning()
      const [vehicle] = await db.insert(vehicles).values({
        customerId: customer.id, year: 2020, make: 'Ford', model: 'Transit',
      }).returning()
      await db.insert(tickets).values(Array.from({ length: 102 }, (_, index) => ({
        shopId: shop.id,
        ticketNumber: index + 1,
        source: 'counter' as const,
        customerId: customer.id,
        vehicleId: vehicle.id,
        concern: `Visit ${index + 1}`,
        createdByProfileId: profile.id,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      })))

      const result = await listVehicleTicketHistory(db, { shopId: shop.id, vehicleId: vehicle.id })

      expect(result.visits).toHaveLength(100)
      expect(result.visits[0].ticketNumber).toBe(102)
      expect(result.visits.at(-1)?.ticketNumber).toBe(3)
      expect(result.hasMore).toBe(true)
    } finally {
      await close()
    }
  })
})

import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { groupVehicleHistoryRows, listVehicleTicketHistory, type VehicleHistoryRow } from '@/lib/tickets'
import { createTestDb } from '@/tests/helpers/db'
import { customers, profiles, shops, ticketJobs, tickets, vehicles } from '@/lib/db/schema'

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
  it('keeps the history query bounded at the database instead of ranking every legacy job', async () => {
    const source = await readFile(resolve(process.cwd(), 'lib/tickets.ts'), 'utf8')

    expect(source).toContain('.leftJoinLateral(')
    expect(source).not.toContain('row_number() over')
  })

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

  it('loads no more than 25 jobs for a visit and uses an indexed 26-row database bound', async () => {
    const { db, client, close } = await createTestDb()
    try {
      const [shop] = await db.insert(shops).values({ name: 'Fanout Shop' }).returning()
      const [profile] = await db.insert(profiles).values({
        userId: crypto.randomUUID(), shopId: shop.id, role: 'owner', fullName: 'Owner',
      }).returning()
      const [customer] = await db.insert(customers).values({
        shopId: shop.id, name: 'Fanout Customer', phone: '5550000001',
      }).returning()
      const [vehicle] = await db.insert(vehicles).values({
        customerId: customer.id, year: 2020, make: 'Ford', model: 'Transit',
      }).returning()
      const [ticket] = await db.insert(tickets).values({
        shopId: shop.id, ticketNumber: 1, source: 'counter', customerId: customer.id,
        vehicleId: vehicle.id, concern: 'Fanout proof', createdByProfileId: profile.id,
      }).returning()
      await db.insert(ticketJobs).values(Array.from({ length: 26 }, (_, index) => ({
        shopId: shop.id, ticketId: ticket.id, title: `Job ${index + 1}`,
        kind: 'repair' as const, requiredSkillTier: 1,
        createdAt: new Date(Date.UTC(2026, 0, index + 1)),
      })))

      const result = await listVehicleTicketHistory(db, { shopId: shop.id, vehicleId: vehicle.id })

      expect(result.visits).toHaveLength(1)
      expect(result.visits[0].jobs).toHaveLength(25)
      expect(result.visits[0].jobsHasMore).toBe(true)

      // A legacy ticket may have far more jobs than today's application cap.
      // The query plan must still stop at the 26th row (25 display rows plus
      // one overflow sentinel) using the tenant+ticket newest-first index.
      await client.query(`
        insert into ticket_jobs (shop_id, ticket_id, title, kind, required_skill_tier, created_at)
        select '${shop.id}', '${ticket.id}', 'Legacy job ' || value, 'repair', 1,
          timestamp '2026-02-01' + value * interval '1 second'
        from generate_series(1, 10000) value
      `)
      await client.query('analyze ticket_jobs')
      const plan = await client.query<{ 'QUERY PLAN': string }>(`
        explain (analyze, costs off, timing off, summary off)
        select bounded.id
        from (select '${shop.id}'::uuid as shop_id, '${ticket.id}'::uuid as ticket_id) visit
        left join lateral (
          select id
          from ticket_jobs
          where shop_id = visit.shop_id and ticket_id = visit.ticket_id
          order by created_at desc, id desc
          limit 26
        ) bounded on true
      `)
      const planText = plan.rows.map((row) => row['QUERY PLAN']).join('\n')

      expect(planText).toMatch(/Index (Only )?Scan.*ticket_jobs_shop_ticket_created_idx/)
      expect(planText).toContain('actual rows=26 loops=1')
    } finally {
      await close()
    }
  })
})

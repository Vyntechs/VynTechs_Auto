import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getTableColumns, sql } from 'drizzle-orm'
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
  it('locks every live predecessor and guarded core table before data validation', async () => {
    const migration = await readFile(
      path.join(process.cwd(), 'drizzle/migrations/0026_shop_os_ticket_spine.sql'),
      'utf8',
    )
    const normalized = migration.replace(/\s+/g, ' ').toLowerCase()
    const lock = [
      'lock table shops, profiles, customers, vehicles, sessions,',
      'repair_orders, work_orders, concerns, line_items, authorizations, outbound_messages',
      'in share row exclusive mode;',
    ].join(' ')

    expect(normalized).toContain(lock)
    expect(normalized.indexOf(lock)).toBeLessThan(
      normalized.indexOf('if exists (select 1 from work_orders)'),
    )
  })

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

    const security = await db.execute<{
      relname: string
      relrowsecurity: boolean
      policies: number
    }>(sql`
      select c.relname,
             c.relrowsecurity,
             (select count(*)::int from pg_policies p where p.tablename=c.relname) as policies
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('tickets','ticket_jobs')
      order by c.relname
    `)
    expect(security.rows).toEqual([
      { relname: 'ticket_jobs', relrowsecurity: true, policies: 1 },
      { relname: 'tickets', relrowsecurity: true, policies: 1 },
    ])

    const constraints = await db.execute<{ conname: string }>(sql`
      select conname
      from pg_constraint
      where conname in (
        'tickets_shop_customer_fk',
        'tickets_customer_vehicle_fk',
        'tickets_shop_creator_fk',
        'ticket_jobs_shop_ticket_fk',
        'ticket_jobs_shop_assignee_fk',
        'ticket_jobs_shop_session_fk'
      )
      order by conname
    `)
    expect(constraints.rows.map((row) => row.conname)).toEqual([
      'ticket_jobs_shop_assignee_fk',
      'ticket_jobs_shop_session_fk',
      'ticket_jobs_shop_ticket_fk',
      'tickets_customer_vehicle_fk',
      'tickets_shop_creator_fk',
      'tickets_shop_customer_fk',
    ])

    const grants = await db.execute<{
      anon_select: boolean
      authenticated_insert: boolean
      service_select: boolean
    }>(sql`
      select has_table_privilege('anon', 'tickets', 'select') as anon_select,
             has_table_privilege('authenticated', 'ticket_jobs', 'insert') as authenticated_insert,
             has_table_privilege('service_role', 'tickets', 'select') as service_select
    `)
    expect(grants.rows[0]).toEqual({
      anon_select: false,
      authenticated_insert: false,
      service_select: true,
    })
  })
})

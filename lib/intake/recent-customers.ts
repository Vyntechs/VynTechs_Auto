import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export type RecentCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  lastVisit: Date
}

/**
 * Customers in the given shop who have had at least one session start within
 * the last N hours (default 12). Used to power the search box's "Recent · today"
 * group when the bar is focused but nothing has been typed yet.
 */
export async function getRecentIntakeCustomers(opts: {
  db: AppDb
  shopId: string
  withinHours?: number
  limit?: number
}): Promise<RecentCustomer[]> {
  const withinHours = opts.withinHours ?? 12
  const limit = opts.limit ?? 8
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000)

  const rows = await opts.db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      lastVisit: sql<Date>`MAX(${sessions.createdAt})`.as('last_visit'),
      vehicleCount: sql<number>`(SELECT COUNT(*)::int FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id})`.as(
        'vehicle_count',
      ),
    })
    .from(customers)
    .innerJoin(vehicles, eq(vehicles.customerId, customers.id))
    .innerJoin(sessions, eq(sessions.vehicleId, vehicles.id))
    .where(and(eq(customers.shopId, opts.shopId), gte(sessions.createdAt, since)))
    .groupBy(customers.id)
    .orderBy(desc(sql`MAX(${sessions.createdAt})`))
    .limit(limit)

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    vehicleCount: Number(r.vehicleCount),
    lastVisit: r.lastVisit instanceof Date ? r.lastVisit : new Date(r.lastVisit as unknown as string),
  }))
}

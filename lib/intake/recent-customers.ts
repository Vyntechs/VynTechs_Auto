import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import type { CustomerVehicle } from './search'

export type { CustomerVehicle }

export type RecentCustomer = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  vehicles: CustomerVehicle[]
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

  // Embed top-10 most-recent vehicles per recent customer.
  const customerIds = rows.map((r) => r.id)
  const vehiclesByCustomer = new Map<string, CustomerVehicle[]>()
  if (customerIds.length > 0) {
    const embeddedLastVisitExpr = sql<Date | null>`(
      SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id}
    )`
    const rankedVehicles = opts.db
      .select({
        customerId: vehicles.customerId,
        id: vehicles.id,
        year: vehicles.year,
        make: vehicles.make,
        model: vehicles.model,
        engine: vehicles.engine,
        vin: vehicles.vin,
        plate: vehicles.plate,
        mileage: vehicles.mileage,
        lastVisit: embeddedLastVisitExpr.as('embedded_last_visit'),
        rank: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${vehicles.customerId} ORDER BY COALESCE(${embeddedLastVisitExpr}, TIMESTAMP 'epoch') DESC, ${vehicles.year} DESC, ${vehicles.id})`.as('vehicle_rank'),
      })
      .from(vehicles)
      .where(inArray(vehicles.customerId, customerIds))
      .as('ranked_vehicles')
    const embeddedRows = await opts.db
      .select({
        customerId: rankedVehicles.customerId,
        id: rankedVehicles.id,
        year: rankedVehicles.year,
        make: rankedVehicles.make,
        model: rankedVehicles.model,
        engine: rankedVehicles.engine,
        vin: rankedVehicles.vin,
        plate: rankedVehicles.plate,
        mileage: rankedVehicles.mileage,
        lastVisit: rankedVehicles.lastVisit,
      })
      .from(rankedVehicles)
      .where(lte(rankedVehicles.rank, 10))
      .orderBy(rankedVehicles.customerId, rankedVehicles.rank)
    for (const row of embeddedRows) {
      const bucket = vehiclesByCustomer.get(row.customerId) ?? []
      bucket.push({
        id: row.id,
        year: row.year,
        make: row.make,
        model: row.model,
        engine: row.engine,
        vin: row.vin,
        plate: row.plate,
        mileage: row.mileage,
        lastVisit:
          row.lastVisit instanceof Date
            ? row.lastVisit
            : row.lastVisit
              ? new Date(row.lastVisit as unknown as string)
              : null,
      })
      vehiclesByCustomer.set(row.customerId, bucket)
    }
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    vehicleCount: Number(r.vehicleCount),
    vehicles: vehiclesByCustomer.get(r.id) ?? [],
    lastVisit: r.lastVisit instanceof Date ? r.lastVisit : new Date(r.lastVisit as unknown as string),
  }))
}

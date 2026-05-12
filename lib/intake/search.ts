import { and, desc, eq, ilike, like, or, sql } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export type CustomerHit = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  lastVisit: Date | null
}

export type VehicleHit = {
  id: string
  year: number | null
  make: string | null
  model: string | null
  engine: string | null
  vin: string | null
  plate: string | null
  mileage: number | null
  ownerId: string
  ownerName: string
  lastVisit: Date | null
}

export type SearchResults = {
  customers: CustomerHit[]
  vehicles: VehicleHit[]
}

const PER_GROUP_LIMIT = 5

function tokenize(q: string): string[] {
  return q.trim().split(/\s+/).filter((t) => t !== '')
}

export async function searchIntake(opts: {
  db: AppDb
  shopId: string
  q: string
}): Promise<SearchResults> {
  const tokens = tokenize(opts.q)
  if (tokens.length === 0) return { customers: [], vehicles: [] }

  // ----- Customers -----
  // Per token, require it match name OR phone OR email.
  // All tokens AND'd. Order: exact-prefix (name) > substring > most-recent visit.
  const customerConditions = tokens.map((t) =>
    or(
      ilike(customers.name, `%${t}%`),
      like(customers.phone, `%${t}%`),
      ilike(customers.email, `%${t}%`),
    ),
  )

  const firstTok = tokens[0]
  const prefixScore = sql<number>`CASE WHEN ${customers.name} ILIKE ${firstTok + '%'} THEN 0 ELSE 1 END`.as('prefix_score')
  const lastVisitExpr = sql<Date | null>`(
    SELECT MAX(${sessions.createdAt}) FROM ${sessions}
    WHERE ${sessions.vehicleId} IN (
      SELECT ${vehicles.id} FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id}
    )
  )`

  const customerRows = await opts.db
    .select({
      id: customers.id,
      name: customers.name,
      phone: customers.phone,
      email: customers.email,
      vehicleCount: sql<number>`(SELECT COUNT(*)::int FROM ${vehicles} WHERE ${vehicles.customerId} = ${customers.id})`.as(
        'vehicle_count',
      ),
      lastVisit: lastVisitExpr.as('last_visit'),
      prefixScore,
    })
    .from(customers)
    .where(and(eq(customers.shopId, opts.shopId), ...customerConditions))
    .orderBy(prefixScore, desc(sql`COALESCE(${lastVisitExpr}, TIMESTAMP 'epoch')`))
    .limit(PER_GROUP_LIMIT)

  // ----- Vehicles -----
  // Per token, match across vehicle fields OR owning customer's name.
  const vehicleConditions = tokens.map((t) =>
    or(
      sql`CAST(${vehicles.year} AS TEXT) LIKE ${`%${t}%`}`,
      ilike(vehicles.make, `%${t}%`),
      ilike(vehicles.model, `%${t}%`),
      ilike(vehicles.engine, `%${t}%`),
      ilike(vehicles.vin, `%${t}%`),
      ilike(vehicles.plate, `%${t}%`),
      ilike(customers.name, `%${t}%`),
    ),
  )

  const vehicleLastVisitExpr = sql<Date | null>`(
    SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id}
  )`

  const vehicleRows = await opts.db
    .select({
      id: vehicles.id,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      engine: vehicles.engine,
      vin: vehicles.vin,
      plate: vehicles.plate,
      mileage: vehicles.mileage,
      ownerId: customers.id,
      ownerName: customers.name,
      lastVisit: vehicleLastVisitExpr.as('last_visit'),
    })
    .from(vehicles)
    .innerJoin(customers, eq(vehicles.customerId, customers.id))
    .where(and(eq(customers.shopId, opts.shopId), ...vehicleConditions))
    .orderBy(desc(sql`COALESCE(${vehicleLastVisitExpr}, TIMESTAMP 'epoch')`))
    .limit(PER_GROUP_LIMIT)

  return {
    customers: customerRows.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      vehicleCount: Number(c.vehicleCount),
      lastVisit:
        c.lastVisit instanceof Date
          ? c.lastVisit
          : c.lastVisit
            ? new Date(c.lastVisit as unknown as string)
            : null,
    })),
    vehicles: vehicleRows.map((v) => ({
      id: v.id,
      year: v.year,
      make: v.make,
      model: v.model,
      engine: v.engine,
      vin: v.vin,
      plate: v.plate,
      mileage: v.mileage,
      ownerId: v.ownerId,
      ownerName: v.ownerName,
      lastVisit:
        v.lastVisit instanceof Date
          ? v.lastVisit
          : v.lastVisit
            ? new Date(v.lastVisit as unknown as string)
            : null,
    })),
  }
}

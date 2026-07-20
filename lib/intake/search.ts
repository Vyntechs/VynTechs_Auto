import { and, desc, eq, inArray, or, sql, type SQLWrapper } from 'drizzle-orm'
import { customers, sessions, vehicles } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import { boundedSearchTokens, literalLikeToken } from '@/lib/intake/search-limits'

export type CustomerVehicle = {
  id: string
  year: number | null
  make: string | null
  model: string | null
  engine: string | null
  vin: string | null
  plate: string | null
  mileage: number | null
  lastVisit: Date | null
}

export type CustomerHit = {
  id: string
  name: string
  phone: string | null
  email: string | null
  vehicleCount: number
  vehicles: CustomerVehicle[]
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

const containsLiteral = (column: SQLWrapper, token: string) =>
  sql<boolean>`${column} ILIKE ${`%${literalLikeToken(token)}%`} ESCAPE '!'`

const containsLiteralCaseSensitive = (column: SQLWrapper, token: string) =>
  sql<boolean>`${column} LIKE ${`%${literalLikeToken(token)}%`} ESCAPE '!'`

export async function searchIntake(opts: {
  db: AppDb
  shopId: string
  q: string
}): Promise<SearchResults> {
  const tokens = boundedSearchTokens(opts.q)
  if (tokens.length === 0) return { customers: [], vehicles: [] }

  // ----- Customers -----
  // Per token, require it match name OR phone OR email.
  // All tokens AND'd. Order: exact-prefix (name) > substring > most-recent visit.
  const customerConditions = tokens.map((t) =>
    or(
      containsLiteral(customers.name, t),
      containsLiteralCaseSensitive(customers.phone, t),
      containsLiteral(customers.email, t),
    ),
  )

  const firstTok = literalLikeToken(tokens[0])
  const prefixScore = sql<number>`CASE WHEN ${customers.name} ILIKE ${firstTok + '%'} ESCAPE '!' THEN 0 ELSE 1 END`.as('prefix_score')
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
      vehicleCount: sql<number>`(SELECT COUNT(*)::int FROM vehicles WHERE vehicles.customer_id = customers.id)`.as(
        'vehicle_count',
      ),
      lastVisit: lastVisitExpr.as('last_visit'),
      prefixScore,
    })
    .from(customers)
    .where(and(eq(customers.shopId, opts.shopId), ...customerConditions))
    .orderBy(prefixScore, desc(sql`COALESCE(${lastVisitExpr}, TIMESTAMP 'epoch')`))
    .limit(PER_GROUP_LIMIT)

  // ----- Embedded vehicles per matched customer (capped at 10 most-recent) -----
  // Batched query keyed by customer_id; bucket in JS, drop overflow past 10.
  const matchedCustomerIds = customerRows.map((c) => c.id)
  const vehiclesByCustomer = new Map<string, CustomerVehicle[]>()
  if (matchedCustomerIds.length > 0) {
    const embeddedLastVisitExpr = sql<Date | null>`(
      SELECT MAX(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.vehicleId} = ${vehicles.id}
    )`
    const embeddedRows = await opts.db
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
      })
      .from(vehicles)
      .where(inArray(vehicles.customerId, matchedCustomerIds))
      .orderBy(
        vehicles.customerId,
        desc(sql`COALESCE(${embeddedLastVisitExpr}, TIMESTAMP 'epoch')`),
        desc(vehicles.year),
        vehicles.id,
      )
    for (const row of embeddedRows) {
      const bucket = vehiclesByCustomer.get(row.customerId) ?? []
      if (bucket.length < 10) {
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
      }
      vehiclesByCustomer.set(row.customerId, bucket)
    }
  }

  // ----- Vehicles -----
  // Per token, match across vehicle fields OR owning customer's name.
  const vehicleConditions = tokens.map((t) =>
    or(
      sql<boolean>`CAST(${vehicles.year} AS TEXT) LIKE ${`%${literalLikeToken(t)}%`} ESCAPE '!'`,
      containsLiteral(vehicles.make, t),
      containsLiteral(vehicles.model, t),
      containsLiteral(vehicles.engine, t),
      containsLiteral(vehicles.vin, t),
      containsLiteral(vehicles.plate, t),
      containsLiteral(customers.name, t),
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
      vehicles: vehiclesByCustomer.get(c.id) ?? [],
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

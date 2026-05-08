import { and, desc, eq } from 'drizzle-orm'
import { vehicles, type Vehicle } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export type UpsertVehicleInput = {
  customerId: string
  year: number
  make: string
  model: string
  engine: string | null
  vin: string | null
  mileage: number | null
  plate: string | null
}

export async function upsertVehicle(db: AppDb, input: UpsertVehicleInput): Promise<Vehicle> {
  if (input.vin && input.vin.trim() !== '') {
    const [existing] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.customerId, input.customerId), eq(vehicles.vin, input.vin)))
      .limit(1)
    if (existing) return existing
  } else if (input.plate && input.plate.trim() !== '') {
    const [existing] = await db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.customerId, input.customerId),
          eq(vehicles.year, input.year),
          eq(vehicles.make, input.make),
          eq(vehicles.model, input.model),
          eq(vehicles.plate, input.plate),
        ),
      )
      .orderBy(desc(vehicles.createdAt))
      .limit(1)
    if (existing) return existing
  }

  const [created] = await db
    .insert(vehicles)
    .values({
      customerId: input.customerId,
      year: input.year,
      make: input.make,
      model: input.model,
      engine: input.engine,
      vin: input.vin,
      mileage: input.mileage,
      plate: input.plate,
    })
    .returning()

  return created
}

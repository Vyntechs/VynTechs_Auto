import { eq } from 'drizzle-orm'
import { customers, sessions, vehicles, type TreeState } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import { upsertCustomer } from './customers'
import { upsertVehicle } from './vehicles'

export type CreateSessionFromIntakeInput = {
  shopId: string
  advisorProfileId: string
  /**
   * Optional override for sessions.tech_id. When null/undefined, falls back to
   * advisorProfileId. The caller (route) is responsible for cross-shop
   * validation BEFORE calling this helper.
   */
  assignedTechId?: string | null
  customer: { name: string; phone: string; email: string | null }
  vehicle: {
    year: number
    make: string
    model: string
    engine: string | null
    vin: string | null
    mileage: number | null
    plate: string | null
  }
  complaint: {
    description: string
    whenStarted: string
    howOften: string
    authorized: string
  }
  /**
   * Optional initial tree state. When omitted, the session is created with an
   * empty tree (the diagnostic page will appear stuck on "Building..." until
   * the tree is generated). Callers integrating with the AI engine should
   * pass a populated tree from generateInitialTree(...).
   */
  treeState?: TreeState
  /**
   * Pick-existing path. When both IDs are set, the helper skips
   * upsertCustomer + upsertVehicle and uses the supplied IDs directly.
   * The caller (route handler) is responsible for cross-shop validation
   * BEFORE calling this helper — the helper trusts that the IDs belong
   * to the caller's shop.
   *
   * On the pick-existing branch, input.vehicle.mileage IS applied as an
   * update to the existing vehicle row (in the same transaction) when
   * non-null and different from the stored value. The other input.vehicle
   * fields are ignored — the existing row's year/make/model/engine drive
   * the session's intake payload.
   */
  existingCustomerId?: string
  existingVehicleId?: string
}

const EMPTY_TREE: TreeState = { nodes: [], currentNodeId: '', message: '' }

export async function createSessionFromIntake(
  db: AppDb,
  input: CreateSessionFromIntakeInput,
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx) => {
    let vehicleId: string
    let intakeVehicle: {
      year: number
      make: string
      model: string
      engine: string | null
      mileage: number | null
    }

    if (input.existingVehicleId && input.existingCustomerId) {
      // Pick-existing branch — skip upserts, apply optional mileage update.
      const [existing] = await tx
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, input.existingVehicleId))
        .limit(1)
      if (!existing) {
        // Caller pre-validated; if we hit this, the row was deleted between
        // the route's lookup and this transaction. Bubble out as an error.
        throw new Error('vehicle_not_found')
      }
      vehicleId = existing.id

      const newMileage = input.vehicle.mileage
      let appliedMileage = existing.mileage
      if (newMileage !== null && newMileage !== existing.mileage) {
        await tx
          .update(vehicles)
          .set({ mileage: newMileage, updatedAt: new Date() })
          .where(eq(vehicles.id, existing.id))
        appliedMileage = newMileage
      }

      intakeVehicle = {
        year: existing.year,
        make: existing.make,
        model: existing.model,
        engine: existing.engine,
        mileage: appliedMileage,
      }
    } else {
      const customer = await upsertCustomer(tx as AppDb, {
        shopId: input.shopId,
        name: input.customer.name,
        phone: input.customer.phone,
        email: input.customer.email,
      })

      const vehicle = await upsertVehicle(tx as AppDb, {
        customerId: customer.id,
        year: input.vehicle.year,
        make: input.vehicle.make,
        model: input.vehicle.model,
        engine: input.vehicle.engine,
        vin: input.vehicle.vin,
        mileage: input.vehicle.mileage,
        plate: input.vehicle.plate,
      })

      vehicleId = vehicle.id
      intakeVehicle = {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        engine: vehicle.engine,
        mileage: vehicle.mileage,
      }
    }

    const [session] = await tx
      .insert(sessions)
      .values({
        shopId: input.shopId,
        techId: input.assignedTechId ?? input.advisorProfileId,
        vehicleId,
        status: 'open',
        intake: {
          vehicleYear: intakeVehicle.year,
          vehicleMake: intakeVehicle.make,
          vehicleModel: intakeVehicle.model,
          vehicleEngine: intakeVehicle.engine ?? undefined,
          mileage: intakeVehicle.mileage ?? undefined,
          customerComplaint: input.complaint.description,
        },
        treeState: input.treeState ?? EMPTY_TREE,
      })
      .returning()

    return { sessionId: session.id }
  })
}

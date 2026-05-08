import { sessions, type TreeState } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import { upsertCustomer } from './customers'
import { upsertVehicle } from './vehicles'

export type CreateSessionFromIntakeInput = {
  shopId: string
  advisorProfileId: string
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
}

const EMPTY_TREE: TreeState = { nodes: [], currentNodeId: '', message: '' }

export async function createSessionFromIntake(
  db: AppDb,
  input: CreateSessionFromIntakeInput,
): Promise<{ sessionId: string }> {
  return db.transaction(async (tx) => {
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

    const [session] = await tx
      .insert(sessions)
      .values({
        shopId: input.shopId,
        techId: input.advisorProfileId,
        vehicleId: vehicle.id,
        status: 'open',
        intake: {
          vehicleYear: input.vehicle.year,
          vehicleMake: input.vehicle.make,
          vehicleModel: input.vehicle.model,
          vehicleEngine: input.vehicle.engine ?? undefined,
          mileage: input.vehicle.mileage ?? undefined,
          customerComplaint: input.complaint.description,
        },
        treeState: input.treeState ?? EMPTY_TREE,
      })
      .returning()

    return { sessionId: session.id }
  })
}

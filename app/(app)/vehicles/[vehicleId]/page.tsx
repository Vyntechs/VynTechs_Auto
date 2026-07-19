import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { customers, vehicles } from '@/lib/db/schema'
import { listVehicleTicketHistory } from '@/lib/tickets'
import { VehicleHistory } from '@/components/screens/vehicle-history'

export default async function VehicleHistoryPage({
  params,
}: {
  params: Promise<{ vehicleId: string }>
}) {
  const { vehicleId } = await params
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')
  if (!ctx.profile.shopId) notFound()
  const shopId = ctx.profile.shopId

  const [row] = await db
    .select({
      vehicle: vehicles,
      customer: customers,
    })
    .from(vehicles)
    .innerJoin(customers, eq(vehicles.customerId, customers.id))
    .where(eq(vehicles.id, vehicleId))
    .limit(1)

  if (!row || row.customer.shopId !== shopId) notFound()

  const history = await listVehicleTicketHistory(db, { shopId, vehicleId })

  return (
    <VehicleHistory
      vehicle={{
        id: row.vehicle.id,
        year: row.vehicle.year,
        make: row.vehicle.make,
        model: row.vehicle.model,
        vin: row.vehicle.vin,
        plate: row.vehicle.plate,
      }}
      customer={{ id: row.customer.id, name: row.customer.name }}
      visits={history.visits}
      hasMore={history.hasMore}
    />
  )
}

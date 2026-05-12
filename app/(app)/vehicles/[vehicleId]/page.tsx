import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listSessionsForVehicle } from '@/lib/db/queries'
import { customers, vehicles } from '@/lib/db/schema'
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

  const [row] = await db
    .select({
      vehicle: vehicles,
      customer: customers,
    })
    .from(vehicles)
    .innerJoin(customers, eq(vehicles.customerId, customers.id))
    .where(eq(vehicles.id, vehicleId))
    .limit(1)

  if (!row || row.customer.shopId !== ctx.profile.shopId) notFound()

  const sessions = await listSessionsForVehicle(db, vehicleId)

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
      sessions={sessions}
    />
  )
}

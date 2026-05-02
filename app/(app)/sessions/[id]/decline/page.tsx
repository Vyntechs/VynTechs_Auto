import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { DeclineOrDefer } from '@/components/screens/decline-or-defer'
import { formatVehicleName, formatElapsed } from '@/lib/format'

// Static demo of the Decline-or-Defer surface. Real gating wires up at Phase M.
export default async function DeclinePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const result = await getSessionForUser({ db, userId: ctx.user.id, sessionId: id })
  if (!result.ok) notFound()

  const { session } = result

  return (
    <DeclineOrDefer
      vehicleName={formatVehicleName(session.intake)}
      vehicleVin={`Session · ${session.id.slice(0, 8)}`}
      timer={formatElapsed(new Date(session.createdAt))}
      gap="Build-date-specific wire colors not found in 5 weighted queries. Forum sources conflict — splice on the wrong wire bricks the bus."
      options={[
        {
          number: 1,
          title: 'Gather more low-risk data',
          description:
            'Pull build-date-specific wiring from ProDemand and photograph it.',
        },
        {
          number: 2,
          title: 'Decline this job',
          description:
            'Customer-facing language: refer to dealer or marque specialist.',
        },
        {
          number: 3,
          title: 'Defer for curator review',
          description:
            '24–72 hr turnaround. Customer keeps the vehicle. Answer enters corpus for all future similar cases.',
          emphasized: true,
        },
      ]}
    />
  )
}

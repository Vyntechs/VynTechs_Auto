import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { DeclineOrDeferLive } from '@/components/screens/decline-or-defer-live'
import { formatVehicleName, formatElapsed } from '@/lib/format'

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
  const gate = session.treeState.gateDecision

  if (!gate || gate.allow) {
    redirect(`/sessions/${id}`)
  }

  const riskClass = gate.riskClass === 'zero' ? 'low' : gate.riskClass

  return (
    <DeclineOrDeferLive
      sessionId={session.id}
      vehicleName={formatVehicleName(session.intake)}
      vehicleVin={`Session · ${session.id.slice(0, 8)}`}
      timer={formatElapsed(new Date(session.createdAt))}
      gap={gate.gap ?? 'Confidence below threshold for proposed action.'}
      confidenceGap={gate.confidenceGap}
      whatWouldClose={gate.whatWouldClose}
      riskClass={riskClass}
      optionKeys={gate.options ?? ['gather_more_low_risk', 'decline', 'defer']}
    />
  )
}

import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { OutcomeCapture } from '@/components/screens/outcome-capture'
import { formatVehicleName, formatElapsed } from '@/lib/format'

export default async function OutcomePage({
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

  // Closed sessions: bounce back to the read-only summary on the detail page.
  // Prevents techs from re-submitting the close-case form after the case is
  // already closed (server returns 400 'session is not open' but the form
  // looks alive).
  if (session.status === 'closed') {
    redirect(`/sessions/${session.id}`)
  }

  const elapsed = formatElapsed(new Date(session.createdAt))

  return (
    <OutcomeCapture
      sessionId={session.id}
      vehicleName={formatVehicleName(session.intake)}
      vehicleMeta={`closing case · session ${session.id.slice(0, 8)}`}
      timer={elapsed}
      diagMin={Math.floor(
        (Date.now() - new Date(session.createdAt).getTime()) / 60000,
      )}
      repairMin={0}
    />
  )
}

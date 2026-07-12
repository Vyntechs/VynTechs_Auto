import { notFound, redirect } from 'next/navigation'
import { SimpleWorkWorkspace } from '@/components/screens/simple-work-workspace'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { getSimpleWorkWorkspace } from '@/lib/shop-os/simple-work'
import { parseSimpleWorkWorkspaceResponse } from '@/lib/shop-os/simple-work-ui'
import { getServerSupabase } from '@/lib/supabase-server'
import { getTicketDetail, ticketActorFromProfile } from '@/lib/tickets'

export default async function SimpleWorkPage({
  params,
}: {
  params: Promise<{ id: string; jobId: string }>
}): Promise<React.JSX.Element> {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) redirect('/sign-in')
  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')
  if (!ctx.profile.shopId) notFound()

  const { id, jobId } = await params
  const [workResult, ticketResult] = await Promise.all([
    getSimpleWorkWorkspace(db, {
      actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
      ticketId: id,
      jobId,
    }),
    getTicketDetail(db, {
      actor: ticketActorFromProfile(ctx.profile),
      ticketId: id,
    }),
  ])
  if (!workResult.ok || !ticketResult.ok) notFound()
  const initialWorkspace = parseSimpleWorkWorkspaceResponse({ workspace: workResult.workspace })
  if (!initialWorkspace) notFound()
  const { ticket } = ticketResult
  if (!ticket.customer || !ticket.vehicle) notFound()
  if (ticket.status !== 'open' && initialWorkspace.workStatus !== 'done') notFound()

  return (
    <SimpleWorkWorkspace
      ticket={{
        id: ticket.id,
        number: ticket.ticketNumber,
        customerName: ticket.customer.name,
        vehicle: `${ticket.vehicle.year} ${ticket.vehicle.make} ${ticket.vehicle.model}`,
      }}
      initialWorkspace={initialWorkspace}
    />
  )
}

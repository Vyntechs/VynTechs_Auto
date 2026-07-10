import { notFound, redirect } from 'next/navigation'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { getTicketDetail, ticketActorFromProfile } from '@/lib/tickets'

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) redirect('/sign-in')

  const { id } = await params
  const result = await getTicketDetail(db, {
    actor: ticketActorFromProfile(ctx.profile),
    ticketId: id,
  })
  if (!result.ok) notFound()

  return <TicketDetailScreen ticket={result.ticket} />
}

import { notFound, redirect } from 'next/navigation'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import styles from '@/components/screens/manual-quote-builder.module.css'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import { cannedJobActorFromProfile, listCannedJobs } from '@/lib/shop-os/canned-jobs'
import { getQuoteBuilder, quoteActorFromProfile } from '@/lib/shop-os/quotes'
import { getServerSupabase } from '@/lib/supabase-server'
import { getTicketDetail, ticketActorFromProfile } from '@/lib/tickets'

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) redirect('/sign-in')

  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')
  if (!canBuildQuotes(ctx.profile.role)) notFound()

  const { id } = await params
  const ticketResult = await getTicketDetail(db, {
    actor: ticketActorFromProfile(ctx.profile),
    ticketId: id,
  })
  if (!ticketResult.ok) notFound()

  const builderResult = await getQuoteBuilder(db, {
    actor: quoteActorFromProfile(ctx.profile),
    ticketId: id,
  })
  if (!builderResult.ok) {
    if (builderResult.error === 'conflict' && builderResult.retryable) {
      return (
        <main className={styles.screen}>
          <div className={styles.blocked}>
            <h1>Quote is busy</h1>
            <p>Another quote update is finishing. Retry to load current server truth.</p>
            <a className={styles.lineAction} href={`/tickets/${id}/quote`}>
              Retry quote
            </a>
          </div>
        </main>
      )
    }
    notFound()
  }

  let cannedResult: Awaited<ReturnType<typeof listCannedJobs>> | null = null
  try {
    cannedResult = await listCannedJobs(db, {
      actor: cannedJobActorFromProfile(ctx.profile),
    })
  } catch {
    // Canned work is an optional accelerator. Manual quoting remains available.
  }
  const cannedCatalogAvailable = cannedResult?.ok === true
    && cannedResult.taxRateBps === builderResult.builder.configuration.taxRateBps

  const quoteTicket = {
    id: ticketResult.ticket.id,
    ticketNumber: ticketResult.ticket.ticketNumber,
    customer: ticketResult.ticket.customer
      ? { name: ticketResult.ticket.customer.name }
      : null,
    vehicle: ticketResult.ticket.vehicle
      ? {
          year: ticketResult.ticket.vehicle.year,
          make: ticketResult.ticket.vehicle.make,
          model: ticketResult.ticket.vehicle.model,
        }
      : null,
  }

  return (
    <ManualQuoteBuilder
      ticket={quoteTicket}
      builder={builderResult.builder}
      cannedJobs={cannedCatalogAvailable && cannedResult?.ok ? cannedResult.cannedJobs : []}
      cannedCatalogAvailable={cannedCatalogAvailable}
    />
  )
}

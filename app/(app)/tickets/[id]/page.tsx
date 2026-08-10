import { notFound, redirect } from 'next/navigation'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { getShopTeam } from '@/lib/intake/team'
import {
  canAssignWork,
  canBuildQuotes,
  canCloseTickets,
  canManageIntegrations,
  canManageTeam,
  canPlacePartsOrders,
} from '@/lib/shop-os/capabilities'
import { getCustomerCopyBundle } from '@/lib/shop-os/customer-copy'
import { listPartRequestsForTicket } from '@/lib/shop-os/part-requests'
import { getPartsArrivalForTicket } from '@/lib/shop-os/parts-arrival'
import { isTicketCorrectionEnabled } from '@/lib/release-policy'
import { getServerSupabase } from '@/lib/supabase-server'
import { getTicketDetail, ticketActorFromProfile } from '@/lib/tickets'
import { refreshCustomerCopy } from './customer-copy-actions'

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

  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')

  const { id } = await params
  const actor = ticketActorFromProfile(ctx.profile)
  const result = await getTicketDetail(db, { actor, ticketId: id })
  if (!result.ok) notFound()

  const team = canAssignWork(ctx.profile.role) && ctx.profile.shopId
    ? (await getShopTeam({
        db,
        shopId: ctx.profile.shopId,
        currentUserId: ctx.profile.id,
      })).members
    : []

  // Getting paid is an advisor/owner surface — techs never see money. Only load
  // the ring-out state when the viewer can act on it.
  let ringOut = null
  let customerCopy = null
  if (canCloseTickets(ctx.profile.role)) {
    const customerCopyBundle = await getCustomerCopyBundle(db, { actor, ticketId: id })
    if (customerCopyBundle.ok) {
      ringOut = customerCopyBundle.ringOut
      customerCopy = customerCopyBundle.copy
    }
  }

  // The parts a tech flagged relay to whoever sources parts (parts/advisor/owner).
  const partRequests = canPlacePartsOrders(ctx.profile.role) && ctx.profile.shopId
    ? await listPartRequestsForTicket(db, { shopId: ctx.profile.shopId, ticketId: id })
    : []
  const partsArrivalResult = await getPartsArrivalForTicket(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
  })
  const partsArrival = partsArrivalResult.ok ? partsArrivalResult.jobs : []

  return (
    <TicketDetailScreen
      ticket={result.ticket}
      canBuildQuote={canBuildQuotes(ctx.profile.role)}
      canCorrectTicket={isTicketCorrectionEnabled() && canAssignWork(ctx.profile.role)}
      canCreateVendorAccount={canManageIntegrations(
        ctx.profile.role,
        isFounder(ctx.user.email),
      )}
      canManageCannedJobs={canManageTeam(
        ctx.profile.role,
        isFounder(ctx.user.email),
      )}
      currentProfileId={ctx.profile.id}
      currentProfileName={ctx.profile.fullName}
      role={ctx.profile.role}
      skillTier={ctx.profile.skillTier}
      team={team}
      ringOut={ringOut}
      partRequests={partRequests}
      partsArrival={partsArrival}
      diagnosticsEntitled={access.entitlements.diagnostics}
      customerCopy={customerCopy}
      refreshCustomerCopyAction={refreshCustomerCopy}
    />
  )
}

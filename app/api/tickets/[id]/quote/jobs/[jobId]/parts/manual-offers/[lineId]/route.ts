import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  manualOfferActorFromProfile,
  manualOfferDomainStatus,
  manualOfferErrorBody,
  publicManualOfferResult,
  removeManualOffer,
} from '@/lib/shop-os/parts-offers'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string; lineId: string }> },
) {
  const context = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!context) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, context.user.id)
  if (denied) return denied
  const { id, jobId, lineId } = await params
  const result = await removeManualOffer(db, {
    actor: manualOfferActorFromProfile(context.profile), ticketId: id, jobId, lineId,
  })
  if (!result.ok) {
    return NextResponse.json(manualOfferErrorBody(result), { status: manualOfferDomainStatus(result) })
  }
  return NextResponse.json(publicManualOfferResult(result), { status: 200 })
}

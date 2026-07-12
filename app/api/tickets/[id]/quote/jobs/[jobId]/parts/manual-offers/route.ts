import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  captureManualOffer,
  manualOfferActorFromProfile,
  manualOfferDomainStatus,
  manualOfferErrorBody,
  publicManualOfferResult,
} from '@/lib/shop-os/parts-offers'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const context = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!context) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, context.user.id)
  if (denied) return denied
  let body: unknown
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { id, jobId } = await params
  const result = await captureManualOffer(db, {
    actor: manualOfferActorFromProfile(context.profile), ticketId: id, jobId, body,
  })
  if (!result.ok) {
    return NextResponse.json(manualOfferErrorBody(result), { status: manualOfferDomainStatus(result) })
  }
  return NextResponse.json(publicManualOfferResult(result), {
    status: result.changed ? 201 : 200,
  })
}

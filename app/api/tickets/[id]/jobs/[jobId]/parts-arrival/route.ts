import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { getPartsArrivalForTicket, partsArrivalErrorBody } from '@/lib/shop-os/parts-arrival'
import { getServerSupabase } from '@/lib/supabase-server'

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(_req: Request, { params }: RouteContext) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE_HEADERS })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  const { id, jobId } = await params
  const result = await getPartsArrivalForTicket(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
  })
  if (!result.ok) {
    const status = result.error === 'invalid_input' ? 400
      : result.error === 'not_found' ? 404 : 409
    return NextResponse.json(partsArrivalErrorBody(result), { status, headers: NO_STORE_HEADERS })
  }
  const job = result.jobs.find((candidate) => candidate.jobId === jobId)
  return job
    ? NextResponse.json({ job }, { status: 200, headers: NO_STORE_HEADERS })
    : NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
}

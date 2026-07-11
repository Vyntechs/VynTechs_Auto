import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  applyCannedJobToTicket,
  cannedJobActorFromProfile,
  cannedJobDomainStatus,
  cannedJobErrorBody,
  publicAppliedCannedJob,
} from '@/lib/shop-os/canned-jobs'
import { getServerSupabase } from '@/lib/supabase-server'

const applyEnvelope = z.strictObject({
  clientKey: z.unknown(),
  cannedJobId: z.unknown(),
  expectedFingerprint: z.unknown(),
  expectedTaxRateBps: z.unknown(),
})

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = applyEnvelope.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }

  const { id } = await params
  const result = await applyCannedJobToTicket(db, {
    actor: cannedJobActorFromProfile(ctx.profile),
    ticketId: id,
    clientKey: parsed.data.clientKey,
    cannedJobId: parsed.data.cannedJobId,
    expectedFingerprint: parsed.data.expectedFingerprint,
    expectedTaxRateBps: parsed.data.expectedTaxRateBps,
  })
  if (!result.ok) {
    return NextResponse.json(cannedJobErrorBody(result), {
      status: cannedJobDomainStatus(result),
    })
  }
  return NextResponse.json(
    { changed: result.changed, job: publicAppliedCannedJob(result.job) },
    { status: result.changed ? 201 : 200 },
  )
}

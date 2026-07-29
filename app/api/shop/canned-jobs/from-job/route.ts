import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { readBoundedJson } from '@/lib/http/bounded-json'
import { rateLimitReject } from '@/lib/rate-limit'
import {
  cannedJobActorFromProfile,
  cannedJobDomainStatus,
  cannedJobErrorBody,
  publicCannedJob,
  saveTicketJobAsCannedJob,
} from '@/lib/shop-os/canned-jobs'
import { getServerSupabase } from '@/lib/supabase-server'

// A canned job saved off a worked ticket is still a library row, so this sits
// with `POST /api/shop/canned-jobs` and answers in the same envelope rather
// than under the ticket it happened to come from. The job id is the only
// locator the domain authorizes on — it scopes the job to the actor's shop
// itself — so no ticket segment is carried that the handler would not read.
const saveEnvelope = z.strictObject({ clientKey: z.unknown(), jobId: z.unknown() })

export async function POST(req: Request) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const limited = await rateLimitReject(
    db,
    `canned-job-from-job:${ctx.profile.shopId}:${ctx.profile.id}`,
    20,
  )
  if (limited) return limited

  const body = await readBoundedJson(req, 4 * 1024)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === 'payload_too_large' ? 413 : 400 })
  }
  const parsed = saveEnvelope.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }

  const result = await saveTicketJobAsCannedJob(db, {
    actor: cannedJobActorFromProfile(
      ctx.profile,
      isFounder(ctx.user.email),
    ),
    jobId: parsed.data.jobId,
    clientKey: parsed.data.clientKey,
  })
  if (!result.ok) {
    return NextResponse.json(cannedJobErrorBody(result), {
      status: cannedJobDomainStatus(result),
    })
  }
  return NextResponse.json(
    { changed: result.changed, cannedJob: publicCannedJob(result.cannedJob) },
    { status: result.changed ? 201 : 200 },
  )
}

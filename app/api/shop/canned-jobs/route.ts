import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  cannedJobActorFromProfile,
  cannedJobDomainStatus,
  cannedJobErrorBody,
  createCannedJob,
  listCannedJobs,
  publicCannedJob,
} from '@/lib/shop-os/canned-jobs'
import { getServerSupabase } from '@/lib/supabase-server'

const createEnvelope = z.strictObject({ clientKey: z.unknown(), cannedJob: z.unknown() })

async function context() {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return null
  const denied = await paywallReject(db, ctx.user.id)
  return denied ? { kind: 'denied' as const, response: denied } : { kind: 'allow' as const, ctx }
}

export async function GET() {
  const access = await context()
  if (!access) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (access.kind === 'denied') return access.response

  const result = await listCannedJobs(db, {
    actor: cannedJobActorFromProfile(
      access.ctx.profile,
      isFounder(access.ctx.user.email),
    ),
  })
  if (!result.ok) {
    return NextResponse.json(cannedJobErrorBody(result), {
      status: cannedJobDomainStatus(result),
    })
  }
  return NextResponse.json({
    cannedJobs: result.cannedJobs.map(publicCannedJob),
    taxRateBps: result.taxRateBps,
  })
}

export async function POST(req: Request) {
  const access = await context()
  if (!access) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (access.kind === 'denied') return access.response

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = createEnvelope.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }

  const result = await createCannedJob(db, {
    actor: cannedJobActorFromProfile(
      access.ctx.profile,
      isFounder(access.ctx.user.email),
    ),
    clientKey: parsed.data.clientKey,
    body: parsed.data.cannedJob,
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

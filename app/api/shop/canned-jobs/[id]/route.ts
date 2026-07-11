import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  cannedJobActorFromProfile,
  cannedJobDomainStatus,
  cannedJobErrorBody,
  publicCannedJob,
  replaceCannedJob,
  retireCannedJob,
} from '@/lib/shop-os/canned-jobs'
import { getServerSupabase } from '@/lib/supabase-server'

const replaceEnvelope = z.strictObject({
  expectedFingerprint: z.unknown(),
  cannedJob: z.unknown(),
})
const retireEnvelope = z.strictObject({ expectedFingerprint: z.unknown() })

async function context() {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return null
  const denied = await paywallReject(db, ctx.user.id)
  return denied ? { kind: 'denied' as const, response: denied } : { kind: 'allow' as const, ctx }
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await context()
  if (!access) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (access.kind === 'denied') return access.response

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = replaceEnvelope.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }
  const { id } = await params
  const result = await replaceCannedJob(db, {
    actor: cannedJobActorFromProfile(
      access.ctx.profile,
      isFounder(access.ctx.user.email),
    ),
    cannedJobId: id,
    expectedFingerprint: parsed.data.expectedFingerprint,
    body: parsed.data.cannedJob,
  })
  if (!result.ok) {
    return NextResponse.json(cannedJobErrorBody(result), {
      status: cannedJobDomainStatus(result),
    })
  }
  return NextResponse.json({
    changed: result.changed,
    cannedJob: publicCannedJob(result.cannedJob),
  })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await context()
  if (!access) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (access.kind === 'denied') return access.response

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = retireEnvelope.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }
  const { id } = await params
  const result = await retireCannedJob(db, {
    actor: cannedJobActorFromProfile(
      access.ctx.profile,
      isFounder(access.ctx.user.email),
    ),
    cannedJobId: id,
    expectedFingerprint: parsed.data.expectedFingerprint,
  })
  if (!result.ok) {
    return NextResponse.json(cannedJobErrorBody(result), {
      status: cannedJobDomainStatus(result),
    })
  }
  return NextResponse.json({
    changed: result.changed,
    cannedJob: publicCannedJob(result.cannedJob),
  })
}

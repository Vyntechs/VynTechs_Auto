import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import {
  getSimpleWorkWorkspace,
  mutateSimpleWork,
  type SimpleWorkFailure,
} from '@/lib/shop-os/simple-work'
import { listPartRequestsForJob } from '@/lib/shop-os/part-requests'
import { getServerSupabase } from '@/lib/supabase-server'

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

function failureResponse(result: SimpleWorkFailure) {
  const status = result.error === 'invalid_input' ? 400
    : result.error === 'not_found' ? 404
      : 409
  return NextResponse.json(
    { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
    { status },
  )
}

async function context() {
  const auth = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!auth) return null
  return auth
}

export async function GET(_req: Request, { params }: RouteContext) {
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { id, jobId } = await params
  const result = await getSimpleWorkWorkspace(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    jobId,
  })
  if (!result.ok) return failureResponse(result)
  const partRequests = await listPartRequestsForJob(db, {
    shopId: ctx.profile.shopId,
    jobId,
  })
  return NextResponse.json({ workspace: result.workspace, partRequests }, { status: 200 })
}

export async function POST(req: Request, { params }: RouteContext) {
  const ctx = await context()
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { id, jobId } = await params
  const result = await mutateSimpleWork(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    jobId,
    body,
  })
  return result.ok
    ? NextResponse.json({ changed: result.changed, work: result.work }, { status: 200 })
    : failureResponse(result)
}

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

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function noStoreResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function failureResponse(result: SimpleWorkFailure) {
  const status = result.error === 'invalid_input' ? 400
    : result.error === 'not_found' ? 404
      : 409
  return noStoreJson(
    { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
    status,
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
  if (!ctx) return noStoreJson({ error: 'unauthenticated' }, 401)
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return noStoreResponse(denied)
  if (!ctx.profile.shopId) return noStoreJson({ error: 'not_found' }, 404)
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
  return noStoreJson({ workspace: result.workspace, partRequests }, 200)
}

export async function POST(req: Request, { params }: RouteContext) {
  const ctx = await context()
  if (!ctx) return noStoreJson({ error: 'unauthenticated' }, 401)
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return noStoreResponse(denied)
  if (!ctx.profile.shopId) return noStoreJson({ error: 'not_found' }, 404)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return noStoreJson({ error: 'invalid_json' }, 400)
  }
  const { id, jobId } = await params
  const result = await mutateSimpleWork(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    jobId,
    body,
  })
  return result.ok
    ? noStoreJson({ changed: result.changed, work: result.work }, 200)
    : failureResponse(result)
}

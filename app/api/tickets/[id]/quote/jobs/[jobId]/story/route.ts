import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  customerStoryDomainStatus,
  customerStoryErrorBody,
  getCustomerStoryWorkspace,
  saveReviewedCustomerStory,
} from '@/lib/shop-os/customer-stories'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  customerStoryReviewTextSchema,
  safeCustomerStoryMeta,
} from '@/lib/shop-os/customer-story-contracts'

const cursorQuery = z.strictObject({
  eventCursor: z.string().min(1).max(1_000).optional(),
})
const reviewEnvelope = z.strictObject({
  clientKey: z.uuid(),
  expectedStoryRevision: z.number().int().nonnegative(),
  whatWeFound: customerStoryReviewTextSchema,
  whatWeRecommend: customerStoryReviewTextSchema,
})

type RouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

async function authenticate() {
  return requireUserAndProfile({ supabase: await getServerSupabase(), db })
}

function invalidInput() {
  return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
}

export async function GET(req: Request, { params }: RouteContext) {
  const ctx = await authenticate()
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  const query = new URL(req.url).searchParams
  if (
    [...query.keys()].some((key) => key !== 'eventCursor') ||
    query.getAll('eventCursor').length > 1
  ) return invalidInput()
  const parsedQuery = cursorQuery.safeParse(Object.fromEntries(query))
  if (!parsedQuery.success) return invalidInput()

  const { id, jobId } = await params
  const result = await getCustomerStoryWorkspace(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
    jobId,
    ...parsedQuery.data,
  })
  if (!result.ok) {
    return NextResponse.json(customerStoryErrorBody(result), {
      status: customerStoryDomainStatus(result),
    })
  }
  return NextResponse.json(result.workspace, { status: 200 })
}

export async function POST(_req: Request, _context: RouteContext) {
  // Legacy AI story generation is intentionally unavailable while diagnostics
  // are off. Keep this fixed response ahead of auth, parsing, and provider
  // code so stale clients and fresh idempotency keys cannot create paid calls
  // or transmit technician observations.
  return NextResponse.json({ error: 'feature_unavailable' }, { status: 404 })
}

export async function PUT(req: Request, { params }: RouteContext) {
  const ctx = await authenticate()
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const body = reviewEnvelope.safeParse(rawBody)
  if (!body.success) return invalidInput()

  const { id, jobId } = await params
  const result = await saveReviewedCustomerStory(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
    jobId,
    ...body.data,
  })
  if (!result.ok) {
    return NextResponse.json(customerStoryErrorBody(result), {
      status: customerStoryDomainStatus(result),
    })
  }
  return NextResponse.json({
    changed: result.changed,
    story: result.story,
    storyMeta: safeCustomerStoryMeta(result.storyMeta),
    storyRevision: result.storyRevision,
  }, { status: 200 })
}

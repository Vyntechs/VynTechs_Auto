import { NextResponse } from 'next/server'
import { z } from 'zod'
import { generateCustomerStory } from '@/lib/ai/customer-story'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  customerStoryDomainStatus,
  customerStoryErrorBody,
  generateAndSaveCustomerStory,
  getCustomerStoryWorkspace,
} from '@/lib/shop-os/customer-stories'
import { getServerSupabase } from '@/lib/supabase-server'

const cursorQuery = z.strictObject({
  eventCursor: z.string().min(1).max(1_000).optional(),
  artifactCursor: z.string().min(1).max(1_000).optional(),
})
const uuidList = z.array(z.uuid()).max(20).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'IDs must be unique' })
  }
})
const generationEnvelope = z.strictObject({
  clientKey: z.uuid(),
  expectedStoryRevision: z.number().int().nonnegative(),
  sourceEventIds: uuidList,
  sourceArtifactIds: uuidList,
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
    [...query.keys()].some((key) => key !== 'eventCursor' && key !== 'artifactCursor') ||
    query.getAll('eventCursor').length > 1 ||
    query.getAll('artifactCursor').length > 1
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

export async function POST(req: Request, { params }: RouteContext) {
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
  const body = generationEnvelope.safeParse(rawBody)
  if (!body.success) return invalidInput()

  const { id, jobId } = await params
  const result = await generateAndSaveCustomerStory(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
    jobId,
    ...body.data,
  }, { generateCustomerStory })
  if (!result.ok) {
    return NextResponse.json(customerStoryErrorBody(result), {
      status: customerStoryDomainStatus(result),
    })
  }
  return NextResponse.json({
    changed: result.changed,
    story: result.story,
    storyMeta: result.storyMeta,
    storyRevision: result.storyRevision,
  }, { status: 200 })
}

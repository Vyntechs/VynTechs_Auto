import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { createAdHocJob, quoteActorFromProfile } from '@/lib/shop-os/quotes'
import { getServerSupabase } from '@/lib/supabase-server'

const createEnvelope = z.strictObject({
  clientKey: z.unknown(),
  job: z.unknown(),
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
  const parsed = createEnvelope.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }

  const { id } = await params
  const result = await createAdHocJob(db, {
    actor: quoteActorFromProfile(ctx.profile),
    ticketId: id,
    clientKey: parsed.data.clientKey,
    body: parsed.data.job,
  })
  if (!result.ok) {
    const status = result.error === 'invalid_input'
      ? 422
      : result.error === 'not_found' ? 404 : 409
    return NextResponse.json(
      result.retryable === true ? { error: result.error, retryable: true } : { error: result.error },
      { status },
    )
  }
  return NextResponse.json(
    { changed: result.changed, job: result.job },
    { status: result.changed ? 201 : 200 },
  )
}

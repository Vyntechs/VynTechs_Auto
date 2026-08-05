import { NextResponse } from 'next/server'
import { z } from 'zod'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import {
  getJobTimerPreference,
  jobTimerPreferenceStatus,
  updateJobTimerPreference,
  type JobTimerPreferenceActor,
} from '@/lib/shop-os/job-timer-preference'
import { getServerSupabase } from '@/lib/supabase-server'

const profileIdSchema = z.string().uuid()
const updateSchema = z.strictObject({
  profileId: profileIdSchema,
  enabled: z.boolean(),
})

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

function actor(ctx: NonNullable<Awaited<ReturnType<typeof requireUserAndProfile>>>): JobTimerPreferenceActor {
  return {
    profileId: ctx.profile.id,
    shopId: ctx.profile.shopId,
    role: ctx.profile.role,
    membershipStatus: ctx.profile.membershipStatus,
    isFounder: isFounder(ctx.user.email),
  }
}

type AccessResult =
  | { ok: true; ctx: NonNullable<Awaited<ReturnType<typeof requireUserAndProfile>>> }
  | { ok: false; response: NextResponse }

async function access(): Promise<AccessResult> {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) return { ok: false, response: noStoreJson({ error: 'unauthenticated' }, 401) }
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return { ok: false, response: noStoreResponse(denied) }
  return { ok: true, ctx }
}

export async function GET(req: Request) {
  const granted = await access()
  if (!granted.ok) return granted.response
  const parsed = profileIdSchema.safeParse(new URL(req.url).searchParams.get('profileId'))
  if (!parsed.success) return noStoreJson({ error: 'invalid_input' }, 422)

  const result = await getJobTimerPreference(db, {
    actor: actor(granted.ctx),
    targetProfileId: parsed.data,
  })
  if (!result.ok) return noStoreJson({ error: result.error }, jobTimerPreferenceStatus(result))
  return noStoreJson({ preference: result.preference }, 200)
}

export async function POST(req: Request) {
  const granted = await access()
  if (!granted.ok) return granted.response

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return noStoreJson({ error: 'invalid_json' }, 400)
  }
  const parsed = updateSchema.safeParse(raw)
  if (!parsed.success) return noStoreJson({ error: 'invalid_input' }, 422)

  const result = await updateJobTimerPreference(db, {
    actor: actor(granted.ctx),
    targetProfileId: parsed.data.profileId,
    enabled: parsed.data.enabled,
  })
  if (!result.ok) return noStoreJson({ error: result.error }, jobTimerPreferenceStatus(result))
  return noStoreJson({ preference: result.preference }, 200)
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  publicVendorAccount,
  updateManualVendorAccount,
  vendorAccountActorFromProfile,
  vendorAccountDomainStatus,
  vendorAccountErrorBody,
} from '@/lib/shop-os/parts'
import { getServerSupabase } from '@/lib/supabase-server'

const updateEnvelope = z.strictObject({
  displayName: z.unknown(),
  enabled: z.unknown(),
  expectedUpdatedAt: z.unknown(),
})

async function context() {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return null
  const denied = await paywallReject(db, ctx.user.id)
  return denied ? { kind: 'denied' as const, response: denied } : { kind: 'allow' as const, ctx }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const access = await context()
  if (!access) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (access.kind === 'denied') return access.response

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = updateEnvelope.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  const { accountId } = await params
  const result = await updateManualVendorAccount(db, {
    actor: vendorAccountActorFromProfile(access.ctx.profile, isFounder(access.ctx.user.email)),
    vendorAccountId: accountId,
    body: parsed.data,
  })
  if (!result.ok) {
    return NextResponse.json(vendorAccountErrorBody(result), { status: vendorAccountDomainStatus(result) })
  }
  return NextResponse.json({
    changed: result.changed,
    vendorAccount: publicVendorAccount(result.vendorAccount),
  })
}

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import {
  createManualVendorAccount,
  listVendorAccounts,
  publicVendorAccount,
  vendorAccountActorFromProfile,
  vendorAccountDomainStatus,
  vendorAccountErrorBody,
} from '@/lib/shop-os/parts'
import { getServerSupabase } from '@/lib/supabase-server'

const createEnvelope = z.strictObject({ clientKey: z.unknown(), displayName: z.unknown() })

async function context() {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return null
  const denied = await paywallReject(db, ctx.user.id)
  return denied ? { kind: 'denied' as const, response: denied } : { kind: 'allow' as const, ctx }
}

function actor(ctx: NonNullable<Awaited<ReturnType<typeof requireUserAndProfile>>>) {
  return vendorAccountActorFromProfile(ctx.profile, isFounder(ctx.user.email))
}

export async function GET(req: Request) {
  const access = await context()
  if (!access) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (access.kind === 'denied') return access.response

  const params = [...new URL(req.url).searchParams.entries()]
  if (params.length > 1 || (params.length === 1 && (params[0][0] !== 'scope' || params[0][1] !== 'all'))) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
  }
  const result = await listVendorAccounts(db, {
    actor: actor(access.ctx),
    scope: params.length === 0 ? 'enabled' : 'all',
  })
  if (!result.ok) {
    return NextResponse.json(vendorAccountErrorBody(result), { status: vendorAccountDomainStatus(result) })
  }
  return NextResponse.json({ vendorAccounts: result.vendorAccounts.map(publicVendorAccount) })
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
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 422 })

  const result = await createManualVendorAccount(db, {
    actor: actor(access.ctx),
    clientKey: parsed.data.clientKey,
    body: { displayName: parsed.data.displayName },
  })
  if (!result.ok) {
    return NextResponse.json(vendorAccountErrorBody(result), { status: vendorAccountDomainStatus(result) })
  }
  return NextResponse.json(
    { changed: result.changed, vendorAccount: publicVendorAccount(result.vendorAccount) },
    { status: result.changed ? 201 : 200 },
  )
}

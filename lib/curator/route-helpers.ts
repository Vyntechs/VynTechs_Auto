import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from './can-curate'

export async function requireCurator(): Promise<
  | { kind: 'ok'; profileId: string }
  | { kind: 'forbidden'; response: NextResponse }
> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      kind: 'forbidden',
      response: NextResponse.json({ error: 'unauthed' }, { status: 401 }),
    }
  }

  const [profile] = await db
    .select({ id: profiles.id, isCurator: profiles.isCurator })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)

  if (!profile || !canCurate(profile.isCurator, user.email)) {
    return {
      kind: 'forbidden',
      response: NextResponse.json({ error: 'forbidden' }, { status: 403 }),
    }
  }

  return { kind: 'ok', profileId: profile.id }
}

/**
 * Server-action helper: returns the curator's profileId, or throws if the
 * caller is not an authenticated curator. Thin wrapper over requireCurator()
 * so server actions (which can't return a NextResponse) get a value-or-throw
 * API. Gating itself is unchanged: requireCurator() keys on profiles.is_curator
 * via canCurate (migration 0018, PR #95) — NOT role.
 */
export async function requireCuratorProfile(): Promise<{ id: string }> {
  const result = await requireCurator()
  if (result.kind === 'forbidden') {
    throw new Error('Forbidden: curator access required')
  }
  return { id: result.profileId }
}

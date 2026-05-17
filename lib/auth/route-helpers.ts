import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'

/**
 * Light-weight auth gate for routes a tech (or any user with a profile +
 * shop) should be able to call. Mirrors `requireCurator` but skips the
 * `canCurate` role check.
 *
 * Use this for read-only endpoints that need to be tech-callable inside
 * an active diagnostic session — e.g. `GET /api/knowledge/[id]` for the
 * citation drawer. Write endpoints (PATCH/DELETE) should keep using
 * `requireCurator`.
 *
 * Returns 401 when the user is unauthenticated OR has no shop yet. Does
 * NOT differentiate the two on purpose — both mean "you can't read shop
 * data."
 */
export async function requireProfile(): Promise<
  | { kind: 'ok'; profileId: string; shopId: string }
  | { kind: 'unauthed'; response: NextResponse }
> {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      kind: 'unauthed',
      response: NextResponse.json({ error: 'unauthed' }, { status: 401 }),
    }
  }

  const [profile] = await db
    .select({ id: profiles.id, shopId: profiles.shopId })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)

  if (!profile || !profile.shopId) {
    return {
      kind: 'unauthed',
      response: NextResponse.json({ error: 'unauthed' }, { status: 401 }),
    }
  }

  return { kind: 'ok', profileId: profile.id, shopId: profile.shopId }
}
